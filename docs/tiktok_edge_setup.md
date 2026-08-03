# TikTok Login (OAuth) via Supabase Edge Functions

Este projeto usa **Supabase Edge Functions** para evitar o problema do seu domínio estar só com front-end (404 no callback).

## 1) Crie as tabelas no Supabase
Execute o SQL:

- `supabase/sql/tiktok_tables.sql`

## 2) Publique as Edge Functions
No terminal do seu projeto:

```bash
supabase functions deploy tiktok-start
supabase functions deploy tiktok-callback
```

## 3) Configure Secrets (NUNCA coloque client_secret no Vite)
```bash
supabase secrets set   TIKTOK_CLIENT_KEY="SEU_CLIENT_KEY"   TIKTOK_CLIENT_SECRET="SEU_CLIENT_SECRET"   TIKTOK_REDIRECT_URI="https://<PROJECT_REF>.functions.supabase.co/tiktok-callback"   SITE_URL="https://infnitylead.com.br"
```

### Observação importante (Redirect URI)
No TikTok Developer Portal, configure a **Redirect URI** exatamente igual ao `TIKTOK_REDIRECT_URI`.

> O endpoint de token v2 é `https://open.tiktokapis.com/v2/oauth/token/` e a autenticação usa o authorize v2 `https://www.tiktok.com/v2/auth/authorize/` (OAuth v2).  
> Ver docs oficiais do TikTok.

## 4) Front-end
O botão "Conectar TikTok" chama `supabase.functions.invoke("tiktok-start")`, que retorna a URL para autorizar.

Após autorizar, o TikTok redireciona para a Edge Function `tiktok-callback`, que:
- troca o `code` por tokens
- busca `/v2/user/info/`
- salva na tabela `tiktok_connections`
- redireciona de volta para `SITE_URL/integrations?tiktok=connected`

## 5) Teste rápido
- Abra **Integrações** no CRM
- Clique em **Conectar TikTok**
- Autorize
- Volte para o CRM e veja o status conectado
