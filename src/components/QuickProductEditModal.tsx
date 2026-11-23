import { useState } from 'react';
import { Building2, Check, DollarSign, Loader2, Package, X } from 'lucide-react';
import { Branch, BranchStock, Product } from '../types/pos';
import { formatNumber, formatRupiah } from '../utils/format';

interface QuickProductEditModalProps {
  product: Product;
  branches: Branch[];
  branchStocks: BranchStock[];
  defaultBranchId?: string | null;
  onClose: () => void;
  onSave: (params: { price: number; stockQty: number; branchId: string }) => Promise<void>;
  onNotify: (msg: string) => void;
}

export function QuickProductEditModal({
  product,
  branches,
  branchStocks,
  defaultBranchId,
  onClose,
  onSave,
  onNotify,
}: QuickProductEditModalProps) {
  const currentBranchId = defaultBranchId || branches[0]?.id || '';
  const initialStock =
    branchStocks.find((s) => s.productId === product.id && s.branchId === currentBranchId)?.currentStock ??
    branchStocks.find((s) => s.productId === product.id)?.currentStock ??
    0;
  const initialBranch =
    branchStocks.find((s) => s.productId === product.id && s.branchId === currentBranchId)?.branchId ||
    branchStocks.find((s) => s.productId === product.id)?.branchId ||
    currentBranchId;

  const [priceInput, setPriceInput] = useState(String(product.price));
  const [stockInput, setStockInput] = useState(String(initialStock));
  const [targetBranchId, setTargetBranchId] = useState(initialBranch);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newPrice = Math.max(0, parseInt(priceInput || '0', 10) || 0);
    const newStock = Math.max(0, parseInt(stockInput || '0', 10) || 0);
    setSaving(true);
    try {
      await onSave({
        price: newPrice,
        stockQty: newStock,
        branchId: targetBranchId,
      });
      onNotify(`Produk "${product.name}" berhasil diperbarui`);
      onClose();
    } catch (err) {
      console.error(err);
      onNotify('Gagal menyimpan perubahan produk');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-200 text-slate-800 font-bold">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Edit Cepat Harga & Stok</h3>
              <p className="text-xs text-slate-500 truncate max-w-[260px]">{product.name}</p>
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

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-800">{product.name}</div>
            <div className="font-mono-num mt-0.5 text-[11px] text-slate-400">SKU: {product.sku}</div>
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <DollarSign className="h-4 w-4 text-slate-700" />
              <span>Harga Jual (Rp)</span>
            </label>
            <input
              type="number"
              required
              min={0}
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              className="font-mono-num h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900 focus:border-[#0F172A] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <Building2 className="h-4 w-4 text-slate-700" />
                <span>Cabang Stok</span>
              </label>
              <select
                value={targetBranchId}
                onChange={(e) => setTargetBranchId(e.target.value)}
                className="h-10 w-full rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:border-[#0F172A] focus:outline-none"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-700">
                Stok Saat Ini (pcs)
              </label>
              <input
                type="number"
                required
                min={0}
                value={stockInput}
                onChange={(e) => setStockInput(e.target.value)}
                className="font-mono-num h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900 focus:border-[#0F172A] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex h-10 items-center gap-2 rounded-xl bg-[#0F172A] px-5 text-xs font-bold text-white hover:bg-[#1E293B] transition-colors shadow-sm disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              <span>Simpan Perubahan</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
