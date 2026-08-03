/**
 * PDF de fechamento de caixa.
 *
 * Imprime o resumo do dia: vendas, quebra por forma de pagamento,
 * movimentos (sangrias/suprimentos), esperado vs contado e diferença.
 * Opcionalmente lista as vendas individualmente.
 *
 * Reutiliza o cabeçalho da empresa (logo + razão social + endereço) se
 * vier no `company`.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import { formatBRL } from "./formatters";
import { type CompanyHeader, formatCompanyAddress } from "./companyInfo";
import type { CashSummary, SessionSale } from "./cashRegister";

export interface CashSessionPdfData {
  sessionId: string;
  vendor: string;
  openedAt: string;
  closedAt: string;
  openingAmount: number;
  closingAmount: number;
  expectedCash: number;
  difference: number;
  summary: CashSummary;
  sales?: SessionSale[]; // se vier, lista as vendas no PDF
  company?: CompanyHeader | null;
  companyLogoDataUrl?: string | null;
  companyName?: string;
  output?: "download" | "print";
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function generateCashSessionPdf(data: CashSessionPdfData) {
  const {
    vendor,
    openedAt,
    closedAt,
    openingAmount,
    closingAmount,
    expectedCash,
    difference,
    summary,
    sales,
    company,
    companyLogoDataUrl,
    companyName,
    output = "download",
  } = data;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  let y = 14;

  /* ─────── CABEÇALHO DA EMPRESA ─────── */
  if (companyLogoDataUrl) {
    try {
      doc.addImage(companyLogoDataUrl, "PNG", marginX, y, 22, 22, undefined, "FAST");
    } catch {
      /* logo inválida — ignora */
    }
  }
  const companyTextX = companyLogoDataUrl ? marginX + 26 : marginX;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(company?.razao_social || companyName || "Delvor", companyTextX, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const addr = company ? formatCompanyAddress(company) : "";
  if (addr) doc.text(addr, companyTextX, y + 10, { maxWidth: pageWidth - companyTextX - marginX });
  if (company?.cnpj) doc.text(`CNPJ: ${company.cnpj}`, companyTextX, y + 14);

  y += 26;
  doc.setDrawColor(180);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 6;

  /* ─────── TÍTULO ─────── */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("FECHAMENTO DE CAIXA", marginX, y);
  y += 7;

  /* ─────── METADADOS ─────── */
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const meta = [
    ["Vendedor", vendor],
    ["Aberto em", fmtDateTime(openedAt)],
    ["Fechado em", fmtDateTime(closedAt)],
  ];
  meta.forEach(([k, v]) => {
    doc.setFont("helvetica", "bold");
    doc.text(`${k}:`, marginX, y);
    doc.setFont("helvetica", "normal");
    doc.text(v, marginX + 28, y);
    y += 5;
  });
  y += 3;

  /* ─────── RESUMO DAS VENDAS ─────── */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Resumo de vendas", marginX, y);
  y += 1;

  autoTable(doc, {
    startY: y + 1,
    margin: { left: marginX, right: marginX },
    head: [["Indicador", "Valor"]],
    body: [
      ["Quantidade de vendas", String(summary.sales_count)],
      ["Total vendido", formatBRL(summary.total_sales)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [91, 33, 182], textColor: 255 },
    columnStyles: { 1: { halign: "right", cellWidth: 50 } },
    theme: "grid",
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  /* ─────── QUEBRA POR MÉTODO ─────── */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Por forma de pagamento", marginX, y);
  autoTable(doc, {
    startY: y + 1,
    margin: { left: marginX, right: marginX },
    head: [["Método", "Recebido"]],
    body: [
      ["Dinheiro", formatBRL(summary.cash_in)],
      ["PIX", formatBRL(summary.pix_in)],
      ["Cartão (débito/crédito)", formatBRL(summary.card_in)],
      ["Outros (boleto/transferência/crediário)", formatBRL(summary.other_in)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [91, 33, 182], textColor: 255 },
    columnStyles: { 1: { halign: "right", cellWidth: 50 } },
    theme: "grid",
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  /* ─────── MOVIMENTOS DE CAIXA ─────── */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Movimentações", marginX, y);
  autoTable(doc, {
    startY: y + 1,
    margin: { left: marginX, right: marginX },
    head: [["Movimento", "Valor"]],
    body: [
      ["Fundo de troco (abertura)", formatBRL(openingAmount)],
      ["+ Suprimentos", formatBRL(summary.suprimentos)],
      ["− Sangrias", formatBRL(summary.sangrias)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [91, 33, 182], textColor: 255 },
    columnStyles: { 1: { halign: "right", cellWidth: 50 } },
    theme: "grid",
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  /* ─────── CONFERÊNCIA ─────── */
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Conferência de dinheiro", marginX, y);
  const diffStr = difference >= 0 ? `+ ${formatBRL(difference)}` : `− ${formatBRL(Math.abs(difference))}`;
  const diffNote =
    Math.abs(difference) < 0.01 ? "OK (sem diferença)"
      : difference > 0 ? "Sobra (entrou mais)"
      : "Falta (saiu mais)";
  autoTable(doc, {
    startY: y + 1,
    margin: { left: marginX, right: marginX },
    head: [["Item", "Valor"]],
    body: [
      ["Esperado em caixa", formatBRL(expectedCash)],
      ["Contado físico", formatBRL(closingAmount)],
      [`Diferença (${diffNote})`, diffStr],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [91, 33, 182], textColor: 255 },
    columnStyles: { 1: { halign: "right", cellWidth: 50 } },
    theme: "grid",
    didParseCell: (hookData) => {
      // Pinta a linha da diferença pra destacar
      if (hookData.row.index === 2) {
        hookData.cell.styles.fontStyle = "bold";
        hookData.cell.styles.textColor =
          Math.abs(difference) < 0.01 ? [16, 185, 129]
            : difference < 0 ? [225, 29, 72]
            : [217, 119, 6];
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  /* ─────── LISTA DE VENDAS (opcional) ─────── */
  if (sales && sales.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Vendas (${sales.length})`, marginX, y);
    autoTable(doc, {
      startY: y + 1,
      margin: { left: marginX, right: marginX },
      head: [["Hora", "Nº", "Cliente", "Status", "Total"]],
      body: sales.map((s) => [
        new Date(s.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        `#${String(s.number).padStart(6, "0")}`,
        s.customer_name || "—",
        s.status,
        formatBRL(s.total),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [91, 33, 182], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { cellWidth: 22 },
        3: { cellWidth: 22 },
        4: { halign: "right", cellWidth: 26 },
      },
      theme: "grid",
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  /* ─────── RODAPÉ ─────── */
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(
    `Gerado em ${new Date().toLocaleString("pt-BR")} pelo Delvor`,
    marginX,
    doc.internal.pageSize.getHeight() - 8
  );
  doc.setTextColor(0);

  const fileName = `caixa_${closedAt.slice(0, 10)}_${vendor.replace(/\s+/g, "_")}.pdf`;

  if (output === "print") {
    doc.autoPrint();
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (w) w.focus();
    return;
  }
  doc.save(fileName);
}
