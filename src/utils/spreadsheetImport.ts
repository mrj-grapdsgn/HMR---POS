import * as XLSX from 'xlsx';
import { ImportedCatalogRow } from '../types/pos';

const MONTH_NAME_MAP: Record<string, number> = {
  jan: 1,
  januari: 1,
  january: 1,
  feb: 2,
  februari: 2,
  february: 2,
  mar: 3,
  maret: 3,
  march: 3,
  apr: 4,
  april: 4,
  mei: 5,
  may: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  agu: 8,
  agustus: 8,
  aug: 8,
  august: 8,
  sep: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  des: 12,
  desember: 12,
  dec: 12,
  december: 12,
};

function parseRupiahOrNumber(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.round(raw));
  }
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  // Remove Rp, pcs, trx, whitespace, and thousand dots (e.g. Rp650.000 -> 650000)
  const cleaned = s
    .replace(/rp\.?/gi, '')
    .replace(/pcs|trx|unit/gi, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(/,.*$/, '')
    .replace(/[^0-9-]/g, '');
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function parseMonth(raw: unknown, fallbackMonth: number): number {
  if (typeof raw === 'number' && raw >= 1 && raw <= 12) return Math.round(raw);
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return fallbackMonth;
  const num = parseInt(s, 10);
  if (Number.isFinite(num) && num >= 1 && num <= 12) return num;
  for (const [key, val] of Object.entries(MONTH_NAME_MAP)) {
    if (s.includes(key)) return val;
  }
  return fallbackMonth;
}

function normalizeHeader(cell: unknown): string {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function findColIndex(headers: string[], candidates: string[]): number {
  for (const cand of candidates) {
    const exact = headers.findIndex((h) => h === cand);
    if (exact >= 0) return exact;
  }
  for (const cand of candidates) {
    const partial = headers.findIndex((h) => h.includes(cand));
    if (partial >= 0) return partial;
  }
  return -1;
}

/**
 * Parses an uploaded Excel (.xlsx/.xls) or CSV file (or CSV text)
 * into normalized ImportedCatalogRow records.
 * Supports both:
 *  1) Standard product/stock tables (Kode Item/SKU, Nama Produk, Kategori, Harga, Stok Awal, Sisa Stok, Cabang)
 *  2) The user's Google Sheet "Dasbor Rekapan Penjualan & Analisis Restok Produk" export!
 */
export function parseSpreadsheetMatrix(
  matrix: unknown[][],
  defaultBranchName: string,
  defaultMonth: number,
  defaultYear: number
): {
  rows: ImportedCatalogRow[];
  detectedBranch: string;
  detectedMonth: number;
} {
  let detectedBranch = defaultBranchName;
  let detectedMonth = defaultMonth;

  // Scan top 10 rows for metadata like "PILIH CABANG: CFD Senayan" or "PILIH BULAN: Juli"
  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const row = matrix[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cellStr = String(row[c] ?? '').trim();
      const lower = cellStr.toLowerCase();
      if (lower.includes('pilih cabang')) {
        for (let k = c + 1; k < Math.min(c + 5, row.length); k++) {
          const val = String(row[k] ?? '').trim();
          if (val && !val.toLowerCase().includes('tips')) {
            detectedBranch = val;
            break;
          }
        }
      }
      if (lower.includes('pilih bulan')) {
        for (let k = c + 1; k < Math.min(c + 5, row.length); k++) {
          const val = String(row[k] ?? '').trim();
          if (val && !val.toLowerCase().includes('tips')) {
            detectedMonth = parseMonth(val, defaultMonth);
            break;
          }
        }
      }
    }
  }

  // Locate best header row (prefer the Restok table if present because it has Stok Awal & Sisa Stok)
  let headerRowIdx = -1;
  let bestScore = -1;

  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const norm = row.map(normalizeHeader);
    const hasName =
      findColIndex(norm, ['nama produk', 'nama barang', 'produk', 'product', 'name']) >=
      0;
    const hasSku =
      findColIndex(norm, ['kode item', 'kode barang', 'sku', 'barcode', 'kode']) >= 0;
    if (!hasName && !hasSku) continue;

    let score = (hasName ? 2 : 0) + (hasSku ? 2 : 0);
    if (findColIndex(norm, ['sisa stok', 'stok akhir', 'stok', 'stock']) >= 0) {
      score += 4;
    }
    if (findColIndex(norm, ['stok awal', 'initial stock']) >= 0) {
      score += 3;
    }
    if (findColIndex(norm, ['harga', 'harga jual', 'price']) >= 0) {
      score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      headerRowIdx = r;
    }
  }

  if (headerRowIdx < 0) {
    return { rows: [], detectedBranch, detectedMonth };
  }

  const headers = (matrix[headerRowIdx] ?? []).map(normalizeHeader);
  const idxSku = findColIndex(headers, [
    'kode item',
    'kode barang',
    'sku',
    'kode',
  ]);
  const idxBarcode = findColIndex(headers, ['barcode', 'kode barcode']);
  const idxName = findColIndex(headers, [
    'nama produk',
    'nama barang',
    'produk',
    'product',
    'name',
  ]);
  const idxCategory = findColIndex(headers, ['kategori', 'category', 'jenis']);
  const idxPrice = findColIndex(headers, [
    'harga jual',
    'harga satuan',
    'harga',
    'price',
  ]);
  const idxInitialStock = findColIndex(headers, [
    'stok awal',
    'initial stock',
    'stock awal',
  ]);
  const idxCurrentStock = findColIndex(headers, [
    'sisa stok',
    'stok akhir',
    'stok sekarang',
    'stok',
    'stock',
  ]);
  const idxQtySold = findColIndex(headers, [
    'qty terjual',
    'terjual',
    'qty',
    'kuantitas',
  ]);
  const idxTotalSales = findColIndex(headers, [
    'total penjualan',
    'omset',
    'total omset',
    'penjualan',
  ]);
  const idxBranch = findColIndex(headers, ['cabang', 'branch', 'toko', 'outlet']);
  const idxMonth = findColIndex(headers, ['bulan', 'month']);
  const idxYear = findColIndex(headers, ['tahun', 'year']);

  const parsedMap = new Map<string, ImportedCatalogRow>();

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const rawName = idxName >= 0 ? String(row[idxName] ?? '').trim() : '';
    const rawSku = idxSku >= 0 ? String(row[idxSku] ?? '').trim() : '';

    // Stop or skip summary rows
    const joinedLower = row.map((c) => String(c ?? '').toLowerCase()).join(' ');
    if (
      joinedLower.includes('total nominasi') ||
      joinedLower.includes('total top 10')
    ) {
      break;
    }

    if (!rawName && !rawSku) continue;
    if (rawName.toLowerCase() === 'nama produk') continue;

    const cleanSku = (rawSku || `SKU-${r}`)
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 32);
    const cleanBarcode =
      (idxBarcode >= 0 ? String(row[idxBarcode] ?? '').trim() : cleanSku)
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 64) || cleanSku;
    const cleanName = (rawName || cleanSku).slice(0, 100);
    const category =
      (idxCategory >= 0 ? String(row[idxCategory] ?? '').trim() : '') ||
      'Umum';
    const qtySold =
      idxQtySold >= 0 ? parseRupiahOrNumber(row[idxQtySold]) : 0;
    const totalSales =
      idxTotalSales >= 0 ? parseRupiahOrNumber(row[idxTotalSales]) : 0;

    let price = idxPrice >= 0 ? parseRupiahOrNumber(row[idxPrice]) : 0;
    if (price === 0 && qtySold > 0 && totalSales > 0) {
      price = Math.round(totalSales / qtySold);
    }

    const currentStock =
      idxCurrentStock >= 0 ? parseRupiahOrNumber(row[idxCurrentStock]) : 0;
    const initialStock =
      idxInitialStock >= 0
        ? parseRupiahOrNumber(row[idxInitialStock])
        : currentStock + qtySold;

    const branchName =
      (idxBranch >= 0 ? String(row[idxBranch] ?? '').trim() : '') ||
      detectedBranch ||
      'CFD Senayan';
    const saleMonth =
      idxMonth >= 0
        ? parseMonth(row[idxMonth], detectedMonth)
        : detectedMonth;
    const saleYear =
      idxYear >= 0
        ? parseRupiahOrNumber(row[idxYear]) || defaultYear
        : defaultYear;

    const dedupeKey = `${branchName.toLowerCase()}::${cleanSku.toLowerCase()}`;
    parsedMap.set(dedupeKey, {
      sku: cleanSku,
      barcode: cleanBarcode,
      name: cleanName,
      category: category.slice(0, 50),
      price,
      branchName: branchName.slice(0, 80),
      initialStock,
      currentStock,
      qtySold: qtySold > 0 ? qtySold : undefined,
      totalSales: qtySold > 0 ? totalSales : undefined,
      saleMonth,
      saleYear,
    });
  }

  return {
    rows: Array.from(parsedMap.values()),
    detectedBranch,
    detectedMonth,
  };
}

export async function parseSpreadsheetFile(
  file: File,
  defaultBranchName: string,
  defaultMonth: number,
  defaultYear: number
): Promise<{
  rows: ImportedCatalogRow[];
  detectedBranch: string;
  detectedMonth: number;
}> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { rows: [], detectedBranch: defaultBranchName, detectedMonth: defaultMonth };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  });
  return parseSpreadsheetMatrix(
    matrix,
    defaultBranchName,
    defaultMonth,
    defaultYear
  );
}

/**
 * Converts a standard Google Sheets URL into a CSV export URL if needed.
 */
export function normalizeGoogleSheetCsvUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.includes('output=csv') || trimmed.includes('format=csv')) {
    return trimmed;
  }
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) {
    const sheetId = match[1];
    const gidMatch = trimmed.match(/gid=(\d+)/);
    const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : '';
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`;
  }
  return trimmed;
}

export async function fetchAndParseSheetUrl(
  rawUrl: string,
  defaultBranchName: string,
  defaultMonth: number,
  defaultYear: number
): Promise<{
  rows: ImportedCatalogRow[];
  detectedBranch: string;
  detectedMonth: number;
}> {
  const csvUrl = normalizeGoogleSheetCsvUrl(rawUrl);
  const res = await fetch(csvUrl);
  if (!res.ok) {
    throw new Error(
      `Gagal mengambil Google Sheet (HTTP ${res.status}). Pastikan akses sheet diatur ke "Siapa saja yang memiliki link" atau ekspor sebagai file CSV/Excel.`
    );
  }
  const text = await res.text();
  const workbook = XLSX.read(text, { type: 'string' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { rows: [], detectedBranch: defaultBranchName, detectedMonth: defaultMonth };
  }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(
    workbook.Sheets[firstSheetName],
    { header: 1, defval: '', raw: true }
  );
  return parseSpreadsheetMatrix(
    matrix,
    defaultBranchName,
    defaultMonth,
    defaultYear
  );
}
