/**
 * Parser de NF-e (modelo 55) — extrai os campos que importam pra dar
 * entrada no estoque. Funciona com XML padrão SEFAZ v4.00, com ou sem
 * o wrapper <nfeProc>.
 *
 * NÃO valida assinatura nem chave de acesso na SEFAZ. Apenas extrai
 * dados do XML como ele veio. Validação fiscal é responsabilidade do
 * sistema do fornecedor.
 */

export interface NfeEmitente {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  ie: string | null;
  endereco: {
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    municipio: string | null;
    uf: string | null;
    cep: string | null;
  } | null;
  fone: string | null;
}

export interface NfeItem {
  /** Número do item na NF (1, 2, 3...) */
  nItem: number;
  /** Código do produto no fornecedor (cProd) */
  cProd: string;
  /** Código de barras EAN (cEAN), se houver */
  cEAN: string | null;
  /** Descrição do produto (xProd) */
  xProd: string;
  /** NCM fiscal */
  NCM: string | null;
  /** CFOP */
  CFOP: string | null;
  /** Unidade comercial (uCom): UN, CX, KG, etc */
  uCom: string;
  /** Quantidade (qCom) */
  qCom: number;
  /** Valor unitário (vUnCom) */
  vUnCom: number;
  /** Valor total da linha (vProd) */
  vProd: number;
}

export interface NfeData {
  /** Chave de acesso de 44 dígitos */
  chave: string | null;
  /** Número da NF */
  nNF: string;
  /** Série */
  serie: string;
  /** Data/hora de emissão (ISO) */
  dhEmi: string | null;
  emitente: NfeEmitente;
  /** Destinatário (CNPJ/CPF + nome) — útil pra checar se é a empresa correta */
  destinatario: { documento: string; nome: string } | null;
  itens: NfeItem[];
  /** Valor total dos produtos */
  vProd: number;
  /** Valor total da NF */
  vNF: number;
}

/* ====================================================================
   HELPERS
==================================================================== */
function getText(parent: Element | Document | null, tag: string): string | null {
  if (!parent) return null;
  const el = (parent as any).getElementsByTagName(tag)[0] as Element | undefined;
  return el?.textContent?.trim() || null;
}

function getNumber(parent: Element | Document | null, tag: string): number {
  const v = getText(parent, tag);
  if (!v) return 0;
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

/* ====================================================================
   PARSER
==================================================================== */
export function parseNfeXml(xmlText: string): NfeData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");

  // Detecta erro de parsing
  const parseError = doc.getElementsByTagName("parsererror")[0];
  if (parseError) {
    throw new Error("Arquivo XML inválido. Verifique se o arquivo é uma NF-e.");
  }

  // Localiza <infNFe> (raiz lógica da nota)
  const infNFe = doc.getElementsByTagName("infNFe")[0];
  if (!infNFe) {
    throw new Error("Estrutura de NF-e não reconhecida (não achei <infNFe>).");
  }

  // ---- Identificação (ide) ----
  const ide = infNFe.getElementsByTagName("ide")[0];
  const nNF = getText(ide, "nNF") || "";
  const serie = getText(ide, "serie") || "";
  const dhEmi = getText(ide, "dhEmi");

  // ---- Chave de acesso ----
  // 1) Em <infProt>/<chNFe> (caso XML protocolado)
  // 2) Senão, no atributo Id de <infNFe> (formato "NFe" + 44 dígitos)
  let chave: string | null = getText(doc, "chNFe");
  if (!chave) {
    const idAttr = infNFe.getAttribute("Id") || "";
    const m = idAttr.match(/(\d{44})/);
    if (m) chave = m[1];
  }

  // ---- Emitente ----
  const emit = infNFe.getElementsByTagName("emit")[0];
  const enderEmit = emit?.getElementsByTagName("enderEmit")[0];
  const emitente: NfeEmitente = {
    cnpj: (getText(emit, "CNPJ") || "").replace(/\D+/g, ""),
    razao_social: getText(emit, "xNome") || "",
    nome_fantasia: getText(emit, "xFant"),
    ie: getText(emit, "IE"),
    fone: getText(enderEmit || emit, "fone"),
    endereco: enderEmit
      ? {
          logradouro: getText(enderEmit, "xLgr"),
          numero: getText(enderEmit, "nro"),
          complemento: getText(enderEmit, "xCpl"),
          bairro: getText(enderEmit, "xBairro"),
          municipio: getText(enderEmit, "xMun"),
          uf: getText(enderEmit, "UF"),
          cep: getText(enderEmit, "CEP"),
        }
      : null,
  };

  // ---- Destinatário (apenas CNPJ/CPF + nome) ----
  const dest = infNFe.getElementsByTagName("dest")[0];
  let destinatario: NfeData["destinatario"] = null;
  if (dest) {
    const documento = (getText(dest, "CNPJ") || getText(dest, "CPF") || "").replace(/\D+/g, "");
    const nome = getText(dest, "xNome") || "";
    if (documento || nome) destinatario = { documento, nome };
  }

  // ---- Itens (det) ----
  const detList = Array.from(infNFe.getElementsByTagName("det"));
  const itens: NfeItem[] = detList.map((det) => {
    const prod = det.getElementsByTagName("prod")[0];
    const nItem = parseInt(det.getAttribute("nItem") || "0", 10) || 0;
    const cEAN = (getText(prod, "cEAN") || "").trim();
    return {
      nItem,
      cProd: getText(prod, "cProd") || "",
      cEAN: !cEAN || cEAN === "SEM GTIN" ? null : cEAN,
      xProd: getText(prod, "xProd") || "",
      NCM: getText(prod, "NCM"),
      CFOP: getText(prod, "CFOP"),
      uCom: getText(prod, "uCom") || "UN",
      qCom: getNumber(prod, "qCom"),
      vUnCom: getNumber(prod, "vUnCom"),
      vProd: getNumber(prod, "vProd"),
    };
  });

  // ---- Totais ----
  const ICMSTot = infNFe.getElementsByTagName("ICMSTot")[0];
  const vProd = getNumber(ICMSTot, "vProd");
  const vNF = getNumber(ICMSTot, "vNF");

  return {
    chave,
    nNF,
    serie,
    dhEmi,
    emitente,
    destinatario,
    itens,
    vProd,
    vNF,
  };
}
