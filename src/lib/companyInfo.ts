import { supabase } from "@/integrations/supabase/client";

export interface CompanyHeader {
  id: string;
  name: string;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  logo_url: string | null;
  address: {
    zipcode?: string | null;
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    district?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
}

const cache = new Map<string, { value: CompanyHeader; expiresAt: number }>();
const TTL_MS = 60_000; // 1 minuto — logo/endereço dificilmente mudam durante a sessão

/** Carrega cabeçalho da empresa com cache curto. Usado pelos PDFs. */
export async function loadCompanyHeader(companyId: string): Promise<CompanyHeader | null> {
  const now = Date.now();
  const cached = cache.get(companyId);
  if (cached && cached.expiresAt > now) return cached.value;

  const { data, error } = await supabase
    .from("companies" as any)
    .select("id, name, cnpj, phone, email, logo_url, address")
    .eq("id", companyId)
    .maybeSingle();

  if (error || !data) return null;
  const value = data as any as CompanyHeader;
  cache.set(companyId, { value, expiresAt: now + TTL_MS });
  return value;
}

/**
 * Baixa uma imagem (URL pública) e devolve um data URI **PNG** — formato
 * que o jsPDF sempre consegue embedar. WebP, SVG, GIF e JPEG são
 * re-encodados via canvas, então a logo aparece no PDF independente do
 * formato em que foi salva.
 */
export async function imageToDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await blobToPngDataUrl(blob);
  } catch {
    return null;
  }
}

/** Decodifica um Blob de imagem e re-encoda como PNG (data URI). */
function blobToPngDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) { resolve(null); return; }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
    img.src = objectUrl;
  });
}

/** Monta linha "Endereço completo" pra rodapé/cabeçalho do PDF. */
export function formatCompanyAddress(addr: CompanyHeader["address"]): string {
  if (!addr) return "";
  const parts: string[] = [];
  const street = [addr.street, addr.number].filter(Boolean).join(", ");
  if (street) parts.push(street);
  if (addr.complement) parts.push(addr.complement);
  if (addr.district) parts.push(addr.district);
  if (addr.city || addr.state) {
    parts.push([addr.city, addr.state].filter(Boolean).join("/"));
  }
  if (addr.zipcode) {
    const z = addr.zipcode.replace(/\D+/g, "");
    if (z.length === 8) parts.push(`CEP ${z.slice(0, 5)}-${z.slice(5)}`);
  }
  return parts.join(" — ");
}
