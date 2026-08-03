/**
 * DocumentGeneratorModal
 *
 * Suporta dois tipos de contrato:
 * - "text": template com {{variáveis}} ou [variáveis] em texto puro
 * - "file": arquivo DOCX com [variáveis] — baixa, preenche com docxtemplater, gera DOCX + PDF
 *
 * Fluxo:
 * 1. Detecta variáveis no template ({{var}} ou [var])
 * 2. Pré-preenche as automáticas (data, telefone, nome)
 * 3. Botão "Extrair dados via IA" → n8n lê a conversa e retorna dados
 * 4. Formulário editável
 * 5. Gera DOCX preenchido (mantendo formatação) + PDF
 */
import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { saveAs } from "file-saver";
import { supabase } from "@/integrations/supabase/client";
import {
  Bot,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileText,
  FileDown,
  Loader2,
  Pencil,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

/* ──────────────────────────────────────────────
   TIPOS
────────────────────────────────────────────── */
export interface DocumentContract {
  id: string;
  name: string;
  type: "text" | "file";
  content?: string;
}

export interface DocumentLeadContext {
  leadId?: string | null;
  leadName?: string;
  remoteJid?: string;
  companyId?: string | null;
  instanceId?: string | null;
  briefing?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contract: DocumentContract | null;
  lead: DocumentLeadContext;
  initialAiVariables?: Record<string, string> | null;
}

/* ──────────────────────────────────────────────
   HELPERS
────────────────────────────────────────────── */

/** Detecta variáveis nos formatos {{var}} e [var] */
function parseVariables(template: string): string[] {
  const bracketMatches = template.match(/\[([^\]]+)\]/g) || [];
  const curlyMatches = template.match(/\{\{([^}]+)\}\}/g) || [];

  const vars = [
    ...bracketMatches.map((m) => m.replace(/\[|\]/g, "").trim()),
    ...curlyMatches.map((m) => m.replace(/\{\{|\}\}/g, "").trim()),
  ];

  const filtered = vars.filter((v) => {
    if (v.length < 2) return false;
    if (v.length > 60) return false;
    if (/^https?:\/\//.test(v)) return false;
    // Ignorar números puros ou com texto entre parênteses tipo "30 (trinta)"
    if (/^\d+(\s*\(.*\))?$/.test(v)) return false;
    // Ignorar referências legais (ex: "art. 1º", "§ 2º", "inciso III")
    if (/^(art|§|inciso|alínea|parágrafo)/i.test(v)) return false;
    // Ignorar se é só um número romano
    if (/^[IVXLCDM]+$/i.test(v)) return false;
    return true;
  });

  return [...new Set(filtered)];
}

/** Substitui {{var}} e [var] pelo valor */
function fillTemplate(template: string, values: Record<string, string>): string {
  let result = template;
  // Substituir [var]
  result = result.replace(/\[([^\]]+)\]/g, (match, key) => {
    const k = key.trim();
    return values[k]?.trim() || match;
  });
  // Substituir {{var}}
  result = result.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const k = key.trim();
    return values[k]?.trim() || match;
  });
  return result;
}

function autoFillValues(lead: DocumentLeadContext): Record<string, string> {
  const now = new Date();
  const phone = (lead.remoteJid || "")
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/@g\.us$/i, "")
    .replace(/\D/g, "");

  return {
    data: now.toLocaleDateString("pt-BR"),
    data_atual: now.toLocaleDateString("pt-BR"),
    data_extenso: now.toLocaleDateString("pt-BR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    hora: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    hora_atual: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    telefone: phone,
    celular: phone,
    remote_jid: lead.remoteJid || "",
    nome_cliente: lead.leadName || "",
    nome: lead.leadName || "",
    "Nome completo": lead.leadName || "",
    cliente: lead.leadName || "",
    contratante: lead.leadName || "",
  };
}

const VARIABLE_LABELS: Record<string, string> = {
  nome_cliente: "Nome do cliente",
  "Nome completo": "Nome completo",
  nome: "Nome",
  cliente: "Nome do cliente",
  contratante: "Nome do contratante",
  cpf: "CPF",
  "número do CPF": "CPF",
  rg: "RG",
  "número do RG": "RG",
  cnpj: "CNPJ",
  telefone: "Telefone",
  celular: "Celular",
  email: "E-mail",
  endereco: "Endereço",
  "endereço completo, incluindo CEP, cidade e estado": "Endereço completo",
  cidade: "Cidade",
  estado: "Estado",
  cep: "CEP",
  data: "Data",
  data_atual: "Data atual",
  data_extenso: "Data por extenso",
  hora: "Hora",
  hora_atual: "Hora atual",
  valor: "Valor",
  valor_extenso: "Valor por extenso",
  descricao: "Descrição",
  objeto: "Objeto do contrato",
  prazo: "Prazo",
  vencimento: "Vencimento",
  data_nascimento: "Data de nascimento",
  profissao: "Profissão",
  "profissão": "Profissão",
  estado_civil: "Estado civil",
  "estado civil": "Estado civil",
  nacionalidade: "Nacionalidade",
  remote_jid: "WhatsApp",
};

/* ──────────────────────────────────────────────
   GERADOR DE PDF (texto puro)
────────────────────────────────────────────── */
function generatePDF(content: string, title: string, opts?: { returnBlob?: boolean }): void | Blob {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 22;
  const usable = pageW - margin * 2;
  let y = margin;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(title, margin, 12);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 180, 200);
  doc.text(
    new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }),
    pageW - margin, 12, { align: "right" }
  );

  y = 30;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 40);
  const lineH = 6.5;

  for (const rawLine of content.split("\n")) {
    const wrapped = doc.splitTextToSize(rawLine || " ", usable);
    for (const line of wrapped) {
      if (y > pageH - 20) {
        doc.addPage();
        y = 20;
        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(30, 30, 40);
      }
      doc.text(line, margin, y);
      y += lineH;
    }
  }

  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150, 150, 160);
    doc.text(title, margin, pageH - 7);
    doc.text(`Pág. ${i} / ${totalPages}`, pageW - margin, pageH - 7, { align: "right" });
  }

  if (opts?.returnBlob) {
    return doc.output("blob");
  }
  doc.save(`${title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.pdf`);
}

/* ──────────────────────────────────────────────
   DOCX: baixar, extrair variáveis, preencher
────────────────────────────────────────────── */

async function fetchDocxAsArrayBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erro ao baixar DOCX: ${res.status}`);
  return res.arrayBuffer();
}

/**
 * Normaliza placeholders dentro do DOCX antes do docxtemplater processar:
 *  - `${X}`  → `[X]`   (dollar-brace, ex: ${Nome_cliente})
 *  - `{{X}}` → `[X]`   (double-curly)
 *  - `_cliente` / `_contratante` / `_contratado` / `_outorgante` / `_outorgado` → sufixo removido
 *
 * Roda em document.xml, headers e footers. Tolerante a runs simples (pdf2docx sai limpo).
 */
function preprocessDocxBuffer(buffer: ArrayBuffer): ArrayBuffer {
  const zip = new PizZip(buffer);
  const SUFFIX_RE = /_(cliente|contratante|contratado|outorgante|outorgado|contratada|outorgada)\b/gi;

  const transform = (inner: string) => inner.replace(SUFFIX_RE, "");

  // Pega todos os XMLs relevantes (document, headers, footers)
  const files = Object.keys((zip as any).files || {}).filter(
    (p) => /word\/(document|header\d*|footer\d*)\.xml$/i.test(p)
  );

  for (const path of files) {
    const file = zip.file(path);
    if (!file) continue;
    let xml = file.asText();

    // 1) ${X} → [X]   (com remoção de sufixo _cliente/etc)
    xml = xml.replace(/\$\{([^}]+)\}/g, (_m, inner) => `[${transform(inner.trim())}]`);

    // 2) {{X}} → [X]
    xml = xml.replace(/\{\{([^}]+)\}\}/g, (_m, inner) => `[${transform(inner.trim())}]`);

    // 3) [X_cliente] → [X]   (caso já venha em colchetes)
    xml = xml.replace(/\[([^\]]+)\]/g, (m, inner) => {
      const stripped = transform(inner);
      return stripped === inner ? m : `[${stripped}]`;
    });

    zip.file(path, xml);
  }

  return zip.generate({ type: "arraybuffer" });
}

function extractVariablesFromDocx(arrayBuffer: ArrayBuffer): string[] {
  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "[", end: "]" },
  });

  // Pega o texto completo do DOCX para extrair variáveis
  const fullText = doc.getFullText();
  return parseVariables(fullText);
}

function fillDocx(arrayBuffer: ArrayBuffer, values: Record<string, string>): PizZip {
  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "[", end: "]" },
    // Não quebrar quando encontrar variáveis sem valor — manter o original
    nullGetter: (part: any) => {
      return `[${part.value}]`;
    },
  });

  doc.render(values);
  return doc.getZip();
}

/* ──────────────────────────────────────────────
   COMPONENTE PRINCIPAL
────────────────────────────────────────────── */
export default function DocumentGeneratorModal({ open, onOpenChange, contract, lead, initialAiVariables }: Props) {
  const { toast } = useToast();

  const [tab, setTab] = useState<"form" | "preview">("form");
  const [values, setValues] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [aiFilledKeys, setAiFilledKeys] = useState<Set<string>>(new Set());

  // DOCX state
  const [docxBuffer, setDocxBuffer] = useState<ArrayBuffer | null>(null);
  const [docxLoading, setDocxLoading] = useState(false);
  const [docxText, setDocxText] = useState<string>("");

  const isDocx = contract?.type === "file";

  // Para contratos texto: pegar variáveis do content
  // Para DOCX: pegar do texto extraído do arquivo
  const templateSource = isDocx ? docxText : (contract?.content || "");

  const variables = useMemo(
    () => parseVariables(templateSource),
    [templateSource]
  );

  // Baixar DOCX quando abrir um contrato do tipo file
  useEffect(() => {
    if (!open || !contract || contract.type !== "file" || !contract.content) {
      setDocxBuffer(null);
      setDocxText("");
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
    const fileUrl = `${supabaseUrl}/storage/v1/object/public/contratos/${contract.content}`;

    setDocxLoading(true);
    fetchDocxAsArrayBuffer(fileUrl)
      .then((rawBuf) => {
        // Normaliza placeholders (${X_cliente} → [X], etc) antes de qualquer parse
        const buf = preprocessDocxBuffer(rawBuf);
        setDocxBuffer(buf);
        // Extrair texto completo para exibir preview e detectar variáveis
        try {
          const zip = new PizZip(buf);
          const doc = new Docxtemplater(zip, {
            paragraphLoop: true,
            linebreaks: true,
            delimiters: { start: "[", end: "]" },
          });
          setDocxText(doc.getFullText());
        } catch (e) {
          console.error("Erro ao parsear DOCX:", e);
          setDocxText("");
        }
      })
      .catch((e) => {
        console.error("Erro ao baixar DOCX:", e);
        toast({ title: "Erro ao baixar modelo DOCX", description: e.message, variant: "destructive" });
      })
      .finally(() => setDocxLoading(false));
  }, [open, contract]);

  // Inicializar valores ao abrir (só roda 1x quando o modal abre ou o DOCX termina de carregar)
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!open) {
      setInitialized(false);
      return;
    }
    if (!contract) return;
    if (isDocx && docxLoading) return;
    if (initialized) return; // Já inicializou, não resetar

    const auto = autoFillValues(lead);
    const initial: Record<string, string> = {};
    const filledKeys = new Set<string>();

    for (const v of variables) {
      if (initialAiVariables && initialAiVariables[v]?.trim() && !auto[v]) {
        initial[v] = initialAiVariables[v].trim();
        filledKeys.add(v);
      } else {
        initial[v] = auto[v] ?? "";
      }
    }

    setValues(initial);
    setAiFilledKeys(filledKeys);
    setTab(filledKeys.size > 0 ? "preview" : "form");
    setCopied(false);
    setInitialized(true);
  }, [open, contract, variables, docxLoading]);

  const filled = useMemo(
    () => fillTemplate(templateSource, values),
    [templateSource, values]
  );

  const missingCount = variables.filter((v) => !values[v]?.trim()).length;
  const hasWebhook = Boolean(import.meta.env.VITE_N8N_CONTRACT_WEBHOOK_URL);
  const canExtract = hasWebhook && Boolean(lead.remoteJid);

  /* ── Extrai dados via IA ── */
  async function handleExtractWithAI() {
    const webhookUrl = import.meta.env.VITE_N8N_CONTRACT_WEBHOOK_URL;
    console.log("[DocumentGenerator] Extrair via IA clicado", { webhookUrl, remoteJid: lead.remoteJid, companyId: lead.companyId });

    if (!webhookUrl) {
      toast({ title: "Extração não configurada", description: "Contate o administrador para configurar a extração automática.", variant: "destructive" });
      return;
    }
    if (!lead.remoteJid) {
      toast({ title: "Sem lead selecionado", variant: "destructive" });
      return;
    }

    setExtracting(true);
    setAiFilledKeys(new Set());

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
      const contractFileUrl = isDocx && contract?.content
        ? `${supabaseUrl}/storage/v1/object/public/contratos/${contract.content}`
        : "";

      const payload = {
        event: "extract_variables",
        company_id: lead.companyId,
        companyId: lead.companyId,
        instance_id: lead.instanceId || "",
        remote_jid: lead.remoteJid,
        remoteJid: lead.remoteJid,
        leadId: lead.leadId,
        contract_id: contract?.id,
        contractId: contract?.id,
        contract_name: contract?.name,
        contractName: contract?.name,
        contract_content: isDocx ? docxText : (contract?.content || ""),
        contract_file_url: contractFileUrl,
        variables_needed: variables,
        briefing_context: lead.briefing || "",
      };

      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const data = await res.json();
      const extracted: Record<string, string> =
        data?.variables || data?.data?.variables || {};

      if (!Object.keys(extracted).length) {
        toast({ title: "IA não encontrou dados", variant: "destructive" });
        setExtracting(false);
        return;
      }

      const filledKeys = new Set<string>();
      const auto = autoFillValues(lead);

      // Normaliza string para comparação: lowercase, remove acentos, underscores = espaços
      const normalize = (s: string) =>
        s.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[_\s]+/g, " ")
          .trim();

      // Canonicaliza: remove sufixos de parte contratual e aplica aliases comuns.
      // Ex: "Nome_cliente" → "nome", "CPF/CNPJ_cliente" → "cpf", "Identidade" → "rg"
      const ALIASES: Record<string, string> = {
        "nome completo": "nome",
        "nome do cliente": "nome",
        "nome do contratante": "nome",
        "cliente": "nome",
        "contratante": "nome",
        "cpf/cnpj": "cpf",
        "cnpj/cpf": "cpf",
        "numero do cpf": "cpf",
        "numero do documento": "cpf",
        "identidade": "rg",
        "numero do rg": "rg",
        "cedula de identidade": "rg",
        "numero": "numero",
        "n": "numero",
        "endereco eletronico": "email",
        "e-mail": "email",
        "telefone de contato": "telefone",
        "celular": "telefone",
        "estado civil": "estado civil",
        "profissao": "profissao",
        "nacionalidade": "nacionalidade",
      };
      const canonicalize = (s: string) => {
        let n = normalize(s);
        // remove sufixos contratuais no final
        n = n.replace(/\s+(cliente|contratante|contratado|outorgante|outorgado|contratada|outorgada)$/i, "").trim();
        return ALIASES[n] ?? n;
      };

      console.log("[DocumentGenerator] Variáveis do template:", variables);
      console.log("[DocumentGenerator] Dados extraídos pela IA:", extracted);

      setValues((prev) => {
        const next = { ...prev };

        // Monta lista de candidatos (key da IA, value, variável do template, score)
        // Score: 3 = exato, 2 = um contém o outro (prefere o par cuja distância de tamanho é menor)
        type Candidate = { key: string; value: string; target: string; score: number; delta: number };
        const candidates: Candidate[] = [];

        for (const [key, value] of Object.entries(extracted)) {
          if (typeof value !== "string" || !value.trim()) continue;
          const keyNorm = normalize(key);
          const keyCanon = canonicalize(key);

          for (const v of variables) {
            const vNorm = normalize(v);
            const vCanon = canonicalize(v);
            let score = 0;
            // 4 = match canônico exato (ex: "Nome_cliente" ↔ "nome completo" → ambos "nome")
            if (vCanon === keyCanon && vCanon.length >= 2) {
              score = 4;
            } else if (vNorm === keyNorm || vNorm.replace(/\s+/g, "_") === keyNorm.replace(/\s+/g, "_")) {
              score = 3;
            } else if (vNorm.includes(keyNorm) || keyNorm.includes(vNorm)) {
              score = 2;
            }
            if (score > 0) {
              candidates.push({
                key,
                value: value.trim(),
                target: v,
                score,
                delta: Math.abs(vNorm.length - keyNorm.length),
              });
            }
          }
        }

        // Ordena: maior score primeiro, depois menor delta (mais próximos em tamanho)
        candidates.sort((a, b) => b.score - a.score || a.delta - b.delta);

        const usedTargets = new Set<string>();
        const usedKeys = new Set<string>();

        // Primeiro loop: só matches com target e key ainda livres (1 key → 1 target)
        for (const c of candidates) {
          if (usedTargets.has(c.target) || usedKeys.has(c.key)) continue;
          next[c.target] = c.value;
          filledKeys.add(c.target);
          usedTargets.add(c.target);
          usedKeys.add(c.key);
          console.log(`[DocumentGenerator] Mapeando: "${c.key}" → "${c.target}" (score ${c.score})`);
        }

        // Segundo loop: keys que não bateram em nenhum template var — guarda pelo nome literal
        for (const [key, value] of Object.entries(extracted)) {
          if (typeof value !== "string" || !value.trim()) continue;
          if (usedKeys.has(key)) continue;
          next[key] = value.trim();
          filledKeys.add(key);
          console.log(`[DocumentGenerator] Sem match no template, guardando literal: "${key}"`);
        }

        return next;
      });

      setAiFilledKeys(filledKeys);
      toast({
        title: `IA extraiu ${filledKeys.size} dado${filledKeys.size !== 1 ? "s" : ""}!`,
        description: "Revise os campos antes de gerar o documento.",
      });
    } catch (e: any) {
      toast({ title: "Erro ao extrair dados", description: e.message, variant: "destructive" });
    }

    setExtracting(false);
  }

  /* ── Salva contrato gerado no Supabase ── */
  async function saveGeneratedContract(blob: Blob, fileName: string, fileType: "docx" | "pdf"): Promise<{ fileUrl: string; storagePath: string } | null> {
    if (!lead.companyId || !lead.leadId) return null;

    try {
      const timestamp = Date.now();
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${lead.companyId}/gerados/${lead.remoteJid || "sem-jid"}/${timestamp}_${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from("contratos")
        .upload(storagePath, blob, { contentType: blob.type, upsert: false });

      if (uploadErr) {
        console.error("Erro upload contrato:", uploadErr);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from("contratos")
        .getPublicUrl(storagePath);

      const fileUrl = urlData?.publicUrl || "";

      await supabase.from("generated_contracts").insert({
        company_id: lead.companyId,
        lead_id: lead.leadId,
        remote_jid: lead.remoteJid || null,
        contract_model_id: contract?.id || null,
        contract_name: (() => {
          const cn = (values["Nome completo"] || values["nome_cliente"] || values["nome"] || values["cliente"] || lead.leadName || "").trim();
          const base = contract?.name || "Documento";
          return cn ? `${base} - ${cn}` : base;
        })(),
        file_path: storagePath,
        file_url: fileUrl,
        file_type: fileType,
        filled_values: values,
      });

      toast({ title: "Contrato salvo na conversa!", description: "Disponível na aba Contratos do InfinityBot." });
      return { fileUrl, storagePath };
    } catch (e: any) {
      console.error("Erro ao salvar contrato gerado:", e);
      return null;
    }
  }

  /* ── Gera DOCX preenchido ── */
  async function handleGenerateDocx() {
    if (!docxBuffer) {
      toast({ title: "DOCX não carregado", variant: "destructive" });
      return;
    }

    setGenerating(true);
    try {
      const filledZip = fillDocx(docxBuffer, values);
      const blob = filledZip.generate({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const clientName = (values["Nome completo"] || values["nome_cliente"] || values["nome"] || values["cliente"] || lead.leadName || "").trim();
      const contractLabel = (contract?.name || "documento").replace(/[^a-zA-Z0-9\s]+/g, "").trim();
      const fileName = `${contractLabel}${clientName ? ` - ${clientName}` : ""}.docx`.replace(/[\\/:*?"<>|]/g, "_");
      saveAs(blob, fileName);
      await saveGeneratedContract(blob, fileName, "docx");
      toast({ title: "DOCX gerado com sucesso!", description: "Salvo na conversa e baixado." });
    } catch (e: any) {
      console.error("Erro ao gerar DOCX:", e);
      toast({ title: "Erro ao gerar DOCX", description: e.message, variant: "destructive" });
    }
    setGenerating(false);
  }

  /* ── Gera PDF ── */
  async function handleGeneratePdf() {
    setGenerating(true);
    try {
      if (isDocx && docxBuffer) {
        // DOCX: preenche → envia ao conversor → recebe PDF
        const filledZip = fillDocx(docxBuffer, values);
        const docxBlob = filledZip.generate({
          type: "blob",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

        const convertUrl = import.meta.env.VITE_DOCX_CONVERTER_URL || "https://converter.zapcompany.com.br/converter-docx-pdf";

        const formData = new FormData();
        const pdfClientName = (values["Nome completo"] || values["nome_cliente"] || values["nome"] || values["cliente"] || lead.leadName || "").trim();
        const pdfContractLabel = (contract?.name || "documento").replace(/[^a-zA-Z0-9\s]+/g, "").trim();
        const fileName = `${pdfContractLabel}${pdfClientName ? ` - ${pdfClientName}` : ""}.docx`.replace(/[\\/:*?"<>|]/g, "_");
        formData.append("file", docxBlob, fileName);

        toast({ title: "Convertendo para PDF...", description: "Aguarde, estamos processando o documento." });

        const res = await fetch(convertUrl, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) throw new Error(`Erro na conversão: ${res.status}`);

        const pdfBlob = await res.blob();
        const pdfName = fileName.replace(/\.docx$/i, ".pdf");
        saveAs(pdfBlob, pdfName);
        await saveGeneratedContract(pdfBlob, pdfName, "pdf");
        toast({ title: "PDF gerado com sucesso!", description: "Salvo na conversa e baixado." });
      } else {
        // Texto puro: gera PDF simples com jsPDF
        generatePDF(filled, contract?.name || "Documento");
        toast({ title: "PDF gerado com sucesso!" });
      }
    } catch (e: any) {
      console.error("Erro ao gerar PDF:", e);
      toast({ title: "Erro ao gerar PDF", description: e.message, variant: "destructive" });
    }
    setGenerating(false);
  }

  /* ── Copia texto ── */
  function handleCopy() {
    navigator.clipboard.writeText(filled).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast({ title: "Texto copiado!" });
    });
  }

  /* ── Descobre o instance_id do lead: props → DB fallback ── */
  async function resolveInstanceId(): Promise<string> {
    if (lead.instanceId) {
      console.log("[DocGen] instance_id via prop:", lead.instanceId);
      return String(lead.instanceId);
    }
    if (!lead.remoteJid || !lead.companyId) {
      console.warn("[DocGen] sem remote_jid ou company_id para resolver instance_id");
      return "";
    }
    try {
      // Tenta pela última mensagem da conversa
      const { data: msg, error: msgErr } = await supabase
        .from("wpp_conversations")
        .select("instance_id")
        .eq("remote_jid", lead.remoteJid)
        .eq("company_id", lead.companyId)
        .not("instance_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      console.log("[DocGen] lookup wpp_conversations →", { msg, msgErr });
      if ((msg as any)?.instance_id) return (msg as any).instance_id;

      // Fallback: pega pelo lead
      const { data: leadRow, error: leadErr } = await supabase
        .from("leads")
        .select("instance_id")
        .eq("id", lead.leadId)
        .maybeSingle();
      console.log("[DocGen] lookup leads →", { leadRow, leadErr });
      return (leadRow as any)?.instance_id || "";
    } catch (e) {
      console.error("[DocGen] erro resolveInstanceId:", e);
      return "";
    }
  }

  /* ── Gera PDF + faz upload + envia ao n8n ── */
  async function handleSendWebhook() {
    const webhookUrl = import.meta.env.VITE_N8N_CONTRACT_WEBHOOK_URL;
    if (!webhookUrl) return;
    setSending(true);
    try {
      const instanceId = await resolveInstanceId();
      // 1. Gerar PDF (reaproveita fluxo do handleGeneratePdf)
      let pdfBlob: Blob;
      const pdfClientName = (values["Nome completo"] || values["nome_cliente"] || values["nome"] || values["cliente"] || lead.leadName || "").trim();
      const pdfContractLabel = (contract?.name || "documento").replace(/[^a-zA-Z0-9\s]+/g, "").trim();
      const baseName = `${pdfContractLabel}${pdfClientName ? ` - ${pdfClientName}` : ""}`.replace(/[\\/:*?"<>|]/g, "_");
      const pdfName = `${baseName}.pdf`;

      if (isDocx && docxBuffer) {
        toast({ title: "Gerando PDF...", description: "Aguarde, estamos preparando o documento." });
        const filledZip = fillDocx(docxBuffer, values);
        const docxBlob = filledZip.generate({
          type: "blob",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        const convertUrl = import.meta.env.VITE_DOCX_CONVERTER_URL || "https://converter.zapcompany.com.br/converter-docx-pdf";
        const formData = new FormData();
        formData.append("file", docxBlob, `${baseName}.docx`);
        const conv = await fetch(convertUrl, { method: "POST", body: formData });
        if (!conv.ok) throw new Error(`Erro na conversão: ${conv.status}`);
        pdfBlob = await conv.blob();
      } else {
        // Texto puro: gera PDF com jsPDF e retorna blob
        pdfBlob = generatePDF(filled, contract?.name || "Documento", { returnBlob: true }) as unknown as Blob;
      }

      // 2. Upload ao Supabase Storage → pega URL pública
      const saved = await saveGeneratedContract(pdfBlob, pdfName, "pdf");
      if (!saved?.fileUrl) throw new Error("Falha ao subir PDF no Storage");

      // 3. Envia URL ao n8n
      const payload = {
        event: "send_document",
        companyId: lead.companyId,
        leadId: lead.leadId,
        remote_jid: lead.remoteJid,
        instance_id: instanceId || "",
        contract_id: contract?.id,
        contract_name: contract?.name,
        contract_type: contract?.type,
        file_url: saved.fileUrl,
        file_name: pdfName,
        mime_type: "application/pdf",
        variables: values,
        briefing_context: lead.briefing,
        generated_at: new Date().toISOString(),
      };
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "PDF enviado ao lead!", description: "O documento foi enviado pelo WhatsApp." });
    } catch (e: any) {
      toast({ title: "Erro ao enviar", description: e.message, variant: "destructive" });
    }
    setSending(false);
  }

  /* ── Render ── */
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden !z-[10000]" style={{ zIndex: 10000 }}>
        {/* Force overlay z-index via global style */}
        <style>{`[data-radix-portal] > [data-state] { z-index: 9999 !important; }`}</style>

        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-5 pb-0 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary shrink-0" />
              <div>
                <DialogTitle className="leading-tight">{contract?.name || "Documento"}</DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {docxLoading ? (
                    "Carregando modelo DOCX..."
                  ) : (
                    <>
                      {variables.length} variável{variables.length !== 1 ? "is" : ""} detectada{variables.length !== 1 ? "s" : ""}
                      {isDocx && <span className="ml-2 text-[9px] px-1.5 py-0 rounded bg-secondary text-secondary-foreground inline-flex items-center">DOCX</span>}
                      {missingCount > 0 && (
                        <span className="text-amber-500 ml-2">· {missingCount} em branco</span>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 -mt-1" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Banner IA */}
          {canExtract && !docxLoading && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40 px-4 py-3">
              <Bot className="h-5 w-5 text-blue-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Extração automática via IA</p>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  A IA vai ler toda a conversa e extrair os dados para preencher o contrato.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => void handleExtractWithAI()}
                disabled={extracting}
                className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white h-8 text-xs"
              >
                {extracting ? (
                  <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo conversa...</>
                ) : (
                  <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Extrair via IA</>
                )}
              </Button>
            </div>
          )}

          {/* Tabs */}
          {!docxLoading && (
            <div className="flex gap-1 mt-3 border-b">
              <button
                onClick={() => setTab("form")}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px flex items-center gap-1 ${
                  tab === "form" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Pencil className="h-3 w-3" /> Variáveis
              </button>
              <button
                onClick={() => setTab("preview")}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors -mb-px flex items-center gap-1 ${
                  tab === "preview" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Eye className="h-3 w-3" /> Preview
              </button>
            </div>
          )}
        </DialogHeader>

        {/* ── Body ── */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-4">
            {docxLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Carregando modelo DOCX...</p>
              </div>
            ) : tab === "form" ? (
              <div className="space-y-3">
                {variables.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm border border-dashed rounded-lg">
                    Nenhuma variável encontrada neste template.
                    <br />
                    <span className="text-xs opacity-70">
                      Use <code className="bg-muted px-1 rounded">[Nome completo]</code> ou <code className="bg-muted px-1 rounded">{"{{nome}}"}</code> para criar campos dinâmicos.
                    </span>
                  </div>
                ) : (
                  <>
                    {aiFilledKeys.size > 0 && (
                      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          <strong>{aiFilledKeys.size} campo{aiFilledKeys.size !== 1 ? "s" : ""}</strong> preenchido{aiFilledKeys.size !== 1 ? "s" : ""} pela IA — revise antes de gerar.
                        </span>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      {variables.map((varName) => {
                        const auto = autoFillValues(lead);
                        const isAuto = Boolean(auto[varName]) && !aiFilledKeys.has(varName);
                        const isAiFilled = aiFilledKeys.has(varName);
                        const isEmpty = !values[varName]?.trim();
                        const label = VARIABLE_LABELS[varName] || VARIABLE_LABELS[varName.toLowerCase()] || varName.replace(/_/g, " ");

                        return (
                          <div key={varName} className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Label className="text-xs capitalize">{label}</Label>
                              {isAuto && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">auto</Badge>}
                              {isAiFilled && (
                                <Badge className="text-[9px] px-1 py-0 h-4 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-0">
                                  <Sparkles className="h-2.5 w-2.5 mr-0.5" /> IA
                                </Badge>
                              )}
                            </div>
                            <Input
                              value={values[varName] ?? ""}
                              onChange={(e) => {
                                setValues((prev) => ({ ...prev, [varName]: e.target.value }));
                                if (isAiFilled) {
                                  setAiFilledKeys((prev) => { const next = new Set(prev); next.delete(varName); return next; });
                                }
                              }}
                              placeholder={`[${varName}]`}
                              className={[
                                "text-sm h-8",
                                isAuto && values[varName] ? "bg-muted/40" : "",
                                isAiFilled ? "border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/20" : "",
                                isEmpty ? "border-amber-300" : "",
                              ].filter(Boolean).join(" ")}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/20 p-4">
                <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
                  {filled}
                </pre>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* ── Footer ── */}
        {!docxLoading && (
          <div className="px-6 py-3 border-t shrink-0 flex flex-wrap items-center justify-between gap-2 bg-muted/10">
            <div className="text-xs text-muted-foreground">
              {missingCount > 0 ? (
                <span className="text-amber-500">⚠ {missingCount} campo{missingCount !== 1 ? "s" : ""} em branco</span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Todos preenchidos
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleCopy} className="h-8 text-xs">
                {copied
                  ? <><CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-500" /> Copiado!</>
                  : <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar texto</>}
              </Button>

              {hasWebhook && lead.remoteJid && (
                <Button variant="outline" size="sm" onClick={() => void handleSendWebhook()} disabled={sending} className="h-8 text-xs">
                  {sending
                    ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Enviando...</>
                    : <><Send className="mr-1.5 h-3.5 w-3.5" /> Enviar automaticamente</>}
                </Button>
              )}

              {isDocx && docxBuffer && (
                <Button size="sm" variant="outline" onClick={handleGenerateDocx} disabled={generating} className="h-8 text-xs">
                  {generating
                    ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Gerando...</>
                    : <><FileDown className="mr-1.5 h-3.5 w-3.5" /> Baixar DOCX</>}
                </Button>
              )}

              <Button size="sm" onClick={handleGeneratePdf} disabled={generating} className="h-8 text-xs">
                {generating
                  ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Gerando...</>
                  : <><Download className="mr-1.5 h-3.5 w-3.5" /> Baixar PDF</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────────────────────────────────
   BOTÃO RÁPIDO
────────────────────────────────────────────── */
export interface DocumentPreviewButtonProps {
  contract: DocumentContract;
  lead: DocumentLeadContext;
  size?: "sm" | "default";
  label?: string;
}

export function DocumentPreviewButton({ contract, lead, size = "sm", label }: DocumentPreviewButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
        <Eye className="h-3.5 w-3.5" />
        {label || "Preencher & PDF"}
      </Button>
      <DocumentGeneratorModal open={open} onOpenChange={setOpen} contract={contract} lead={lead} />
    </>
  );
}
