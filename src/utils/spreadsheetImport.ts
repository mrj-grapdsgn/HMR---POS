import * as XLSX from 'xlsx';
import { ImportedCatalogRow } from '../types/pos';

export type SheetTabKind = 'catalog' | 'sales' | 'dashboard' | 'unknown';

export interface ParsedSheetTab {
  sheetName: string;
  kind: SheetTabKind;
  rows: ImportedCatalogRow[];
  rawRowCount: number;
  detectedBranch: string;
  detectedMonth: number;
  selectedByDefault: boolean;
}

export interface ParsedWorkbookResult {
  tabs: ParsedSheetTab[];
  rows: ImportedCatalogRow[];
  detectedBranch: string;
  detectedMonth: number;
  isDashboardSummaryOnly: boolean;
  fetchedFormat: 'xlsx' | 'csv';
  xlsxDownloadUrl?: string;
  warnings: string[];
}

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

const GENERIC_TAB_NAMES = new Set([
  'sheet1',
  'sheet2',
  'sheet3',
  'dasbor',
  'dashboard',
  'rekapan',
  'rekap',
  'ringkasan',
  'summary',
  'master',
  'master produk',
  'daftar produk',
  'produk',
  'product',
  'products',
  'barang',
  'katalog',
  'catalog',
  'stok',
  'stock',
  'inventory',
  'inventori',
  'transaksi',
  'penjualan',
  'sales',
  'laporan',
  'report',
  'data',
  'database',
  'database produk',
  'database stok',
  'restok',
  'analisis',
  'list',
  'menu',
  'harga',
  'all',
  'semua',
]);

function parseRupiahOrNumber(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.round(raw));
  }
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  // Handle Indonesian format Rp650.000 or 650.000,00 or 1,500
  const stripped = s
    .replace(/rp\.?/gi, '')
    .replace(/idr/gi, '')
    .replace(/pcs|trx|unit|buah|item/gi, '')
    .replace(/\s+/g, '');

  // If format has both dot and comma, decide decimal separator by last occurrence
  let normalized = stripped;
  const lastDot = stripped.lastIndexOf('.');
  const lastComma = stripped.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) {
      // Indonesian: 1.250.000,50
      normalized = stripped.replace(/\./g, '').replace(/,.*$/, '');
    } else {
      // English: 1,250,000.50
      normalized = stripped.replace(/,/g, '').replace(/\..*$/, '');
    }
  } else if (lastDot >= 0) {
    // Check if dot is thousand separator (3 digits after last dot) vs decimal
    const afterDot = stripped.slice(lastDot + 1);
    if (afterDot.length === 3 || stripped.split('.').length > 2) {
      normalized = stripped.replace(/\./g, '');
    } else {
      normalized = stripped.replace(/\..*$/, '');
    }
  } else if (lastComma >= 0) {
    const afterComma = stripped.slice(lastComma + 1);
    if (afterComma.length === 3 || stripped.split(',').length > 2) {
      normalized = stripped.replace(/,/g, '');
    } else {
      normalized = stripped.replace(/,.*$/, '');
    }
  }

  const digits = normalized.replace(/[^0-9-]/g, '');
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function parseMonth(raw: unknown, fallbackMonth: number): number {
  if (typeof raw === 'number' && raw >= 1 && raw <= 12) return Math.round(raw);
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return fallbackMonth;
  const num = parseInt(s, 10);
  if (Number.isFinite(num) && num >= 1 && num <= 12 && /^\d{1,2}$/.test(s)) {
    return num;
  }
  for (const [key, val] of Object.entries(MONTH_NAME_MAP)) {
    if (s.includes(key)) return val;
  }
  return fallbackMonth;
}

function parseDateToYearMonth(
  raw: unknown,
  fallbackYear: number,
  fallbackMonth: number
): { year: number; month: number } {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { year: raw.getFullYear(), month: raw.getMonth() + 1 };
  }
  // Excel serial date (between year 2000 = 36526 and year 2099 = 73050)
  if (typeof raw === 'number' && raw >= 36500 && raw <= 75000) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y >= 2000 && parsed.m >= 1 && parsed.m <= 12) {
      return { year: parsed.y, month: parsed.m };
    }
  }
  const s = String(raw ?? '').trim();
  if (!s) return { year: fallbackYear, month: fallbackMonth };

  // ISO: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
      return { year: y, month: m };
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmyMatch) {
    const p1 = parseInt(dmyMatch[1], 10);
    const p2 = parseInt(dmyMatch[2], 10);
    let y = parseInt(dmyMatch[3], 10);
    if (y < 100) y += 2000;
    const m = p2 <= 12 ? p2 : p1 <= 12 ? p1 : fallbackMonth;
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
      return { year: y, month: m };
    }
  }

  // Text date containing month name (e.g., "15 Juli 2026" or "Jul 2026")
  const lower = s.toLowerCase();
  let detectedM = fallbackMonth;
  for (const [key, val] of Object.entries(MONTH_NAME_MAP)) {
    if (lower.includes(key)) {
      detectedM = val;
      break;
    }
  }
  const yearMatch = s.match(/\b(20\d{2})\b/);
  const detectedY = yearMatch ? parseInt(yearMatch[1], 10) : fallbackYear;
  return { year: detectedY, month: detectedM };
}

function normalizeHeader(cell: unknown): string {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function findColIndex(
  headers: string[],
  candidates: string[],
  excludeSubstrings: string[] = []
): number {
  const isExcluded = (h: string) =>
    excludeSubstrings.some((ex) => h.includes(ex));

  for (const cand of candidates) {
    const exact = headers.findIndex((h) => h === cand && !isExcluded(h));
    if (exact >= 0) return exact;
  }
  for (const cand of candidates) {
    const partial = headers.findIndex(
      (h) => h.includes(cand) && !isExcluded(h)
    );
    if (partial >= 0) return partial;
  }
  return -1;
}

function cellToSkuString(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.round(raw));
  }
  return String(raw).trim();
}

function slugSkuFromName(name: string, rowIdx: number): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 26);
  return slug.length >= 2 ? `PRD-${slug}` : `SKU-${rowIdx}`;
}

function inferBranchFromSheetName(sheetName: string): string | null {
  const trimmed = sheetName.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (GENERIC_TAB_NAMES.has(lower)) return null;

  // Strip common prefixes like "Stok CFD Senayan" or "Cabang Bandung"
  const stripped = trimmed
    .replace(/^(stok|stock|cabang|branch|outlet|toko|data|rekap)\s*[-: ]*\s*/i, '')
    .trim();
  const strippedLower = stripped.toLowerCase();
  if (!stripped || GENERIC_TAB_NAMES.has(strippedLower)) return null;
  if (
    strippedLower.includes('dasbor') ||
    strippedLower.includes('dashboard') ||
    strippedLower.includes('rekapan') ||
    strippedLower.includes('transaksi') ||
    strippedLower.includes('penjualan') ||
    strippedLower.includes('master') ||
    strippedLower.includes('produk') ||
    strippedLower.includes('sheet')
  ) {
    return null;
  }
  return stripped.slice(0, 80);
}

function isSummaryRowText(rawName: string, rawSku: string, row: unknown[]): boolean {
  const nameLower = rawName.toLowerCase().trim();
  const skuLower = rawSku.toLowerCase().trim();
  if (
    nameLower === 'total' ||
    nameLower.startsWith('total ') ||
    nameLower.startsWith('grand total') ||
    nameLower.startsWith('subtotal') ||
    nameLower === 'jumlah' ||
    skuLower === 'total' ||
    skuLower.startsWith('total ')
  ) {
    return true;
  }
  const firstFew = row
    .slice(0, 4)
    .map((c) => String(c ?? '').toLowerCase().trim())
    .join(' ');
  if (
    firstFew.includes('total nominasi') ||
    firstFew.includes('total top 10') ||
    firstFew.includes('grand total')
  ) {
    return true;
  }
  return false;
}

/**
 * Parses a single sheet's 2D matrix into normalized ImportedCatalogRow records.
 */
export function parseSpreadsheetMatrix(
  matrix: unknown[][],
  defaultBranchName: string,
  defaultMonth: number,
  defaultYear: number,
  sheetName = 'Sheet1'
): ParsedSheetTab {
  const tabBranchHint = inferBranchFromSheetName(sheetName);
  let detectedBranch = tabBranchHint || defaultBranchName;
  let detectedMonth = defaultMonth;
  let isDashboard = false;

  // Scan top 12 rows for dashboard signatures & filter metadata
  const topTextParts: string[] = [];
  for (let r = 0; r < Math.min(12, matrix.length); r++) {
    const row = matrix[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cellStr = String(row[c] ?? '').trim();
      if (!cellStr) continue;
      const lower = cellStr.toLowerCase();
      topTextParts.push(lower);
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

  const topJoined = topTextParts.join(' ');
  const sheetLower = sheetName.toLowerCase();
  if (
    topJoined.includes('dasbor rekapan') ||
    topJoined.includes('top 10 produk terlaris') ||
    topJoined.includes('analisis prioritas restok') ||
    sheetLower.includes('dasbor') ||
    sheetLower.includes('dashboard') ||
    sheetLower.includes('ringkasan')
  ) {
    isDashboard = true;
  }

  // Locate best header row across first 60 rows (or full sheet if short)
  const scanLimit = Math.min(matrix.length, 60);
  let headerRowIdx = -1;
  let bestScore = -1;

  for (let r = 0; r < scanLimit; r++) {
    const row = matrix[r] ?? [];
    const norm = row.map(normalizeHeader);
    const hasName =
      findColIndex(
        norm,
        ['nama produk', 'nama barang', 'nama item', 'produk', 'barang', 'product', 'item', 'name', 'deskripsi'],
        ['nama cabang', 'nama kasir', 'nama pembeli', 'nama customer', 'nama pelanggan', 'nama toko']
      ) >= 0;
    const hasSku =
      findColIndex(
        norm,
        ['kode item', 'kode barang', 'kode produk', 'sku', 'barcode', 'item code', 'kode', 'artikel', 'plu'],
        ['kode cabang', 'kode transaksi', 'kode invoice', 'kode voucher', 'kode promo', 'kode kasir']
      ) >= 0;
    if (!hasName && !hasSku) continue;

    let score = (hasName ? 3 : 0) + (hasSku ? 3 : 0);
    if (
      findColIndex(
        norm,
        ['sisa stok', 'stok akhir', 'stok sekarang', 'stok tersedia', 'stok', 'stock'],
        ['stok awal', 'stock awal', 'status', '%']
      ) >= 0
    ) {
      score += 4;
    }
    if (findColIndex(norm, ['stok awal', 'initial stock', 'stock awal']) >= 0) {
      score += 3;
    }
    if (findColIndex(norm, ['harga jual', 'harga satuan', 'harga', 'price', 'het']) >= 0) {
      score += 2;
    }
    if (findColIndex(norm, ['kategori', 'category', 'jenis']) >= 0) {
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      headerRowIdx = r;
    }
  }

  if (headerRowIdx < 0) {
    return {
      sheetName,
      kind: isDashboard ? 'dashboard' : 'unknown',
      rows: [],
      rawRowCount: 0,
      detectedBranch,
      detectedMonth,
      selectedByDefault: false,
    };
  }

  const headers = (matrix[headerRowIdx] ?? []).map(normalizeHeader);
  const idxSku = findColIndex(
    headers,
    [
      'kode item',
      'kode barang',
      'kode produk',
      'kode sku',
      'sku',
      'item code',
      'product code',
      'artikel',
      'article',
      'plu',
      'kode',
      'code',
    ],
    ['kode cabang', 'kode transaksi', 'kode invoice', 'kode voucher', 'kode promo', 'kode kasir', 'barcode']
  );
  const idxBarcode = findColIndex(headers, ['barcode', 'kode barcode', 'ean', 'upc']);
  const idxName = findColIndex(
    headers,
    [
      'nama produk',
      'nama barang',
      'nama item',
      'product name',
      'deskripsi',
      'description',
      'produk',
      'barang',
      'item',
      'product',
      'nama',
      'name',
    ],
    ['nama cabang', 'nama kasir', 'nama pembeli', 'nama customer', 'nama pelanggan', 'nama toko', 'kode item']
  );
  const idxCategory = findColIndex(headers, [
    'kategori',
    'category',
    'jenis',
    'sub kategori',
    'grup',
    'group',
    'divisi',
    'tipe',
    'type',
  ]);
  const idxPrice = findColIndex(
    headers,
    ['harga jual', 'harga satuan', 'unit price', 'harga retail', 'harga', 'price', 'het', 'hj', 'tarif'],
    ['total harga', 'harga beli', 'harga modal', 'hpp']
  );
  const idxInitialStock = findColIndex(headers, [
    'stok awal',
    'initial stock',
    'stock awal',
    'saldo awal',
    'qty awal',
    'stok masuk',
  ]);
  const idxCurrentStock = findColIndex(
    headers,
    [
      'sisa stok',
      'stok akhir',
      'stok sekarang',
      'stok tersedia',
      'stok saat ini',
      'saldo akhir',
      'qty akhir',
      'sisa',
      'stok',
      'stock',
      'qty stok',
      'available',
    ],
    ['stok awal', 'stock awal', 'status', 'restok', '%', 'terjual']
  );
  const idxQtySold = findColIndex(
    headers,
    [
      'qty terjual',
      'jumlah terjual',
      'terjual',
      'qty jual',
      'kuantitas',
      'quantity',
      'qty',
      'jumlah',
      'sold',
    ],
    ['qty awal', 'qty akhir', 'qty stok', '%', 'total qty', 'jumlah stok']
  );
  const idxTotalSales = findColIndex(
    headers,
    [
      'total penjualan',
      'total omset',
      'nilai penjualan',
      'total harga',
      'omset',
      'penjualan',
      'subtotal',
      'revenue',
      'sales',
      'total',
      'nominal',
      'amount',
    ],
    ['total stok', 'total qty', 'total item', 'total produk']
  );
  const idxBranch = findColIndex(headers, [
    'cabang',
    'nama cabang',
    'branch',
    'toko',
    'outlet',
    'lokasi',
    'store',
    'event',
  ]);
  const idxMonth = findColIndex(headers, ['bulan', 'month', 'periode']);
  const idxYear = findColIndex(headers, ['tahun', 'year']);
  const idxDate = findColIndex(headers, [
    'tanggal transaksi',
    'tgl transaksi',
    'tanggal',
    'tgl',
    'date',
    'waktu',
    'timestamp',
  ]);

  const isSalesSheet =
    !isDashboard &&
    (sheetLower.includes('transaksi') ||
      sheetLower.includes('penjualan') ||
      sheetLower.includes('sales') ||
      (idxDate >= 0 && idxCurrentStock < 0) ||
      (idxQtySold >= 0 && idxCurrentStock < 0 && idxInitialStock < 0));

  const kind: SheetTabKind = isDashboard
    ? 'dashboard'
    : isSalesSheet
      ? 'sales'
      : 'catalog';

  const parsedMap = new Map<string, ImportedCatalogRow>();
  let rawRowCount = 0;

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const rawName = idxName >= 0 ? String(row[idxName] ?? '').trim() : '';
    const rawSku = idxSku >= 0 ? cellToSkuString(row[idxSku]) : '';
    const rawBarcode = idxBarcode >= 0 ? cellToSkuString(row[idxBarcode]) : '';

    if (!rawName && !rawSku && !rawBarcode) continue;
    if (
      rawName.toLowerCase() === 'nama produk' ||
      rawName.toLowerCase() === 'nama barang' ||
      rawSku.toLowerCase() === 'kode item'
    ) {
      continue;
    }
    if (isSummaryRowText(rawName, rawSku, row)) {
      if (isDashboard) break;
      continue;
    }

    const baseSku = rawSku || rawBarcode || slugSkuFromName(rawName, r);
    const cleanSku = baseSku
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32) || `SKU-${r}`;

    const cleanBarcode =
      (rawBarcode || cleanSku)
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64) || cleanSku;

    const cleanName = (rawName || cleanSku).slice(0, 100);
    const category =
      (idxCategory >= 0 ? String(row[idxCategory] ?? '').trim() : '') || 'Umum';
    const qtySold =
      idxQtySold >= 0 ? parseRupiahOrNumber(row[idxQtySold]) : 0;
    const totalSales =
      idxTotalSales >= 0 ? parseRupiahOrNumber(row[idxTotalSales]) : 0;

    let price = idxPrice >= 0 ? parseRupiahOrNumber(row[idxPrice]) : 0;
    if (price === 0 && qtySold > 0 && totalSales > 0) {
      price = Math.round(totalSales / qtySold);
    }

    const hasCurrentStockCol = idxCurrentStock >= 0;
    const hasInitialStockCol = idxInitialStock >= 0;
    const currentStock = hasCurrentStockCol
      ? parseRupiahOrNumber(row[idxCurrentStock])
      : 0;
    const initialStock = hasInitialStockCol
      ? parseRupiahOrNumber(row[idxInitialStock])
      : currentStock + qtySold;

    const branchName =
      (idxBranch >= 0 ? String(row[idxBranch] ?? '').trim() : '') ||
      detectedBranch ||
      defaultBranchName ||
      'CFD Senayan';

    let saleYear = defaultYear;
    let saleMonth = detectedMonth;
    if (idxDate >= 0 && row[idxDate] !== '' && row[idxDate] !== undefined) {
      const dm = parseDateToYearMonth(row[idxDate], defaultYear, detectedMonth);
      saleYear = dm.year;
      saleMonth = dm.month;
    }
    if (idxMonth >= 0 && String(row[idxMonth] ?? '').trim()) {
      saleMonth = parseMonth(row[idxMonth], saleMonth);
    }
    if (idxYear >= 0 && String(row[idxYear] ?? '').trim()) {
      const parsedYr = parseRupiahOrNumber(row[idxYear]);
      if (parsedYr >= 2000 && parsedYr <= 2100) saleYear = parsedYr;
    }

    rawRowCount += 1;

    // Group by (branch, sku, year, month) so transaction logs aggregate qty & sales instead of overwriting!
    const dedupeKey = isSalesSheet
      ? `${branchName.toLowerCase()}::${cleanSku.toLowerCase()}::${saleYear}::${saleMonth}`
      : `${branchName.toLowerCase()}::${cleanSku.toLowerCase()}`;

    const prev = parsedMap.get(dedupeKey);
    if (prev && isSalesSheet) {
      const nextQty = (prev.qtySold ?? 0) + qtySold;
      const nextSales = (prev.totalSales ?? 0) + totalSales;
      parsedMap.set(dedupeKey, {
        ...prev,
        name: prev.name || cleanName,
        category: prev.category !== 'Umum' ? prev.category : category.slice(0, 50),
        price: prev.price > 0 ? prev.price : price,
        qtySold: nextQty > 0 ? nextQty : undefined,
        totalSales: nextQty > 0 ? nextSales : undefined,
      });
    } else if (prev) {
      parsedMap.set(dedupeKey, {
        ...prev,
        name: cleanName || prev.name,
        category: category !== 'Umum' ? category.slice(0, 50) : prev.category,
        price: price > 0 ? price : prev.price,
        initialStock: hasInitialStockCol ? initialStock : prev.initialStock,
        currentStock: hasCurrentStockCol ? currentStock : prev.currentStock,
        qtySold:
          qtySold > 0
            ? (prev.qtySold ?? 0) + qtySold
            : prev.qtySold,
        totalSales:
          qtySold > 0
            ? (prev.totalSales ?? 0) + totalSales
            : prev.totalSales,
      });
    } else {
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
  }

  return {
    sheetName,
    kind,
    rows: Array.from(parsedMap.values()),
    rawRowCount,
    detectedBranch,
    detectedMonth,
    selectedByDefault: !isDashboard && parsedMap.size > 0,
  };
}

/**
 * Merges rows from multiple selected tabs cleanly:
 * - Preserves all unique products and branch stocks from catalog tabs.
 * - Attaches/aggregates sales from sales tabs without wiping out stock from catalog tabs.
 */
export function mergeSelectedTabs(
  tabs: ParsedSheetTab[],
  selectedSheetNames: string[]
): ImportedCatalogRow[] {
  const selectedSet = new Set(selectedSheetNames);
  const chosen = tabs.filter(
    (t) => selectedSet.has(t.sheetName) && t.rows.length > 0
  );
  if (chosen.length === 0) return [];
  if (chosen.length === 1) return chosen[0].rows;

  // Sort so catalog/stock tabs are processed before sales/dashboard tabs
  const order: Record<SheetTabKind, number> = {
    catalog: 0,
    dashboard: 1,
    sales: 2,
    unknown: 3,
  };
  const ordered = [...chosen].sort((a, b) => order[a.kind] - order[b.kind]);

  // Keep master metadata per SKU so sales-only tabs inherit price & category
  const masterBySku = new Map<
    string,
    { name: string; category: string; price: number; barcode: string }
  >();
  for (const tab of ordered) {
    for (const r of tab.rows) {
      const skuKey = r.sku.toLowerCase();
      const prev = masterBySku.get(skuKey);
      masterBySku.set(skuKey, {
        name: prev?.name || r.name,
        barcode: prev?.barcode || r.barcode,
        category:
          prev && prev.category !== 'Umum' ? prev.category : r.category,
        price: prev && prev.price > 0 ? prev.price : r.price,
      });
    }
  }

  const merged = new Map<string, ImportedCatalogRow>();
  for (const tab of ordered) {
    const isSalesOnly = tab.kind === 'sales';
    for (const r of tab.rows) {
      const skuKey = r.sku.toLowerCase();
      const master = masterBySku.get(skuKey);
      const bKey = r.branchName.trim().toLowerCase();
      const yr = r.saleYear ?? new Date().getFullYear();
      const mo = r.saleMonth ?? new Date().getMonth() + 1;

      const baseKey = `${bKey}::${skuKey}`;
      const periodKey = `${baseKey}::${yr}::${mo}`;

      // If catalog tab already inserted this (branch, sku), enrich it if same month or first sales entry
      const existingBase = merged.get(baseKey);
      if (isSalesOnly && existingBase) {
        if (!existingBase.qtySold || (existingBase.saleYear === yr && existingBase.saleMonth === mo)) {
          merged.set(baseKey, {
            ...existingBase,
            price: existingBase.price > 0 ? existingBase.price : r.price || master?.price || 0,
            qtySold: (existingBase.qtySold ?? 0) + (r.qtySold ?? 0) || undefined,
            totalSales:
              (existingBase.totalSales ?? 0) + (r.totalSales ?? 0) || undefined,
            saleYear: yr,
            saleMonth: mo,
          });
          continue;
        }
        // Different month for the same branch+sku -> store separate period row preserving stock
        const existingPeriod = merged.get(periodKey);
        if (existingPeriod) {
          merged.set(periodKey, {
            ...existingPeriod,
            qtySold: (existingPeriod.qtySold ?? 0) + (r.qtySold ?? 0) || undefined,
            totalSales:
              (existingPeriod.totalSales ?? 0) + (r.totalSales ?? 0) || undefined,
          });
        } else {
          merged.set(periodKey, {
            ...r,
            name: master?.name || r.name,
            barcode: master?.barcode || r.barcode,
            category: master?.category || r.category,
            price: r.price > 0 ? r.price : master?.price || 0,
            initialStock: existingBase.initialStock,
            currentStock: existingBase.currentStock,
          });
        }
        continue;
      }

      const key = isSalesOnly ? periodKey : baseKey;
      const prev = merged.get(key);
      if (prev) {
        merged.set(key, {
          ...prev,
          name: prev.name || r.name,
          category:
            prev.category !== 'Umum' ? prev.category : r.category,
          price: prev.price > 0 ? prev.price : r.price,
          initialStock:
            r.initialStock > 0 ? r.initialStock : prev.initialStock,
          currentStock:
            tab.kind === 'catalog' ? r.currentStock : prev.currentStock,
          qtySold: (prev.qtySold ?? 0) + (r.qtySold ?? 0) || undefined,
          totalSales:
            (prev.totalSales ?? 0) + (r.totalSales ?? 0) || undefined,
        });
      } else {
        merged.set(key, {
          ...r,
          name: master?.name || r.name,
          barcode: master?.barcode || r.barcode,
          category:
            r.category !== 'Umum' ? r.category : master?.category || 'Umum',
          price: r.price > 0 ? r.price : master?.price || 0,
        });
      }
    }
  }

  return Array.from(merged.values());
}

function parseWorkbook(
  workbook: XLSX.WorkBook,
  defaultBranchName: string,
  defaultMonth: number,
  defaultYear: number,
  fetchedFormat: 'xlsx' | 'csv',
  xlsxDownloadUrl?: string
): ParsedWorkbookResult {
  const tabs: ParsedSheetTab[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: true,
    });
    const parsedTab = parseSpreadsheetMatrix(
      matrix,
      defaultBranchName,
      defaultMonth,
      defaultYear,
      sheetName
    );
    if (parsedTab.rows.length > 0) {
      tabs.push(parsedTab);
    }
  }

  const nonDashboardTabs = tabs.filter((t) => t.kind !== 'dashboard');
  let selectedNames: string[];
  let isDashboardSummaryOnly = false;

  if (nonDashboardTabs.length > 0) {
    // Auto-select all real data tabs (Master Produk, Stok, Transaksi), skip Dashboard summary tab!
    tabs.forEach((t) => {
      t.selectedByDefault = t.kind !== 'dashboard';
    });
    selectedNames = nonDashboardTabs.map((t) => t.sheetName);
  } else if (tabs.length > 0) {
    tabs.forEach((t) => {
      t.selectedByDefault = true;
    });
    selectedNames = tabs.map((t) => t.sheetName);
    isDashboardSummaryOnly = tabs.every((t) => t.kind === 'dashboard');
  } else {
    selectedNames = [];
  }

  const mergedRows = mergeSelectedTabs(tabs, selectedNames);
  const primaryTab =
    nonDashboardTabs[0] ?? tabs[0] ?? null;

  const warnings: string[] = [];
  if (isDashboardSummaryOnly) {
    warnings.push(
      `Hanya tab Dasbor Ringkasan yang terbaca (${mergedRows.length} produk unggulan). Daftar produk lengkap biasanya berada di tab lain di spreadsheet Anda.`
    );
  }

  return {
    tabs,
    rows: mergedRows,
    detectedBranch: primaryTab?.detectedBranch ?? defaultBranchName,
    detectedMonth: primaryTab?.detectedMonth ?? defaultMonth,
    isDashboardSummaryOnly,
    fetchedFormat,
    xlsxDownloadUrl,
    warnings,
  };
}

export async function parseSpreadsheetFile(
  file: File,
  defaultBranchName: string,
  defaultMonth: number,
  defaultYear: number
): Promise<ParsedWorkbookResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const isCsv = file.name.toLowerCase().endsWith('.csv');
  return parseWorkbook(
    workbook,
    defaultBranchName,
    defaultMonth,
    defaultYear,
    isCsv ? 'csv' : 'xlsx'
  );
}

export function extractGoogleSheetInfo(rawUrl: string): {
  sheetId: string | null;
  gid: string | null;
  isExplicitCsv: boolean;
} {
  const trimmed = rawUrl.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const gidMatch = trimmed.match(/[?#&]gid=(\d+)/);
  const isExplicitCsv =
    trimmed.includes('output=csv') ||
    trimmed.includes('format=csv') ||
    trimmed.includes('out:csv');
  return {
    sheetId: match ? match[1] : null,
    gid: gidMatch ? gidMatch[1] : null,
    isExplicitCsv,
  };
}

function isLikelyHtmlResponse(text: string): boolean {
  const head = text.slice(0, 400).trim().toLowerCase();
  return (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.includes('accounts.google.com')
  );
}

export async function fetchAndParseSheetUrl(
  rawUrl: string,
  defaultBranchName: string,
  defaultMonth: number,
  defaultYear: number,
  optionalSheetName?: string
): Promise<ParsedWorkbookResult> {
  const trimmed = rawUrl.trim();
  const { sheetId, gid, isExplicitCsv } = extractGoogleSheetInfo(trimmed);
  const xlsxDownloadUrl = sheetId
    ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`
    : undefined;
  const cleanTabName = optionalSheetName?.trim() || '';

  // Case 1: User specified an exact tab/sheet name -> use CORS-friendly Google Visualization API
  if (sheetId && cleanTabName) {
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(cleanTabName)}`;
    const res = await fetch(gvizUrl);
    if (!res.ok) {
      throw new Error(
        `Tab "${cleanTabName}" gagal diambil (HTTP ${res.status}). Periksa kembali ejaan nama tab di Google Sheet Anda.`
      );
    }
    const text = await res.text();
    if (isLikelyHtmlResponse(text)) {
      throw new Error(
        'Google Sheet masih bersifat privat. Ubah akses berbagi ke "Siapa saja yang memiliki link (Pelihat)", atau unduh sebagai Excel (.xlsx) lalu unggah di sebelah kiri.'
      );
    }
    const workbook = XLSX.read(text, { type: 'string' });
    const firstKey = workbook.SheetNames[0];
    if (firstKey && firstKey !== cleanTabName) {
      workbook.Sheets[cleanTabName] = workbook.Sheets[firstKey];
      delete workbook.Sheets[firstKey];
      workbook.SheetNames[0] = cleanTabName;
    }
    return parseWorkbook(
      workbook,
      defaultBranchName,
      defaultMonth,
      defaultYear,
      'csv',
      xlsxDownloadUrl
    );
  }

  // Case 2: Standard Google Sheet URL (not explicit CSV) -> Try full multi-tab XLSX first!
  if (sheetId && !isExplicitCsv && xlsxDownloadUrl) {
    try {
      const xlsxRes = await fetch(xlsxDownloadUrl);
      const ct = (xlsxRes.headers.get('content-type') || '').toLowerCase();
      if (xlsxRes.ok && !ct.includes('text/html')) {
        const buffer = await xlsxRes.arrayBuffer();
        // Verify ZIP header (PK\x03\x04) so we don't parse an HTML login page as XLSX
        const bytes = new Uint8Array(buffer.slice(0, 4));
        if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
          const workbook = XLSX.read(buffer, { type: 'array' });
          if (workbook.SheetNames.length > 0) {
            return parseWorkbook(
              workbook,
              defaultBranchName,
              defaultMonth,
              defaultYear,
              'xlsx',
              xlsxDownloadUrl
            );
          }
        }
      }
    } catch {
      // Browser CORS blocked direct .xlsx redirect -> fall back to CORS-friendly gviz CSV below
    }
  }

  // Case 3: Fallback to CORS-friendly gviz CSV (respects gid if present) or direct CSV URL
  const candidateUrls: string[] = [];
  if (sheetId && !isExplicitCsv) {
    const gidParam = gid ? `&gid=${gid}` : '';
    candidateUrls.push(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${gidParam}`
    );
    candidateUrls.push(
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`
    );
  } else {
    candidateUrls.push(trimmed);
  }

  let lastError =
    'Gagal mengambil Google Sheet. Pastikan akses sheet diatur ke "Siapa saja yang memiliki link" atau unduh sebagai Excel (.xlsx) lalu unggah di sebelah kiri.';

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastError = `Gagal mengambil Google Sheet (HTTP ${res.status}). Pastikan akses sheet publik atau unduh sebagai file Excel (.xlsx).`;
        continue;
      }
      const text = await res.text();
      if (isLikelyHtmlResponse(text)) {
        lastError =
          'Google Sheet meminta login (masih privat). Ubah akses berbagi menjadi "Siapa saja yang memiliki link (Pelihat)", atau klik File → Download → Microsoft Excel (.xlsx) di Google Sheet lalu unggah di sebelah kiri.';
        continue;
      }
      const workbook = XLSX.read(text, { type: 'string' });
      const result = parseWorkbook(
        workbook,
        defaultBranchName,
        defaultMonth,
        defaultYear,
        'csv',
        xlsxDownloadUrl
      );
      if (sheetId && result.tabs.length <= 1) {
        result.warnings.push(
          'Browser hanya bisa mengambil 1 tab via CSV dari link Google Sheet (pembatasan CORS Google). Untuk mengimpor SEMUA tab & ratusan produk sekaligus, klik tombol "Unduh Semua Tab (.xlsx)" di bawah lalu unggah file .xlsx tersebut, atau ketik Nama Tab daftar produk lengkap Anda.'
        );
      }
      return result;
    } catch (err) {
      if (err instanceof Error && err.message) {
        lastError = `${err.message} — Coba unduh Google Sheet sebagai Excel (.xlsx) lalu unggah di sebelah kiri.`;
      }
    }
  }

  throw new Error(lastError);
}
