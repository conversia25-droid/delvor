/**
 * Busca dados de empresa pelo CNPJ usando a BrasilAPI (dados da Receita Federal).
 * Grátis, sem cadastro, sem rate-limit agressivo.
 *
 * Docs: https://brasilapi.com.br/docs#tag/CNPJ
 */

export interface CnpjLookupResult {
  cnpj: string;                    // só dígitos
  razao_social: string;
  nome_fantasia: string | null;
  /** "ATIVA", "BAIXADA", "SUSPENSA", "INAPTA", "NULA" */
  situacao_cadastral: string;
  /** Endereço */
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;              // só dígitos
  municipio: string | null;
  uf: string | null;
  /** Contato (DDD já formatado, ex: "31") */
  ddd_telefone_1: string | null;   // "31988887777"
  ddd_telefone_2: string | null;   // opcional, quando a Receita tem dois
  email: string | null;
  /** Atividade principal (CNAE) — útil pra classificar segmento */
  cnae_fiscal_descricao: string | null;
}

const SITUACAO_LABEL: Record<string, string> = {
  "1": "NULA",
  "2": "ATIVA",
  "3": "SUSPENSA",
  "4": "INAPTA",
  "8": "BAIXADA",
};

export type CnpjLookupError =
  | "invalid_cnpj"
  | "not_found"
  | "rate_limited"
  | "network"
  | "unknown";

export async function lookupCnpj(
  cnpj: string,
  signal?: AbortSignal,
): Promise<{ ok: true; data: CnpjLookupResult } | { ok: false; error: CnpjLookupError; message?: string }> {
  const digits = (cnpj || "").replace(/\D+/g, "");
  if (digits.length !== 14) return { ok: false, error: "invalid_cnpj" };

  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, { signal });

    if (res.status === 404) return { ok: false, error: "not_found" };
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (!res.ok) return { ok: false, error: "unknown", message: `HTTP ${res.status}` };

    const json: any = await res.json();

    return {
      ok: true,
      data: {
        cnpj: json.cnpj ? String(json.cnpj).replace(/\D+/g, "") : digits,
        razao_social: json.razao_social || "",
        nome_fantasia: json.nome_fantasia || null,
        situacao_cadastral: SITUACAO_LABEL[String(json.situacao_cadastral)] || String(json.situacao_cadastral || ""),
        logradouro: json.logradouro || null,
        numero: json.numero || null,
        complemento: json.complemento || null,
        bairro: json.bairro || null,
        cep: json.cep ? String(json.cep).replace(/\D+/g, "") : null,
        municipio: json.municipio || null,
        uf: json.uf || null,
        ddd_telefone_1: json.ddd_telefone_1 ? String(json.ddd_telefone_1).replace(/\D+/g, "") : null,
        ddd_telefone_2: json.ddd_telefone_2 ? String(json.ddd_telefone_2).replace(/\D+/g, "") : null,
        email: json.email || null,
        cnae_fiscal_descricao: json.cnae_fiscal_descricao || null,
      },
    };
  } catch (err: any) {
    if (err?.name === "AbortError") return { ok: false, error: "unknown", message: "aborted" };
    return { ok: false, error: "network", message: err?.message };
  }
}

export const CNPJ_ERROR_MESSAGES: Record<CnpjLookupError, string> = {
  invalid_cnpj: "CNPJ deve ter 14 dígitos.",
  not_found: "CNPJ não encontrado na Receita Federal.",
  rate_limited: "Muitas consultas — aguarde alguns segundos.",
  network: "Sem internet ou API indisponível.",
  unknown: "Erro ao consultar — tente novamente.",
};
