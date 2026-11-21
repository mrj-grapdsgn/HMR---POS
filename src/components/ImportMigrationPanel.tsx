import { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { HIKEMORE_SEED_ROWS, MONTH_OPTIONS } from '../data/catalog';
import { Branch, ImportedCatalogRow } from '../types/pos';
import { formatRupiah } from '../utils/format';
import {
  fetchAndParseSheetUrl,
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
    includeSales: boolean
  ) => Promise<{
    branchesCreated: number;
    productsUpserted: number;
    stocksUpdated: number;
    salesLinesImported: number;
  }>;
  onNotify: (msg: string) => void;
}

export function ImportMigrationPanel({
  branches,
  hasLegacyCafe,
  onReplaceLegacyCafe,
  onImportRows,
  onNotify,
}: ImportMigrationPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sheetUrl, setSheetUrl] = useState('');
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

  const [previewRows, setPreviewRows] = useState<ImportedCatalogRow[]>([]);
  const [sourceLabel, setSourceLabel] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [migratingLegacy, setMigratingLegacy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

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
      if (parsed.rows.length === 0) {
        setErrorMsg(
          'Tidak ditemukan baris produk yang valid. Pastikan tabel memiliki kolom "Kode Item / SKU" dan "Nama Produk".'
        );
      } else {
        setPreviewRows(parsed.rows);
        setDefaultBranch(parsed.detectedBranch);
        setDefaultMonth(parsed.detectedMonth);
        setSourceLabel(file.name);
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
        defaultYear
      );
      if (parsed.rows.length === 0) {
        setErrorMsg(
          'Link berhasil dibuka tetapi tidak ditemukan kolom produk yang dikenali.'
        );
      } else {
        setPreviewRows(parsed.rows);
        setDefaultBranch(parsed.detectedBranch);
        setDefaultMonth(parsed.detectedMonth);
        setSourceLabel('Google Sheet CSV');
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Gagal mengambil data dari link Google Sheet (coba unduh sebagai .xlsx/.csv lalu unggah di atas).'
      );
    } finally {
      setParsing(false);
    }
  };

  const handleLoadHikemorePreset = () => {
    setErrorMsg(null);
    setResultMsg(null);
    setPreviewRows(HIKEMORE_SEED_ROWS);
    setDefaultBranch('CFD Senayan');
    setDefaultMonth(7);
    setDefaultYear(2026);
    setSourceLabel('Data Hikemore CFD Senayan (Juli)');
  };

  const handleCommitImport = async () => {
    if (previewRows.length === 0) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      const normalizedRows = previewRows.map((r) => ({
        ...r,
        branchName: r.branchName || defaultBranch || 'CFD Senayan',
        saleMonth: r.saleMonth || defaultMonth,
        saleYear: r.saleYear || defaultYear,
      }));
      const summary = await onImportRows(normalizedRows, includeSales);
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
      onNotify('Impor data ke Firebase berhasil');
      setPreviewRows([]);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menyimpan data impor.'
      );
    } finally {
      setSaving(false);
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
              contoh kafe tersebut dan langsung mengisi 13 produk Hikemore +
              stok CFD Senayan dari file Anda.
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
        {/* Upload Excel / CSV */}
        <div className="space-y-3.5 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Impor Produk, Stok & Penjualan dari Excel / CSV
              </h2>
              <p className="text-xs text-slate-500">
                Unggah file .xlsx atau .csv hasil ekspor Google Sheet. Setelah
                disimpan ke Firebase, link Google Sheet sudah tidak diperlukan
                lagi.
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
              disabled={parsing}
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
              onClick={handleLoadHikemorePreset}
              className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
              <span>Muat 13 Produk Hikemore (CFD Senayan)</span>
            </button>
          </div>

          <p className="text-[11px] text-slate-500">
            Kolom yang dikenali otomatis: <strong>Kode Item / SKU</strong>,{' '}
            <strong>Nama Produk</strong>, <strong>Kategori</strong>,{' '}
            <strong>Harga</strong>, <strong>Stok Awal</strong>,{' '}
            <strong>Sisa Stok</strong>, <strong>Cabang</strong>,{' '}
            <strong>Qty Terjual</strong>, dan <strong>Total Penjualan</strong>.
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
            Jika sheet Anda masih di Google Sheets (akses publik / Publish to
            Web CSV), tempel tautannya di sini untuk menyalin datanya ke
            Firebase lalu pensiunkan link tersebut.
          </p>
          <input
            type="url"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
          />
          <button
            type="submit"
            disabled={parsing || !sheetUrl.trim()}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
          >
            {parsing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            <span>Ambil Pratinjau dari Google Sheet</span>
          </button>
        </form>
      </div>

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

      {/* Preview Table Before Committing to Firebase */}
      {previewRows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <div className="text-xs font-bold text-slate-900">
                Pratinjau Data Siap Diimpor ({previewRows.length} baris ·{' '}
                {sourceLabel})
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
                onClick={() => setPreviewRows([])}
                className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
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
                  {saving ? 'Menyimpan ke Firebase...' : 'Simpan ke Firebase'}
                </span>
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-white text-[11px] text-slate-500">
                <tr>
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
                {previewRows.map((row, idx) => (
                  <tr key={`${row.sku}-${idx}`} className="hover:bg-slate-50">
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
        </div>
      )}
    </div>
  );
}
