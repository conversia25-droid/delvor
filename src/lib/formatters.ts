/**
 * Helpers de formatação BR (CPF, CNPJ, CEP, telefone, moeda).
 * Sem dependência externa para não inflar o bundle.
 */

const onlyDigits = (s: string) => (s || "").replace(/\D+/g, "");

/**
 * Formata uma data no formato pt-BR sem deslocamento por timezone.
 *
 * Bug clássico: `new Date("2026-07-06").toLocaleDateString("pt-BR")` parseia
 * como UTC meia-noite; em BRT (UTC-3) vira 21h do dia 5 e imprime "05/07".
 * Aqui a gente detecta o formato date-only (YYYY-MM-DD) e formata direto,
 * caindo pro Date apenas quando vem datetime completo (que já traz timezone).
 */
export function formatDateBR(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  if (iso instanceof Date) return iso.toLocaleDateString("pt-BR");
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function formatDocument(doc: string | null | undefined): string {
  const d = onlyDigits(doc || "");
  if (d.length === 11) {
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  if (d.length === 14) {
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return doc || "";
}

export function maskDocument(value: string, personType: "PF" | "PJ" | undefined): string {
  const d = onlyDigits(value).slice(0, personType === "PF" ? 11 : 14);
  if (personType === "PF") {
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function maskPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 10) {
    return d
      .replace(/(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

export function maskCep(value: string): string {
  const d = onlyDigits(value).slice(0, 8);
  return d.replace(/(\d{5})(\d{1,3})$/, "$1-$2");
}

export function formatPhone(p: string | null | undefined): string {
  return maskPhone(p || "");
}

export function formatCep(c: string | null | undefined): string {
  return maskCep(c || "");
}

export function formatBRL(value: number | null | undefined): string {
  const v = typeof value === "number" ? value : 0;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Converte número BR (com 11 dígitos) para JID Evolution. */
export function phoneToJid(phone: string | null | undefined): string | null {
  const d = onlyDigits(phone || "");
  if (d.length < 10) return null;
  // Brasileiro DDI 55 + DDD + número (sem máscara)
  const ddi = d.length === 13 || d.length === 12 ? d : `55${d}`;
  return `${ddi}@s.whatsapp.net`;
}

/** ViaCEP — busca endereço pelo CEP. Retorna null se não achar. */
export async function fetchAddressByCep(cep: string): Promise<{
  street?: string;
  district?: string;
  city?: string;
  state?: string;
} | null> {
  const d = onlyDigits(cep);
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    if (!r.ok) return null;
    const j = await r.json();
    if (j.erro) return null;
    return {
      street: j.logradouro,
      district: j.bairro,
      city: j.localidade,
      state: j.uf,
    };
  } catch {
    return null;
  }
}
