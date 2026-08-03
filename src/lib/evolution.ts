/**
 * Cliente HTTP da Evolution API (v2).
 *
 * Lê URL + API Key do runtime config (`window.__OSM_ENV__`), com fallback
 * pra `import.meta.env` em dev. Se não estiverem configuradas, todas as
 * chamadas retornam `null` / `false` e o sistema cai pro modo `wa.me`.
 *
 * Endpoints usados (Evolution API v2):
 *   POST   /instance/create
 *   GET    /instance/connect/:name
 *   GET    /instance/connectionState/:name
 *   DELETE /instance/logout/:name
 *   DELETE /instance/delete/:name
 *   POST   /message/sendText/:name
 *   GET    /instance/fetchInstances?instanceName=:name
 *
 * O `apikey` é passado no header de toda request.
 */

/* ====================================================================
   ENV
==================================================================== */
function resolveEnv(name: "VITE_EVOLUTION_URL" | "VITE_EVOLUTION_API_KEY"): string | undefined {
  if (typeof window !== "undefined") {
    const w = (window as any).__OSM_ENV__;
    const v = w?.[name];
    if (typeof v === "string" && v && !v.startsWith("${") && !v.includes("VITE_")) {
      return v;
    }
  }
  return (import.meta.env as any)?.[name];
}

export function getEvolutionConfig(): { url: string; apiKey: string } | null {
  const url = resolveEnv("VITE_EVOLUTION_URL");
  const apiKey = resolveEnv("VITE_EVOLUTION_API_KEY");
  if (!url || !apiKey) return null;
  // Remove trailing slash pra normalizar
  return { url: url.replace(/\/+$/, ""), apiKey };
}

export function isEvolutionConfigured(): boolean {
  return getEvolutionConfig() !== null;
}

/* ====================================================================
   FETCH WRAPPER
==================================================================== */
type EvolutionMethod = "GET" | "POST" | "DELETE" | "PUT";

async function evoFetch<T = any>(
  path: string,
  method: EvolutionMethod = "GET",
  body?: unknown
): Promise<T> {
  const cfg = getEvolutionConfig();
  if (!cfg) {
    throw new Error("Evolution API não configurada. Defina VITE_EVOLUTION_URL e VITE_EVOLUTION_API_KEY no env.");
  }
  const url = `${cfg.url}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: cfg.apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // resposta não-JSON — passa string crua
  }
  if (!res.ok) {
    const msg = json?.response?.message || json?.message || text || `HTTP ${res.status}`;
    const message = Array.isArray(msg) ? msg.join(", ") : String(msg);
    throw new Error(message);
  }
  return json as T;
}

/* ====================================================================
   INSTANCE NAME HELPER
==================================================================== */
/** Converte um company_id (UUID) em nome de instância seguro pra Evolution. */
export function companyIdToInstanceName(companyId: string): string {
  // Evolution aceita letras/números/underscore. Usa "osm_<uuid-sem-hifens>".
  return `osm_${companyId.replace(/-/g, "")}`;
}

/* ====================================================================
   API METHODS
==================================================================== */

export type InstanceState = "open" | "connecting" | "close" | "unknown";

export interface InstanceStatus {
  state: InstanceState;
  /** Número conectado (com DDI), se houver. */
  ownerJid?: string | null;
  /** Nome do contato (push name) quando disponível. */
  profileName?: string | null;
  /** URL da foto, se exposta. */
  profilePictureUrl?: string | null;
}

/** Cria a instância na Evolution. Idempotente: se já existe, devolve sucesso. */
export async function createInstance(name: string): Promise<void> {
  try {
    await evoFetch("/instance/create", "POST", {
      instanceName: name,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    });
  } catch (e: any) {
    const msg = String(e?.message || "");
    // "already in use" / "exists" — não é erro real
    if (/already|exists|in use/i.test(msg)) return;
    throw e;
  }
}

/** Abre o pareamento e retorna o QR (base64 data URL) + estado atual. */
export async function connectInstance(name: string): Promise<{
  base64?: string | null;
  state: InstanceState;
}> {
  const r = await evoFetch<any>(`/instance/connect/${encodeURIComponent(name)}`);
  // Forma 1: { base64: "data:image/png;base64,..." }
  // Forma 2: { instance: { state: "open" } } (quando já conectado)
  // Forma 3: { code: "...", pairingCode: "...", base64: "..." }
  if (r?.instance?.state) {
    return { state: r.instance.state, base64: r.base64 || null };
  }
  return {
    base64: r?.base64 || null,
    state: r?.base64 ? "connecting" : "unknown",
  };
}

/** Retorna o estado atual de conexão. */
export async function getInstanceStatus(name: string): Promise<InstanceStatus> {
  try {
    const r = await evoFetch<any>(`/instance/connectionState/${encodeURIComponent(name)}`);
    const state: InstanceState = (r?.instance?.state || r?.state || "unknown") as InstanceState;
    return { state };
  } catch (e: any) {
    // 404 = instância não existe
    return { state: "unknown" };
  }
}

/** Busca informações detalhadas (inclui número conectado). */
export async function fetchInstanceInfo(name: string): Promise<InstanceStatus> {
  try {
    const r = await evoFetch<any>(`/instance/fetchInstances?instanceName=${encodeURIComponent(name)}`);
    const arr = Array.isArray(r) ? r : (r ? [r] : []);
    const inst = arr[0];
    if (!inst) return { state: "unknown" };
    const state: InstanceState = (inst?.instance?.state || inst?.connectionStatus || inst?.state || "unknown") as InstanceState;
    return {
      state,
      ownerJid: inst?.instance?.owner || inst?.ownerJid || inst?.owner || null,
      profileName: inst?.instance?.profileName || inst?.profileName || null,
      profilePictureUrl: inst?.instance?.profilePictureUrl || inst?.profilePictureUrl || null,
    };
  } catch {
    return { state: "unknown" };
  }
}

/** Desconecta (logout) — preserva a instância pra reconectar com novo QR. */
export async function disconnectInstance(name: string): Promise<void> {
  try {
    await evoFetch(`/instance/logout/${encodeURIComponent(name)}`, "DELETE");
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (/not.*found|404|not.*connected/i.test(msg)) return;
    throw e;
  }
}

/** Apaga a instância da Evolution. */
export async function deleteInstance(name: string): Promise<void> {
  try {
    await evoFetch(`/instance/delete/${encodeURIComponent(name)}`, "DELETE");
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (/not.*found|404/i.test(msg)) return;
    throw e;
  }
}

/** Lista todas as instâncias existentes no servidor Evolution. */
export async function listInstances(): Promise<Array<{
  name: string;
  state: InstanceState;
  ownerJid?: string | null;
  profileName?: string | null;
}>> {
  const r = await evoFetch<any>("/instance/fetchInstances");
  const arr = Array.isArray(r) ? r : [];
  return arr.map((inst) => {
    // Compatibilidade com várias versões do Evolution v2:
    //  - { instance: { instanceName, state, owner, profileName } }
    //  - { name, connectionStatus, ownerJid, profileName }
    const innerInst = inst?.instance || inst;
    const name = innerInst?.instanceName || innerInst?.name || inst?.name || "";
    const state: InstanceState = (innerInst?.state || innerInst?.connectionStatus || "unknown") as InstanceState;
    return {
      name,
      state,
      ownerJid: innerInst?.owner || innerInst?.ownerJid || null,
      profileName: innerInst?.profileName || null,
    };
  }).filter((i) => i.name);
}

/** Envia mensagem de texto. Number deve estar em formato E.164 sem +. */
export async function sendText(
  name: string,
  numberE164: string,
  text: string
): Promise<{ id?: string }> {
  const r = await evoFetch<any>(
    `/message/sendText/${encodeURIComponent(name)}`,
    "POST",
    {
      number: numberE164,
      text,
    }
  );
  return { id: r?.key?.id || r?.id };
}
