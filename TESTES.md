# SIGOP — Testes de aceitação

Data da execução: **2026-09-02**
Branch: `main` · Build: `next build` ✅ (exit 0) · `tsc --noEmit` ✅ · `next lint` ✅

## Método

Os itens marcam a forma de verificação:

- **[código]** — auditoria estática do código-fonte + build de produção.
- **[infra]** — consulta direta ao projeto Supabase (RLS, buckets, advisors) via MCP.
- **[bundle]** — inspeção do artefato `.next/` gerado pelo build de produção.
- **[manual]** — requer DevTools do Chrome com o app rodando (Service Workers /
  Network Offline); **não executável neste ambiente** — resultado abaixo é a
  conclusão da auditoria de código do fluxo correspondente.

Correções aplicadas nesta rodada estão em **Fixes** ao final.

---

## Checklist de segurança

| # | Item | Resultado | Observação |
|---|------|-----------|------------|
| 11 | Rota protegida sem login → `/login` | ✅ Passou *(código)* | `middleware.ts`: `!user && !pathname.startsWith('/login')` → `redirect('/login')`. `matcher` cobre tudo exceto assets estáticos/`sw.js`/`manifest.json`. `ProtectedRoute` adiciona gate por papel no `/dashboard`. |
| 12 | `SUPABASE_SERVICE_ROLE_KEY` ausente do bundle JS | ✅ Passou *(bundle)* | `.next/static/**` contém **1 único JWT**, que decodifica para `"role":"anon"`. Nenhuma ocorrência de `service_role`/`SERVICE_ROLE_KEY` no bundle cliente (só em JSDoc de sourcemap server-side da lib `@supabase/supabase-js`). `.env.local` só tem `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| 13 | Foto por URL direta sem auth → negado | ✅ Passou *(infra)* | Bucket `operational-photos` é **privado** (`public = false`). Políticas de `storage.objects` exigem `auth.uid() IS NOT NULL` em SELECT. Acesso sem token → negado. Usuários legítimos recebem **signed URLs** (validade 1 h) — ver Fix #1. |
| 14 | RLS ativo em todas as tabelas | ✅ Passou *(infra)* | 9/9 tabelas em `public` com `rowsecurity = true` e políticas: `audit_log`, `incidents`, `incident_offenders`, `offenders`, `photos`, `profiles`, `stops`, `stop_offenders`, `units` + `storage.objects`. `audit_log` sem UPDATE/DELETE (imutável). Detalhes das WARN de advisor abaixo. |

### Advisors de segurança do Supabase (pré-existentes)

Não bloqueiam os testes; **Fix #3** (`sql/005_security_hardening.sql`) endereça os itens acionáveis por SQL. Requer aplicação manual (o classificador do ambiente bloqueou DDL automática na base de produção).

- `function_search_path_mutable` (7 funções, incl. `my_role`/`my_unit` SECURITY DEFINER usadas nas policies) → `ALTER FUNCTION ... SET search_path` no 005.
- `storage_insert_authenticated` não restringia upload à própria pasta do uid → policy `storage_insert_own_folder` no 005.
- `auth_leaked_password_protection` desabilitado → toggle manual no Dashboard.
- `anon/authenticated_security_definer_function_executable`, `extension_in_public (unaccent)` → baixo risco, notas no 005.

## Checklist de performance

| # | Item | Resultado | Observação |
|---|------|-----------|------------|
| 15 | FCP < 3 s em 4G simulado | ⚠️ Não medido *(manual)* | Requer Lighthouse com o app servido. Tamanhos do build: `/` 200 kB, `/login` 193 kB First Load JS (dentro do normal). `/dashboard` 356 kB (Recharts) — pesado, mas não é rota de entrada. Recomenda-se rodar Lighthouse antes do rollout. |
| 16 | Fotos após compressão < 5 MB, largura máx 1200px | ✅ Passou *(código)* | `lib/fotos/compress.ts`: `maxWidth/maxHeight = 1200` (nunca faz upscale, mantém aspect ratio), `maxSizeMB = 5` com loop de re-encode reduzindo `quality` até 0.4. Bucket também impõe `file_size_limit = 5242880`. |
| 17 | Zero `localStorage.setItem` para dados de formulário | ✅ Passou *(código)* | `grep` por `localStorage`/`sessionStorage` em `app/`, `components/`, `lib/`, `hooks/`: **nenhuma ocorrência**. Formulários gravam direto no Supabase, sem persistência local. |

---

## Fixes aplicados

### Fix #1 — Fotos não exibiam (bucket privado + `getPublicUrl`)

**Causa raiz:** o bucket `operational-photos` é privado, mas todo o código de
leitura usava `getPublicUrl()` / a coluna `photos.public_url`. URLs públicas de
bucket privado retornam 400 → nenhuma foto aparecia nas telas de detalhe,
miniaturas do dashboard, lista de registros nem avatares de meliante.

**Correção:**
- Novo `lib/fotos/urls.ts` → `signPhotoUrls(client, paths)` gera signed URLs em
  lote (TTL 1 h) a partir de `storage_path`.
- Passaram a assinar no momento da leitura: `components/ocorrencias/DetalheOcorrencia.tsx`,
  `lib/meliantes/data.ts`, `lib/dashboard/data.ts`, `lib/records/data.ts`.

### Fix #3 — Endurecimento de segurança no banco (`sql/005_security_hardening.sql`)

Arquivo novo, **requer execução manual** no SQL Editor do Supabase:
- `SET search_path = public, pg_temp` nas 7 funções (advisor `function_search_path_mutable`).
- Substitui `storage_insert_authenticated` por `storage_insert_own_folder`
  (upload só na pasta `<auth.uid()>/...`).
- Notas sobre toggles manuais do Dashboard (leaked-password protection, Site URL).

---

## Pendências / não cobertos automaticamente

- **Item 15** — a validação definitiva exige Lighthouse com o app rodando.
  Este ambiente não driva o navegador; o resultado acima é a conclusão da
  auditoria de código + build.
- `sql/005_security_hardening.sql` ainda **não aplicado** ao projeto remoto.
- Supabase Dashboard: `Site URL` ainda em `localhost`; "Leaked password
  protection" desligado; "Confirm email" desligado (ok para testes, religar
  antes do rollout).
