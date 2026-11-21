import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  Building2,
  ClipboardList,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Branch, BranchStock, Product, StockLog } from '../types/pos';
import { formatDateTime, formatNumber, formatRupiah } from '../utils/format';

interface InventoryBranchPanelProps {
  branches: Branch[];
  products: Product[];
  branchStocks: BranchStock[];
  stockLogs: StockLog[];
  activeBranchId: string | null;
  onSelectActiveBranch: (branchId: string) => void;
  onSaveBranch: (input: {
    id?: string;
    code: string;
    name: string;
    address: string;
    active: boolean;
  }) => Promise<void>;
  onDeleteBranch: (branchId: string) => Promise<void>;
  onAdjustStock: (params: {
    branchId: string;
    branchName: string;
    product: Product;
    mode: 'restock' | 'opname';
    qtyInput: number;
    initialStockOverride?: number;
    minThreshold?: number;
    note: string;
  }) => Promise<void>;
  onNotify: (msg: string) => void;
}

export function InventoryBranchPanel({
  branches,
  products,
  branchStocks,
  stockLogs,
  activeBranchId,
  onSelectActiveBranch,
  onSaveBranch,
  onDeleteBranch,
  onAdjustStock,
  onNotify,
}: InventoryBranchPanelProps) {
  const [viewBranchId, setViewBranchId] = useState<string>(
    activeBranchId ?? branches[0]?.id ?? ''
  );

  useEffect(() => {
    if (!viewBranchId && branches.length > 0) {
      setViewBranchId(activeBranchId ?? branches[0].id);
    } else if (
      viewBranchId &&
      branches.length > 0 &&
      !branches.some((b) => b.id === viewBranchId)
    ) {
      setViewBranchId(branches[0].id);
    }
  }, [branches, activeBranchId, viewBranchId]);

  // Branch form state
  const [branchEditId, setBranchEditId] = useState<string | undefined>(undefined);
  const [branchName, setBranchName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchActive, setBranchActive] = useState(true);
  const [branchSaving, setBranchSaving] = useState(false);

  // Stock filter state
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<
    'all' | 'zero' | 'low' | 'safe'
  >('all');

  // Stock modal state
  const [modalProduct, setModalProduct] = useState<Product | null>(null);
  const [modalMode, setModalMode] = useState<'restock' | 'opname'>('restock');
  const [modalQty, setModalQty] = useState('');
  const [modalInitial, setModalInitial] = useState('');
  const [modalThreshold, setModalThreshold] = useState('2');
  const [modalNote, setModalNote] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  const selectedBranch =
    branches.find((b) => b.id === viewBranchId) ?? branches[0] ?? null;

  const stockMapForBranch = useMemo(() => {
    const map = new Map<string, BranchStock>();
    if (!selectedBranch) return map;
    for (const s of branchStocks) {
      if (s.branchId === selectedBranch.id) {
        map.set(s.productId, s);
      }
    }
    return map;
  }, [branchStocks, selectedBranch]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .map((p) => {
        const st = stockMapForBranch.get(p.id);
        const currentStock = st?.currentStock ?? 0;
        const initialStock = st?.initialStock ?? 0;
        const minThreshold = st?.minThreshold ?? 2;
        return {
          product: p,
          currentStock,
          initialStock,
          minThreshold,
        };
      })
      .filter((r) => {
        if (stockFilter === 'zero' && r.currentStock > 0) return false;
        if (
          stockFilter === 'low' &&
          (r.currentStock <= 0 || r.currentStock > r.minThreshold)
        ) {
          return false;
        }
        if (stockFilter === 'safe' && r.currentStock <= r.minThreshold) {
          return false;
        }
        if (q) {
          return (
            r.product.name.toLowerCase().includes(q) ||
            r.product.sku.toLowerCase().includes(q) ||
            r.product.category.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [products, stockMapForBranch, search, stockFilter]);

  const summary = useMemo(() => {
    let totalUnits = 0;
    let zeroCount = 0;
    let lowCount = 0;
    for (const p of products) {
      const st = stockMapForBranch.get(p.id);
      const curr = st?.currentStock ?? 0;
      const min = st?.minThreshold ?? 2;
      totalUnits += curr;
      if (curr <= 0) zeroCount += 1;
      else if (curr <= min) lowCount += 1;
    }
    return { totalUnits, zeroCount, lowCount };
  }, [products, stockMapForBranch]);

  const branchLogs = useMemo(() => {
    if (!selectedBranch) return stockLogs.slice(0, 20);
    return stockLogs
      .filter((l) => l.branchId === selectedBranch.id)
      .slice(0, 20);
  }, [stockLogs, selectedBranch]);

  const resetBranchForm = () => {
    setBranchEditId(undefined);
    setBranchName('');
    setBranchCode('');
    setBranchAddress('');
    setBranchActive(true);
  };

  const handleBranchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName.trim()) return;
    setBranchSaving(true);
    try {
      await onSaveBranch({
        id: branchEditId,
        code: branchCode.trim(),
        name: branchName.trim(),
        address: branchAddress.trim(),
        active: branchActive,
      });
      onNotify(
        branchEditId ? 'Data cabang diperbarui' : 'Cabang baru ditambahkan'
      );
      resetBranchForm();
    } finally {
      setBranchSaving(false);
    }
  };

  const openStockModal = (product: Product, mode: 'restock' | 'opname') => {
    const st = stockMapForBranch.get(product.id);
    setModalProduct(product);
    setModalMode(mode);
    setModalQty(mode === 'restock' ? '10' : String(st?.currentStock ?? 0));
    setModalInitial(String(st?.initialStock ?? 0));
    setModalThreshold(String(st?.minThreshold ?? 2));
    setModalNote(
      mode === 'restock' ? 'Restok pengadaan barang' : 'Penyesuaian stok opname'
    );
  };

  const handleStockModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalProduct || !selectedBranch) return;
    setModalSaving(true);
    try {
      await onAdjustStock({
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        product: modalProduct,
        mode: modalMode,
        qtyInput: Math.max(0, parseInt(modalQty || '0', 10) || 0),
        initialStockOverride:
          modalMode === 'opname'
            ? Math.max(0, parseInt(modalInitial || '0', 10) || 0)
            : undefined,
        minThreshold: Math.max(0, parseInt(modalThreshold || '2', 10) || 0),
        note: modalNote,
      });
      onNotify(
        modalMode === 'restock'
          ? `Restok ${modalProduct.name} berhasil dicatat`
          : `Stok opname ${modalProduct.name} disimpan`
      );
      setModalProduct(null);
    } finally {
      setModalSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Section 1: Multi-Branch Management */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <form
          onSubmit={handleBranchSubmit}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Building2 className="h-4 w-4 text-[#1B8EE6]" />
              <span>{branchEditId ? 'Edit Cabang' : 'Tambah Cabang Baru'}</span>
            </h2>
            {branchEditId && (
              <button
                type="button"
                onClick={resetBranchForm}
                className="text-xs font-semibold text-[#1B8EE6] hover:underline"
              >
                Batal
              </button>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Nama Cabang / Outlet
            </label>
            <input
              type="text"
              required
              maxLength={80}
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="Contoh: CFD Senayan / Store Bekasi"
              className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">
                Kode Cabang
              </label>
              <input
                type="text"
                maxLength={24}
                value={branchCode}
                onChange={(e) => setBranchCode(e.target.value.toUpperCase())}
                placeholder="CFD-SENAYAN"
                className="font-mono-num h-9 w-full rounded-lg border border-slate-300 px-3 text-xs uppercase text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={branchActive}
                  onChange={(e) => setBranchActive(e.target.checked)}
                  className="h-4 w-4 accent-[#1B8EE6]"
                />
                <span>Cabang Aktif</span>
              </label>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">
              Lokasi / Catatan Alamat
            </label>
            <input
              type="text"
              maxLength={160}
              value={branchAddress}
              onChange={(e) => setBranchAddress(e.target.value)}
              placeholder="Opsional"
              className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={branchSaving}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[#1B8EE6] text-xs font-bold text-white hover:bg-[#1479C9] disabled:bg-slate-300"
          >
            <Plus className="h-4 w-4" />
            <span>
              {branchSaving
                ? 'Menyimpan...'
                : branchEditId
                  ? 'Simpan Perubahan'
                  : 'Tambah Cabang'}
            </span>
          </button>
        </form>

        {/* Branch List */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-8">
          <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold text-slate-700">
            Daftar Cabang Terdaftar ({branches.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Cabang</th>
                  <th className="px-3 py-2.5 font-semibold">Kode</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branches.map((b) => {
                  const isPosActive = b.id === activeBranchId;
                  return (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900">
                          {b.name}
                        </div>
                        {b.address && (
                          <div className="text-[11px] text-slate-400">
                            {b.address}
                          </div>
                        )}
                      </td>
                      <td className="font-mono-num px-3 py-2.5 text-slate-600">
                        {b.code}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`text-xs font-semibold ${
                            b.active ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {b.active ? 'Aktif' : 'Nonaktif'}
                        </span>
                        {isPosActive && (
                          <span className="ml-2 text-[11px] font-bold text-[#1B8EE6]">
                            · Aktif di POS
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setViewBranchId(b.id);
                              onSelectActiveBranch(b.id);
                              onNotify(`Cabang aktif POS diubah ke ${b.name}`);
                            }}
                            className="h-7 rounded-md border border-slate-300 px-2 text-[11px] font-semibold text-slate-700 hover:border-[#1B8EE6] hover:text-[#1B8EE6]"
                          >
                            Pilih di POS
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setBranchEditId(b.id);
                              setBranchName(b.name);
                              setBranchCode(b.code);
                              setBranchAddress(b.address);
                              setBranchActive(b.active);
                            }}
                            aria-label="Edit cabang"
                            className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {branches.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                void onDeleteBranch(b.id);
                                onNotify('Cabang dihapus');
                              }}
                              aria-label="Hapus cabang"
                              className="flex h-7 w-7 items-center justify-center rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Section 2: Per-Branch Stock Inventory Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-xs font-bold text-slate-900">
              Stok Produk Cabang:
            </h3>
            <select
              value={selectedBranch?.id ?? ''}
              onChange={(e) => setViewBranchId(e.target.value)}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-[#1B8EE6] focus:border-[#1B8EE6] focus:outline-none"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">
              Total Sisa: <strong className="font-mono-num text-slate-900">{formatNumber(summary.totalUnits)} pcs</strong> ·{' '}
              <span className="text-rose-600 font-semibold">{summary.zeroCount} Habis</span> ·{' '}
              <span className="text-amber-600 font-semibold">{summary.lowCount} Menipis</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
              {(
                [
                  { id: 'all', label: 'Semua' },
                  { id: 'zero', label: 'Habis (0)' },
                  { id: 'low', label: 'Menipis' },
                  { id: 'safe', label: 'Aman' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStockFilter(f.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    stockFilter === f.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari produk / SKU..."
                className="h-8 w-48 rounded-lg border border-slate-300 pr-2.5 pl-8 text-xs focus:border-[#1B8EE6] focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Produk & Kode Item</th>
                <th className="px-3 py-2.5 font-semibold">Kategori</th>
                <th className="px-3 py-2.5 text-right font-semibold">Harga</th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  Stok Awal
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  Sisa Stok
                </th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">
                  Kelola Stok
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-slate-400"
                  >
                    Tidak ada produk yang cocok dengan filter stok ini.
                  </td>
                </tr>
              ) : (
                rows.map(({ product, currentStock, initialStock, minThreshold }) => {
                  const statusText =
                    currentStock <= 0
                      ? 'Habis (Tidak bisa dijual)'
                      : currentStock <= minThreshold
                        ? 'Stok Menipis'
                        : 'Stok Aman';
                  const statusClass =
                    currentStock <= 0
                      ? 'text-rose-600 font-bold'
                      : currentStock <= minThreshold
                        ? 'text-amber-600 font-semibold'
                        : 'text-emerald-700 font-semibold';

                  return (
                    <tr key={product.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-900">
                          {product.name}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-400">
                          {product.sku}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">
                        {product.category}
                      </td>
                      <td className="font-mono-num px-3 py-2.5 text-right text-slate-700 whitespace-nowrap">
                        {formatRupiah(product.price)}
                      </td>
                      <td className="font-mono-num px-3 py-2.5 text-right text-slate-600 whitespace-nowrap">
                        {initialStock} pcs
                      </td>
                      <td
                        className={`font-mono-num px-3 py-2.5 text-right font-bold whitespace-nowrap ${
                          currentStock <= 0
                            ? 'text-rose-600'
                            : currentStock <= minThreshold
                              ? 'text-amber-600'
                              : 'text-slate-900'
                        }`}
                      >
                        {currentStock} pcs
                      </td>
                      <td className={`px-3 py-2.5 text-[11px] ${statusClass}`}>
                        {statusText}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openStockModal(product, 'restock')}
                            className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                          >
                            <PackagePlus className="h-3.5 w-3.5" />
                            <span>Restok</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openStockModal(product, 'opname')}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <ArrowDownUp className="h-3 w-3" />
                            <span>Opname</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 3: Recent Stock Mutation Logs */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 text-xs font-bold text-slate-700">
          <ClipboardList className="h-4 w-4 text-slate-500" />
          <span>
            Riwayat Mutasi Stok Terbaru ({selectedBranch?.name ?? 'Semua'})
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Waktu</th>
                <th className="px-3 py-2 font-semibold">Produk</th>
                <th className="px-3 py-2 font-semibold">Jenis</th>
                <th className="px-3 py-2 text-right font-semibold">Perubahan</th>
                <th className="px-3 py-2 text-right font-semibold">
                  Sebelum → Sesudah
                </th>
                <th className="px-4 py-2 font-semibold">Catatan & Operator</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {branchLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-slate-400"
                  >
                    Belum ada riwayat mutasi stok untuk cabang ini.
                  </td>
                </tr>
              ) : (
                branchLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-[11px] text-slate-500 whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-900">
                        {log.productName}
                      </div>
                      <div className="font-mono-num text-[11px] text-slate-400">
                        {log.productSku}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px] font-semibold text-slate-600 uppercase">
                      {log.type}
                    </td>
                    <td
                      className={`font-mono-num px-3 py-2 text-right font-bold whitespace-nowrap ${
                        log.qtyDelta > 0
                          ? 'text-emerald-700'
                          : log.qtyDelta < 0
                            ? 'text-rose-600'
                            : 'text-slate-500'
                      }`}
                    >
                      {log.qtyDelta > 0 ? `+${log.qtyDelta}` : log.qtyDelta} pcs
                    </td>
                    <td className="font-mono-num px-3 py-2 text-right text-slate-600 whitespace-nowrap">
                      {log.stockBefore} → {log.stockAfter}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-slate-600">
                      {log.note} ·{' '}
                      <span className="font-semibold text-slate-800">
                        {log.actorName}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Restock / Opname Modal */}
      {modalProduct && selectedBranch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-[1px]">
          <form
            onSubmit={handleStockModalSubmit}
            className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between bg-[#1B8EE6] px-5 py-3.5 text-white">
              <h3 className="text-sm font-bold">
                {modalMode === 'restock'
                  ? `Restok Masuk — ${selectedBranch.name}`
                  : `Stok Opname — ${selectedBranch.name}`}
              </h3>
              <button
                type="button"
                onClick={() => setModalProduct(null)}
                aria-label="Tutup"
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3.5 p-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-bold text-slate-900">
                  {modalProduct.name}
                </div>
                <div className="font-mono-num mt-0.5 text-[11px] text-slate-500">
                  {modalProduct.sku} · Sisa saat ini:{' '}
                  <strong>
                    {stockMapForBranch.get(modalProduct.id)?.currentStock ?? 0}{' '}
                    pcs
                  </strong>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  {modalMode === 'restock'
                    ? 'Tambah Jumlah Stok Masuk (pcs)'
                    : 'Set Sisa Stok Aktual (pcs)'}
                </label>
                <input
                  type="number"
                  required
                  min={modalMode === 'restock' ? 1 : 0}
                  max={1000000}
                  value={modalQty}
                  onChange={(e) => setModalQty(e.target.value)}
                  className="font-mono-num h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                />
              </div>

              {modalMode === 'opname' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Stok Awal Periode (pcs)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={1000000}
                      value={modalInitial}
                      onChange={(e) => setModalInitial(e.target.value)}
                      className="font-mono-num h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Batas Minimum Alert
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      value={modalThreshold}
                      onChange={(e) => setModalThreshold(e.target.value)}
                      className="font-mono-num h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Catatan
                </label>
                <input
                  type="text"
                  maxLength={160}
                  value={modalNote}
                  onChange={(e) => setModalNote(e.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setModalProduct(null)}
                className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={modalSaving}
                className="h-9 rounded-lg bg-[#4CAF50] px-4 text-xs font-bold text-white hover:bg-[#43A047] disabled:bg-slate-300"
              >
                {modalSaving ? 'Menyimpan...' : 'Simpan Stok'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
