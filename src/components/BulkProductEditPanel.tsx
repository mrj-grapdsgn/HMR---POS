import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  Layers,
  Loader2,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { BulkPriceStockUpdateItem } from '../services/posRepository';
import { Branch, BranchStock, Product } from '../types/pos';
import { formatNumber, formatRupiah } from '../utils/format';

type BulkAdjustMode = 'none' | 'set' | 'add' | 'sub' | 'pct_inc' | 'pct_dec';

interface DraftEdit {
  price?: number;
  stock?: number;
}

interface BulkProductEditPanelProps {
  products: Product[];
  branches: Branch[];
  branchStocks: BranchStock[];
  activeBranchId: string | null;
  categories: string[];
  onSaveBulk: (params: {
    branchId: string;
    branchName: string;
    items: BulkPriceStockUpdateItem[];
  }) => Promise<{
    updatedPrices: number;
    updatedStocks: number;
    totalTouchedProducts: number;
  }>;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

const MAX_PRICE = 1000000000;
const MAX_STOCK = 1000000;

function applyAdjustment(
  currentValue: number,
  mode: BulkAdjustMode,
  rawAmount: number,
  maxLimit: number
): number {
  const amt = Math.max(0, Number.isFinite(rawAmount) ? rawAmount : 0);
  let next = currentValue;
  switch (mode) {
    case 'set':
      next = amt;
      break;
    case 'add':
      next = currentValue + amt;
      break;
    case 'sub':
      next = currentValue - amt;
      break;
    case 'pct_inc':
      next = currentValue * (1 + amt / 100);
      break;
    case 'pct_dec':
      next = currentValue * (1 - amt / 100);
      break;
    default:
      return currentValue;
  }
  return Math.min(maxLimit, Math.max(0, Math.round(next)));
}

export function BulkProductEditPanel({
  products,
  branches,
  branchStocks,
  activeBranchId,
  categories,
  onSaveBulk,
  onClose,
  onNotify,
}: BulkProductEditPanelProps) {
  const defaultBranchId = useMemo(
    () => activeBranchId || branches[0]?.id || '',
    [activeBranchId, branches]
  );

  const [targetBranchId, setTargetBranchId] = useState<string>(defaultBranchId);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [viewFilter, setViewFilter] = useState<'all' | 'changed'>('all');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [draftEdits, setDraftEdits] = useState<Record<string, DraftEdit>>({});

  // Batch action controls for selected rows
  const [priceMode, setPriceMode] = useState<BulkAdjustMode>('none');
  const [priceValue, setPriceValue] = useState<string>('');
  const [stockMode, setStockMode] = useState<BulkAdjustMode>('none');
  const [stockValue, setStockValue] = useState<string>('');
  const [batchAppliedHint, setBatchAppliedHint] = useState<string | null>(null);

  // Guard prompts (inline, never window.confirm)
  const [pendingBranchSwitchId, setPendingBranchSwitchId] = useState<
    string | null
  >(null);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectAllRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!targetBranchId && defaultBranchId) {
      setTargetBranchId(defaultBranchId);
    }
  }, [defaultBranchId, targetBranchId]);

  const targetBranch = useMemo(
    () => branches.find((b) => b.id === targetBranchId) ?? branches[0] ?? null,
    [branches, targetBranchId]
  );

  // Live stock balance per product for target branch
  const baseStockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    if (!targetBranch) return map;
    for (const st of branchStocks) {
      if (st.branchId === targetBranch.id) {
        map.set(st.productId, st.currentStock);
      }
    }
    return map;
  }, [branchStocks, targetBranch]);

  // Compute dirty stats strictly against live values
  const dirtySummary = useMemo(() => {
    let priceChanges = 0;
    let stockChanges = 0;
    let changedProducts = 0;
    const dirtyProductIds = new Set<string>();

    for (const p of products) {
      const draft = draftEdits[p.id];
      if (!draft) continue;
      const baseStock = baseStockByProduct.get(p.id) ?? 0;
      const isPriceDirty = draft.price !== undefined && draft.price !== p.price;
      const isStockDirty =
        Boolean(targetBranch) &&
        draft.stock !== undefined &&
        draft.stock !== baseStock;

      if (isPriceDirty) priceChanges += 1;
      if (isStockDirty) stockChanges += 1;
      if (isPriceDirty || isStockDirty) {
        changedProducts += 1;
        dirtyProductIds.add(p.id);
      }
    }

    return {
      priceChanges,
      stockChanges,
      changedProducts,
      dirtyProductIds,
    };
  }, [products, draftEdits, baseStockByProduct, targetBranch]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) {
        return false;
      }
      if (viewFilter === 'changed' && !dirtySummary.dirtyProductIds.has(p.id)) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [
    products,
    searchQuery,
    selectedCategory,
    viewFilter,
    dirtySummary.dirtyProductIds,
  ]);

  // Selection helpers scoped to visible filtered products
  const visibleSelectedCount = useMemo(
    () => filteredProducts.reduce((n, p) => n + (selectedIds.has(p.id) ? 1 : 0), 0),
    [filteredProducts, selectedIds]
  );
  const allVisibleSelected =
    filteredProducts.length > 0 &&
    visibleSelectedCount === filteredProducts.length;
  const someVisibleSelected =
    visibleSelectedCount > 0 && visibleSelectedCount < filteredProducts.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredProducts.forEach((p) => next.delete(p.id));
      } else {
        filteredProducts.forEach((p) => next.add(p.id));
      }
      return next;
    });
  };

  const toggleSelectRow = (productId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const updateRowDraft = (
    product: Product,
    field: 'price' | 'stock',
    rawValue: string
  ) => {
    const parsed = rawValue === '' ? 0 : parseInt(rawValue, 10);
    const clamped =
      field === 'price'
        ? Math.min(MAX_PRICE, Math.max(0, Number.isNaN(parsed) ? 0 : parsed))
        : Math.min(MAX_STOCK, Math.max(0, Number.isNaN(parsed) ? 0 : parsed));

    const baseVal =
      field === 'price'
        ? product.price
        : (baseStockByProduct.get(product.id) ?? 0);

    setDraftEdits((prev) => {
      const current = prev[product.id] ?? {};
      const nextEntry: DraftEdit = { ...current };
      if (clamped === baseVal) {
        delete nextEntry[field];
      } else {
        nextEntry[field] = clamped;
      }

      const nextAll = { ...prev };
      if (nextEntry.price === undefined && nextEntry.stock === undefined) {
        delete nextAll[product.id];
      } else {
        nextAll[product.id] = nextEntry;
      }
      return nextAll;
    });
    setSaveError(null);
  };

  const resetRowDraft = (productId: string) => {
    setDraftEdits((prev) => {
      if (!prev[productId]) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  const resetAllDrafts = () => {
    setDraftEdits({});
    setBatchAppliedHint(null);
    setSaveError(null);
    setConfirmExitOpen(false);
    setPendingBranchSwitchId(null);
  };

  const handleRequestBranchChange = (nextBranchId: string) => {
    if (nextBranchId === targetBranchId) return;
    if (dirtySummary.stockChanges > 0) {
      setPendingBranchSwitchId(nextBranchId);
      return;
    }
    setTargetBranchId(nextBranchId);
  };

  const confirmBranchSwitch = () => {
    if (!pendingBranchSwitchId) return;
    // Discard only stock drafts, keep price drafts intact!
    setDraftEdits((prev) => {
      const next: Record<string, DraftEdit> = {};
      for (const [prodId, entry] of Object.entries(prev)) {
        if (entry.price !== undefined) {
          next[prodId] = { price: entry.price };
        }
      }
      return next;
    });
    setTargetBranchId(pendingBranchSwitchId);
    setPendingBranchSwitchId(null);
  };

  const handleRequestExit = () => {
    if (dirtySummary.changedProducts > 0) {
      setConfirmExitOpen(true);
      return;
    }
    onClose();
  };

  const canApplyBatch = useMemo(() => {
    if (selectedIds.size === 0) return false;
    const priceReady =
      priceMode !== 'none' &&
      priceValue.trim() !== '' &&
      !Number.isNaN(Number(priceValue)) &&
      Number(priceValue) >= 0;
    const stockReady =
      Boolean(targetBranch) &&
      stockMode !== 'none' &&
      stockValue.trim() !== '' &&
      !Number.isNaN(Number(stockValue)) &&
      Number(stockValue) >= 0;
    return priceReady || stockReady;
  }, [
    selectedIds.size,
    priceMode,
    priceValue,
    stockMode,
    stockValue,
    targetBranch,
  ]);

  const handleApplyBatchToDraft = () => {
    if (!canApplyBatch) return;
    const priceAmt = Number(priceValue);
    const stockAmt = Number(stockValue);
    const applyPrice =
      priceMode !== 'none' &&
      priceValue.trim() !== '' &&
      !Number.isNaN(priceAmt) &&
      priceAmt >= 0;
    const applyStock =
      Boolean(targetBranch) &&
      stockMode !== 'none' &&
      stockValue.trim() !== '' &&
      !Number.isNaN(stockAmt) &&
      stockAmt >= 0;

    let appliedCount = 0;

    setDraftEdits((prev) => {
      const next = { ...prev };
      for (const p of products) {
        if (!selectedIds.has(p.id)) continue;
        const currentDraft = next[p.id] ?? {};
        const effectivePrice = currentDraft.price ?? p.price;
        const baseStock = baseStockByProduct.get(p.id) ?? 0;
        const effectiveStock = currentDraft.stock ?? baseStock;

        const updatedEntry: DraftEdit = { ...currentDraft };

        if (applyPrice) {
          const nextPrice = applyAdjustment(
            effectivePrice,
            priceMode,
            priceAmt,
            MAX_PRICE
          );
          if (nextPrice === p.price) {
            delete updatedEntry.price;
          } else {
            updatedEntry.price = nextPrice;
          }
        }

        if (applyStock) {
          const nextStock = applyAdjustment(
            effectiveStock,
            stockMode,
            stockAmt,
            MAX_STOCK
          );
          if (nextStock === baseStock) {
            delete updatedEntry.stock;
          } else {
            updatedEntry.stock = nextStock;
          }
        }

        if (updatedEntry.price === undefined && updatedEntry.stock === undefined) {
          delete next[p.id];
        } else {
          next[p.id] = updatedEntry;
        }
        appliedCount += 1;
      }
      return next;
    });

    setSaveError(null);
    setBatchAppliedHint(
      `Draf diperbarui untuk ${appliedCount} produk terpilih — periksa pratinjau di tabel lalu klik Simpan Perubahan.`
    );
  };

  const handleSaveAll = async () => {
    if (dirtySummary.changedProducts === 0 || saving) return;

    const items: BulkPriceStockUpdateItem[] = [];
    for (const p of products) {
      const draft = draftEdits[p.id];
      if (!draft) continue;
      const baseStock = baseStockByProduct.get(p.id) ?? 0;
      const priceChanged =
        draft.price !== undefined && draft.price !== p.price;
      const stockChanged =
        Boolean(targetBranch) &&
        draft.stock !== undefined &&
        draft.stock !== baseStock;

      if (priceChanged || stockChanged) {
        items.push({
          product: p,
          newPrice: priceChanged ? draft.price : undefined,
          newStock: stockChanged ? draft.stock : undefined,
        });
      }
    }

    if (items.length === 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      const res = await onSaveBulk({
        branchId: targetBranch?.id ?? '',
        branchName: targetBranch?.name ?? 'Cabang',
        items,
      });

      const parts: string[] = [];
      if (res.updatedPrices > 0) parts.push(`${res.updatedPrices} harga`);
      if (res.updatedStocks > 0) {
        parts.push(
          `${res.updatedStocks} stok (${targetBranch?.name ?? 'Cabang'})`
        );
      }

      setDraftEdits({});
      setSelectedIds(new Set());
      setPriceMode('none');
      setPriceValue('');
      setStockMode('none');
      setStockValue('');
      setBatchAppliedHint(null);
      setViewFilter('all');
      onNotify(
        `Edit massal berhasil disimpan: ${parts.join(' dan ')} diperbarui.`
      );
    } catch (err) {
      console.error(err);
      setSaveError(
        err instanceof Error
          ? err.message
          : 'Gagal menyimpan perubahan massal ke database.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    col: 'stock' | 'price'
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const nextInput = document.querySelector<HTMLInputElement>(
        `input[data-bulk-cell="${col}-${rowIndex + 1}"]`
      );
      if (nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    }
  };

  const pendingTargetBranchName = useMemo(
    () =>
      branches.find((b) => b.id === pendingBranchSwitchId)?.name ?? 'cabang lain',
    [branches, pendingBranchSwitchId]
  );

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 shrink-0 text-[#0F172A]" />
            <h2 className="text-sm font-bold text-slate-900">
              Edit Massal Harga & Stok
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Hanya mengubah harga jual dan stok cabang terpilih · Nama, SKU, dan
            kategori produk terkunci aman
          </p>
        </div>

        <button
          type="button"
          onClick={handleRequestExit}
          disabled={saving}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Kembali ke Daftar Produk</span>
        </button>
      </div>

      {/* Inline Guard Banner: Confirm Exit with Unsaved Changes */}
      {confirmExitOpen && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Masih ada{' '}
              <strong className="font-mono-num">
                {dirtySummary.changedProducts}
              </strong>{' '}
              produk dengan perubahan draf yang belum disimpan. Keluar sekarang
              akan membatalkan draf tersebut.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmExitOpen(false)}
              className="h-8 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap"
            >
              Tetap di Sini
            </button>
            <button
              type="button"
              onClick={() => {
                resetAllDrafts();
                onClose();
              }}
              className="h-8 rounded-lg bg-[#0F172A] px-3 text-xs font-bold text-white hover:bg-[#1E293B] whitespace-nowrap"
            >
              Buang Draf & Keluar
            </button>
          </div>
        </div>
      )}

      {/* Inline Guard Banner: Confirm Branch Switch with Unsaved Stock Drafts */}
      {pendingBranchSwitchId && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Ada{' '}
              <strong className="font-mono-num">
                {dirtySummary.stockChanges}
              </strong>{' '}
              perubahan stok belum disimpan untuk{' '}
              <strong>{targetBranch?.name}</strong>. Pindah ke{' '}
              <strong>{pendingTargetBranchName}</strong> akan mereset draf stok
              (draf harga tetap dipertahankan).
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPendingBranchSwitchId(null)}
              className="h-8 rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={confirmBranchSwitch}
              className="h-8 rounded-lg bg-[#0F172A] px-3 text-xs font-bold text-white hover:bg-[#1E293B] whitespace-nowrap"
            >
              Buang Draf Stok & Pindah
            </button>
          </div>
        </div>
      )}

      {/* Toolbar: Target Branch, Category Filter, Search, View Segmented Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Target Branch Selector */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="bulk-target-branch"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 whitespace-nowrap"
            >
              <Building2 className="h-3.5 w-3.5 text-slate-500" />
              <span>Cabang Stok:</span>
            </label>
            {branches.length > 0 ? (
              <select
                id="bulk-target-branch"
                value={targetBranch?.id ?? ''}
                onChange={(e) => handleRequestBranchChange(e.target.value)}
                disabled={saving}
                className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-900 focus:border-[#0F172A] focus:outline-none"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs font-semibold text-rose-600">
                Belum ada cabang
              </span>
            )}
          </div>

          {/* Category Filter */}
          <select
            aria-label="Filter kategori produk"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 focus:border-[#0F172A] focus:outline-none"
          >
            <option value="ALL">Semua Kategori ({products.length})</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          {/* Segmented View Filter */}
          <div className="inline-flex items-center rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setViewFilter('all')}
              className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                viewFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Semua ({products.length})
            </button>
            <button
              type="button"
              onClick={() => setViewFilter('changed')}
              className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap tabular-nums ${
                viewFilter === 'changed'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Diubah ({dirtySummary.changedProducts})
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama produk atau SKU..."
            className="h-9 w-full rounded-lg border border-slate-300 pr-8 pl-8 text-xs text-slate-900 focus:border-[#0F172A] focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Hapus pencarian"
              onClick={() => setSearchQuery('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Batch Action Panel (Simultaneous Apply for Checked Products) */}
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        {selectedIds.size === 0 ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>
              Ketik langsung pada kolom <strong>Stok</strong> atau{' '}
              <strong>Harga</strong> di tabel, atau{' '}
              <strong>centang beberapa produk</strong> untuk menerapkan
              perubahan serentak (nilai tetap, tambah/kurang, atau persentase).
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#0F172A]" />
                <span className="font-bold text-slate-900 tabular-nums">
                  Aksi Serentak · {selectedIds.size} produk dipilih
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline whitespace-nowrap"
              >
                Batalkan Pilihan
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-end">
              {/* Batch Price Control */}
              <div className="space-y-1 lg:col-span-5">
                <label className="block text-[11px] font-bold text-slate-600">
                  Penyesuaian Harga Serentak
                </label>
                <div className="flex gap-2">
                  <select
                    aria-label="Metode ubah harga serentak"
                    value={priceMode}
                    onChange={(e) => {
                      setPriceMode(e.target.value as BulkAdjustMode);
                      setBatchAppliedHint(null);
                    }}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:border-[#0F172A] focus:outline-none"
                  >
                    <option value="none">Tidak diubah</option>
                    <option value="set">Set harga tetap (Rp)</option>
                    <option value="add">Tambah nominal (+Rp)</option>
                    <option value="sub">Kurangi nominal (-Rp)</option>
                    <option value="pct_inc">Naikkan persen (+%)</option>
                    <option value="pct_dec">Turunkan persen (-%)</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={
                      priceMode === 'pct_inc' || priceMode === 'pct_dec'
                        ? 1000
                        : MAX_PRICE
                    }
                    step="any"
                    disabled={priceMode === 'none'}
                    value={priceValue}
                    onChange={(e) => setPriceValue(e.target.value)}
                    placeholder={
                      priceMode === 'pct_inc' || priceMode === 'pct_dec'
                        ? 'Contoh: 10'
                        : 'Contoh: 250000'
                    }
                    className="font-mono-num h-9 w-32 shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 text-right text-xs font-bold text-slate-900 focus:border-[#0F172A] focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
              </div>

              {/* Batch Stock Control */}
              <div className="space-y-1 lg:col-span-5">
                <label className="block text-[11px] font-bold text-slate-600">
                  Penyesuaian Stok · {targetBranch?.name ?? 'Cabang'}
                </label>
                <div className="flex gap-2">
                  <select
                    aria-label="Metode ubah stok serentak"
                    disabled={!targetBranch}
                    value={stockMode}
                    onChange={(e) => {
                      setStockMode(e.target.value as BulkAdjustMode);
                      setBatchAppliedHint(null);
                    }}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:border-[#0F172A] focus:outline-none disabled:bg-slate-100"
                  >
                    <option value="none">Tidak diubah</option>
                    <option value="set">Set stok tetap (pcs)</option>
                    <option value="add">Tambah stok (+pcs)</option>
                    <option value="sub">Kurangi stok (-pcs)</option>
                    <option value="pct_inc">Naikkan persen (+%)</option>
                    <option value="pct_dec">Turunkan persen (-%)</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={
                      stockMode === 'pct_inc' || stockMode === 'pct_dec'
                        ? 1000
                        : MAX_STOCK
                    }
                    step="any"
                    disabled={!targetBranch || stockMode === 'none'}
                    value={stockValue}
                    onChange={(e) => setStockValue(e.target.value)}
                    placeholder={
                      stockMode === 'pct_inc' || stockMode === 'pct_dec'
                        ? 'Contoh: 20'
                        : 'Contoh: 10'
                    }
                    className="font-mono-num h-9 w-28 shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 text-right text-xs font-bold text-slate-900 focus:border-[#0F172A] focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
              </div>

              {/* Apply Button */}
              <div className="lg:col-span-2">
                <button
                  type="button"
                  disabled={!canApplyBatch || saving}
                  onClick={handleApplyBatchToDraft}
                  className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-[#0F172A] px-3 text-xs font-bold text-white transition-colors hover:bg-[#1E293B] disabled:cursor-not-allowed disabled:bg-slate-300 whitespace-nowrap"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Terapkan ({selectedIds.size})</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {batchAppliedHint && (
          <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-200 pt-2 text-xs font-medium text-slate-700">
            <span>{batchAppliedHint}</span>
            <button
              type="button"
              onClick={() => setBatchAppliedHint(null)}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Tutup pesan"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Inline Save Error */}
      {saveError && (
        <div className="flex items-center justify-between gap-2 border-b border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700">
          <span>{saveError}</span>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="text-rose-500 hover:text-rose-800"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Spreadsheet Inline Edit Table */}
      <div className="max-h-[540px] overflow-auto pos-scroll">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
            <tr>
              <th className="w-10 px-4 py-2.5">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Pilih semua produk yang tampil"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#0F172A]"
                />
              </th>
              <th className="px-3 py-2.5 font-semibold">Produk (Read-only)</th>
              <th className="w-44 px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                Stok · {targetBranch?.name ?? 'Cabang'}
              </th>
              <th className="w-52 px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                Harga Jual (Rp)
              </th>
              <th className="w-24 px-4 py-2.5 text-right font-semibold">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <div className="text-sm font-semibold text-slate-700">
                    {viewFilter === 'changed'
                      ? 'Belum ada produk yang diubah'
                      : 'Tidak ada produk yang cocok dengan filter'}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {viewFilter === 'changed'
                      ? 'Ubah nilai stok atau harga langsung di tabel atau gunakan Aksi Serentak.'
                      : 'Coba ubah kata kunci pencarian atau pilih kategori lain.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('ALL');
                      setViewFilter('all');
                    }}
                    className="mt-3 inline-flex h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Tampilkan Semua Produk
                  </button>
                </td>
              </tr>
            ) : (
              filteredProducts.map((p, idx) => {
                const draft = draftEdits[p.id];
                const baseStock = baseStockByProduct.get(p.id) ?? 0;
                const currentStock = draft?.stock ?? baseStock;
                const currentPrice = draft?.price ?? p.price;

                const stockDirty =
                  Boolean(targetBranch) &&
                  draft?.stock !== undefined &&
                  draft.stock !== baseStock;
                const priceDirty =
                  draft?.price !== undefined && draft.price !== p.price;
                const rowDirty = stockDirty || priceDirty;

                const stockDelta = currentStock - baseStock;
                const priceDelta = currentPrice - p.price;
                const isSelected = selectedIds.has(p.id);

                return (
                  <tr
                    key={p.id}
                    className={`transition-colors ${
                      rowDirty
                        ? 'bg-amber-50/50'
                        : isSelected
                          ? 'bg-slate-50'
                          : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <td className="px-4 py-2.5 align-middle">
                      <input
                        type="checkbox"
                        aria-label={`Pilih ${p.name}`}
                        checked={isSelected}
                        onChange={() => toggleSelectRow(p.id)}
                        className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#0F172A]"
                      />
                    </td>

                    <td className="px-3 py-2.5 align-middle">
                      <div className="font-semibold text-slate-900">
                        {p.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                        <span className="font-mono-num text-slate-400">
                          {p.sku}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{p.category}</span>
                      </div>
                    </td>

                    {/* Inline Stock Cell */}
                    <td className="px-3 py-2 text-right align-middle">
                      <div className="flex flex-col items-end">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            max={MAX_STOCK}
                            disabled={!targetBranch || saving}
                            data-bulk-cell={`stock-${idx}`}
                            aria-label={`Stok ${p.name}`}
                            value={currentStock}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) =>
                              updateRowDraft(p, 'stock', e.target.value)
                            }
                            onKeyDown={(e) =>
                              handleInputKeyDown(e, idx, 'stock')
                            }
                            className={`font-mono-num h-9 w-24 rounded-lg border px-2.5 text-right text-xs font-bold transition-colors focus:outline-none ${
                              stockDirty
                                ? 'border-[#0F172A] bg-white text-slate-900 ring-1 ring-[#0F172A]/15'
                                : currentStock <= 0
                                  ? 'border-slate-300 bg-white text-rose-600 focus:border-[#0F172A]'
                                  : 'border-slate-300 bg-white text-slate-900 focus:border-[#0F172A]'
                            } disabled:bg-slate-100 disabled:text-slate-400`}
                          />
                          <span className="text-[11px] text-slate-400">
                            pcs
                          </span>
                        </div>
                        {stockDirty ? (
                          <span
                            className={`font-mono-num mt-0.5 text-[10px] font-semibold ${
                              stockDelta > 0
                                ? 'text-emerald-700'
                                : 'text-rose-600'
                            }`}
                          >
                            {baseStock} → {currentStock} (
                            {stockDelta > 0 ? `+${stockDelta}` : stockDelta})
                          </span>
                        ) : currentStock <= 0 ? (
                          <span className="mt-0.5 text-[10px] font-medium text-rose-600">
                            Stok habis
                          </span>
                        ) : null}
                      </div>
                    </td>

                    {/* Inline Price Cell */}
                    <td className="px-3 py-2 text-right align-middle">
                      <div className="flex flex-col items-end">
                        <div className="relative flex items-center">
                          <span className="pointer-events-none absolute left-2.5 text-[11px] font-semibold text-slate-400">
                            Rp
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={MAX_PRICE}
                            disabled={saving}
                            data-bulk-cell={`price-${idx}`}
                            aria-label={`Harga ${p.name}`}
                            value={currentPrice}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) =>
                              updateRowDraft(p, 'price', e.target.value)
                            }
                            onKeyDown={(e) =>
                              handleInputKeyDown(e, idx, 'price')
                            }
                            className={`font-mono-num h-9 w-36 rounded-lg border pr-2.5 pl-8 text-right text-xs font-bold transition-colors focus:outline-none ${
                              priceDirty
                                ? 'border-[#0F172A] bg-white text-slate-900 ring-1 ring-[#0F172A]/15'
                                : currentPrice === 0
                                  ? 'border-slate-300 bg-white text-amber-700 focus:border-[#0F172A]'
                                  : 'border-slate-300 bg-white text-slate-900 focus:border-[#0F172A]'
                            } disabled:bg-slate-100`}
                          />
                        </div>
                        {priceDirty ? (
                          <span
                            className={`font-mono-num mt-0.5 text-[10px] font-semibold ${
                              priceDelta > 0
                                ? 'text-emerald-700'
                                : 'text-rose-600'
                            }`}
                          >
                            {formatRupiah(p.price)} →{' '}
                            {priceDelta > 0
                              ? `+${formatNumber(priceDelta)}`
                              : formatNumber(priceDelta)}
                          </span>
                        ) : currentPrice === 0 ? (
                          <span className="mt-0.5 text-[10px] font-medium text-amber-700">
                            Harga belum diisi
                          </span>
                        ) : null}
                      </div>
                    </td>

                    {/* Status & Row Reset */}
                    <td className="px-4 py-2.5 text-right align-middle whitespace-nowrap">
                      {rowDirty ? (
                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-amber-700">
                            Diubah
                          </span>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => resetRowDraft(p.id)}
                            title="Kembalikan nilai asli baris ini"
                            aria-label={`Reset perubahan ${p.name}`}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          Tetap
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom Summary & Commit Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-xs text-slate-600 tabular-nums">
          {dirtySummary.changedProducts > 0 ? (
            <span>
              <strong className="font-mono-num text-slate-900">
                {dirtySummary.changedProducts} produk
              </strong>{' '}
              siap disimpan
              {dirtySummary.priceChanges > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <span className="font-semibold text-slate-800">
                    {dirtySummary.priceChanges} harga
                  </span>
                </>
              )}
              {dirtySummary.stockChanges > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <span className="font-semibold text-slate-800">
                    {dirtySummary.stockChanges} stok ({targetBranch?.name})
                  </span>
                </>
              )}
            </span>
          ) : (
            <span>
              Menampilkan{' '}
              <strong className="font-mono-num text-slate-800">
                {filteredProducts.length}
              </strong>{' '}
              dari{' '}
              <strong className="font-mono-num text-slate-800">
                {products.length}
              </strong>{' '}
              produk · Belum ada perubahan
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {dirtySummary.changedProducts > 0 && (
            <button
              type="button"
              disabled={saving}
              onClick={resetAllDrafts}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset Semua</span>
            </button>
          )}
          <button
            type="button"
            disabled={dirtySummary.changedProducts === 0 || saving}
            onClick={() => void handleSaveAll()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0F172A] px-5 text-xs font-bold text-white transition-colors hover:bg-[#1E293B] disabled:cursor-not-allowed disabled:bg-slate-300 whitespace-nowrap"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span>
              {saving
                ? 'Menyimpan...'
                : dirtySummary.changedProducts > 0
                  ? `Simpan ${dirtySummary.changedProducts} Perubahan`
                  : 'Simpan Perubahan'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
