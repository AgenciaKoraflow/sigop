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

## Checklist offline

| # | Item | Resultado | Observação |
|---|------|-----------|------------|
| 1 | Abrir o app sem internet após primeiro acesso | ✅ Passou *(código)* | `next-pwa` com `runtimeCaching` app-shell `NetworkFirst` (`networkTimeoutSeconds: 3`). Offline real → `fetch` falha imediatamente → cache serve sem espera. PWA só ativa em build de produção (`disable` em dev). Rotas precisam ter sido visitadas online (pré-condição do próprio teste). |
| 2 | Criar ocorrência totalmente offline | ✅ Passou *(código)* | `FormOcorrencia` é 100% client-side. `persistDraft()` grava em `draft_incidents` (IndexedDB). Badge **"Rascunho local"** renderiza quando `localStatus === 'draft'` (após 1º autosave de 30 s ou "Salvar rascunho"). |
| 3 | Salvar abordagem com flagrante offline | ✅ Passou *(código)* | `FormAbordagem`: campos do meliante (`subject.*`) funcionam offline; foto do abordado guardada como `Blob` em `offline_settings` (`stop:extras:<id>`); fotos gerais em `pending_photos` como `Blob`. |
| 4 | Tirar foto offline e vincular | ✅ Passou *(código)* | `PhotoUpload`: `<input capture="environment">` → `compressImage()` → `savePendingPhoto()` (Blob em `pending_photos`), preview via `URL.createObjectURL`. Nenhum base64. |
| 5 | Fechar e reabrir app sem internet | ✅ Passou *(código)* | Drafts e blobs persistem em IndexedDB. Telas de detalhe (`DetalheOcorrencia`/`DetalheAbordagem`) e formulários de edição têm fallback "draft local vence" antes de tentar o servidor. |
| 6 | Indicador de sync (offline) | ✅ Passou *(código)* | `SyncIndicator` (status `offline`): _"Sem internet — seus dados serão sincronizados quando a conexão voltar"_. |
| 7 | Voltar online | ✅ Passou *(código)* | `useOnlineStatus`: evento `online` → `syncNow()` → status `syncing` → _"Sincronizando N registros..."_ e `processQueue()` roda. Também dispara em `visibilitychange`. |
| 8 | Sincronização das fotos | ✅ Passou *(código)* — **corrigido** | Upload já funcionava (`processPendingPhotos` → `storage.upload` no bucket privado). **Fix #1**: a exibição estava quebrada (bucket privado + `getPublicUrl`). Agora as leituras assinam URLs (`signPhotoUrls`). |
| 9 | Ausência de duplicatas | ✅ Passou *(código)* | Toda escrita é `upsert({ onConflict: 'id' })` com UUID gerado no cliente; `removeFromQueue` após sucesso; links ignoram erro `duplicate`. Sync repetido é idempotente. |
| 10 | Testar conflito (2 dispositivos) | ✅ Passou *(código)* — **corrigido** | **Fix #2**: antes, o `processQueue` sobrescrevia o servidor sem checar versão (a detecção só existia, e de forma frágil, na tela `/pendentes`). Agora: (a) os formulários gravam `remote_version` = `version` do servidor no momento da edição; (b) `syncItem` chama `assertNoConflict()` antes de todo `update` e joga o item para `error` com mensagem de conflito se o servidor avançou; (c) a tela `/pendentes` usa o baseline real e mostra o diff + resolução (manter local / usar servidor). |

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
| 17 | Zero `localStorage.setItem` para dados de formulário | ✅ Passou *(código)* | `grep` por `localStorage`/`sessionStorage` em `app/`, `components/`, `lib/`, `hooks/`: **nenhuma ocorrência** (apenas comentários em `lib/db` reforçando "IndexedDB only"). Toda persistência via `idb`. |

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
  `components/abordagens/DetalheAbordagem.tsx`, `lib/meliantes/data.ts`,
  `lib/dashboard/data.ts`, `lib/records/data.ts`.
- `lib/sync/queue.ts` deixou de gravar o `public_url` inútil (grava `null`;
  `storage_path` continua sendo a fonte de verdade).

### Fix #2 — Conflito de edição era sobrescrito silenciosamente no auto-sync

**Causa raiz:** `processQueue` fazia `UPDATE ... WHERE id` sem checar versão. A
detecção de conflito existia só na tela `/pendentes` e usava
`remote_version ?? local_version` como baseline — mas `remote_version` nunca era
populado, então o baseline era um contador local sem relação com o servidor.

**Correção:**
- `FormOcorrencia` / `FormAbordagem`: ao carregar um registro para edição,
  guardam o `version` do servidor e o gravam em `draft.remote_version` (baseline
  real de concorrência otimista). `useSyncQueue` recebe `baselineVersion`.
- `lib/sync/queue.ts`: nova `assertNoConflict()` roda antes de todo `update` de
  `incident`/`stop`; se o servidor avançou além do baseline, lança
  `SyncConflictError` e o item vai para `error` com mensagem clara.
- `lib/sync/pendentes.ts`: `loadConflicts` agora só considera drafts com
  `remote_version` conhecido e usa esse valor como baseline.

### Fix #3 — Endurecimento de segurança no banco (`sql/005_security_hardening.sql`)

Arquivo novo, **requer execução manual** no SQL Editor do Supabase:
- `SET search_path = public, pg_temp` nas 7 funções (advisor `function_search_path_mutable`).
- Substitui `storage_insert_authenticated` por `storage_insert_own_folder`
  (upload só na pasta `<auth.uid()>/...`).
- Notas sobre toggles manuais do Dashboard (leaked-password protection, Site URL).

---

## Pendências / não cobertos automaticamente

- **Itens 1, 15 e os fluxos interativos offline (2–7, 10)** — a validação
  definitiva exige DevTools do Chrome (Application > Service Workers, Network >
  Offline) e/ou Lighthouse com o app rodando. Este ambiente não driva o
  navegador; os resultados acima são a conclusão da auditoria de código + build.
- `sql/005_security_hardening.sql` ainda **não aplicado** ao projeto remoto.
- Supabase Dashboard: `Site URL` ainda em `localhost`; "Leaked password
  protection" desligado; "Confirm email" desligado (ok para testes, religar
  antes do rollout).
