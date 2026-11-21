import { useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { PRODUCT_CATEGORIES } from '../data/catalog';
import { Product } from '../types/pos';
import { formatRupiah } from '../utils/format';

interface ProductManagerModalProps {
  products: Product[];
  onSave: (input: {
    id?: string;
    sku: string;
    barcode: string;
    name: string;
    price: number;
    image: string;
    category: Product['category'];
  }) => Promise<void>;
  onDelete: (productId: string) => Promise<void>;
  onClose: () => void;
}

const EDITABLE_CATEGORIES = PRODUCT_CATEGORIES.filter(
  (c): c is Product['category'] => c !== 'Semua'
);

export function ProductManagerModal({
  products,
  onSave,
  onDelete,
  onClose,
}: ProductManagerModalProps) {
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [category, setCategory] = useState<Product['category']>('Makanan');
  const [image, setImage] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const resetForm = () => {
    setEditingId(undefined);
    setName('');
    setSku('');
    setBarcode('');
    setPriceStr('');
    setCategory('Makanan');
    setImage('');
    setErrorMsg(null);
  };

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setName(p.name);
    setSku(p.sku);
    setBarcode(p.barcode);
    setPriceStr(String(p.price));
    setCategory(p.category);
    setImage(p.image);
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericPrice = parseInt(priceStr || '0', 10);
    if (!name.trim()) {
      setErrorMsg('Nama produk wajib diisi.');
      return;
    }
    if (Number.isNaN(numericPrice) || numericPrice < 0) {
      setErrorMsg('Harga produk tidak valid.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await onSave({
        id: editingId,
        sku: sku.trim() || `SKU-${Date.now().toString().slice(-4)}`,
        barcode: barcode.trim() || `899${Date.now().toString().slice(-7)}`,
        name: name.trim(),
        price: numericPrice,
        image: image.trim(),
        category,
      });
      resetForm();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal menyimpan produk.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 backdrop-blur-[1px]">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#1B8EE6] px-5 py-3.5 text-white">
          <div>
            <h2 className="text-sm font-bold">Kelola Produk (Firebase Firestore)</h2>
            <p className="text-[11px] text-white/85">
              Tambah, ubah, atau hapus katalog produk tersimpan di cloud
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup kelola produk"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pos-scroll grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 md:grid-cols-12">
          {/* Form */}
          <form
            onSubmit={handleSubmit}
            className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:col-span-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800">
                {editingId ? 'Edit Produk' : 'Tambah Produk Baru'}
              </h3>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-[11px] font-semibold text-[#1B8EE6] hover:underline"
                >
                  Batal Edit
                </button>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold text-slate-600">
                Nama Produk
              </label>
              <input
                type="text"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Es Kopi Susu"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">
                  Harga (Rp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={priceStr}
                  onChange={(e) => setPriceStr(e.target.value)}
                  placeholder="25000"
                  className="font-mono-num h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">
                  Kategori
                </label>
                <select
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as Product['category'])
                  }
                  className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                >
                  {EDITABLE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">
                  SKU
                </label>
                <input
                  type="text"
                  maxLength={32}
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="MNM-09"
                  className="font-mono-num h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">
                  Barcode
                </label>
                <input
                  type="text"
                  maxLength={64}
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="8992001009"
                  className="font-mono-num h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                />
              </div>
            </div>

            {errorMsg && (
              <div className="rounded-md bg-rose-50 px-2.5 py-1.5 text-[11px] font-medium text-rose-700">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-[#4CAF50] text-xs font-bold text-white hover:bg-[#43A047] disabled:bg-slate-300"
            >
              <Plus className="h-4 w-4" />
              <span>
                {saving
                  ? 'Menyimpan...'
                  : editingId
                    ? 'Simpan Perubahan'
                    : 'Simpan ke Firestore'}
              </span>
            </button>
          </form>

          {/* Existing Products List */}
          <div className="space-y-2 md:col-span-7">
            <div className="text-xs font-bold text-slate-600">
              Daftar Produk di Cloud ({products.length})
            </div>
            <div className="pos-scroll max-h-[48vh] space-y-1.5 overflow-y-auto pr-1">
              {products.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-slate-900">
                      {p.name}
                    </div>
                    <div className="font-mono-num text-[11px] text-slate-500">
                      {p.sku} · {p.barcode} · {formatRupiah(p.price)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      aria-label={`Edit ${p.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-sky-50 hover:text-[#1B8EE6]"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(p.id)}
                      aria-label={`Hapus ${p.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
