# TikTok Login (Conectar conta TikTok no CRM)

Este projeto continua usando **Supabase Auth (email/senha)** para login do CRM.
O que foi implementado aqui é uma **integração**: o usuário logado pode clicar em **Conectar TikTok**, autorizar no TikTok, e o servidor salva os tokens no Supabase.

## 1) TikTok Developer Portal

No TikTok for Developers:
- Crie/registre seu app.
- Adicione o produto **Login Kit**.
- Configure uma **Redirect URI** (precisa ser HTTPS e estática). A callback do servidor é:
  - `https://SEU_DOMINIO_DO_SERVIDOR/auth/tiktok/callback`

Documentação do fluxo Web / endpoints:
- Authorization: `https://www.tiktok.com/v2/auth/authorize/` citeturn1view0
- Token exchange: `https://open.tiktokapis.com/v2/oauth/token/` citeturn3view0
- User info: `https://open.tiktokapis.com/v2/user/info/` citeturn4search0

## 2) Criar tabela no Supabase

Execute o SQL em `supabase/sql/tiktok_connections.sql`.

> Observação: por padrão, essa tabela guarda `access_token` e `refresh_token`. Se você quiser criptografar os tokens no banco, dá para fazer depois (pelo menos com pgcrypto ou criptografia na aplicação).

## 3) Variáveis de ambiente (servidor)

Crie um `.env` na raiz do projeto com:

- `FRONTEND_URL` (ex.: `https://crm.seudominio.com`)
- `HMAC_SECRET` (qualquer segredo longo)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TIKTOK_CLIENT_KEY`
- `TIKTOK_CLIENT_SECRET`
- `TIKTOK_REDIRECT_URI` (tem que ser exatamente a mesma redirect URI cadastrada no TikTok)

## 4) Rodar o servidor

1. Instale dependências:
   - `npm install`
2. Suba o servidor:
   - `npm run tiktok:server`

Porta padrão: `5174` (mude via `PORT`).

## 5) Frontend

A tela **Configurações → Integrações → TikTok** abre o modal e dispara o fluxo.
Após conectar com sucesso, você volta para o CRM e a integração aparece como conectada.
