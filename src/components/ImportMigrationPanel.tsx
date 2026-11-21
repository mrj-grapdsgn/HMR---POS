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
  mergeSelectedTabs,
  parseSpreadsheetFile,
} from '../utils/spreadsheetImport';

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
    onProgress?: (progress: ImportProgress) => void
  ) => Promise<{
    branchesCreated: number;
    productsUpserted: number;
    stocksUpdated: number;
    salesLinesImported: number;
  }>;
  onNotify: (msg: string) => void;
}

const TAB_KIND_LABEL: Record<ParsedSheetTab['kind'], string> = {
  catalog: 'Katalog & Stok',
  sales: 'Penjualan',
  dashboard: 'Dasbor Ringkasan',
  unknown: 'Lainnya',
};

export function ImportMigrationPanel({
  branches,
  hasLegacyCafe,
  onReplaceLegacyCafe,
  onImportRows,
  onNotify,
}: ImportMigrationPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetTabName, setSheetTabName] = useState('monitoring_stok');
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
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [migratingLegacy, setMigratingLegacy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const previewRows = useMemo(() => {
    if (manualRows) return manualRows;
    if (parsedTabs.length === 0) return [];
    return mergeSelectedTabs(parsedTabs, selectedTabNames);
  }, [manualRows, parsedTabs, selectedTabNames]);

  const uniqueSkuCount = useMemo(() => {
    return new Set(previewRows.map((r) => r.sku.toLowerCase())).size;
  }, [previewRows]);

  const directXlsxFromInput = useMemo(() => {
    const info = extractGoogleSheetInfo(sheetUrl);
    return info.sheetId
      ? `https://docs.google.com/spreadsheets/d/${info.sheetId}/export?format=xlsx`
      : null;
  }, [sheetUrl]);

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
      const parsed = await fetchAndParseSheetUrl(
        sheetUrl,
        defaultBranch,
        defaultMonth,
        defaultYear,
        sheetTabName
      );
      if (parsed.tabs.length === 0 || parsed.rows.length === 0) {
        setErrorMsg(
          'Link berhasil dibuka tetapi tidak ditemukan kolom produk yang dikenali. Coba isi "Nama Tab / Sheet" sesuai tab daftar produk Anda, atau unduh file sebagai .xlsx.'
        );
      } else {
        const formatLabel =
          parsed.fetchedFormat === 'xlsx'
            ? `Google Sheet (${parsed.tabs.length} tab)`
            : sheetTabName.trim()
              ? `Google Sheet · Tab "${sheetTabName.trim()}"`
              : 'Google Sheet (1 tab CSV)';
        applyWorkbookResult(parsed, formatLabel);
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
      stage: 'Memulai impor ke Firebase...',
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
        (prog) => setProgress(prog)
      );
      const msg = `Berhasil disimpan ke Firebase: ${summary.productsUpserted} produk, ${summary.stocksUpdated} stok cabang${
        summary.branchesCreated > 0
          ? `, ${summary.branchesCreated} cabang baru`
          : ''
      }${
        summary.salesLinesImported > 0
          ? `, ${summary.salesLinesImported} baris penjualan`
          : ''
      }.`;
      setResultMsg(msg);
      onNotify(`Impor selesai (${summary.productsUpserted} produk tersimpan)`);
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
        <div className="space-y-3.5 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Impor Semua Tab dari Excel (.xlsx) / CSV
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                <strong>Cara terbaik untuk banyak produk & banyak tab:</strong>{' '}
                di Google Sheets klik{' '}
                <span className="font-semibold text-slate-700">
                  File → Download → Microsoft Excel (.xlsx)
                </span>
                , lalu unggah file tersebut di sini. Semua tab (Master Produk,
                Stok Cabang, Penjualan) akan dibaca sekaligus.
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
                Bulan Data Penjualan
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
                Tahun
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
              <span>Muat 13 Produk Awal (CFD Senayan)</span>
            </button>
          </div>

          <p className="text-[11px] text-slate-500">
            Kolom yang dikenali otomatis: <strong>Kode Item / SKU</strong>,{' '}
            <strong>Nama Produk</strong>, <strong>Kategori</strong>,{' '}
            <strong>Harga</strong>, <strong>Stok Awal</strong>,{' '}
            <strong>Sisa Stok</strong>, <strong>Cabang</strong>,{' '}
            <strong>Tanggal / Bulan</strong>, <strong>Qty Terjual</strong>, dan{' '}
            <strong>Total Penjualan</strong>.
          </p>
        </div>

        {/* One-Time Google Sheet Link Import */}
        <form
          onSubmit={handleFetchSheetUrl}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5"
        >
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Link2 className="h-4 w-4 text-[#1B8EE6]" />
            <span>Tarik Sekali dari Link Google Sheet</span>
          </h3>
          <p className="text-xs text-slate-500">
            Tempel link Google Sheet Anda. Jika tab pertama adalah Dasbor
            (hanya 13 produk), isi <strong>Nama Tab</strong> daftar produk
            lengkap Anda di bawah atau unduh semua tab sebagai{' '}
            <strong>.xlsx</strong>.
          </p>
          <div className="space-y-2">
            <input
              type="url"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
            />
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-[11px] font-semibold text-slate-600">
                  Nama Tab / Sheet Spesifik (Opsional)
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSheetTabName('monitoring_stok')}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                      sheetTabName === 'monitoring_stok'
                        ? 'bg-[#1B8EE6] text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    monitoring_stok
                  </button>
                  {sheetTabName && (
                    <button
                      type="button"
                      onClick={() => setSheetTabName('')}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-200"
                    >
                      Semua Tab
                    </button>
                  )}
                </div>
              </div>
              <input
                type="text"
                value={sheetTabName}
                onChange={(e) => setSheetTabName(e.target.value)}
                placeholder="Contoh: monitoring_stok, Master Produk, atau Transaksi"
                className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="submit"
              disabled={parsing || saving || !sheetUrl.trim()}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {parsing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              <span>Ambil Pratinjau</span>
            </button>

            {directXlsxFromInput && (
              <a
                href={directXlsxFromInput}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[#1B8EE6] bg-sky-50 px-3 text-xs font-bold text-[#1B8EE6] hover:bg-sky-100 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Unduh Semua Tab (.xlsx)</span>
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
                  : 'Catatan Multi-Tab Google Sheet'}
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

      {/* Live Save Progress Banner */}
      {saving && progress && (
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

      {/* Multi-Tab Sheet Selector (when workbook has > 1 detected tab) */}
      {parsedTabs.length > 1 && (
        <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
              <Layers className="h-4 w-4 text-[#1B8EE6]" />
              <span>
                Pilih Tab Spreadsheet yang Ingin Diimpor ({parsedTabs.length}{' '}
                tab terdeteksi)
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              Tab Dasbor Ringkasan otomatis tidak dicentang agar tidak duplikat
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {parsedTabs.map((tab) => {
              const checked = selectedTabNames.includes(tab.sheetName);
              return (
                <label
                  key={tab.sheetName}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                    checked
                      ? 'border-[#1B8EE6] bg-sky-50 text-slate-900'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTabSelection(tab.sheetName)}
                    className="h-3.5 w-3.5 accent-[#1B8EE6]"
                  />
                  <span className="font-bold">{tab.sheetName}</span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200">
                    {TAB_KIND_LABEL[tab.kind]} · {tab.rows.length} baris
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview Table Before Committing to Firebase */}
      {previewRows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <div className="text-xs font-bold text-slate-900">
                Pratinjau Data Siap Diimpor ({previewRows.length} baris ·{' '}
                {uniqueSkuCount} produk unik · {sourceLabel})
              </div>
              <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={includeSales}
                  onChange={(e) => setIncludeSales(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#1B8EE6]"
                />
                <span>
                  Sertakan kolom Qty Terjual & Total Penjualan ke Dasbor Rekapan
                  & Restok
                </span>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={clearPreview}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleCommitImport}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-[#4CAF50] px-4 text-xs font-bold text-white hover:bg-[#43A047] disabled:bg-slate-300"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>
                  {saving
                    ? 'Menyimpan ke Firebase...'
                    : `Simpan ${uniqueSkuCount} Produk ke Firebase`}
                </span>
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-white text-[11px] text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">#</th>
                  <th className="px-3 py-2 font-semibold">Kode Item</th>
                  <th className="px-3 py-2 font-semibold">Nama Produk</th>
                  <th className="px-3 py-2 font-semibold">Kategori</th>
                  <th className="px-3 py-2 font-semibold">Cabang</th>
                  <th className="px-3 py-2 text-right font-semibold">Harga</th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Stok Awal
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Sisa Stok
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    Terjual
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visiblePreviewRows.map((row, idx) => (
                  <tr
                    key={`${row.branchName}-${row.sku}-${row.saleYear ?? ''}-${row.saleMonth ?? ''}-${idx}`}
                    className="hover:bg-slate-50"
                  >
                    <td className="font-mono-num px-3 py-2 text-slate-400">
                      {idx + 1}
                    </td>
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
                    <td className="font-mono-num px-3 py-2 text-right text-slate-800">
                      {formatRupiah(row.price)}
                    </td>
                    <td className="font-mono-num px-3 py-2 text-right text-slate-600">
                      {row.initialStock}
                    </td>
                    <td
                      className={`font-mono-num px-3 py-2 text-right font-bold ${
                        row.currentStock <= 0
                          ? 'text-rose-600'
                          : 'text-slate-900'
                      }`}
                    >
                      {row.currentStock}
                    </td>
                    <td className="font-mono-num px-3 py-2 text-right text-slate-600">
                      {row.qtySold ? `${row.qtySold} pcs` : '—'}
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
