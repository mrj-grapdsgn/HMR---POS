import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Layers,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { HIKEMORE_SEED_ROWS, MONTH_OPTIONS } from '../data/catalog';
import { Branch, ImportProgress, ImportedCatalogRow } from '../types/pos';
import { formatRupiah } from '../utils/format';
import {
  ParsedSheetTab,
  ParsedWorkbookResult,
  extractGoogleSheetInfo,
  fetchAndParseSheetUrl,
  fetchAndSyncGoogleSheetTabs,
  mergeSelectedTabs,
  parseSpreadsheetFile,
} from '../utils/spreadsheetImport';

const SAVED_SHEET_URL_KEY = 'kasirpos_last_google_sheet_url';

type SheetSyncMode =
  | 'dual_stok_penjualan'
  | 'data_penjualan'
  | 'monitoring_stok'
  | 'custom';

interface ImportMigrationPanelProps {
  branches: Branch[];
  hasLegacyCafe: boolean;
  onReplaceLegacyCafe: () => Promise<{
    removedCafeCount: number;
    importedCount: number;
  }>;
  onImportRows: (
    rows: ImportedCatalogRow[],
    includeSales: boolean,
    replacePreviousImportedSales: boolean,
    onProgress?: (progress: ImportProgress) => void
  ) => Promise<{
    branchesCreated: number;
    productsUpserted: number;
    stocksUpdated: number;
    transactionsImported?: number;
    transactionsSkipped?: number;
    salesLinesImported: number;
    salesLinesSkipped?: number;
  }>;
  onClearImportedSales: (
    onProgress?: (progress: ImportProgress) => void
  ) => Promise<{
    deletedTransactions: number;
    deletedSalesLines: number;
  }>;
  onNotify: (msg: string) => void;
}

const TAB_KIND_LABEL: Record<ParsedSheetTab['kind'], string> = {
  catalog: 'Katalog & Stok',
  sales: 'Penjualan',
  dashboard: 'Dasbor Ringkasan',
  unknown: 'Lainnya',
};

const MONTH_SHORT_MAP: Record<number, string> = Object.fromEntries(
  MONTH_OPTIONS.map((m) => [m.num, m.short])
);

export function ImportMigrationPanel({
  branches,
  hasLegacyCafe,
  onReplaceLegacyCafe,
  onImportRows,
  onClearImportedSales,
  onNotify,
}: ImportMigrationPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sheetUrl, setSheetUrl] = useState<string>(() => {
    try {
      return window.localStorage.getItem(SAVED_SHEET_URL_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [syncMode, setSyncMode] = useState<SheetSyncMode>(
    'dual_stok_penjualan'
  );
  const [customTabName, setCustomTabName] = useState('');
  const [defaultBranch, setDefaultBranch] = useState(
    branches[0]?.name ?? 'CFD Senayan'
  );
  const [defaultMonth, setDefaultMonth] = useState<number>(
    new Date().getMonth() + 1
  );
  const [defaultYear, setDefaultYear] = useState<number>(
    new Date().getFullYear()
  );
  const [includeSales, setIncludeSales] = useState(true);
  const [replacePreviousImportedSales, setReplacePreviousImportedSales] =
    useState(true);

  const [parsedTabs, setParsedTabs] = useState<ParsedSheetTab[]>([]);
  const [selectedTabNames, setSelectedTabNames] = useState<string[]>([]);
  const [manualRows, setManualRows] = useState<ImportedCatalogRow[] | null>(
    null
  );
  const [warnings, setWarnings] = useState<string[]>([]);
  const [xlsxDownloadUrl, setXlsxDownloadUrl] = useState<string | null>(null);
  const [isDashboardOnly, setIsDashboardOnly] = useState(false);

  const [sourceLabel, setSourceLabel] = useState('');
  const [showAllPreview, setShowAllPreview] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearingImported, setClearingImported] = useState(false);
  const [confirmResetImport, setConfirmResetImport] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [migratingLegacy, setMigratingLegacy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const previewRows = useMemo(() => {
    if (manualRows) return manualRows;
    if (parsedTabs.length === 0) return [];
    return mergeSelectedTabs(parsedTabs, selectedTabNames);
  }, [manualRows, parsedTabs, selectedTabNames]);

  const previewStats = useMemo(() => {
    const skus = new Set(previewRows.map((r) => r.sku.toLowerCase()));
    const txCodes = new Set<string>();
    let totalQtySold = 0;
    let totalOmset = 0;
    for (const r of previewRows) {
      if ((r.qtySold ?? 0) > 0) {
        totalQtySold += r.qtySold ?? 0;
        totalOmset +=
          r.totalSales !== undefined ? r.totalSales : (r.qtySold ?? 0) * r.price;
        if (r.transactionCode?.trim()) {
          txCodes.add(
            `${r.branchName.toLowerCase()}::${r.transactionCode.trim().toLowerCase()}`
          );
        }
      }
    }
    return {
      uniqueSkus: skus.size,
      uniqueTxCount: txCodes.size,
      hasTxCodes: txCodes.size > 0,
      totalQtySold,
      totalOmset,
    };
  }, [previewRows]);

  const directXlsxFromInput = useMemo(() => {
    const info = extractGoogleSheetInfo(sheetUrl);
    return info.sheetId
      ? `https://docs.google.com/spreadsheets/d/${info.sheetId}/export?format=xlsx`
      : null;
  }, [sheetUrl]);

  const handleSheetUrlChange = (val: string) => {
    setSheetUrl(val);
    try {
      window.localStorage.setItem(SAVED_SHEET_URL_KEY, val);
    } catch {
      // Ignore storage quota errors
    }
  };

  const applyWorkbookResult = (
    parsed: ParsedWorkbookResult,
    label: string
  ) => {
    setManualRows(null);
    setParsedTabs(parsed.tabs);
    setSelectedTabNames(
      parsed.tabs.filter((t) => t.selectedByDefault).map((t) => t.sheetName)
    );
    setDefaultBranch(parsed.detectedBranch);
    setDefaultMonth(parsed.detectedMonth);
    setWarnings(parsed.warnings);
    setXlsxDownloadUrl(parsed.xlsxDownloadUrl ?? null);
    setIsDashboardOnly(parsed.isDashboardSummaryOnly);
    setSourceLabel(label);
    setShowAllPreview(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setResultMsg(null);
    setParsing(true);
    try {
      const parsed = await parseSpreadsheetFile(
        file,
        defaultBranch,
        defaultMonth,
        defaultYear
      );
      if (parsed.tabs.length === 0 || parsed.rows.length === 0) {
        setErrorMsg(
          'Tidak ditemukan baris produk yang valid di seluruh tab file ini. Pastikan ada kolom "Kode Item / SKU" atau "Nama Produk".'
        );
      } else {
        applyWorkbookResult(
          parsed,
          `${file.name} (${parsed.tabs.length} tab terdeteksi)`
        );
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal membaca file spreadsheet.'
      );
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFetchSheetUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetUrl.trim()) return;
    setErrorMsg(null);
    setResultMsg(null);
    setParsing(true);
    try {
      let parsed: ParsedWorkbookResult;
      let label: string;

      if (syncMode === 'dual_stok_penjualan') {
        parsed = await fetchAndSyncGoogleSheetTabs(
          sheetUrl,
          ['monitoring_stok', 'Data_Penjualan'],
          defaultBranch,
          defaultMonth,
          defaultYear
        );
        label = `Sinkron Gabungan (${parsed.tabs.map((t) => t.sheetName).join(' + ')})`;
      } else if (syncMode === 'data_penjualan') {
        parsed = await fetchAndParseSheetUrl(
          sheetUrl,
          defaultBranch,
          defaultMonth,
          defaultYear,
          'Data_Penjualan'
        );
        label = 'Google Sheet · Tab "Data_Penjualan"';
      } else if (syncMode === 'monitoring_stok') {
        parsed = await fetchAndParseSheetUrl(
          sheetUrl,
          defaultBranch,
          defaultMonth,
          defaultYear,
          'monitoring_stok'
        );
        label = 'Google Sheet · Tab "monitoring_stok"';
      } else {
        parsed = await fetchAndParseSheetUrl(
          sheetUrl,
          defaultBranch,
          defaultMonth,
          defaultYear,
          customTabName
        );
        label =
          parsed.fetchedFormat === 'xlsx'
            ? `Google Sheet (${parsed.tabs.length} tab)`
            : customTabName.trim()
              ? `Google Sheet · Tab "${customTabName.trim()}"`
              : 'Google Sheet (1 tab CSV)';
      }

      if (parsed.tabs.length === 0 || parsed.rows.length === 0) {
        setErrorMsg(
          'Link berhasil dibuka tetapi tidak ditemukan kolom produk/penjualan yang dikenali. Pastikan ejaan nama tab (monitoring_stok / Data_Penjualan) sesuai di Google Sheet Anda, atau unduh sebagai .xlsx.'
        );
      } else {
        applyWorkbookResult(parsed, label);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Gagal mengambil data dari link Google Sheet (coba unduh sebagai .xlsx lalu unggah di sebelah kiri).'
      );
    } finally {
      setParsing(false);
    }
  };

  const handleLoadHikemorePreset = () => {
    setErrorMsg(null);
    setResultMsg(null);
    setParsedTabs([]);
    setSelectedTabNames([]);
    setWarnings([]);
    setXlsxDownloadUrl(null);
    setIsDashboardOnly(false);
    setManualRows(HIKEMORE_SEED_ROWS);
    setDefaultBranch('CFD Senayan');
    setDefaultMonth(7);
    setDefaultYear(2026);
    setSourceLabel('Data Contoh Hikemore CFD Senayan (13 Produk)');
    setShowAllPreview(false);
  };

  const toggleTabSelection = (sheetName: string) => {
    setSelectedTabNames((prev) =>
      prev.includes(sheetName)
        ? prev.filter((n) => n !== sheetName)
        : [...prev, sheetName]
    );
  };

  const clearPreview = () => {
    setParsedTabs([]);
    setSelectedTabNames([]);
    setManualRows(null);
    setWarnings([]);
    setXlsxDownloadUrl(null);
    setIsDashboardOnly(false);
    setSourceLabel('');
  };

  const handleCommitImport = async () => {
    if (previewRows.length === 0) return;
    setErrorMsg(null);
    setResultMsg(null);
    setSaving(true);
    setProgress({
      stage: 'Memulai sinkronisasi ke Firebase...',
      current: 0,
      total: previewRows.length,
    });
    try {
      const normalizedRows = previewRows.map((r) => ({
        ...r,
        branchName: r.branchName || defaultBranch || 'CFD Senayan',
        saleMonth: r.saleMonth || defaultMonth,
        saleYear: r.saleYear || defaultYear,
      }));
      const summary = await onImportRows(
        normalizedRows,
        includeSales,
        replacePreviousImportedSales,
        (prog) => setProgress(prog)
      );
      const txImported = summary.transactionsImported ?? 0;
      const txSkipped = summary.transactionsSkipped ?? 0;
      const skippedText =
        txSkipped > 0
          ? ` (${txSkipped} transaksi sudah ada & dilewati agar tidak ganda)`
          : summary.salesLinesSkipped && summary.salesLinesSkipped > 0
            ? ` (${summary.salesLinesSkipped} baris penjualan sudah sinkron & dilewati agar tidak ganda)`
            : '';
      const msg = `Berhasil disinkronkan ke Firebase: ${summary.productsUpserted} produk, ${summary.stocksUpdated} stok cabang${
        summary.branchesCreated > 0
          ? `, ${summary.branchesCreated} cabang baru`
          : ''
      }${
        txImported > 0 ? `, ${txImported} transaksi (TRX) baru` : ''
      }${
        summary.salesLinesImported > 0
          ? ` (${summary.salesLinesImported} baris penjualan)`
          : ''
      }${skippedText}.`;
      setResultMsg(msg);
      onNotify(
        `Sinkronisasi selesai (${summary.productsUpserted} produk${
          txImported > 0 ? `, ${txImported} TRX` : ''
        })`
      );
      clearPreview();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menyimpan data impor.'
      );
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  const handleClearImportedSales = async () => {
    setErrorMsg(null);
    setResultMsg(null);
    setClearingImported(true);
    setConfirmResetImport(false);
    setProgress({
      stage: 'Menghapus data penjualan impor lama...',
      current: 0,
      total: 1,
    });
    try {
      const res = await onClearImportedSales((prog) => setProgress(prog));
      const msg =
        res.deletedTransactions === 0 && res.deletedSalesLines === 0
          ? 'Tidak ada data penjualan impor lama yang perlu dihapus.'
          : `Data penjualan impor lama dibersihkan (${res.deletedTransactions} transaksi impor & ${res.deletedSalesLines} baris rekapan). Transaksi kasir POS tetap aman.`;
      setResultMsg(msg);
      onNotify('Data penjualan impor lama berhasil dibersihkan');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Gagal membersihkan data penjualan impor lama.'
      );
    } finally {
      setClearingImported(false);
      setProgress(null);
    }
  };

  const handleReplaceLegacy = async () => {
    setMigratingLegacy(true);
    setErrorMsg(null);
    try {
      const res = await onReplaceLegacyCafe();
      setResultMsg(
        `Selesai! ${res.removedCafeCount} produk contoh kafe dihapus dan diganti dengan ${res.importedCount} produk Hikemore (CFD Senayan).`
      );
      onNotify('Katalog contoh kafe berhasil diganti dengan data Hikemore');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal mengganti data contoh kafe.'
      );
    } finally {
      setMigratingLegacy(false);
    }
  };

  const visiblePreviewRows = showAllPreview
    ? previewRows
    : previewRows.slice(0, 100);

  return (
    <div className="space-y-5">
      {/* Legacy Cafe Cleanup Banner */}
      {hasLegacyCafe && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="max-w-2xl">
            <div className="text-xs font-bold text-amber-900">
              Data Contoh Kafe Terdeteksi di Database Anda
            </div>
            <p className="mt-0.5 text-xs text-amber-800">
              Akun Anda masih menyimpan produk contoh bawaan awal (Chicken
              Wings, Coffee Latte, dll.). Klik tombol di samping untuk menghapus
              contoh kafe tersebut dan langsung mengisi data awal Hikemore.
            </p>
          </div>
          <button
            type="button"
            disabled={migratingLegacy}
            onClick={handleReplaceLegacy}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
          >
            {migratingLegacy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>Ganti Contoh Kafe → Data Hikemore</span>
          </button>
        </div>
      )}

      {/* Importer Controls Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Upload Excel / CSV (Multi-Tab Recommended!) */}
        <div className="space-y-3.5 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-6">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Impor Semua Tab dari Excel (.xlsx) / CSV
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Di Google Sheets klik{' '}
                <span className="font-semibold text-slate-700">
                  File → Download → Microsoft Excel (.xlsx)
                </span>
                , lalu unggah di sini. Tab <strong>monitoring_stok</strong> &{' '}
                <strong>Data_Penjualan</strong> otomatis dibaca dan digabungkan
                sekaligus.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                Cabang Default
              </label>
              <input
                type="text"
                maxLength={80}
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                placeholder="CFD Senayan"
                className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                Bulan Default
              </label>
              <select
                value={defaultMonth}
                onChange={(e) => setDefaultMonth(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:border-[#1B8EE6] focus:outline-none"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.num} value={m.num}>
                    {m.full}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                Tahun Default
              </label>
              <input
                type="number"
                min={2020}
                max={2099}
                value={defaultYear}
                onChange={(e) =>
                  setDefaultYear(parseInt(e.target.value || '2026', 10) || 2026)
                }
                className="font-mono-num h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
              />
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={parsing || saving}
              onClick={() => fileInputRef.current?.click()}
              className="flex h-10 items-center gap-2 rounded-lg bg-[#1B8EE6] px-4 text-xs font-bold text-white hover:bg-[#1479C9] disabled:bg-slate-300 whitespace-nowrap"
            >
              {parsing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              <span>Pilih File Excel (.xlsx) / CSV</span>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={handleLoadHikemorePreset}
              className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              <span>Muat 13 Produk Awal</span>
            </button>
          </div>

          <p className="text-[11px] text-slate-500">
            Sinkronisasi ulang <strong>Data_Penjualan</strong> aman dari
            duplikasi (hanya selisih penjualan baru yang ditambahkan) dan tidak
            menimpa stok cabang yang sudah ada.
          </p>
        </div>

        {/* Google Sheet Direct Sync (monitoring_stok + Data_Penjualan) */}
        <form
          onSubmit={handleFetchSheetUrl}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-6"
        >
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Link2 className="h-4 w-4 text-[#1B8EE6]" />
            <span>Sinkronisasi dari Link Google Sheet</span>
          </h3>
          <p className="text-xs text-slate-500">
            Tempel link Google Sheet Anda untuk menarik langsung tab{' '}
            <strong>monitoring_stok</strong> (daftar produk & stok) dan{' '}
            <strong>Data_Penjualan</strong> (riwayat penjualan per produk &
            bulan) sekaligus ke Firebase.
          </p>

          <input
            type="url"
            value={sheetUrl}
            onChange={(e) => handleSheetUrlChange(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
          />

          {/* Mode Selector */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-600">
              Sumber Tab yang Disinkronkan
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setSyncMode('dual_stok_penjualan')}
                className={`rounded-lg border px-2.5 py-2 text-left text-[11px] font-bold transition-colors ${
                  syncMode === 'dual_stok_penjualan'
                    ? 'border-[#1B8EE6] bg-sky-50 text-[#1B8EE6]'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div>monitoring_stok + Data_Penjualan</div>
                <div className="text-[10px] font-normal text-slate-500">
                  Gabung produk, stok & penjualan
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSyncMode('data_penjualan')}
                className={`rounded-lg border px-2.5 py-2 text-left text-[11px] font-bold transition-colors ${
                  syncMode === 'data_penjualan'
                    ? 'border-[#1B8EE6] bg-sky-50 text-[#1B8EE6]'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div>Hanya Data_Penjualan</div>
                <div className="text-[10px] font-normal text-slate-500">
                  Sinkron penjualan (stok tetap aman)
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSyncMode('monitoring_stok')}
                className={`rounded-lg border px-2.5 py-2 text-left text-[11px] font-bold transition-colors ${
                  syncMode === 'monitoring_stok'
                    ? 'border-[#1B8EE6] bg-sky-50 text-[#1B8EE6]'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div>Hanya monitoring_stok</div>
                <div className="text-[10px] font-normal text-slate-500">
                  Daftar produk & sisa stok
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSyncMode('custom')}
                className={`rounded-lg border px-2.5 py-2 text-left text-[11px] font-bold transition-colors ${
                  syncMode === 'custom'
                    ? 'border-[#1B8EE6] bg-sky-50 text-[#1B8EE6]'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div>Tab Lain / Semua Tab</div>
                <div className="text-[10px] font-normal text-slate-500">
                  Ketik nama tab manual
                </div>
              </button>
            </div>
          </div>

          {syncMode === 'custom' && (
            <input
              type="text"
              value={customTabName}
              onChange={(e) => setCustomTabName(e.target.value)}
              placeholder="Kosongkan untuk coba semua tab, atau ketik nama tab..."
              className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
            />
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="submit"
              disabled={parsing || saving || !sheetUrl.trim()}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {parsing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>
                {syncMode === 'dual_stok_penjualan'
                  ? 'Tarik monitoring_stok + Data_Penjualan'
                  : syncMode === 'data_penjualan'
                    ? 'Tarik Sheet Data_Penjualan'
                    : syncMode === 'monitoring_stok'
                      ? 'Tarik Sheet monitoring_stok'
                      : 'Ambil Pratinjau'}
              </span>
            </button>

            {directXlsxFromInput && (
              <a
                href={directXlsxFromInput}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#1B8EE6] bg-sky-50 px-3 text-xs font-bold text-[#1B8EE6] hover:bg-sky-100 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Unduh .xlsx</span>
              </a>
            )}
          </div>
        </form>
      </div>

      {/* Dashboard-only / Multi-tab Guidance Warning */}
      {(isDashboardOnly || warnings.length > 0) && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="space-y-1.5">
              <div className="font-bold">
                {isDashboardOnly
                  ? 'Perhatian: Tab yang terbaca adalah Tab Dasbor Ringkasan (bukan seluruh produk)'
                  : 'Catatan Sinkronisasi Tab Google Sheet'}
              </div>
              {warnings.map((w, idx) => (
                <p key={idx} className="text-amber-800">
                  {w}
                </p>
              ))}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {xlsxDownloadUrl && (
                  <a
                    href={xlsxDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>1. Unduh Semua Tab (.xlsx)</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 text-xs font-bold text-amber-900 hover:bg-amber-100"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>2. Unggah File .xlsx yang Diunduh</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status Messages */}
      {errorMsg && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {resultMsg && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{resultMsg}</span>
        </div>
      )}

      {/* Live Save / Cleanup Progress Banner */}
      {(saving || clearingImported) && progress && (
        <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4">
          <div className="flex items-center justify-between text-xs font-bold text-sky-900">
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[#1B8EE6]" />
              {progress.stage}
            </span>
            <span className="font-mono-num">
              {progress.current} / {progress.total}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-sky-200">
            <div
              className="h-full bg-[#1B8EE6] transition-all duration-200"
              style={{
                width: `${
                  progress.total > 0
                    ? Math.min(
                        100,
                        Math.round((progress.current / progress.total) * 100)
                      )
                    : 15
                }%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Utility Bar: Reset Imported Sales Data Only (POS Sales Stay Safe) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-xs text-slate-600">
          <strong className="text-slate-800">
            Perbaikan Data Penjualan Impor:
          </strong>{' '}
          Jika angka TRX atau kategori impor sebelumnya keliru, bersihkan
          khusus data hasil impor lalu sinkronkan ulang. Transaksi kasir POS
          asli tidak tersentuh.
        </div>
        {confirmResetImport ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-rose-700">
              Hapus semua penjualan impor lama?
            </span>
            <button
              type="button"
              disabled={clearingImported || saving}
              onClick={() => void handleClearImportedSales()}
              className="h-8 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Ya, Bersihkan
            </button>
            <button
              type="button"
              disabled={clearingImported}
              onClick={() => setConfirmResetImport(false)}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={clearingImported || saving}
            onClick={() => setConfirmResetImport(true)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Reset Data Penjualan Impor</span>
          </button>
        )}
      </div>

      {/* Multi-Tab Sheet Selector & Detected Column Mapping */}
      {parsedTabs.length > 0 && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
              <Layers className="h-4 w-4 text-[#1B8EE6]" />
              <span>
                Tab & Pemetaan Kolom Terdeteksi ({parsedTabs.length} tab)
              </span>
            </div>
            {parsedTabs.length > 1 && (
              <span className="text-[11px] text-slate-500">
                Jika <strong>monitoring_stok</strong> &{' '}
                <strong>Data_Penjualan</strong> dipilih bersama, stok diambil
                dari <em>monitoring_stok</em> dan penjualan per TRX dari{' '}
                <em>Data_Penjualan</em> tanpa hitung ganda
              </span>
            )}
          </div>

          <div className="space-y-2">
            {parsedTabs.map((tab) => {
              const checked = selectedTabNames.includes(tab.sheetName);
              const cols = tab.detectedColumns;
              const colItems: Array<[string, string | undefined]> = [
                ['ID Trx', cols.txId],
                ['SKU', cols.sku],
                ['Produk', cols.name],
                ['Kategori', cols.category],
                ['Cabang', cols.branch],
                ['Harga', cols.price],
                ['Stok', cols.currentStock],
                ['Qty', cols.qtySold],
                ['Total', cols.totalSales],
                ['Tanggal', cols.date],
              ].filter((entry): entry is [string, string] => Boolean(entry[1]));

              return (
                <div
                  key={tab.sheetName}
                  className={`rounded-lg border p-2.5 text-xs transition-colors ${
                    checked
                      ? 'border-[#1B8EE6] bg-sky-50/70 text-slate-900'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                  }`}
                >
                  <label className="flex cursor-pointer flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTabSelection(tab.sheetName)}
                      className="h-3.5 w-3.5 accent-[#1B8EE6]"
                    />
                    <span className="font-bold">{tab.sheetName}</span>
                    <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                      {TAB_KIND_LABEL[tab.kind]} · {tab.rows.length} baris
                      {tab.uniqueTxCount > 0
                        ? ` · ${tab.uniqueTxCount} TRX unik`
                        : ''}
                    </span>
                  </label>
                  {colItems.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-5 text-[11px] text-slate-600">
                      {colItems.map(([label, headerName]) => (
                        <span key={label}>
                          <span className="font-semibold text-slate-500">
                            {label}:
                          </span>{' '}
                          <span className="font-mono-num font-semibold text-slate-800">
                            {headerName}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview Table Before Committing to Firebase */}
      {previewRows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div className="space-y-1">
              <div className="text-xs font-bold text-slate-900">
                Pratinjau Data Siap Disinkronkan ({previewRows.length} baris ·{' '}
                {previewStats.uniqueSkus} produk unik
                {previewStats.uniqueTxCount > 0
                  ? ` · ${previewStats.uniqueTxCount} trx`
                  : ''}
                {' · '}
                {previewStats.totalQtySold} pcs terjual ·{' '}
                {formatRupiah(previewStats.totalOmset)} · {sourceLabel})
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={includeSales}
                  onChange={(e) => setIncludeSales(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#1B8EE6]"
                />
                <span>
                  Sinkronkan data penjualan (TRX, Qty Terjual & Omset) ke Dasbor
                  Rekapan & Analisis Restok
                </span>
              </label>
              {includeSales && previewStats.totalQtySold > 0 && (
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={replacePreviousImportedSales}
                    onChange={(e) =>
                      setReplacePreviousImportedSales(e.target.checked)
                    }
                    className="h-3.5 w-3.5 accent-[#1B8EE6]"
                  />
                  <span>
                    Ganti data penjualan impor lama (perbaiki jumlah TRX &
                    kategori lama; transaksi kasir POS tetap aman)
                  </span>
                </label>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving || clearingImported}
                onClick={clearPreview}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={saving || clearingImported}
                onClick={handleCommitImport}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-[#4CAF50] px-4 text-xs font-bold text-white hover:bg-[#43A047] disabled:bg-slate-300"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>
                  {saving
                    ? 'Menyinkronkan...'
                    : `Sinkronkan ${previewStats.uniqueSkus} Produk${
                        previewStats.uniqueTxCount > 0
                          ? ` & ${previewStats.uniqueTxCount} TRX`
                          : ''
                      } ke Firebase`}
                </span>
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-white text-[11px] text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">#</th>
                  {previewStats.hasTxCodes && (
                    <th className="px-3 py-2 font-semibold">Kode Trx</th>
                  )}
                  <th className="px-3 py-2 font-semibold">Kode Item</th>
                  <th className="px-3 py-2 font-semibold">Nama Produk</th>
                  <th className="px-3 py-2 font-semibold">Kategori</th>
                  <th className="px-3 py-2 font-semibold">Cabang</th>
                  <th className="px-3 py-2 font-semibold">Periode</th>
                  <th className="px-3 py-2 text-right font-semibold">Harga</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Sisa Stok
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Terjual
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Total Penjualan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visiblePreviewRows.map((row, idx) => (
                  <tr
                    key={`${row.branchName}-${row.transactionCode ?? ''}-${row.sku}-${row.saleYear ?? ''}-${row.saleMonth ?? ''}-${idx}`}
                    className="hover:bg-slate-50"
                  >
                    <td className="font-mono-num px-3 py-2 text-slate-400">
                      {idx + 1}
                    </td>
                    {previewStats.hasTxCodes && (
                      <td className="font-mono-num px-3 py-2 text-slate-600 whitespace-nowrap">
                        {row.transactionCode || '—'}
                      </td>
                    )}
                    <td className="font-mono-num px-3 py-2 text-slate-600">
                      {row.sku}
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-900">
                      {row.name}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{row.category}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.branchName}
                    </td>
                    <td className="font-mono-num px-3 py-2 text-slate-600 whitespace-nowrap">
                      {row.saleMonth
                        ? `${MONTH_SHORT_MAP[row.saleMonth] ?? row.saleMonth} ${row.saleYear ?? defaultYear}`
                        : '—'}
                    </td>
                    <td className="font-mono-num px-3 py-2 text-right text-slate-800">
                      {formatRupiah(row.price)}
                    </td>
                    <td
                      className={`font-mono-num px-3 py-2 text-right font-bold ${
                        row.hasStockData === false
                          ? 'text-slate-400 font-normal'
                          : row.currentStock <= 0
                            ? 'text-rose-600'
                            : 'text-slate-900'
                      }`}
                    >
                      {row.hasStockData === false ? 'Tetap' : row.currentStock}
                    </td>
                    <td className="font-mono-num px-3 py-2 text-right text-slate-700">
                      {row.qtySold ? `${row.qtySold} pcs` : '—'}
                    </td>
                    <td className="font-mono-num px-3 py-2 text-right font-semibold text-emerald-700">
                      {row.qtySold
                        ? formatRupiah(
                            row.totalSales !== undefined
                              ? row.totalSales
                              : row.qtySold * row.price
                          )
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {previewRows.length > 100 && !showAllPreview && (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-center">
              <button
                type="button"
                onClick={() => setShowAllPreview(true)}
                className="text-xs font-bold text-[#1B8EE6] hover:underline"
              >
                Tampilkan semua {previewRows.length} baris (sedang menampilkan
                100 baris pertama)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
