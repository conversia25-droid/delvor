/**
 * Exportação de relatórios — CSV (Excel) e PDF.
 *
 *  • downloadCSV  → gera arquivo .csv com separador ";" + BOM UTF-8
 *                   (abre certinho no Excel PT-BR, com acentos)
 *  • downloadReportPDF → gera PDF A4 com uma ou mais tabelas (jsPDF + autotable)
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* ====================================================================
   CSV
==================================================================== */
export interface CsvColumn {
  key: string;
  label: string;
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // escapa aspas e envolve se tiver separador/quebra
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCSV(
  filename: string,
  columns: CsvColumn[],
  rows: Array<Record<string, unknown>>
) {
  const header = columns.map((c) => csvCell(c.label)).join(";");
  const body = rows
    .map((row) => columns.map((c) => csvCell(row[c.key])).join(";"))
    .join("\n");
  // BOM (﻿) faz o Excel reconhecer UTF-8
  const csv = "﻿" + header + "\n" + body;

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

/* ====================================================================
   PDF
==================================================================== */
export interface PdfColumn {
  header: string;
  dataKey: string;
  /** Alinhamento da coluna */
  align?: "left" | "right" | "center";
}

export interface PdfSection {
  heading: string;
  columns: PdfColumn[];
  rows: Array<Record<string, unknown>>;
  /** Linha de total (opcional) — Record com as mesmas dataKeys */
  totalRow?: Record<string, unknown>;
}

export interface PdfReportOpts {
  title: string;
  /** Subtítulo (ex: período) */
  subtitle?: string;
  /** Nome da empresa pro cabeçalho */
  companyName?: string;
  /** Logo da empresa (PNG data URI) — aparece no canto superior direito. */
  logoDataUrl?: string | null;
  sections: PdfSection[];
  filename?: string;
}

export function downloadReportPDF(opts: PdfReportOpts) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  // ── Cabeçalho ──
  if (opts.logoDataUrl) {
    try {
      let lw = 30, lh = 16;
      try {
        const p = doc.getImageProperties(opts.logoDataUrl);
        if (p?.width && p?.height) {
          const maxW = 34, maxH = 18;
          lw = maxW; lh = maxW * (p.height / p.width);
          if (lh > maxH) { lh = maxH; lw = maxH * (p.width / p.height); }
        }
      } catch { /* sem dimensões — usa caixa padrão */ }
      doc.addImage(opts.logoDataUrl, "PNG", pageWidth - margin - lw, 8, lw, lh);
    } catch { /* ignora se não puder embedar */ }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(opts.title, margin, 16);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  let y = 22;
  if (opts.companyName) { doc.text(opts.companyName, margin, y); y += 4; }
  if (opts.subtitle) { doc.text(opts.subtitle, margin, y); y += 4; }
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, margin, y);
  doc.setTextColor(0);
  y += 6;

  // ── Seções ──
  for (const sec of opts.sections) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(sec.heading, margin, y);
    y += 2;

    const body = sec.rows.map((r) => sec.columns.map((c) => fmt(r[c.dataKey])));
    if (sec.totalRow) {
      body.push(sec.columns.map((c) => fmt(sec.totalRow![c.dataKey])));
    }

    autoTable(doc, {
      startY: y + 2,
      head: [sec.columns.map((c) => c.header)],
      body,
      headStyles: { fillColor: [120, 70, 220], textColor: 255, fontSize: 8.5 },
      bodyStyles: { fontSize: 8.5 },
      columnStyles: Object.fromEntries(
        sec.columns.map((c, i) => [
          i,
          { halign: c.align || "left" },
        ])
      ),
      // destaca a última linha (total) se houver
      didParseCell: (data) => {
        if (sec.totalRow && data.section === "body" && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [240, 238, 250];
        }
      },
      margin: { left: margin, right: margin },
    });

    // @ts-ignore — lastAutoTable é injetado pelo plugin
    y = (doc as any).lastAutoTable.finalY + 8;
  }

  // ── Rodapé ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(
      `Delvor · pág. ${i}/${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 6,
      { align: "center" }
    );
  }

  doc.save(opts.filename || `relatorio-${Date.now()}.pdf`);
}

function fmt(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

/* ====================================================================
   util
==================================================================== */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
