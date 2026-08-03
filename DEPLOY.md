# Deploy — Delvor / InfnityServices

Guia passo-a-passo pra subir no **EasyPanel** com domínio no **Cloudflare** e SSL automático.

## Pré-requisitos

- VPS com EasyPanel instalado e funcionando
- Domínio gerenciado no Cloudflare (DNS)
- Repositório no GitHub (já criado)
- Projeto Supabase Cloud configurado

---

## 1. Cloudflare — apontar DNS pra VPS

### 1.1 Pega o IP da VPS
No painel do seu provedor (DigitalOcean, Hetzner, Contabo, etc), copie o IP público da VPS onde o EasyPanel está rodando.

### 1.2 Cria o registro A no Cloudflare
1. Acesse **Cloudflare → Dashboard → seu domínio → DNS → Records**
2. **Add record**:
   - **Type:** `A`
   - **Name:** `app` (vai gerar `app.seudominio.com.br`) ou `@` se for o domínio raiz
   - **IPv4 address:** IP da VPS
   - **Proxy status:** clique no nuvem ☁️ — **deixe DNS only (cinza)** durante a primeira configuração com Let's Encrypt. Depois pode ligar pra "Proxied" (laranja).
   - **TTL:** Auto
3. Salve.

> **Por que DNS only no início?** O Let's Encrypt precisa que o EasyPanel responda em HTTP-01 challenge no IP real. Com proxy ligado, o Cloudflare intercepta e quebra. Depois do certificado emitido, ligue o proxy.

### 1.3 (Opcional) SSL Mode no Cloudflare
**Cloudflare → SSL/TLS → Overview** → **Full (strict)**. Isso garante que tanto Cloudflare↔Visitor quanto Cloudflare↔VPS sejam HTTPS.

---

## 2. EasyPanel — criar o projeto

### 2.1 Login
Acesse `https://easypanel.SUA-VPS.com.br` (ou o IP direto no porta 3000).

### 2.2 Cria projeto
**+ Project** → nome `delvor` (ou `infnityservices`).

### 2.3 Adiciona o app
Dentro do projeto, **+ Service → App**.
- **Source:** **GitHub**
  - Conecta sua conta (ou usa Public Git e cola URL `https://github.com/conversia25-droid/InfnityServices`)
  - **Branch:** `main`
- **Build:** **Dockerfile** (autodetectado se o arquivo está na raiz)
- **Build Path:** `.` (raiz do repo)
- **Dockerfile Path:** `Dockerfile`

### 2.4 Variáveis de ambiente (build-time)
Na aba **Environment** do app, adicione:

| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://SEU-PROJETO.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `eyJhbGciOiJIUzI1NiI...` (anon/publishable key) |

> Pega esses valores em **Supabase Dashboard → Project Settings → API**.

### 2.5 Domínio
Aba **Domains** → **+ Add Domain**:
- **Host:** `app.seudominio.com.br` (o mesmo do registro A)
- **HTTPS:** ON
- **Path:** `/`
- **Port:** `80` (porta interna do nginx)

EasyPanel vai automaticamente solicitar certificado Let's Encrypt. **Aguarde alguns minutos** — confira o status na mesma tela.

### 2.6 Deploy
Aba **Deployments** → **Deploy**.

Vai puxar do GitHub, rodar o `Dockerfile` (build do Vite + nginx) e iniciar. Logs em tempo real na mesma tela.

Tempo típico: 2–4 minutos.

---

## 3. Pós-deploy — checklist

### 3.1 Acessa o site
Abre `https://app.seudominio.com.br` — você deve ver a landing do Delvor.

### 3.2 Teste login
Use o email/senha que cadastrou no Supabase Cloud (passos 4 e 5 do `setup_cloud.sql`).

### 3.3 Liga proxy do Cloudflare (opcional, recomendado)
Volta no Cloudflare DNS → clica no ☁️ pra virar laranja **Proxied**. Ganha:
- Cache global de assets
- DDoS protection
- Esconde o IP real da VPS

### 3.4 Atualizar `redirectTo` do Auth (Supabase)
**Supabase Dashboard → Authentication → URL Configuration**:
- **Site URL:** `https://app.seudominio.com.br`
- **Redirect URLs:** adicione `https://app.seudominio.com.br/update-password`

Sem isso, reset de senha não vai funcionar.

---

## 4. Atualizações futuras

Sempre que você fizer push no GitHub:

1. EasyPanel detecta automaticamente (se você ativou **Auto Deploy** no app)
2. OU manualmente: **Deployments → Deploy**

Tempo de build: 2–4 minutos.

> Se mudou alguma `VITE_*` → precisa **Rebuild** (não só restart). Vite compila essas variáveis no momento do build.

---

## 5. Edge Functions (opcional)

A função `admin-create-user` (Equipe → criar membro sem deslogar) precisa ser publicada à parte:

```bash
cd C:\Users\MAQUINA06\Documents\InfnityServices
supabase login
supabase link --project-ref SEU-PROJECT-REF
supabase functions deploy admin-create-user
```

Sem isso, a tela Equipe → Novo membro vai dar erro 404 ao tentar criar usuário. Mas é o único impacto.

---

## 6. Troubleshooting

### Build falha: "Failed to install dependencies"
Verifique se o EasyPanel tem RAM suficiente (Vite + recharts precisam de ~1.5GB pra buildar). Se a VPS é pequena, suba a swap.

### Site abre mas vê tela branca
Abre o DevTools (F12) → Console. Se ver erro de variável Supabase undefined:
- Vá em **EasyPanel → seu app → Environment**
- Confira que `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` estão setadas
- Clique **Rebuild** (não só Restart) — Vite compila as vars no build, não no runtime

### "Mixed content" warnings
Se o domínio é HTTPS mas o app tenta acessar Supabase em HTTP, força HTTPS no `.env` (`VITE_SUPABASE_URL=https://...`).

### Cloudflare 525 / 526 / SSL errors
Cloudflare → SSL/TLS → modo **Full** ou **Full (strict)**. Não use **Flexible** (cria loop).

### F5 dá 404 em rotas internas (ex: `/dashboard`)
O `nginx.conf` que mandei já trata isso (SPA fallback). Se mesmo assim acontecer, confirme que o arquivo foi incluído no container (dentro do EasyPanel, abre o terminal do app e roda `cat /etc/nginx/conf.d/default.conf`).
