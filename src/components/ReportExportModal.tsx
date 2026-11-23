import { useState } from 'react';
import { Building2, Calendar, Download, FileSpreadsheet, FileText, X } from 'lucide-react';
import { Branch, Product, SalesLine, SimpleTransaction, UserProfile } from '../types/pos';
import { exportSalesExcel, exportSalesPDF } from '../utils/reportExport';

interface ReportExportModalProps {
  profile: UserProfile | null;
  branches: Branch[];
  products: Product[];
  transactions: SimpleTransaction[];
  salesLines: SalesLine[];
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export function ReportExportModal({
  profile,
  branches,
  products,
  transactions,
  salesLines,
  onClose,
  onNotify,
}: ReportExportModalProps) {
  const [branchKey, setBranchKey] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [reportType, setReportType] = useState<'analysis' | 'transactions' | 'complete'>('complete');
  const [isExporting, setIsExporting] = useState(false);

  const storeName = profile?.storeName || 'Hikemore Store';
  const ownerName = profile?.displayName || 'Admin Utama';

  const selectedBranchLabel =
    branchKey === 'all'
      ? 'Semua Cabang (Konsolidasi)'
      : branches.find((b) => b.id === branchKey)?.name || 'Cabang Terpilih';

  const handlePdf = () => {
    setIsExporting(true);
    try {
      exportSalesPDF({
        storeName,
        ownerName,
        branchKey,
        branchLabel: selectedBranchLabel,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        reportType,
        transactions,
        salesLines,
        products,
        branches,
      });
      onNotify('Laporan PDF berhasil diunduh');
      onClose();
    } catch (err) {
      console.error(err);
      onNotify('Gagal membuat dokumen PDF');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExcel = () => {
    setIsExporting(true);
    try {
      exportSalesExcel({
        storeName,
        ownerName,
        branchKey,
        branchLabel: selectedBranchLabel,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        reportType,
        transactions,
        salesLines,
        products,
        branches,
      });
      onNotify('Laporan Excel (.xlsx) berhasil diunduh');
      onClose();
    } catch (err) {
      console.error(err);
      onNotify('Gagal membuat file Excel');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-[#0F172A]">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Ekspor Laporan & Analisis Penjualan</h3>
              <p className="text-xs text-slate-500">Unduh rekap pembukuan lengkap format PDF atau Excel (.xlsx)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {/* Branch Filter */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <Building2 className="h-4 w-4 text-[#0F172A]" />
              <span>Cabang / Outlet</span>
            </label>
            <select
              value={branchKey}
              onChange={(e) => setBranchKey(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 focus:border-[#0F172A] focus:outline-none"
            >
              <option value="all">Semua Cabang (Konsolidasi)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code || 'PST'})
                </option>
              ))}
            </select>
          </div>

          {/* Date Range Selection */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <Calendar className="h-4 w-4 text-[#0F172A]" />
                <span>Dari Tanggal</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 focus:border-[#0F172A] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <Calendar className="h-4 w-4 text-[#0F172A]" />
                <span>Sampai Tanggal</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 focus:border-[#0F172A] focus:outline-none"
              />
            </div>
          </div>

          {/* Report Type */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">Jenis Laporan</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setReportType('analysis')}
                className={`flex flex-col items-start rounded-xl border p-3 text-left transition-all ${
                  reportType === 'analysis'
                    ? 'border-[#0F172A] bg-slate-50/80 text-[#0F172A]'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="text-xs font-bold">Analisa Penjualan</span>
                <span className="mt-0.5 text-[10px] text-slate-500">Top produk & omset</span>
              </button>
              <button
                type="button"
                onClick={() => setReportType('transactions')}
                className={`flex flex-col items-start rounded-xl border p-3 text-left transition-all ${
                  reportType === 'transactions'
                    ? 'border-[#0F172A] bg-slate-50/80 text-[#0F172A]'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="text-xs font-bold">Report Transaksi</span>
                <span className="mt-0.5 text-[10px] text-slate-500">Daftar riwayat invoice</span>
              </button>
              <button
                type="button"
                onClick={() => setReportType('complete')}
                className={`flex flex-col items-start rounded-xl border p-3 text-left transition-all ${
                  reportType === 'complete'
                    ? 'border-[#0F172A] bg-slate-50/80 text-[#0F172A]'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="text-xs font-bold">Laporan Lengkap</span>
                <span className="mt-0.5 text-[10px] text-slate-500">Analisa + Report Transaksi</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleExcel}
            disabled={isExporting}
            className="flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span>Unduh Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={handlePdf}
            disabled={isExporting}
            className="flex h-10 items-center gap-2 rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white hover:bg-[#1E293B] transition-colors shadow-sm disabled:opacity-50"
          >
            <FileText className="h-4 w-4" />
            <span>Unduh PDF</span>
          </button>
        </div>
      </div>
    </div>
  );
}
