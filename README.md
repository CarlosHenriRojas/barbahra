# Barbahra Prospeccao

MVP web para campanhas de prospeccao com importacao de Excel/CSV, modelos de mensagem, fila aprovada, opt-out e envio pela UAZAPI.

## Rodando localmente

```bash
npm install
npm run dev
```

Configure `.env.local` a partir de `.env.example`. O app usa Supabase Auth com email e senha; sem `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`, nao e possivel entrar.

## Supabase

1. Rode as migrations em `supabase/migrations`.
2. Crie uma organizacao em `organizations`.
3. Crie o usuario em Supabase Auth.
4. Crie o perfil em `profiles` vinculando `profiles.id` ao `auth.users.id` e `profiles.organization_id` a organizacao.

As rotas de campanhas, contatos, importacoes e fila exigem sessao autenticada e carregam dados apenas da organizacao do usuario.

## Variaveis obrigatorias

Supabase:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

UAZAPI e worker:

- `UAZAPI_BASE_URL`
- `UAZAPI_TOKEN`
- `UAZAPI_SEND_TEXT_PATH`
- `UAZAPI_SEND_MENU_PATH`
- `UAZAPI_STATUS_PATH`
- `UAZAPI_CHECK_NUMBER_PATH`
- `UAZAPI_WEBHOOK_SECRET`
- `QUEUE_WORKER_SECRET`
- `QUEUE_WORKER_BATCH_SIZE`
- `CRON_SECRET`

Em producao, `UAZAPI_WEBHOOK_SECRET` e `CRON_SECRET`/`QUEUE_WORKER_SECRET` devem estar configurados.

## Fluxo operacional

- Login real via Supabase Auth.
- Criar campanha cria um rascunho no Supabase.
- Importar contatos persiste a lista na campanha e ignora telefones duplicados.
- Modelos de mensagem ficam vinculados a campanha aberta.
- Verificar e aprovar consulta a UAZAPI em `/chat/check` e monta a fila local.
- Iniciar ativa a campanha existente, recria os jobs no banco e nao cria campanha duplicada.
- O worker `/api/worker/process-queue` envia jobs vencidos pela UAZAPI.

## Vercel

O `vercel.json` agenda `/api/worker/process-queue` a cada minuto. Configure `CRON_SECRET`; a Vercel envia esse valor como bearer token para proteger o cron.

## Validacao de release

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```
