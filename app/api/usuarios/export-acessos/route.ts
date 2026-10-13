import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import { adminUnavailable } from '@/lib/api/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptProvisionalPassword } from '@/lib/auth/credential-vault'
import { requireAdmin } from '@/lib/usuarios/guard'
import { parseExportRange } from '@/lib/usuarios/export-range'

const CHUNK = 150
/** Hard ceiling per export — a period this large should be split. */
const MAX_ROWS = 5000

interface ProfileRow {
  id: string
  email: string | null
  created_at: string
}

/**
 * GET /api/usuarios/export-acessos?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Spreadsheet of the accesses created in the period: system link, login,
 * provisional password and operation. The password is only available while the
 * user has not set a permanent one (sql/033); afterwards the cell stays empty.
 */
export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  const url = new URL(request.url)
  const parsed = parseExportRange(url.searchParams.get('from'), url.searchParams.get('to'))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  if (!process.env.PROVISIONAL_CREDENTIALS_KEY) {
    return NextResponse.json(
      { error: 'Exportação indisponível: configure PROVISIONAL_CREDENTIALS_KEY no servidor.' },
      { status: 503 },
    )
  }

  let admin
  try {
    admin = createAdminClient()
  } catch (err) {
    return adminUnavailable(err)
  }
  const db = admin as unknown as SupabaseClient

  const { data: profiles, error } = await db
    .from('profiles')
    .select('id, email, created_at')
    .is('deleted_at', null)
    .not('email', 'is', null)
    .gte('created_at', parsed.range.startIso)
    .lt('created_at', parsed.range.endIso)
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS + 1)
    .returns<ProfileRow[]>()
  if (error) {
    console.error('[usuarios] export list failed:', error.message)
    return NextResponse.json({ error: 'Não foi possível listar os acessos.' }, { status: 500 })
  }
  const rows = profiles ?? []
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Mais de ${MAX_ROWS} acessos no período. Reduza o intervalo de datas.` },
      { status: 400 },
    )
  }

  // Stored (encrypted) provisional passwords of those users.
  const encrypted = new Map<string, string>()
  for (let i = 0; i < rows.length; i += CHUNK) {
    const ids = rows.slice(i, i + CHUNK).map((row) => row.id)
    const { data, error: credError } = await db
      .from('provisional_credentials')
      .select('user_id, password_enc')
      .in('user_id', ids)
    if (credError) {
      console.error('[usuarios] export credentials failed:', credError.message)
      return NextResponse.json(
        { error: 'Não foi possível ler as senhas provisórias. Verifique se a migration 033 foi aplicada.' },
        { status: 500 },
      )
    }
    for (const item of (data ?? []) as { user_id: string; password_enc: string }[]) {
      encrypted.set(item.user_id, item.password_enc)
    }
  }

  // Bulk hand-out of credentials: leave a trail, and refuse if it cannot be written.
  const { error: auditError } = await db.from('audit_log').insert({
    entity_type: 'credentials_export',
    entity_id: gate.userId,
    operation: 'create',
    performed_by: gate.userId,
    new_data: { from: url.searchParams.get('from'), to: url.searchParams.get('to'), accounts: rows.length },
  })
  if (auditError) {
    console.error('[usuarios] export audit failed:', auditError.message)
    return NextResponse.json(
      { error: 'Não foi possível registrar a exportação. Verifique se a migration 033 foi aplicada.' },
      { status: 500 },
    )
  }

  const systemLink = url.origin
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Acessos')
  sheet.columns = [
    { header: 'Link do sistema', key: 'link', width: 38 },
    { header: 'Login', key: 'login', width: 38 },
    { header: 'Senha provisória', key: 'password', width: 22 },
    { header: 'Operação', key: 'operation', width: 24 },
  ]
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  let withoutPassword = 0
  for (const row of rows) {
    const stored = encrypted.get(row.id)
    const password = stored ? await decryptProvisionalPassword(stored, row.id) : null
    if (!password) withoutPassword += 1
    sheet.addRow({ link: systemLink, login: row.email, password: password ?? '', operation: '' })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="acessos_${from}_a_${to}.xlsx"`,
      'Cache-Control': 'no-store, max-age=0',
      'X-Export-Total': String(rows.length),
      'X-Export-Without-Password': String(withoutPassword),
    },
  })
}
