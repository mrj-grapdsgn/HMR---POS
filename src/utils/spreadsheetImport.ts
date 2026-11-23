import * as XLSX from 'xlsx';
import { DiscountMode, ImportedCatalogRow } from '../types/pos';
import {
  inferCategoryFromProductName,
  isExplicitValidCategory,
  normalizeBranchKey,
  normalizeBranchName,
} from './productCategory';

export type SheetTabKind = 'catalog' | 'sales' | 'dashboard' | 'unknown';

export interface DetectedColumnMap {
  txId?: string;
  sku?: string;
  name?: string;
  category?: string;
  branch?: string;
  price?: string;
  initialStock?: string;
  currentStock?: string;
  qtySold?: string;
  discountType?: string;
  voucher?: string;
  discount?: string;
  totalSales?: string;
  netPay?: string;
  date?: string;
}

export interface ParsedSheetTab {
  sheetName: string;
  kind: SheetTabKind;
  rows: ImportedCatalogRow[];
  rawRowCount: number;
  uniqueTxCount: number;
  detectedBranch: string;
  detectedMonth: number;
  detectedColumns: DetectedColumnMap;
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

function parsePercentNumber(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel native percentage cell (e.g. 0.2 for 20%)
    if (raw > 0 && raw < 1) return Math.min(100, raw * 100);
    return Math.min(100, Math.max(0, raw));
  }
  const s = String(raw ?? '')
    .trim()
    .replace(/%/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.');
  if (!s) return 0;
  const n = parseFloat(s.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

function resolveLineDiscount(params: {
  grossTotal: number;
  rawTypeCell: unknown;
  rawAmountCell: unknown;
  rawValueCell: unknown;
  hasSeparateValueCol: boolean;
}): {
  discountAmount: number;
  discountType: DiscountMode;
  discountLabel?: string;
} {
  const {
    grossTotal,
    rawTypeCell,
    rawAmountCell,
    rawValueCell,
    hasSeparateValueCol,
  } = params;
  if (grossTotal <= 0) {
    return { discountAmount: 0, discountType: 'none' };
  }

  const rawTypeStr = String(rawTypeCell ?? '').trim().toLowerCase();
  const isNoneType =
    rawTypeStr === 'tidak_ada' ||
    rawTypeStr === 'tidak ada' ||
    rawTypeStr === 'none' ||
    rawTypeStr === '-' ||
    rawTypeStr === '0' ||
    rawTypeStr === 'tanpa diskon';
  const isPercentType =
    rawTypeStr.includes('persen') ||
    rawTypeStr.includes('percent') ||
    rawTypeStr === '%';
  const isVoucherType =
    rawTypeStr.includes('voucher') || rawTypeStr.includes('kupon');

  let discountRp = 0;
  let discountType: DiscountMode = 'none';
  let discountLabel: string | undefined;

  const amtStr = String(rawAmountCell ?? '').trim();
  const valStr = String(rawValueCell ?? '').trim();

  const parseDiscountMagnitude = (cell: unknown): number => {
    if (typeof cell === 'number' && Number.isFinite(cell)) {
      return Math.abs(Math.round(cell));
    }
    return parseRupiahOrNumber(String(cell ?? '').replace(/[-−]/g, ''));
  };

  // 1. Primary Rupiah discount column (e.g., Total Diskon / Jumlah Diskon / Potongan)
  // NOTE: Never skip a positive Rupiah value just because Tipe Diskon is '-' / 'tidak_ada' / 'none'
  // (manual/exact price adjustments in legacy POS exports often leave Tipe Diskon as '-' while recording real Potongan TRX).
  if (amtStr !== '') {
    if (amtStr.includes('%')) {
      const pct = parsePercentNumber(amtStr.replace(/[-−]/g, ''));
      if (pct > 0) {
        discountRp = Math.round((grossTotal * pct) / 100);
        discountType = 'percent';
        discountLabel = `Diskon ${pct}%`;
      }
    } else {
      const amtNum = parseDiscountMagnitude(rawAmountCell);
      const looksLikePercentOnly =
        isPercentType &&
        !isNoneType &&
        !hasSeparateValueCol &&
        !amtStr.toLowerCase().includes('rp') &&
        ((typeof rawAmountCell === 'number' &&
          Math.abs(rawAmountCell) > 0 &&
          Math.abs(rawAmountCell) <= 100) ||
          (amtNum > 0 && amtNum <= 100));

      if (looksLikePercentOnly) {
        const pct = parsePercentNumber(
          typeof rawAmountCell === 'number'
            ? Math.abs(rawAmountCell)
            : amtStr.replace(/[-−]/g, '')
        );
        discountRp = Math.round((grossTotal * pct) / 100);
        discountType = 'percent';
        discountLabel = `Diskon ${pct}%`;
      } else if (amtNum > 0) {
        discountRp = amtNum;
        discountType =
          isPercentType && !isNoneType
            ? 'percent'
            : isVoucherType
              ? 'voucher'
              : 'fixed';
        discountLabel =
          isPercentType && !isNoneType
            ? 'Diskon Persen'
            : isVoucherType
              ? 'Voucher Diskon'
              : isNoneType
                ? 'Potongan TRX'
                : 'Diskon Nominal';
      }
    }
  }

  // 2. Fallback to Value/Percent column (e.g., Nilai Diskon / Diskon %) when no Rupiah amount was present
  if (discountRp === 0 && valStr !== '') {
    const valRupiah = parseDiscountMagnitude(rawValueCell);
    const hasCurrencyPrefix = valStr.toLowerCase().includes('rp');
    const isPercentValue =
      valStr.includes('%') ||
      (isPercentType &&
        !isNoneType &&
        !hasCurrencyPrefix &&
        ((typeof rawValueCell === 'number' &&
          Math.abs(rawValueCell) > 0 &&
          Math.abs(rawValueCell) <= 100) ||
          (valRupiah > 0 && valRupiah <= 100)));

    if (isPercentValue) {
      const pct = parsePercentNumber(
        typeof rawValueCell === 'number'
          ? Math.abs(rawValueCell)
          : valStr.replace(/[-−]/g, '')
      );
      if (pct > 0) {
        discountRp = Math.round((grossTotal * pct) / 100);
        discountType = 'percent';
        discountLabel = `Diskon ${pct}%`;
      }
    } else if (valRupiah > 0) {
      discountRp = valRupiah;
      discountType = isVoucherType ? 'voucher' : 'fixed';
      discountLabel = isVoucherType
        ? 'Voucher Diskon'
        : isNoneType
          ? 'Potongan TRX'
          : 'Diskon Nominal';
    }
  }

  const clamped = Math.min(grossTotal, Math.max(0, Math.round(discountRp)));
  return {
    discountAmount: clamped,
    discountType: clamped > 0 ? discountType : 'none',
    discountLabel: clamped > 0 ? discountLabel : undefined,
  };
}

function parseVoucherCode(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  const lower = s.toLowerCase();
  if (
    lower === '-' ||
    lower === '—' ||
    lower === '–' ||
    lower === '0' ||
    lower === 'none' ||
    lower === 'null' ||
    lower === 'n/a' ||
    lower === 'tidak ada' ||
    lower === 'tidak_ada'
  ) {
    return undefined;
  }
  return s.slice(0, 40);
}

interface TxDiscountObservation {
  rawTypeCell: unknown;
  rawAmountCell: unknown;
  rawValueCell: unknown;
}

interface TxDiscountMeta {
  observations: TxDiscountObservation[];
  netPayAmounts: number[];
  voucherCode?: string;
}

/**
 * Resolves a single transaction-level discount ONCE per ID Transaksi.
 * In legacy Google Sheets (Data_Penjualan), `Total Diskon` (e.g. Rp38.000) is repeated
 * verbatim on every item row of the same transaction. Taking the highest resolved amount
 * across observations ensures the discount is applied exactly 1x per transaction.
 * If an explicit `Total Bayar (Net)` / `Total Akhir` column is present and `Total Diskon` is 0/absent,
 * reconciles the transaction discount from `txSubtotal - txNetPay`.
 */
function resolveTransactionDiscount(params: {
  txSubtotal: number;
  observations: TxDiscountObservation[];
  netPayAmounts?: number[];
  voucherCode?: string;
  hasSeparateValueCol: boolean;
}): {
  discountAmount: number;
  discountType: DiscountMode;
  discountLabel?: string;
} {
  const {
    txSubtotal,
    observations,
    netPayAmounts = [],
    voucherCode,
    hasSeparateValueCol,
  } = params;
  if (txSubtotal <= 0) {
    return {
      discountAmount: 0,
      discountType: 'none',
      discountLabel: voucherCode ? `Voucher ${voucherCode}` : undefined,
    };
  }

  let bestAmount = 0;
  let bestType: DiscountMode = 'none';
  let bestLabel: string | undefined;

  for (const obs of observations) {
    const res = resolveLineDiscount({
      grossTotal: txSubtotal,
      rawTypeCell: obs.rawTypeCell,
      rawAmountCell: obs.rawAmountCell,
      rawValueCell: obs.rawValueCell,
      hasSeparateValueCol,
    });
    if (res.discountAmount > bestAmount) {
      bestAmount = res.discountAmount;
      bestType = res.discountType;
      bestLabel = res.discountLabel;
    }
  }

  // Reconcile from explicit Total Bayar (Net) / Total Akhir column when Total Diskon is absent/0
  if (bestAmount === 0 && netPayAmounts.length > 0) {
    const positiveNets = netPayAmounts.filter((n) => n > 0);
    if (positiveNets.length > 0) {
      const uniqueNets = new Set(positiveNets);
      let resolvedNetPay = 0;
      if (positiveNets.length === 1 || uniqueNets.size === 1) {
        // TRX-level Total Bayar (Net) shown on row 1 only (e.g. old web Excel export) or repeated on every row
        resolvedNetPay = positiveNets[0];
      } else {
        const sumNets = positiveNets.reduce((a, b) => a + b, 0);
        const maxNet = Math.max(...positiveNets);
        resolvedNetPay = sumNets <= txSubtotal ? sumNets : maxNet;
      }
      if (resolvedNetPay > 0 && resolvedNetPay < txSubtotal) {
        bestAmount = txSubtotal - resolvedNetPay;
        bestType = voucherCode ? 'voucher' : 'fixed';
        bestLabel = voucherCode ? 'Voucher Diskon' : 'Potongan TRX';
      }
    }
  }

  const clamped = Math.min(txSubtotal, Math.max(0, Math.round(bestAmount)));
  let finalType: DiscountMode = clamped > 0 ? bestType : 'none';
  let finalLabel = clamped > 0 ? bestLabel : undefined;

  if (voucherCode) {
    if (clamped > 0 && finalType === 'none') {
      finalType = 'voucher';
    }
    finalLabel = finalLabel
      ? `Voucher ${voucherCode} (${finalLabel})`
      : `Voucher ${voucherCode}`;
  }

  return {
    discountAmount: clamped,
    discountType: finalType,
    discountLabel: finalLabel,
  };
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

type DateOrder = 'dmy' | 'mdy';

export function parseTimestampMsFromTxCode(rawTxId: string): number | null {
  const s = String(rawTxId ?? '').trim();
  if (!s) return null;
  const m = s.match(/(?:^|[^0-9])(1[5-9]\d{11}|2\d{12})(?:[^0-9]|$)/);
  if (!m) return null;
  const ms = Number(m[1]);
  // Valid Unix millisecond timestamp between 2020-01-01 and 2100-01-01
  if (!Number.isFinite(ms) || ms < 1577836800000 || ms > 4102444800000) {
    return null;
  }
  return ms;
}

function parseEpochFromTxCode(
  rawTxId: string
): { year: number; month: number; day: number } | null {
  const ms = parseTimestampMsFromTxCode(rawTxId);
  if (ms === null) return null;
  // Shift to WIB (UTC+7) so morning Indonesian retail timestamps match local calendar date
  const wib = new Date(ms + 7 * 60 * 60 * 1000);
  return {
    year: wib.getUTCFullYear(),
    month: wib.getUTCMonth() + 1,
    day: wib.getUTCDate(),
  };
}

function detectColumnDateOrder(
  matrix: unknown[][],
  startRow: number,
  idxDate: number,
  idxTxId: number
): DateOrder {
  if (idxDate < 0) return 'dmy';
  let dmyScore = 0;
  let mdyScore = 0;

  for (let r = startRow; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const raw = row[idxDate];
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    const match = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (!match) continue;

    const p1 = parseInt(match[1], 10);
    const p2 = parseInt(match[2], 10);
    let y = parseInt(match[3], 10);
    if (y < 100) y += 2000;
    if (y < 2000 || y > 2100) continue;

    if (p1 > 12 && p2 >= 1 && p2 <= 12) {
      dmyScore += 10;
    } else if (p2 > 12 && p1 >= 1 && p1 <= 12) {
      mdyScore += 10;
    } else if (p1 >= 1 && p1 <= 12 && p2 >= 1 && p2 <= 12 && p1 !== p2 && idxTxId >= 0) {
      const epoch = parseEpochFromTxCode(cellToSkuString(row[idxTxId]));
      if (epoch && epoch.year === y) {
        if (epoch.month === p2 && epoch.day === p1) {
          dmyScore += 5;
        } else if (epoch.month === p1 && epoch.day === p2) {
          mdyScore += 5;
        } else if (epoch.month === p2) {
          dmyScore += 2;
        } else if (epoch.month === p1) {
          mdyScore += 2;
        }
      }
    }
  }

  return mdyScore > dmyScore ? 'mdy' : 'dmy';
}

function parseDateToYearMonth(
  raw: unknown,
  fallbackYear: number,
  fallbackMonth: number,
  dateOrder: DateOrder = 'dmy',
  rawTxId = ''
): { year: number; month: number } {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { year: raw.getFullYear(), month: raw.getMonth() + 1 };
  }
  // Excel serial date from binary .xlsx (between year 2000 = 36526 and year 2099 = 73050)
  if (typeof raw === 'number' && raw >= 36500 && raw <= 75000) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y >= 2000 && parsed.m >= 1 && parsed.m <= 12) {
      return { year: parsed.y, month: parsed.m };
    }
  }
  const s = String(raw ?? '').trim();
  if (!s) {
    const epochFallback = parseEpochFromTxCode(rawTxId);
    return epochFallback
      ? { year: epochFallback.year, month: epochFallback.month }
      : { year: fallbackYear, month: fallbackMonth };
  }

  // ISO: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
      return { year: y, month: m };
    }
  }

  // Numeric slash/dash date: DD/MM/YYYY or M/D/YYYY
  // Cross-checks ambiguous dates (both parts <= 12) against TRX-<epoch> first to survive mixed-locale rows
  const slashMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    let y = parseInt(slashMatch[3], 10);
    if (y < 100) y += 2000;
    let m: number;
    if (p1 > 12 && p2 >= 1 && p2 <= 12) {
      m = p2;
    } else if (p2 > 12 && p1 >= 1 && p1 <= 12) {
      m = p1;
    } else if (p1 >= 1 && p1 <= 12 && p2 >= 1 && p2 <= 12) {
      const epoch = p1 !== p2 ? parseEpochFromTxCode(rawTxId) : null;
      if (epoch && epoch.year === y) {
        if (epoch.month === p2 && epoch.day === p1) {
          m = p2;
        } else if (epoch.month === p1 && epoch.day === p2) {
          m = p1;
        } else if (epoch.month === p2) {
          m = p2;
        } else if (epoch.month === p1) {
          m = p1;
        } else {
          m = dateOrder === 'mdy' ? p1 : p2;
        }
      } else {
        m = dateOrder === 'mdy' ? p1 : p2;
      }
    } else {
      m = fallbackMonth;
    }
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
      return { year: y, month: m };
    }
  }

  // Short date without year (e.g. "27/09 10:23" from legacy web app Riwayat Transaksi Excel export)
  const shortSlashMatch = s.match(/^(\d{1,2})[-/](\d{1,2})(?:\s+\d{1,2}:\d{2})?/);
  if (shortSlashMatch) {
    const epoch = parseEpochFromTxCode(rawTxId);
    if (epoch) {
      return { year: epoch.year, month: epoch.month };
    }
    const p1 = parseInt(shortSlashMatch[1], 10);
    const p2 = parseInt(shortSlashMatch[2], 10);
    const m =
      p1 > 12 && p2 >= 1 && p2 <= 12
        ? p2
        : p2 > 12 && p1 >= 1 && p1 <= 12
          ? p1
          : dateOrder === 'mdy'
            ? p1
            : p2;
    if (m >= 1 && m <= 12) {
      return { year: fallbackYear, month: m };
    }
  }

  // Text date containing month name (e.g., "15 Juli 2026" or "Jul 2026")
  const lower = s.toLowerCase();
  let matchedTextMonth = false;
  let detectedM = fallbackMonth;
  for (const [key, val] of Object.entries(MONTH_NAME_MAP)) {
    if (lower.includes(key)) {
      detectedM = val;
      matchedTextMonth = true;
      break;
    }
  }
  const yearMatch = s.match(/\b(20\d{2})\b/);
  if (matchedTextMonth || yearMatch) {
    const detectedY = yearMatch ? parseInt(yearMatch[1], 10) : fallbackYear;
    return { year: detectedY, month: detectedM };
  }

  const epochFallback = parseEpochFromTxCode(rawTxId);
  if (epochFallback) {
    return { year: epochFallback.year, month: epochFallback.month };
  }
  return { year: fallbackYear, month: fallbackMonth };
}

function normalizeHeader(cell: unknown): string {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_.\-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    strippedLower.includes('monitoring') ||
    strippedLower.includes('stok') ||
    strippedLower.includes('stock') ||
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
  let detectedBranch = normalizeBranchName(tabBranchHint || defaultBranchName);
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
            detectedBranch = normalizeBranchName(val, detectedBranch);
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
        ['nama cabang', 'nama kasir', 'nama pembeli', 'nama customer', 'nama pelanggan', 'nama toko', 'nama partner', 'partner', 'nama outlet', 'nama event']
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
      uniqueTxCount: 0,
      detectedBranch,
      detectedMonth,
      detectedColumns: {},
      selectedByDefault: false,
    };
  }

  const rawHeaders = (matrix[headerRowIdx] ?? []).map((c) =>
    String(c ?? '').trim()
  );
  const headers = rawHeaders.map(normalizeHeader);

  const idxTxId = findColIndex(
    headers,
    [
      'id transaksi',
      'kode transaksi',
      'no transaksi',
      'nomor transaksi',
      'no invoice',
      'nomor invoice',
      'kode invoice',
      'invoice',
      'no struk',
      'kode struk',
      'id struk',
      'no nota',
      'kode nota',
      'id nota',
      'nota',
      'struk',
      'trx id',
      'no trx',
      'id trx',
      'kode trx',
      'trx',
      'transaction id',
      'order id',
      'id order',
      'no order',
      'kode order',
      'receipt',
      'no faktur',
      'faktur',
      'no ref',
      'referensi',
      'id penjualan',
      'kode penjualan',
      'transaksi',
      'id',
    ],
    [
      'tanggal',
      'tgl',
      'date',
      'waktu',
      'status',
      'metode',
      'tipe',
      'type',
      'jenis',
      'produk',
      'barang',
      'item',
      'cabang',
      'kasir',
      'sku',
      'total',
      'nilai',
      'jumlah',
      'diskon',
      'discount',
      'bayar',
    ]
  );

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
    [
      'kode cabang',
      'kode transaksi',
      'kode invoice',
      'no invoice',
      'no transaksi',
      'id transaksi',
      'kode voucher',
      'kode promo',
      'kode kasir',
      'kode order',
      'kode penjualan',
      'barcode',
    ]
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
    [
      'nama cabang',
      'nama kasir',
      'nama pembeli',
      'nama customer',
      'nama pelanggan',
      'nama toko',
      'nama partner',
      'partner',
      'nama outlet',
      'nama reseller',
      'nama agen',
      'nama salesman',
      'nama staff',
      'nama pegawai',
      'nama karyawan',
      'nama gudang',
      'nama event',
      'kode item',
      'id item',
    ]
  );
  // CRITICAL: Never match "Tipe Diskon" / "Jenis Diskon" / "Tipe Pembayaran" as product category!
  const idxCategory = findColIndex(
    headers,
    [
      'kategori produk',
      'kategori barang',
      'kategori',
      'category',
      'sub kategori',
      'divisi',
      'grup',
      'group',
      'jenis produk',
      'jenis barang',
    ],
    [
      'diskon',
      'discount',
      'potongan',
      'pembayaran',
      'payment',
      'transaksi',
      'metode',
      'bayar',
      'harga',
      'stok',
      'cabang',
      'outlet',
      'status',
      'promo',
      'voucher',
      'tipe',
      'type',
    ]
  );
  const idxPrice = findColIndex(
    headers,
    [
      'harga jual',
      'harga satuan',
      'unit price',
      'harga retail',
      'harga',
      'price',
      'het',
      'hj',
      'tarif',
    ],
    ['total harga', 'harga total', 'harga beli', 'harga modal', 'hpp', 'diskon', 'discount']
  );
  const idxInitialStock = findColIndex(headers, [
    'stok awal',
    'initial stock',
    'stock awal',
    'saldo awal',
    'qty awal',
    'stok masuk',
    'awal',
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
    [
      'stok awal',
      'stock awal',
      'status',
      'restok',
      '%',
      'terjual',
      'keluar',
      'masuk',
      'total',
      'harga',
      'bayar',
      'penjualan',
      'omset',
      'net',
      'bersih',
      'voucher',
      'diskon',
      'discount',
    ]
  );
  // CRITICAL: Exclude discount/payment columns (e.g. "Jumlah Diskon", "Nilai Diskon", "Diskon (%)") from Qty!
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
      'jumlah barang',
      'jumlah item',
      'jumlah produk',
      'jumlah',
      'sold',
      'pcs',
      'stok keluar',
      'barang keluar',
      'qty keluar',
      'keluar',
    ],
    [
      'qty awal',
      'qty akhir',
      'qty stok',
      '%',
      'persen',
      'total qty',
      'jumlah stok',
      'diskon',
      'discount',
      'potongan',
      'bayar',
      'harga',
      'uang',
      'kembali',
      'kembalian',
      'voucher',
    ]
  );
  const primaryIdxTotalSales = findColIndex(
    headers,
    [
      'total penjualan',
      'subtotal item',
      'sub total item',
      'subtotal',
      'sub total',
      'total omset',
      'nilai penjualan',
      'total harga',
      'harga total',
    ],
    [
      'total stok',
      'total qty',
      'total terjual',
      'terjual',
      'qty',
      'kuantitas',
      'pcs',
      'unit',
      'keluar',
      'masuk',
      'diskon',
      'discount',
      'potongan',
      'kembalian',
      'kembali',
    ]
  );
  const rawIdxTotalSales =
    primaryIdxTotalSales >= 0
      ? primaryIdxTotalSales
      : findColIndex(
          headers,
          [
            'omset',
            'pendapatan',
            'penjualan',
            'revenue',
            'sales',
            'grand total',
            'total bayar',
            'total bersih',
            'total',
            'nominal',
            'nilai',
            'amount',
          ],
          [
            'total stok',
            'total qty',
            'total terjual',
            'terjual',
            'qty',
            'kuantitas',
            'pcs',
            'unit',
            'keluar',
            'masuk',
            'total item',
            'total produk',
            'diskon',
            'discount',
            'potongan',
            'kembalian',
            'kembali',
          ]
        );
  // CRITICAL: Never let Total Sales collide with Qty Sold (e.g. "Total Terjual") which creates fake Rp 1 prices!
  const idxTotalSales =
    rawIdxTotalSales === idxQtySold ? -1 : rawIdxTotalSales;

  // Optional explicit Net Payment column (e.g., "TOTAL BAYAR (NET)", "Total Akhir", "Grand Total", "Total Net")
  // strictly distinct from idxTotalSales so gross subtotal & net pay never collide.
  const rawIdxNetPay = findColIndex(
    headers,
    [
      'total bayar (net)',
      'total bayar net',
      'total bayar',
      'bayar net',
      'total akhir',
      'grand total',
      'total net',
      'net total',
      'total bersih',
      'net bayar',
      'omset bersih',
    ],
    [
      'total stok',
      'stok',
      'stock',
      'qty',
      'terjual',
      'diskon',
      'discount',
      'potongan',
      'kembalian',
      'kembali',
      'subtotal',
    ]
  );
  const idxNetPay =
    rawIdxNetPay === idxTotalSales ||
    rawIdxNetPay === idxQtySold ||
    rawIdxNetPay === idxPrice ||
    rawIdxNetPay === idxCurrentStock ||
    rawIdxNetPay === idxInitialStock
      ? -1
      : rawIdxNetPay;

  // Discount columns in Data_Penjualan (e.g. Tipe Diskon, Jumlah Diskon, Nilai Diskon, Diskon, Potongan)
  const idxDiscountType = findColIndex(
    headers,
    [
      'tipe diskon',
      'jenis diskon',
      'mode diskon',
      'type diskon',
      'discount type',
      'discount mode',
    ],
    ['jumlah', 'nominal', 'nilai', 'total', 'harga', 'rp']
  );
  const rawIdxDiscountAmount = findColIndex(
    headers,
    [
      'jumlah diskon',
      'nominal diskon',
      'total diskon',
      'potongan diskon',
      'potongan harga',
      'nilai potongan',
      'diskon rp',
      'diskon rupiah',
      'discount amount',
      'total discount',
      'potongan',
      'diskon',
      'discount',
    ],
    [
      'tipe',
      'jenis',
      'mode',
      'type',
      'kode',
      'code',
      'nama',
      'keterangan',
      'catatan',
      '%',
      'persen',
      'percent',
      'nilai diskon',
    ]
  );
  const idxDiscountAmount =
    rawIdxDiscountAmount === idxTotalSales ||
    rawIdxDiscountAmount === idxNetPay ||
    rawIdxDiscountAmount === idxQtySold ||
    rawIdxDiscountAmount === idxDiscountType
      ? -1
      : rawIdxDiscountAmount;

  const rawIdxDiscountValue = findColIndex(
    headers,
    [
      'nilai diskon',
      'besaran diskon',
      'diskon persen',
      'diskon %',
      'diskon (%)',
      'persen diskon',
      'discount value',
      'discount percent',
      'discount %',
    ],
    ['tipe', 'jenis', 'mode', 'type', 'kode', 'code', 'nama']
  );
  const idxDiscountValue =
    rawIdxDiscountValue === idxDiscountAmount ||
    rawIdxDiscountValue === idxTotalSales ||
    rawIdxDiscountValue === idxNetPay ||
    rawIdxDiscountValue === idxQtySold ||
    rawIdxDiscountValue === idxDiscountType
      ? -1
      : rawIdxDiscountValue;

  const rawIdxVoucher = findColIndex(
    headers,
    ['kode voucher', 'voucher', 'kupon', 'kode kupon', 'kode promo', 'promo'],
    ['total', 'jumlah', 'nilai', 'nominal', 'diskon', 'discount', 'qty', 'stok']
  );
  const idxVoucher =
    rawIdxVoucher === idxTotalSales ||
    rawIdxVoucher === idxNetPay ||
    rawIdxVoucher === idxQtySold ||
    rawIdxVoucher === idxDiscountAmount ||
    rawIdxVoucher === idxDiscountValue ||
    rawIdxVoucher === idxDiscountType ||
    rawIdxVoucher === idxSku ||
    rawIdxVoucher === idxTxId
      ? -1
      : rawIdxVoucher;

  const idxBranch = findColIndex(headers, [
    'cabang',
    'nama cabang',
    'branch',
    'nama partner',
    'partner',
    'nama outlet',
    'nama toko',
    'nama event',
    'toko',
    'outlet',
    'lokasi',
    'store',
    'event',
    'channel',
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

  const detectedDiscountHeaders = [
    idxDiscountAmount >= 0 ? rawHeaders[idxDiscountAmount] : undefined,
    idxDiscountValue >= 0 ? rawHeaders[idxDiscountValue] : undefined,
  ].filter((h): h is string => Boolean(h));

  const detectedColumns: DetectedColumnMap = {
    txId: idxTxId >= 0 ? rawHeaders[idxTxId] : undefined,
    sku: idxSku >= 0 ? rawHeaders[idxSku] : undefined,
    name: idxName >= 0 ? rawHeaders[idxName] : undefined,
    category: idxCategory >= 0 ? rawHeaders[idxCategory] : undefined,
    branch: idxBranch >= 0 ? rawHeaders[idxBranch] : undefined,
    price: idxPrice >= 0 ? rawHeaders[idxPrice] : undefined,
    initialStock: idxInitialStock >= 0 ? rawHeaders[idxInitialStock] : undefined,
    currentStock: idxCurrentStock >= 0 ? rawHeaders[idxCurrentStock] : undefined,
    qtySold: idxQtySold >= 0 ? rawHeaders[idxQtySold] : undefined,
    discountType: idxDiscountType >= 0 ? rawHeaders[idxDiscountType] : undefined,
    voucher: idxVoucher >= 0 ? rawHeaders[idxVoucher] : undefined,
    discount:
      detectedDiscountHeaders.length > 0
        ? detectedDiscountHeaders.join(' + ')
        : undefined,
    totalSales: idxTotalSales >= 0 ? rawHeaders[idxTotalSales] : undefined,
    netPay: idxNetPay >= 0 ? rawHeaders[idxNetPay] : undefined,
    date: idxDate >= 0 ? rawHeaders[idxDate] : undefined,
  };

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
  const txDiscountMetaMap = new Map<string, TxDiscountMeta>();
  const uniqueTxSet = new Set<string>();
  const columnDateOrder = detectColumnDateOrder(
    matrix,
    headerRowIdx + 1,
    idxDate,
    idxTxId
  );
  let rawRowCount = 0;

  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const rawName = idxName >= 0 ? String(row[idxName] ?? '').trim() : '';
    const rawSku = idxSku >= 0 ? cellToSkuString(row[idxSku]) : '';
    const rawBarcode = idxBarcode >= 0 ? cellToSkuString(row[idxBarcode]) : '';
    const rawTxId = idxTxId >= 0 ? cellToSkuString(row[idxTxId]) : '';

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
    const cleanSku =
      baseSku
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
    const rawCategory =
      idxCategory >= 0 ? String(row[idxCategory] ?? '').trim() : '';
    const category = inferCategoryFromProductName(cleanName, rawCategory);

    let qtySold =
      idxQtySold >= 0 ? parseRupiahOrNumber(row[idxQtySold]) : 0;
    const hasExplicitTotalSalesCell =
      idxTotalSales >= 0 && String(row[idxTotalSales] ?? '').trim() !== '';
    let grossSales = hasExplicitTotalSalesCell
      ? parseRupiahOrNumber(row[idxTotalSales])
      : 0;

    let price = idxPrice >= 0 ? parseRupiahOrNumber(row[idxPrice]) : 0;
    if (isSalesSheet && idxQtySold < 0 && (grossSales > 0 || price > 0)) {
      qtySold = 1;
    }
    // Preserve explicit Rp 0 promo/bonus lines when the sheet explicitly specifies Total Penjualan = 0
    if (!hasExplicitTotalSalesCell && grossSales === 0 && qtySold > 0 && price > 0) {
      grossSales = price * qtySold;
    }

    const rawDiscountTypeCell = idxDiscountType >= 0 ? row[idxDiscountType] : '';
    const rawDiscountAmountCell = idxDiscountAmount >= 0 ? row[idxDiscountAmount] : '';
    const rawDiscountValueCell = idxDiscountValue >= 0 ? row[idxDiscountValue] : '';
    const voucherCode =
      idxVoucher >= 0 ? parseVoucherCode(row[idxVoucher]) : undefined;

    // For sales sheets (Data_Penjualan), Total Diskon repeats on every row of the same ID Transaksi,
    // so we defer discount calculation to the 1x-per-TRX post-pass below.
    // For non-sales catalog/summary sheets without transactionCode, resolve line discount directly.
    const hasDiscountCols = idxDiscountAmount >= 0 || idxDiscountValue >= 0;
    const resolvedLineDiscount =
      !isSalesSheet && hasDiscountCols && qtySold > 0 && grossSales > 0
        ? resolveLineDiscount({
            grossTotal: grossSales,
            rawTypeCell: rawDiscountTypeCell,
            rawAmountCell: rawDiscountAmountCell,
            rawValueCell: rawDiscountValueCell,
            hasSeparateValueCol: idxDiscountValue >= 0,
          })
        : {
            discountAmount: 0,
            discountType: 'none' as DiscountMode,
            discountLabel: undefined,
          };

    const discountAmount = resolvedLineDiscount.discountAmount;
    const totalSales = Math.max(0, grossSales - discountAmount);

    if (price === 0 && qtySold > 0 && grossSales > 0) {
      price = Math.round(grossSales / qtySold);
    }

    const hasCurrentStockCol = idxCurrentStock >= 0;
    const hasInitialStockCol = idxInitialStock >= 0;
    const hasStockData = hasCurrentStockCol || hasInitialStockCol;
    const currentStock = hasCurrentStockCol
      ? parseRupiahOrNumber(row[idxCurrentStock])
      : 0;
    const initialStock = hasInitialStockCol
      ? parseRupiahOrNumber(row[idxInitialStock])
      : currentStock + qtySold;

    const branchName = normalizeBranchName(
      (idxBranch >= 0 ? String(row[idxBranch] ?? '').trim() : '') ||
        detectedBranch ||
        defaultBranchName ||
        'CFD Senayan'
    );
    const branchKey = normalizeBranchKey(branchName);

    let saleYear = defaultYear;
    let saleMonth = detectedMonth;
    if (idxDate >= 0 && row[idxDate] !== '' && row[idxDate] !== undefined) {
      const dm = parseDateToYearMonth(
        row[idxDate],
        defaultYear,
        detectedMonth,
        columnDateOrder,
        rawTxId
      );
      saleYear = dm.year;
      saleMonth = dm.month;
    } else if (rawTxId) {
      const epochDm = parseEpochFromTxCode(rawTxId);
      if (epochDm) {
        saleYear = epochDm.year;
        saleMonth = epochDm.month;
      }
    }
    if (idxMonth >= 0 && String(row[idxMonth] ?? '').trim()) {
      saleMonth = parseMonth(row[idxMonth], saleMonth);
    }
    if (idxYear >= 0 && String(row[idxYear] ?? '').trim()) {
      const parsedYr = parseRupiahOrNumber(row[idxYear]);
      if (parsedYr >= 2000 && parsedYr <= 2100) saleYear = parsedYr;
    }

    // Build clean transactionCode for Data_Penjualan so Total Transaksi reflects REAL TRX count!
    let transactionCode: string | undefined;
    if (isSalesSheet) {
      const cleanedRawTx = rawTxId
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32);
      if (cleanedRawTx.length >= 1) {
        transactionCode =
          cleanedRawTx.length >= 3 ? cleanedRawTx : `TRX-${cleanedRawTx}`;
      } else {
        transactionCode = `TRX-${saleYear}${String(saleMonth).padStart(2, '0')}-${r}`;
      }
      const txGroupKey = `${branchKey}::${transactionCode.toLowerCase()}`;
      if (qtySold > 0) {
        uniqueTxSet.add(txGroupKey);
      }

      // Collect transaction-level discount, voucher & optional Total Bayar (Net) observations (deduped 1x per ID Transaksi after loop)
      const parsedNetPay =
        idxNetPay >= 0 && String(row[idxNetPay] ?? '').trim() !== ''
          ? parseRupiahOrNumber(row[idxNetPay])
          : 0;
      if (hasDiscountCols || voucherCode || parsedNetPay > 0) {
        let meta = txDiscountMetaMap.get(txGroupKey);
        if (!meta) {
          meta = { observations: [], netPayAmounts: [] };
          txDiscountMetaMap.set(txGroupKey, meta);
        }
        if (voucherCode && !meta.voucherCode) {
          meta.voucherCode = voucherCode;
        }
        if (parsedNetPay > 0) {
          meta.netPayAmounts.push(parsedNetPay);
        }
        if (
          String(rawDiscountAmountCell ?? '').trim() !== '' ||
          String(rawDiscountValueCell ?? '').trim() !== '' ||
          String(rawDiscountTypeCell ?? '').trim() !== ''
        ) {
          meta.observations.push({
            rawTypeCell: rawDiscountTypeCell,
            rawAmountCell: rawDiscountAmountCell,
            rawValueCell: rawDiscountValueCell,
          });
        }
      }
    }

    rawRowCount += 1;

    // For Data_Penjualan, preserve per-transaction rows keyed by (branch, transactionCode, sku)!
    const dedupeKey = isSalesSheet
      ? `${branchKey}::${(transactionCode ?? '').toLowerCase()}::${cleanSku.toLowerCase()}`
      : `${branchKey}::${cleanSku.toLowerCase()}`;

    const prev = parsedMap.get(dedupeKey);
    if (prev && isSalesSheet) {
      const nextQty = (prev.qtySold ?? 0) + qtySold;
      const nextGross =
        (prev.grossSales ?? prev.totalSales ?? 0) + grossSales;
      parsedMap.set(dedupeKey, {
        ...prev,
        name: prev.name || cleanName,
        category:
          prev.category !== 'Umum' ? prev.category : category.slice(0, 50),
        price: prev.price > 0 ? prev.price : price,
        qtySold: nextQty > 0 ? nextQty : undefined,
        grossSales: nextQty > 0 ? nextGross : undefined,
        totalSales: nextQty > 0 ? nextGross : undefined,
      });
    } else if (prev) {
      const nextQty =
        qtySold > 0 ? (prev.qtySold ?? 0) + qtySold : prev.qtySold;
      const nextGross =
        qtySold > 0
          ? (prev.grossSales ?? prev.totalSales ?? 0) + grossSales
          : prev.grossSales;
      const nextDiscount =
        qtySold > 0
          ? (prev.discountAmount ?? 0) + discountAmount
          : prev.discountAmount;
      parsedMap.set(dedupeKey, {
        ...prev,
        name: cleanName || prev.name,
        category: category !== 'Umum' ? category.slice(0, 50) : prev.category,
        price: price > 0 ? price : prev.price,
        initialStock: hasInitialStockCol ? initialStock : prev.initialStock,
        currentStock: hasCurrentStockCol ? currentStock : prev.currentStock,
        hasStockData: prev.hasStockData || hasStockData,
        qtySold: nextQty,
        grossSales: nextGross,
        discountAmount:
          nextDiscount && nextDiscount > 0 ? nextDiscount : undefined,
        totalSales:
          qtySold > 0 ? (prev.totalSales ?? 0) + totalSales : prev.totalSales,
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
        hasStockData,
        transactionCode,
        qtySold: qtySold > 0 ? qtySold : undefined,
        grossSales: qtySold > 0 ? grossSales : undefined,
        discountAmount:
          qtySold > 0 && discountAmount > 0 ? discountAmount : undefined,
        discountType:
          qtySold > 0 && discountAmount > 0
            ? resolvedLineDiscount.discountType
            : undefined,
        discountLabel:
          qtySold > 0 && discountAmount > 0
            ? resolvedLineDiscount.discountLabel
            : undefined,
        totalSales: qtySold > 0 ? totalSales : undefined,
        saleMonth,
        saleYear,
      });
    }
  }

  // Post-pass for Data_Penjualan: apply Total Diskon EXACTLY ONCE per unique ID Transaksi
  // and distribute proportionally across paid item rows (grossSales > 0), keeping Rp 0 promo rows at Rp 0.
  const finalRows = Array.from(parsedMap.values());
  if (isSalesSheet && txDiscountMetaMap.size > 0) {
    const rowsByTxKey = new Map<string, ImportedCatalogRow[]>();
    for (const item of finalRows) {
      if ((item.qtySold ?? 0) <= 0 || !item.transactionCode) continue;
      const txGroupKey = `${normalizeBranchKey(item.branchName)}::${item.transactionCode.toLowerCase()}`;
      const list = rowsByTxKey.get(txGroupKey) ?? [];
      list.push(item);
      rowsByTxKey.set(txGroupKey, list);
    }

    for (const [txGroupKey, txRows] of rowsByTxKey.entries()) {
      const meta = txDiscountMetaMap.get(txGroupKey);
      if (!meta) continue;

      const txSubtotal = txRows.reduce(
        (sum, item) => sum + Math.max(0, item.grossSales ?? item.totalSales ?? 0),
        0
      );
      const resolvedTx = resolveTransactionDiscount({
        txSubtotal,
        observations: meta.observations,
        netPayAmounts: meta.netPayAmounts,
        voucherCode: meta.voucherCode,
        hasSeparateValueCol: idxDiscountValue >= 0,
      });

      const paidRows = txRows.filter((item) => (item.grossSales ?? 0) > 0);
      for (const item of txRows) {
        const gross = Math.max(0, item.grossSales ?? item.totalSales ?? 0);
        item.grossSales = gross;
        item.discountAmount = undefined;
        item.discountType = undefined;
        item.discountLabel =
          gross === 0 && resolvedTx.discountAmount === 0
            ? resolvedTx.discountLabel
            : undefined;
        item.totalSales = gross;
      }

      if (resolvedTx.discountAmount > 0 && paidRows.length > 0 && txSubtotal > 0) {
        let allocated = 0;
        paidRows.forEach((item, idx) => {
          const rowGross = item.grossSales ?? 0;
          let rowDisc: number;
          if (idx === paidRows.length - 1) {
            rowDisc = Math.max(
              0,
              Math.min(rowGross, resolvedTx.discountAmount - allocated)
            );
          } else {
            rowDisc = Math.max(
              0,
              Math.min(
                rowGross,
                Math.round((resolvedTx.discountAmount * rowGross) / txSubtotal)
              )
            );
          }
          allocated += rowDisc;
          item.discountAmount = rowDisc > 0 ? rowDisc : undefined;
          item.discountType = rowDisc > 0 ? resolvedTx.discountType : undefined;
          item.discountLabel =
            rowDisc > 0 ? resolvedTx.discountLabel : undefined;
          item.totalSales = Math.max(0, rowGross - rowDisc);
        });

        // Safety remainder pass if clamping on last row left unallocated Rupiah
        let remainder = resolvedTx.discountAmount - allocated;
        if (remainder > 0) {
          for (const item of paidRows) {
            if (remainder <= 0) break;
            const currentNet = item.totalSales ?? 0;
            if (currentNet <= 0) continue;
            const extra = Math.min(currentNet, remainder);
            item.discountAmount = (item.discountAmount ?? 0) + extra;
            item.discountType = resolvedTx.discountType;
            item.discountLabel = resolvedTx.discountLabel;
            item.totalSales = currentNet - extra;
            remainder -= extra;
          }
        }
      } else if (resolvedTx.discountLabel) {
        for (const item of paidRows) {
          item.discountLabel = resolvedTx.discountLabel;
        }
      }
    }
  }

  return {
    sheetName,
    kind,
    rows: finalRows,
    rawRowCount,
    uniqueTxCount: uniqueTxSet.size,
    detectedBranch,
    detectedMonth,
    detectedColumns,
    selectedByDefault: !isDashboard && finalRows.length > 0,
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

  // Keep master metadata per SKU AND per normalized Name so Data_Penjualan links seamlessly to monitoring_stok
  const masterBySku = new Map<
    string,
    { sku: string; name: string; category: string; price: number; barcode: string }
  >();
  const masterByName = new Map<
    string,
    { sku: string; name: string; category: string; price: number; barcode: string }
  >();
  for (const tab of ordered) {
    for (const r of tab.rows) {
      const skuKey = r.sku.toLowerCase();
      const nameKey = r.name.trim().toLowerCase();
      const prev = masterBySku.get(skuKey);
      const prevHasRealName =
        Boolean(prev?.name) && prev!.name.toLowerCase() !== prev!.sku.toLowerCase();
      const rowHasRealName =
        Boolean(r.name) && r.name.toLowerCase() !== r.sku.toLowerCase();
      const resolvedName = prevHasRealName
        ? prev!.name
        : rowHasRealName
          ? r.name
          : prev?.name || r.name;
      const entry = {
        sku: prev?.sku || r.sku,
        name: resolvedName,
        barcode: prev?.barcode || r.barcode,
        category: inferCategoryFromProductName(
          resolvedName,
          isExplicitValidCategory(prev?.category)
            ? prev!.category
            : r.category
        ),
        price: prev && prev.price > 0 ? prev.price : r.price,
      };
      masterBySku.set(skuKey, entry);
      if (nameKey && (!masterByName.has(nameKey) || tab.kind === 'catalog')) {
        masterByName.set(nameKey, entry);
      }
    }
  }

  const hasDedicatedSalesTab = ordered.some((t) => t.kind === 'sales');
  const merged = new Map<string, ImportedCatalogRow>();

  for (const tab of ordered) {
    const isSalesOnly = tab.kind === 'sales';
    for (const r of tab.rows) {
      let resolvedSku = r.sku;
      let master = masterBySku.get(resolvedSku.toLowerCase());
      if (
        isSalesOnly &&
        (!master ||
          resolvedSku.startsWith('PRD-') ||
          resolvedSku.startsWith('SKU-'))
      ) {
        const byName = masterByName.get(r.name.trim().toLowerCase());
        if (byName) {
          master = byName;
          resolvedSku = byName.sku;
        }
      }
      const skuKey = resolvedSku.toLowerCase();
      const cleanBranchName = normalizeBranchName(r.branchName);
      const bKey = normalizeBranchKey(cleanBranchName);
      const yr = r.saleYear ?? new Date().getFullYear();
      const mo = r.saleMonth ?? new Date().getMonth() + 1;

      const baseKey = `cat::${bKey}::${skuKey}`;

      // Catalog tab (monitoring_stok) -> authoritative catalog + stock rows
      if (!isSalesOnly && hasDedicatedSalesTab) {
        const prev = merged.get(baseKey);
        const resolvedName = prev?.name || master?.name || r.name;
        const resolvedCategory = inferCategoryFromProductName(
          resolvedName,
          isExplicitValidCategory(prev?.category)
            ? prev!.category
            : isExplicitValidCategory(r.category)
              ? r.category
              : master?.category
        );
        if (prev) {
          merged.set(baseKey, {
            ...prev,
            branchName: cleanBranchName,
            name: resolvedName,
            category: resolvedCategory,
            price: prev.price > 0 ? prev.price : r.price,
            initialStock: r.hasStockData ? r.initialStock : prev.initialStock,
            currentStock: r.hasStockData ? r.currentStock : prev.currentStock,
            hasStockData: prev.hasStockData || r.hasStockData,
            qtySold: undefined,
            totalSales: undefined,
          });
        } else {
          merged.set(baseKey, {
            ...r,
            branchName: cleanBranchName,
            sku: resolvedSku,
            name: resolvedName,
            barcode: master?.barcode || r.barcode,
            category: resolvedCategory,
            price: r.price > 0 ? r.price : master?.price || 0,
            qtySold: undefined,
            grossSales: undefined,
            discountAmount: undefined,
            totalSales: undefined,
          });
        }
        continue;
      }

      // Sales tab (Data_Penjualan) -> preserve EVERY individual transactionCode so Total Transaksi is exact!
      if (isSalesOnly) {
        const txPart = (r.transactionCode ?? `${yr}-${mo}`).toLowerCase();
        const txLineKey = `tx::${bKey}::${txPart}::${skuKey}`;
        const prev = merged.get(txLineKey);
        if (prev) {
          const nextQty = (prev.qtySold ?? 0) + (r.qtySold ?? 0);
          const nextGross =
            (prev.grossSales ?? prev.totalSales ?? 0) +
            (r.grossSales ?? r.totalSales ?? 0);
          const nextDiscount =
            (prev.discountAmount ?? 0) + (r.discountAmount ?? 0);
          const nextSales = (prev.totalSales ?? 0) + (r.totalSales ?? 0);
          merged.set(txLineKey, {
            ...prev,
            qtySold: nextQty > 0 ? nextQty : undefined,
            grossSales: nextQty > 0 ? nextGross : undefined,
            discountAmount: nextDiscount > 0 ? nextDiscount : undefined,
            discountType:
              nextDiscount > 0
                ? prev.discountType && prev.discountType !== 'none'
                  ? prev.discountType
                  : r.discountType
                : undefined,
            discountLabel: prev.discountLabel ?? r.discountLabel,
            totalSales: nextQty > 0 ? nextSales : undefined,
          });
        } else {
          const resolvedName = master?.name || r.name;
          const resolvedCategory = inferCategoryFromProductName(
            resolvedName,
            isExplicitValidCategory(master?.category)
              ? master!.category
              : r.category
          );
          const isExplicitFreeLine =
            r.grossSales !== undefined &&
            r.grossSales === 0 &&
            (r.qtySold ?? 0) > 0;
          merged.set(txLineKey, {
            ...r,
            branchName: cleanBranchName,
            sku: resolvedSku,
            name: resolvedName,
            barcode: master?.barcode || r.barcode,
            category: resolvedCategory,
            price: isExplicitFreeLine
              ? 0
              : r.price > 0
                ? r.price
                : master?.price || 0,
            hasStockData: false,
          });
        }
        continue;
      }

      // Single non-sales tab or multiple catalog tabs without dedicated sales tab
      const prev = merged.get(baseKey);
      const resolvedName = prev?.name || master?.name || r.name;
      const resolvedCategory = inferCategoryFromProductName(
        resolvedName,
        isExplicitValidCategory(prev?.category)
          ? prev!.category
          : isExplicitValidCategory(r.category)
            ? r.category
            : master?.category
      );
      if (prev) {
        const nextQty = (prev.qtySold ?? 0) + (r.qtySold ?? 0);
        const nextGross =
          (prev.grossSales ?? prev.totalSales ?? 0) +
          (r.grossSales ?? r.totalSales ?? 0);
        const nextDiscount =
          (prev.discountAmount ?? 0) + (r.discountAmount ?? 0);
        const nextSales = (prev.totalSales ?? 0) + (r.totalSales ?? 0);
        merged.set(baseKey, {
          ...prev,
          branchName: cleanBranchName,
          name: resolvedName,
          category: resolvedCategory,
          price: prev.price > 0 ? prev.price : r.price,
          initialStock: r.hasStockData ? r.initialStock : prev.initialStock,
          currentStock: r.hasStockData ? r.currentStock : prev.currentStock,
          hasStockData: prev.hasStockData || r.hasStockData,
          qtySold: nextQty > 0 ? nextQty : undefined,
          grossSales: nextQty > 0 ? nextGross : undefined,
          discountAmount: nextDiscount > 0 ? nextDiscount : undefined,
          totalSales: nextQty > 0 ? nextSales : undefined,
        });
      } else {
        merged.set(baseKey, {
          ...r,
          branchName: cleanBranchName,
          sku: resolvedSku,
          name: resolvedName,
          barcode: master?.barcode || r.barcode,
          category: resolvedCategory,
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
  const isCsv = file.name.toLowerCase().endsWith('.csv');
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: 'string', raw: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' });
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
    const workbook = XLSX.read(text, { type: 'string', raw: true });
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
      const workbook = XLSX.read(text, { type: 'string', raw: true });
      const result = parseWorkbook(
        workbook,
        defaultBranchName,
        defaultMonth,
        defaultYear,
        'csv',
        xlsxDownloadUrl
      );

      // If default tab was a Dashboard summary (e.g. only 13 Top products), automatically probe 'monitoring_stok' via CORS-friendly gviz API
      if (sheetId && result.isDashboardSummaryOnly) {
        try {
          const probeUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('monitoring_stok')}`;
          const probeRes = await fetch(probeUrl);
          if (probeRes.ok) {
            const probeText = await probeRes.text();
            if (
              probeText &&
              !isLikelyHtmlResponse(probeText) &&
              probeText.trim() !== text.trim()
            ) {
              const probeWb = XLSX.read(probeText, { type: 'string', raw: true });
              const fk = probeWb.SheetNames[0];
              if (fk) {
                probeWb.Sheets['monitoring_stok'] = probeWb.Sheets[fk];
                if (fk !== 'monitoring_stok') delete probeWb.Sheets[fk];
                probeWb.SheetNames[0] = 'monitoring_stok';
              }
              const probeResult = parseWorkbook(
                probeWb,
                defaultBranchName,
                defaultMonth,
                defaultYear,
                'csv',
                xlsxDownloadUrl
              );
              if (probeResult.rows.length > 0 && !probeResult.isDashboardSummaryOnly) {
                return probeResult;
              }
            }
          }
        } catch {
          // Ignore probe failure and fall back to default result with guidance
        }
      }

      if (sheetId && result.tabs.length <= 1) {
        result.warnings.push(
          'Browser hanya bisa mengambil 1 tab via CSV dari link Google Sheet (pembatasan CORS Google). Gunakan mode "Sinkronkan monitoring_stok + Data_Penjualan" atau unduh file .xlsx untuk mengambil semua tab.'
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

/**
 * Fetches multiple named tabs (e.g. ['monitoring_stok', 'Data_Penjualan']) in parallel
 * via Google Sheets' CORS-friendly gviz CSV API and merges them into a unified workbook result.
 */
export async function fetchAndSyncGoogleSheetTabs(
  rawUrl: string,
  tabNames: string[],
  defaultBranchName: string,
  defaultMonth: number,
  defaultYear: number
): Promise<ParsedWorkbookResult> {
  const { sheetId } = extractGoogleSheetInfo(rawUrl);
  if (!sheetId) {
    throw new Error(
      'Link Google Sheet tidak valid. Tempel URL yang mengandung /spreadsheets/d/...'
    );
  }
  const xlsxDownloadUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
  const cleanTabs = tabNames.map((t) => t.trim()).filter(Boolean);
  if (cleanTabs.length === 0) {
    return fetchAndParseSheetUrl(
      rawUrl,
      defaultBranchName,
      defaultMonth,
      defaultYear
    );
  }

  const fetched = await Promise.all(
    cleanTabs.map(async (tabName) => {
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
      const res = await fetch(url);
      if (!res.ok) {
        return { tabName, text: '', error: `HTTP ${res.status}` };
      }
      const text = await res.text();
      if (isLikelyHtmlResponse(text)) {
        return { tabName, text: '', error: 'PRIVATE' };
      }
      return { tabName, text, error: null };
    })
  );

  if (fetched.some((f) => f.error === 'PRIVATE')) {
    throw new Error(
      'Google Sheet masih bersifat privat. Ubah akses berbagi menjadi "Siapa saja yang memiliki link (Pelihat)", atau unduh sebagai Excel (.xlsx) lalu unggah di sebelah kiri.'
    );
  }

  const combinedWb = XLSX.utils.book_new();
  const seenPayloads = new Map<string, string>();
  const warnings: string[] = [];

  for (const item of fetched) {
    if (!item.text.trim()) {
      warnings.push(`Tab "${item.tabName}" kosong atau gagal dibaca.`);
      continue;
    }
    const sig = item.text.trim().slice(0, 500);
    if (seenPayloads.has(sig)) {
      warnings.push(
        `Tab "${item.tabName}" mengembalikan isi yang sama persis dengan "${seenPayloads.get(sig)}" (pastikan ejaan nama tab di Google Sheet persis sama).`
      );
      continue;
    }
    seenPayloads.set(sig, item.tabName);

    const subWb = XLSX.read(item.text, { type: 'string', raw: true });
    const fk = subWb.SheetNames[0];
    if (fk && subWb.Sheets[fk]) {
      XLSX.utils.book_append_sheet(combinedWb, subWb.Sheets[fk], item.tabName);
    }
  }

  if (combinedWb.SheetNames.length === 0) {
    throw new Error(
      `Tidak ada data yang berhasil diambil dari tab ${cleanTabs.join(', ')}. Pastikan nama tab sesuai persis di Google Sheet Anda.`
    );
  }

  const result = parseWorkbook(
    combinedWb,
    defaultBranchName,
    defaultMonth,
    defaultYear,
    'csv',
    xlsxDownloadUrl
  );
  if (warnings.length > 0) {
    result.warnings = [...result.warnings, ...warnings];
  }
  return result;
}

