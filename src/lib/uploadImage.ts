/**
 * Upload de arquivos — envia pro MinIO via webhook do n8n.
 *
 * Fluxo: arquivo → base64 → POST no webhook → MinIO → devolve a URL pública.
 *
 *  • uploadImage → imagens (JPEG, PNG, WebP, GIF, SVG)
 *  • uploadFile  → imagens + PDF (usado nos anexos de OS)
 */

const DEFAULT_WEBHOOK_URL =
  "https://infnitycrm.zapcompany.com.br/webhook/infnity-upload-image";

const IMAGE_MIMES = [
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/svg+xml",
];
const DOC_MIMES = ["application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB (o webhook também valida)

/** Valores prontos pro atributo `accept` de <input type=file> — só os formatos suportados. */
export const IMAGE_ACCEPT = IMAGE_MIMES.join(",");
export const FILE_ACCEPT = [...IMAGE_MIMES, ...DOC_MIMES].join(",");

function resolveEnv(name: string): string | undefined {
  if (typeof window !== "undefined") {
    const v = (window as any).__OSM_ENV__?.[name];
    if (typeof v === "string" && v && !v.startsWith("${") && !v.includes("VITE_")) {
      return v;
    }
  }
  return (import.meta.env as any)?.[name];
}

function getWebhookUrl(): string {
  const u = resolveEnv("VITE_IMAGE_UPLOAD_WEBHOOK_URL");
  return u && u.startsWith("http") ? u : DEFAULT_WEBHOOK_URL;
}

/** Converte um File em base64 puro (sem o prefixo data:...;base64,). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf("base64,");
      resolve(idx >= 0 ? result.slice(idx + 7) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export interface UploadResult {
  ok: boolean;
  url?: string;
  key?: string;
  error?: string;
}

async function doUpload(
  file: File,
  allowed: string[],
  hint: string,
): Promise<UploadResult> {
  if (!allowed.includes((file.type || "").toLowerCase())) {
    return { ok: false, error: `Formato não suportado — ${hint}.` };
  }
  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return { ok: false, error: `Arquivo muito grande (${mb} MB). O máximo é 10 MB.` };
  }

  let data: string;
  try {
    data = await fileToBase64(file);
  } catch {
    return { ok: false, error: "Não foi possível ler o arquivo." };
  }

  try {
    const res = await fetch(getWebhookUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, mime: file.type, data }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success || !json?.url) {
      return {
        ok: false,
        error: json?.message || json?.error || `Falha no upload (HTTP ${res.status}).`,
      };
    }
    return { ok: true, url: json.url, key: json.key };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha de rede ao enviar o arquivo." };
  }
}

/** Upload de imagem — JPEG, PNG, WebP, GIF ou SVG. */
export function uploadImage(file: File): Promise<UploadResult> {
  return doUpload(file, IMAGE_MIMES, "use JPEG, PNG, WebP, GIF ou SVG");
}

/** Upload de arquivo — imagens (JPEG/PNG/WebP/GIF/SVG) ou PDF. */
export function uploadFile(file: File): Promise<UploadResult> {
  return doUpload(file, [...IMAGE_MIMES, ...DOC_MIMES], "use uma imagem ou PDF");
}
