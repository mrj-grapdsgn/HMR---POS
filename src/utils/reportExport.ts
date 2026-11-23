import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { Branch, Product, SalesLine, SimpleTransaction } from '../types/pos';
import { formatNumber, formatRupiah } from './format';
import { normalizeBranchKey } from './productCategory';
import { parseTimestampMsFromTxCode } from './spreadsheetImport';

export interface ReportExportOptions {
  storeName: string;
  ownerName: string;
  branchKey: string;
  branchLabel: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  reportType: 'analysis' | 'transactions' | 'complete';
  transactions: SimpleTransaction[];
  salesLines: SalesLine[];
  products: Product[];
  branches: Branch[];
}

function getTxTimestampMs(tx: SimpleTransaction): number {
  if (tx.source === 'import') {
    const epochMs = parseTimestampMsFromTxCode(tx.invoiceNo);
    if (epochMs !== null) return epochMs;
    const yr = tx.saleYear || new Date().getFullYear();
    const mo = tx.saleMonth || 1;
    return Date.UTC(yr, mo - 1, 15, 12, 0, 0);
  }
  const dt = new Date(tx.createdAt);
  return Number.isNaN(dt.getTime()) ? 0 : dt.getTime();
}

function filterData(opts: ReportExportOptions) {
  const { branchKey, startDate, endDate, transactions, salesLines, branches } = opts;

  const branchIds = new Set<string>();
  if (branchKey !== 'all') {
    branches.forEach((b) => {
      if (normalizeBranchKey(b.name) === branchKey) branchIds.add(b.id);
    });
  }

  const startMs = startDate ? new Date(startDate + 'T00:00:00').getTime() : 0;
  const endMs = endDate ? new Date(endDate + 'T23:59:59').getTime() : Number.MAX_SAFE_INTEGER;

  const filteredTx = transactions.filter((t) => {
    if (branchKey !== 'all') {
      const matchId = t.branchId ? branchIds.has(t.branchId) : false;
      const tKey = normalizeBranchKey(t.branchName || '');
      if (!matchId && tKey !== branchKey) return false;
    }
    const ms = getTxTimestampMs(t);
    if (ms > 0 && (ms < startMs || ms > endMs)) return false;
    return true;
  });

  const validTxIds = new Set(filteredTx.map((t) => t.id));

  const filteredLines = salesLines.filter((l) => {
    if (branchKey !== 'all') {
      const matchId = branchIds.has(l.branchId);
      const lKey = normalizeBranchKey(l.branchName || '');
      if (!matchId && lKey !== branchKey) return false;
    }
    if (validTxIds.size > 0 && !validTxIds.has(l.transactionId)) return false;
    return true;
  });

  return { filteredTx, filteredLines };
}

export function exportSalesPDF(opts: ReportExportOptions): void {
  const { filteredTx, filteredLines } = filterData(opts);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const primaryColor = [27, 142, 230] as [number, number, number]; // #0F172A
  const darkColor = [30, 41, 59] as [number, number, number]; // #1E293B

  // Header banner
  doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.rect(0, 0, 210, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(opts.storeName.toUpperCase(), 14, 12);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`LAPORAN KEUANGAN & ANALISIS PENJUALAN (${opts.branchLabel})`, 14, 20);

  const dateStr =
    opts.startDate || opts.endDate
      ? `${opts.startDate || 'Awal'} s.d. ${opts.endDate || 'Sekarang'}`
      : 'Semua Periode';
  doc.text(`Periode: ${dateStr} | Cetak: ${new Date().toLocaleDateString('id-ID')}`, 14, 25);

  let cursorY = 34;

  // Compute Metrics
  let totalGross = 0;
  let totalDisc = 0;
  let totalNet = 0;
  let totalQty = 0;
  const countedTx = new Set<string>();

  filteredTx.forEach((t) => {
    const rawSub = Math.max(0, Math.round(t.subtotal || 0));
    const rawDisc = Math.max(0, Math.round(t.discountAmount || 0));
    const rawGrand = Math.max(0, Math.round(t.grandTotal || 0));
    const net = rawDisc > 0 && rawGrand >= rawSub && rawSub > 0 ? Math.max(0, rawSub - rawDisc) : rawGrand;
    const gross = Math.max(rawSub, net + rawDisc);
    const disc = Math.max(0, gross - net);

    totalGross += gross;
    totalDisc += disc;
    totalNet += net;
    countedTx.add(t.id);
  });

  filteredLines.forEach((l) => {
    if (l.qty > 0) totalQty += l.qty;
  });
  if (totalQty === 0) {
    filteredTx.forEach((t) => {
      totalQty += t.totalQty ?? 0;
    });
  }

  // Summary KPI Cards Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, cursorY, 182, 18, 2, 2, 'FD');

  doc.setTextColor(darkColor[0], darkColor[1], darkColor[2]);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('TOTAL TRANSAKSI', 18, cursorY + 6);
  doc.text('TOTAL QTY TERJUAL', 66, cursorY + 6);
  doc.text('TOTAL POTONGAN', 114, cursorY + 6);
  doc.text('TOTAL OMSET (NET)', 160, cursorY + 6);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`${formatNumber(filteredTx.length)} trx`, 18, cursorY + 13);
  doc.text(`${formatNumber(totalQty)} pcs`, 66, cursorY + 13);
  doc.setTextColor(225, 29, 72); // rose-600
  doc.text(`-${formatRupiah(totalDisc)}`, 114, cursorY + 13);
  doc.setTextColor(13, 148, 136); // emerald
  doc.setFont('helvetica', 'bold');
  doc.text(formatRupiah(totalNet), 160, cursorY + 13);

  cursorY += 24;

  // Section 1: Analisa Penjualan (Top Products)
  if (opts.reportType === 'analysis' || opts.reportType === 'complete') {
    doc.setTextColor(darkColor[0], darkColor[1], darkColor[2]);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('1. Analisa Top Produk Terlaris & Omset', 14, cursorY);
    cursorY += 4;

    const skuMap = new Map<string, { sku: string; name: string; category: string; qty: number; rev: number }>();
    filteredLines.forEach((l) => {
      if (l.qty <= 0) return;
      const key = (l.productSku || l.productId).trim().toLowerCase();
      const prev = skuMap.get(key);
      if (prev) {
        prev.qty += l.qty;
        prev.rev += l.lineTotal;
      } else {
        skuMap.set(key, {
          sku: l.productSku || '-',
          name: l.productName,
          category: l.category || 'Umum',
          qty: l.qty,
          rev: l.lineTotal,
        });
      }
    });

    const topList = Array.from(skuMap.values())
      .sort((a, b) => b.qty - a.qty || b.rev - a.rev)
      .slice(0, 15);

    const tableData = topList.map((item, idx) => [
      idx + 1,
      item.name,
      item.category,
      `${item.qty} pcs`,
      formatRupiah(item.rev),
    ]);

    autoTable(doc, {
      startY: cursorY,
      head: [['No', 'Nama Produk', 'Kategori', 'Qty Terjual', 'Total Omset']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: darkColor },
      columnStyles: { 0: { cellWidth: 10 }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });

    // @ts-expect-origin autoTable modifies doc with lastAutoTable
    cursorY = (doc as any).lastAutoTable.finalY + 10;
  }

  // Section 2: Report Penjualan (Transactions)
  if (opts.reportType === 'transactions' || opts.reportType === 'complete') {
    if (cursorY > 230) {
      doc.addPage();
      cursorY = 20;
    }

    doc.setTextColor(darkColor[0], darkColor[1], darkColor[2]);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(opts.reportType === 'complete' ? '2. Laporan Riwayat Transaksi (Net)' : 'Laporan Riwayat Transaksi (Net)', 14, cursorY);
    cursorY += 4;

    const txTableData = filteredTx.slice(0, 100).map((t, idx) => {
      const rawSub = Math.max(0, Math.round(t.subtotal || 0));
      const rawDisc = Math.max(0, Math.round(t.discountAmount || 0));
      const rawGrand = Math.max(0, Math.round(t.grandTotal || 0));
      const net = rawDisc > 0 && rawGrand >= rawSub && rawSub > 0 ? Math.max(0, rawSub - rawDisc) : rawGrand;
      const gross = Math.max(rawSub, net + rawDisc);
      const disc = Math.max(0, gross - net);

      return [
        idx + 1,
        t.invoiceNo,
        t.branchName || opts.branchLabel,
        t.paymentMethod.toUpperCase(),
        `${t.totalQty ?? 0} pcs`,
        formatRupiah(gross),
        disc > 0 ? `-${formatRupiah(disc)}` : 'Rp 0',
        formatRupiah(net),
      ];
    });

    autoTable(doc, {
      startY: cursorY,
      head: [['No', 'Invoice', 'Cabang', 'Metode', 'Qty', 'Subtotal', 'Potongan', 'Total Net']],
      body: txTableData,
      theme: 'grid',
      headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: darkColor },
      columnStyles: { 0: { cellWidth: 10 }, 4: { halign: 'center' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    });
  }

  // Footer on all pages
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Halaman ${i} dari ${pageCount} — ${opts.storeName} POS System`, 14, 290);
  }

  const fileName = `laporan-penjualan-${opts.reportType}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fileName);
}

export function exportSalesExcel(opts: ReportExportOptions): void {
  const { filteredTx, filteredLines } = filterData(opts);
  const wb = XLSX.utils.book_new();

  // Sheet 1: Analisa Penjualan Top Produk
  const skuMap = new Map<string, { sku: string; name: string; category: string; qty: number; rev: number }>();
  filteredLines.forEach((l) => {
    if (l.qty <= 0) return;
    const key = (l.productSku || l.productId).trim().toLowerCase();
    const prev = skuMap.get(key);
    if (prev) {
      prev.qty += l.qty;
      prev.rev += l.lineTotal;
    } else {
      skuMap.set(key, {
        sku: l.productSku || '-',
        name: l.productName,
        category: l.category || 'Umum',
        qty: l.qty,
        rev: l.lineTotal,
      });
    }
  });

  const analysisRows = Array.from(skuMap.values())
    .sort((a, b) => b.qty - a.qty || b.rev - a.rev)
    .map((item, idx) => ({
      No: idx + 1,
      'Kode SKU': item.sku,
      'Nama Produk': item.name,
      Kategori: item.category,
      'Qty Terjual (pcs)': item.qty,
      'Total Omset (Net)': item.rev,
    }));

  const wsAnalysis = XLSX.utils.json_to_sheet(analysisRows);
  XLSX.utils.book_append_sheet(wb, wsAnalysis, 'Analisa Penjualan');

  // Sheet 2: Report Transaksi Lengkap
  const txRows = filteredTx.map((t, idx) => {
    const rawSub = Math.max(0, Math.round(t.subtotal || 0));
    const rawDisc = Math.max(0, Math.round(t.discountAmount || 0));
    const rawGrand = Math.max(0, Math.round(t.grandTotal || 0));
    const net = rawDisc > 0 && rawGrand >= rawSub && rawSub > 0 ? Math.max(0, rawSub - rawDisc) : rawGrand;
    const gross = Math.max(rawSub, net + rawDisc);
    const disc = Math.max(0, gross - net);

    return {
      No: idx + 1,
      Invoice: t.invoiceNo,
      Cabang: t.branchName || opts.branchLabel,
      Waktu: t.createdAt,
      Kasir: t.cashierName || 'Admin',
      'Metode Bayar': t.paymentMethod.toUpperCase(),
      'Total Qty': t.totalQty ?? 0,
      'Subtotal Kotor': gross,
      'Potongan Diskon': disc,
      'Total Bayar (Net)': net,
    };
  });

  const wsTx = XLSX.utils.json_to_sheet(txRows);
  XLSX.utils.book_append_sheet(wb, wsTx, 'Report Transaksi');

  const fileName = `laporan-penjualan-lengkap-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
