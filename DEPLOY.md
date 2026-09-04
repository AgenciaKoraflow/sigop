# Deploy — SIGOP

Ambiente de **testes** hospedado na Vercel, com PWA instalável.

## URL de produção

```
https://sigop-five.vercel.app
```

Projeto Vercel: `agenciakoraflows-projects/sigop`.

## Variáveis de ambiente

Configuradas em **Vercel > Project Settings > Environment Variables** (escopo *Production* — e *Preview* se for usar deploys de PR):

| Variável                        | Onde pegar                                                   | Exposta ao browser? |
| -------------------------------- | -------------------------------------------------------------- | -------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | Supabase > Project Settings > API > Project URL               | Sim (prefixo `NEXT_PUBLIC_`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Supabase > Project Settings > API > `anon` `public` key       | Sim |
| `SUPABASE_SERVICE_ROLE_KEY`      | Supabase > Project Settings > API > `service_role` key        | **Não** — somente usada pelos Route Handlers de `app/api/usuarios/*` (criação/edição de contas). Nunca prefixar com `NEXT_PUBLIC_`. |

As três já estão configuradas em produção (escopo *Production* apenas — não há *Preview*/*Development* configurado na Vercel ainda, então PRs de preview vão falhar até isso ser adicionado). Os valores atuais de desenvolvimento estão em `.env.local` (não versionado) — não faça commit desse arquivo.

Depois de configurar/alterar variáveis, é preciso **redeploy** (a Vercel não aplica env vars novas a builds já existentes): `vercel --prod` de novo, ou "Redeploy" no dashboard.

## Deploy inicial (já feito) / redeploy

O deploy inicial já foi feito via CLI com um token de acesso pessoal (`vercel.com/account/tokens`), rodando na WSL. Projeto: `agenciakoraflows-projects/sigop`.

Para redeployar depois de mudanças:

```bash
npx vercel --prod
```

(Se a máquina não tiver a CLI logada/linkada, rode `npx vercel login` e `npx vercel link` primeiro, ou passe `--token <seu-token>` em cada comando.)

## Pós-deploy — configuração no Supabase

> ⚠️ **Pendente** — precisa ser feito manualmente no dashboard do Supabase (não existe ferramenta MCP para essa configuração).

No painel do Supabase do projeto (**Authentication > URL Configuration**):

- **Site URL**: trocar de `localhost` para `https://sigop-five.vercel.app`.
- **Redirect URLs**: adicionar `https://sigop-five.vercel.app/auth/callback`.
  > O login atual do SIGOP é e-mail/senha puro (`signInWithPassword`, sem OAuth/magic link), então essa rota não é usada na prática hoje — mas deixe cadastrada para não travar se um fluxo de redirect (reset de senha, convite) for ativado depois.

## Como criar novos usuários

Não existe cadastro público — só um administrador pode criar contas:

1. Login como administrador (o primeiro admin, `ferramentas@koraflow.com.br`, já existe em produção/dev — role `administrator`).
2. Acesse **/usuarios > Novo usuário**.
3. Preencha e-mail, nome, cargo (`role`) e uma senha provisória.
4. O formulário chama `POST /api/usuarios`, que usa a `service_role` key (`lib/supabase/admin.ts`) para criar o login via `admin.auth.admin.createUser` com `email_confirm: true` — a conta já nasce confirmada, sem precisar de e-mail de verificação.
5. Passe a senha provisória ao novo usuário por um canal separado (não fica visível de novo depois de criada).

Reset de senha de um usuário existente: `/usuarios/[id]` > ação de reset (chama `POST /api/usuarios/[id]/reset-password`).

## Como atualizar o banco (nova migration)

O projeto não usa a Supabase CLI para migrations — os arquivos em `sql/NNN_*.sql` são aplicados manualmente, em ordem, pelo **SQL Editor** do dashboard Supabase:

1. Crie o próximo arquivo numerado em `sql/` (ex.: `007_descricao.sql`), seguindo o padrão dos anteriores (nomes em inglês, comentário de cabeçalho explicando o quê e por quê).
2. Cole o conteúdo no SQL Editor do projeto Supabase e rode.
3. Se a migration mexer em função `SECURITY DEFINER`/RLS, confira **Database > Advisors** depois (pode reintroduzir warnings de `search_path`, ver `005_security_hardening.sql`).
4. Se mudou o schema público, regenere os tipos: `npm run gen:types` (grava em `types/database.types.ts`) e commit o resultado.
5. Rode `npm run type-check` antes de commitar — mudanças de schema costumam quebrar tipos em call sites.

Não existe rollback automático: migrations são SQL direto contra produção. Para mudanças arriscadas, teste antes num branch Supabase (`mcp__supabase__create_branch`) ou num projeto de staging separado.

## Backup e procedimentos de emergência

- **Backup do banco**: a Supabase faz backup diário automático em projetos pagos (verificar plano do projeto — free tier não tem PITR). Para um snapshot manual antes de uma migration arriscada: `pg_dump` via connection string (Project Settings > Database) ou usar a opção de backup do dashboard.
- **Rollback de deploy**: no dashboard da Vercel, **Deployments** > escolha um deploy anterior > **Promote to Production** (instantâneo, não precisa rebuild).
- **Chave comprometida**: se a `SUPABASE_SERVICE_ROLE_KEY` vazar, gere uma nova em Supabase > Project Settings > API > "Roll" e atualize a env var na Vercel + redeploy imediatamente — essa chave dá acesso total ao banco, ignorando RLS.
- **Fora do ar**: confira primeiro `vercel logs <url>` e Supabase > Logs (a MCP tool `query_logs` também serve para isso) antes de reverter — muitas vezes é env var faltando ou uma RLS policy nova bloqueando uma rota.
- **Trava de sync offline**: dados pendentes ficam em IndexedDB no dispositivo do usuário (ver `/pendentes`); um usuário travado pode limpar em "Sair mesmo assim" (perde o que não sincronizou) — não é recuperável pelo backend.
