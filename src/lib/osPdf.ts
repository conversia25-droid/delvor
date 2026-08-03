import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import type {
  Customer,
  CustomerEquipment,
  ServiceOrder,
  ServiceOrderItem,
} from "@/types/delvor";
import { OS_STATUS_LABELS } from "@/types/delvor";
import { formatBRL, formatDocument, formatPhone } from "./formatters";
import { type CompanyHeader, formatCompanyAddress } from "./companyInfo";

export interface OsPdfData {
  os: ServiceOrder;
  customer: Customer | null;
  equipment: CustomerEquipment | null;
  items: ServiceOrderItem[];
  /** Dados completos da empresa do banco (recomendado). */
  company?: CompanyHeader | null;
  /** Logo já baixado como data URI (usar imageToDataUrl). */
  companyLogoDataUrl?: string | null;
  /** Fallback se company não vier. */
  companyName?: string;
  technicianName?: string;
  /**
   * Modo de saída:
   *  - "download" (default): faz `doc.save()` — abre download no navegador
   *  - "base64": retorna a string base64 do PDF (sem prefix data:)
   *  - "blob": retorna o Blob
   */
  output?: "download" | "base64" | "blob";
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  // Bug de timezone: `new Date("2026-06-10")` é UTC meia-noite e em BRT (UTC-3)
  // vira 21h do dia 9. Parseio o formato date-only direto pra evitar shift.
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) {
    return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }
  return new Date(iso).toLocaleDateString("pt-BR");
}

function paragraph(doc: jsPDF, text: string, x: number, y: number, maxW: number, lineH = 5): number {
  const lines = doc.splitTextToSize(text, maxW);
  doc.text(lines, x, y);
  return y + lines.length * lineH;
}

export function generateOsPdf({
  os,
  customer,
  equipment,
  items,
  company,
  companyLogoDataUrl,
  companyName,
  technicianName,
  output = "download",
}: OsPdfData): string | Blob | void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  const cName = company?.name || companyName || "Delvor";
  const cCnpj = company?.cnpj ? formatDocument(company.cnpj) : null;
  const cPhone = company?.phone ? formatPhone(company.phone) : null;
  const cEmail = company?.email || null;
  const cAddr = company ? formatCompanyAddress(company.address) : "";

  // ---------------- HEADER ----------------
  let headerLeftX = margin;
  if (companyLogoDataUrl) {
    try {
      // Encaixa a logo numa caixa de 32x16mm preservando a proporção
      let lw = 16, lh = 16;
      try {
        const p = doc.getImageProperties(companyLogoDataUrl);
        if (p?.width && p?.height) {
          const maxW = 32, maxH = 16;
          lw = maxW; lh = maxW * (p.height / p.width);
          if (lh > maxH) { lh = maxH; lw = maxH * (p.width / p.height); }
        }
      } catch { /* sem dimensões — usa caixa quadrada padrão */ }
      doc.addImage(companyLogoDataUrl, "PNG", margin, 9, lw, lh);
      headerLeftX = margin + lw + 4;
    } catch {
      // ignora se a imagem não puder ser embedada
    }
  }

  // Reserva ~55mm à direita pra Nº da OS + status — nome da empresa não invade.
  const rightBlockWidth = 55;
  const nameMaxWidth = Math.max(40, pageWidth - headerLeftX - margin - rightBlockWidth);

  doc.setFont("helvetica", "bold");
  // Tenta 14 primeiro; se não couber, reduz até 9. Se ainda não couber, quebra em linhas.
  let nameSize = 14;
  doc.setFontSize(nameSize);
  while (nameSize > 9 && doc.getTextWidth(cName) > nameMaxWidth) {
    nameSize -= 1;
    doc.setFontSize(nameSize);
  }
  const nameLines = doc.splitTextToSize(cName, nameMaxWidth) as string[];
  doc.text(nameLines, headerLeftX, 16);
  // Avança conforme número de linhas do nome (aproximação de altura de linha).
  let headerY = 16 + (nameLines.length - 1) * (nameSize * 0.45);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100);
  const subParts: string[] = [];
  if (cCnpj) subParts.push(`CNPJ: ${cCnpj}`);
  if (cPhone) subParts.push(`Tel: ${cPhone}`);
  if (cEmail) subParts.push(cEmail);
  if (subParts.length) {
    headerY += 5;
    doc.text(subParts.join("  •  "), headerLeftX, headerY);
  }
  doc.setFontSize(9);
  headerY += 5;
  doc.text("ORDEM DE SERVIÇO", headerLeftX, headerY);

  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(`OS #${String(os.number).padStart(6, "0")}`, pageWidth - margin, 18, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(OS_STATUS_LABELS[os.status]?.label || os.status, pageWidth - margin, 24, { align: "right" });
  doc.setTextColor(0);

  // Linha divisória — abaixo do maior entre o fim do bloco esquerdo e do direito.
  let y = Math.max(headerY + 4, 32);
  doc.setDrawColor(220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // ---------------- CLIENTE + EQUIPAMENTO ----------------
  const colW = (pageWidth - margin * 2 - 4) / 2;

  // Cliente
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("CLIENTE", margin, y);
  // Equipamento
  doc.text("EQUIPAMENTO", margin + colW + 4, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let yL = y, yR = y;

  if (customer) {
    doc.text(customer.name || "—", margin, yL); yL += 4;
    if (customer.trade_name) { doc.text(customer.trade_name, margin, yL); yL += 4; }
    if (customer.document) {
      doc.text(`${customer.person_type === "PJ" ? "CNPJ" : "CPF"}: ${formatDocument(customer.document)}`, margin, yL);
      yL += 4;
    }
    if (customer.phone) { doc.text(`Tel: ${formatPhone(customer.phone)}`, margin, yL); yL += 4; }
    if (customer.email) { doc.text(customer.email, margin, yL); yL += 4; }
    const addr = [
      customer.street && customer.number ? `${customer.street}, ${customer.number}` : customer.street,
      customer.district,
      customer.city && customer.state ? `${customer.city}/${customer.state}` : customer.city,
    ].filter(Boolean).join(" — ");
    if (addr) { yL = paragraph(doc, addr, margin, yL, colW, 4); }
  } else {
    doc.text("—", margin, yL); yL += 4;
  }

  if (equipment) {
    const title = [equipment.brand, equipment.model].filter(Boolean).join(" ") || "Equipamento";
    doc.text(title, margin + colW + 4, yR); yR += 4;
    if (equipment.serial_number) { doc.text(`Série: ${equipment.serial_number}`, margin + colW + 4, yR); yR += 4; }
    if (equipment.asset_tag) { doc.text(`Patrimônio: ${equipment.asset_tag}`, margin + colW + 4, yR); yR += 4; }
    if (equipment.category) { doc.text(`Categoria: ${equipment.category}`, margin + colW + 4, yR); yR += 4; }
    if (equipment.location) { doc.text(`Local: ${equipment.location}`, margin + colW + 4, yR); yR += 4; }
  } else {
    doc.text("—", margin + colW + 4, yR); yR += 4;
  }

  y = Math.max(yL, yR) + 4;

  // ---------------- INFO OPERACIONAL ----------------
  doc.setDrawColor(220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  const info: string[] = [];
  info.push(`Abertura: ${fmtDate(os.created_at)}`);
  if (os.due_at) info.push(`Prazo: ${fmtDate(os.due_at)}`);
  if (os.scheduled_at) info.push(`Visita: ${fmtDate(os.scheduled_at)}`);
  if (os.finished_at) info.push(`Conclusão: ${fmtDate(os.finished_at)}`);
  if (os.delivered_at) info.push(`Entrega: ${fmtDate(os.delivered_at)}`);
  if (os.warranty_until) info.push(`Garantia até: ${fmtDate(os.warranty_until)}`);
  if (technicianName) info.push(`Técnico: ${technicianName}`);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80);
  y = paragraph(doc, info.join("    •    "), margin, y, pageWidth - margin * 2, 4);
  doc.setTextColor(0);
  y += 4;

  // ---------------- DEFEITO / DIAGNÓSTICO / SOLUÇÃO ----------------
  function block(title: string, body: string | null) {
    if (!body) return;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(title, margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    y = paragraph(doc, body, margin, y, pageWidth - margin * 2, 4.5);
    y += 4;
  }

  block("DEFEITO RELATADO", os.reported_issue);
  block("DIAGNÓSTICO TÉCNICO", os.diagnosis);
  block("SOLUÇÃO APLICADA", os.solution);

  // ---------------- ITENS ----------------
  if (items.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["#", "Tipo", "Descrição", "Qtd", "Unit.", "Total"]],
      body: items.map((it, idx) => [
        String(idx + 1),
        it.kind === "peca" ? "Peça" : "Serviço",
        it.description,
        String(it.qty),
        formatBRL(it.unit_price),
        formatBRL(it.total),
      ]),
      headStyles: { fillColor: [120, 70, 220], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 8, halign: "center" },
        1: { cellWidth: 18 },
        2: { cellWidth: "auto" },
        3: { cellWidth: 14, halign: "right" },
        4: { cellWidth: 24, halign: "right" },
        5: { cellWidth: 28, halign: "right", fontStyle: "bold" },
      },
      margin: { left: margin, right: margin },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  // ---------------- TOTAIS ----------------
  if (os.total > 0 || os.parts_total > 0 || os.labor_total > 0) {
    const totalsX = pageWidth - margin - 60;
    const totalsW = 60;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const row = (label: string, value: string, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.text(label, totalsX, y);
      doc.text(value, totalsX + totalsW, y, { align: "right" });
      y += 5;
    };

    if (os.parts_total > 0) row("Peças", formatBRL(os.parts_total));
    if (os.labor_total > 0) row("Mão de obra", formatBRL(os.labor_total));
    if (os.discount > 0) row("Desconto", `- ${formatBRL(os.discount)}`);
    doc.setDrawColor(180);
    doc.line(totalsX, y - 1, totalsX + totalsW, y - 1);
    y += 3;
    doc.setFontSize(12);
    row("TOTAL", formatBRL(os.total), true);
    y += 4;
  }

  // ---------------- ASSINATURA ----------------
  // Garante espaço pro bloco de assinatura — joga pra próxima página se não couber
  const signatureBlockH = 38;
  if (y + signatureBlockH > pageHeight - 14) {
    doc.addPage();
    y = 20;
  }

  y = pageHeight - 35; // ancora no rodapé

  doc.setDrawColor(150);
  // Cliente
  const sigW = (pageWidth - margin * 2 - 14) / 2;
  doc.line(margin, y, margin + sigW, y);
  doc.line(margin + sigW + 14, y, pageWidth - margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(80);
  doc.text(`Cliente — ${customer?.name || ""}`, margin, y + 4);
  doc.text(`Responsável técnico${technicianName ? ` — ${technicianName}` : ""}`, margin + sigW + 14, y + 4);

  doc.setFontSize(7);
  doc.setTextColor(120);
  doc.text(
    `Equipamento ${os.status === "entregue" ? "entregue e recebido" : "recebido para análise"} em ${fmtDate(new Date().toISOString())}`,
    pageWidth / 2,
    y + 12,
    { align: "center" }
  );

  if (os.warranty_until) {
    doc.text(
      `Garantia da prestação de serviço válida até ${fmtDate(os.warranty_until)} conforme Código de Defesa do Consumidor.`,
      pageWidth / 2,
      y + 16,
      { align: "center" }
    );
  }

  // Rodapé
  doc.setFontSize(8);
  doc.setTextColor(150);
  const footerLine = cAddr
    ? `${cName} • ${cAddr}`
    : `${cName} • Documento gerado pelo Delvor`;
  doc.text(footerLine, pageWidth / 2, pageHeight - 6, { align: "center" });

  const fileName = `OS_${String(os.number).padStart(6, "0")}.pdf`;

  if (output === "base64") {
    // datauristring tem prefix "data:application/pdf;filename=...;base64,"
    const dataUri = doc.output("datauristring") as string;
    const idx = dataUri.indexOf("base64,");
    return idx >= 0 ? dataUri.slice(idx + 7) : dataUri;
  }
  if (output === "blob") {
    return doc.output("blob") as Blob;
  }
  // default: download
  doc.save(fileName);
}
