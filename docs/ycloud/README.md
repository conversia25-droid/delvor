# YCloud — Integração WhatsApp Oficial

Integração da API oficial do WhatsApp via [YCloud](https://www.ycloud.com/),
usando **n8n self-hosted** como orquestrador.

## Arquitetura

```
[WhatsApp / Meta]
      │
      ▼
[YCloud API]  ◄────── CRM envia (via webhook n8n)
      │
      │ webhook (eventos)
      ▼
[n8n self-hosted]  ──────► [Supabase]
                              │
                              ├── ycloud_webhook_events  (log bruto)
                              ├── ycloud_phone_numbers   (WABA por empresa)
                              ├── ycloud_settings        (credenciais master)
                              └── wpp_conversations      (provider='ycloud')
```

## Fases de implantação

### ✅ Fase 1 — Alicerce master
- SQL [ycloud_setup.sql](../../supabase/sql/ycloud_setup.sql)
- Tela master `/master/ycloud` pra salvar API key + webhook n8n + secret

### ✅ Fase 1.5 — Separação Lite / API
- SQL [ycloud_phone_numbers.sql](../../supabase/sql/ycloud_phone_numbers.sql)
  - Tabela `ycloud_phone_numbers` (WABA por empresa)
  - Coluna `provider` em `wpp_conversations`
- UI: toggles "Lite" / "Oficial" no header do `/chat`

### ⏳ Fase 2.1 — Webhook em modo "log bruto" (você está aqui)
1. SQL [ycloud_webhook_events.sql](../../supabase/sql/ycloud_webhook_events.sql)
2. Importar [n8n-inbound-webhook.json](./n8n-inbound-webhook.json) no n8n
3. Configurar variáveis de ambiente
4. Cadastrar URL do webhook no painel do YCloud
5. Disparar evento de teste e inspecionar `ycloud_webhook_events`

### ⏳ Fase 2.2 — Parsing
Depois de ver payloads reais, a gente monta um fluxo de parsing que:
- Detecta tipo do evento (inbound message, status, template)
- Lookup em `ycloud_phone_numbers` pra achar `company_id`
- Insere em `wpp_conversations` com `provider='ycloud'`
- Atualiza status de mensagens enviadas

### ⏳ Fase 3 — Configuração por empresa
Tela nas Configurações onde o admin da empresa cadastra
o número oficial dele (WABA ID + Phone Number ID).

### ⏳ Fase 4 — Envio de mensagem via n8n
CRM chama webhook n8n → n8n chama YCloud API → resposta volta.

### ⏳ Fase 5 — Templates
Tela de criação e submissão de templates para aprovação da Meta.

---

## Como importar o fluxo fase 2.1 no n8n

### 1. Configure as variáveis de ambiente do n8n

No n8n (arquivo `.env` do docker, ou variáveis do host), adicione:

```env
SUPABASE_URL=https://<seu-projeto>.supabase.co
SUPABASE_SERVICE_ROLE=<service_role key do Supabase>
```

> A chave `service_role` fica em **Supabase Dashboard → Settings → API →
> `service_role` key**. Nunca exponha ela no frontend.

Reinicie o n8n pra pegar as vars.

### 2. Importe o workflow

No n8n:
- Menu **Workflows** → **Import from file**
- Escolha [n8n-inbound-webhook.json](./n8n-inbound-webhook.json)

### 3. Ajuste o shared secret

No node **"Valida Secret"** troque `TROQUE_AQUI_PELO_SHARED_SECRET` pelo
valor que você salvou em **Painel Master → YCloud → Shared Secret**.

### 4. Ative o workflow

Toggle **Active** no canto superior direito. Copie a URL do webhook
(aparece no node Webhook, algo como `https://n8n.seudominio.com/webhook/ycloud`).

### 5. Cadastre o webhook no YCloud

No painel do YCloud:
- **Settings → Webhooks** (ou Developer → Webhook)
- Cole a URL do n8n
- Marque os eventos que quer receber (mensagem recebida, status, etc)
- Salve

O YCloud também geralmente suporta um **header custom** — adicione
`Authorization: Bearer <seu-shared-secret>` pra bater com o secret do n8n.
Se o YCloud não suportar header custom, a gente troca o IF do n8n pra
validar a assinatura HMAC que o YCloud envia (campo `signature` no header).

### 6. Teste

No painel do YCloud tem botão de **"Send test event"** — dispare e veja
se apareceu linha nova em `ycloud_webhook_events`:

```sql
select * from public.ycloud_webhook_events order by received_at desc limit 10;
```

Se apareceu, manda a gente ver. A partir desses payloads reais
montamos a fase 2.2.
