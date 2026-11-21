import { useEffect, useMemo, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  Database,
  History,
  Loader2,
  LogIn,
  LogOut,
  Minus,
  PackagePlus,
  Plus,
  RotateCcw,
  ShoppingBag,
  Trash2,
  Utensils,
} from 'lucide-react';
import { DiscountControl } from './components/DiscountControl';
import { ProductManagerModal } from './components/ProductManagerModal';
import { ProductSearchScan } from './components/ProductSearchScan';
import {
  SimpleCheckoutModal,
  SimpleHistoryModal,
  SimpleReceiptModal,
} from './components/SimpleCheckoutModal';
import { DEFAULT_DISCOUNT, PRODUCT_CATEGORIES } from './data/catalog';
import { auth, googleProvider } from './firebase';
import {
  createTransactionAtomic,
  deleteProductFromFirestore,
  fetchTransactionItems,
  saveProductToFirestore,
  seedInitialDataIfNeeded,
  subscribeProducts,
  subscribeTransactions,
  subscribeVouchers,
} from './services/posRepository';
import {
  CartItem,
  DiscountConfig,
  PaymentMethod,
  Product,
  SimpleTransaction,
  VoucherDef,
} from './types/pos';
import {
  calculateSimpleTotals,
  formatNumber,
  formatRupiah,
} from './utils/format';

export default function App() {
  // Firebase Auth State
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Firestore Real-Time State
  const [products, setProducts] = useState<Product[]>([]);
  const [vouchers, setVouchers] = useState<VoucherDef[]>([]);
  const [transactions, setTransactions] = useState<SimpleTransaction[]>([]);
  const [syncingData, setSyncingData] = useState(false);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  // Active Cart & Discount State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState<DiscountConfig>(DEFAULT_DISCOUNT);

  // Search / Scan + Qty inputs
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [inputQty, setInputQty] = useState<number>(1);
  const [category, setCategory] = useState<string>('Semua');

  // Modals
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [productManagerOpen, setProductManagerOpen] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<SimpleTransaction | null>(
    null
  );
  const [loadingReceipt, setLoadingReceipt] = useState(false);

  // Surface Firestore permission/quota errors cleanly to ErrorBoundary
  if (fatalError) {
    throw fatalError;
  }

  // Listen for Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setProducts([]);
        setVouchers([]);
        setTransactions([]);
        setCart([]);
        setDiscount(DEFAULT_DISCOUNT);
      }
    });
    return () => unsubscribe();
  }, []);

  // Attach Firestore onSnapshot listeners ONLY when auth is ready and user is authenticated
  useEffect(() => {
    if (!authReady || !user) return;

    let cancelled = false;
    setSyncingData(true);

    void seedInitialDataIfNeeded(user.uid)
      .catch((err) => {
        if (!cancelled) {
          setFatalError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        if (!cancelled) setSyncingData(false);
      });

    const unsubProducts = subscribeProducts(
      user.uid,
      (list) => setProducts(list),
      (err) => setFatalError(err)
    );

    const unsubVouchers = subscribeVouchers(
      user.uid,
      (list) => setVouchers(list),
      (err) => setFatalError(err)
    );

    const unsubTx = subscribeTransactions(
      user.uid,
      (list) => setTransactions(list),
      (err) => setFatalError(err)
    );

    return () => {
      cancelled = true;
      unsubProducts();
      unsubVouchers();
      unsubTx();
    };
  }, [authReady, user]);

  const handleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Gagal masuk dengan Google. Silakan coba lagi.'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const totals = useMemo(
    () => calculateSimpleTotals(cart, discount, vouchers),
    [cart, discount, vouchers]
  );

  const qtyByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    cart.forEach((c) => {
      map[c.productId] = c.qty;
    });
    return map;
  }, [cart]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (category !== 'Semua' && p.category !== category) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [products, category, searchQuery]);

  const addProductToCart = (product: Product, qtyToAdd: number) => {
    const safeQty = Math.max(1, Math.round(qtyToAdd));
    setCart((prev) => {
      const idx = prev.findIndex((item) => item.productId === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + safeQty };
        return next;
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          unitPrice: product.price,
          qty: safeQty,
        },
      ];
    });
  };

  const handleSearchSelectProduct = (product: Product) => {
    addProductToCart(product, inputQty);
    setInputQty(1);
  };

  const updateItemQty = (productId: string, nextQty: number) => {
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((item) => item.productId !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, qty: nextQty } : item
      )
    );
  };

  const handleReset = () => {
    setCart([]);
    setDiscount(DEFAULT_DISCOUNT);
    setSearchQuery('');
    setInputQty(1);
  };

  const handleConfirmPayment = async (
    method: PaymentMethod,
    amountPaid: number
  ) => {
    if (!user || cart.length === 0) return;

    const invoiceNo = `INV-${String(1001 + transactions.length).padStart(4, '0')}`;
    const change = Math.max(0, amountPaid - totals.grandTotal);

    try {
      const createdTx = await createTransactionAtomic(user.uid, {
        invoiceNo,
        items: cart,
        subtotal: totals.subtotal,
        discountMode: discount.mode,
        discountAmount: totals.discountAmount,
        adjustmentLabel: totals.adjustmentLabel,
        grandTotal: totals.grandTotal,
        paymentMethod: method,
        amountPaid,
        change,
      });

      setCart([]);
      setDiscount(DEFAULT_DISCOUNT);
      setCheckoutOpen(false);
      setActiveReceipt(createdTx);
    } catch (err) {
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const handleOpenHistoricalReceipt = async (tx: SimpleTransaction) => {
    if (!user) return;
    setHistoryOpen(false);
    if (tx.items.length > 0) {
      setActiveReceipt(tx);
      return;
    }
    setLoadingReceipt(true);
    try {
      const items = await fetchTransactionItems(user.uid, tx.id);
      setActiveReceipt({ ...tx, items });
    } catch (err) {
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoadingReceipt(false);
    }
  };

  // Loading auth state
  if (!authReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-100">
        <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin text-[#1B8EE6]" />
          <span>Menghubungkan ke Firebase...</span>
        </div>
      </div>
    );
  }

  // Google Sign-In Gate
  if (!user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-100 p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-lg">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#1B8EE6] text-white">
            <Database className="h-6 w-6" />
          </div>

          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
            KasirPOS · Firebase Cloud
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Masuk dengan akun Google Anda untuk menyinkronkan katalog produk,
            voucher promo, dan riwayat transaksi secara real-time di Firebase
            Firestore.
          </p>

          {authError && (
            <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
              {authError}
            </div>
          )}

          <button
            type="button"
            disabled={authLoading}
            onClick={handleSignIn}
            className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1B8EE6] px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#1479C9] disabled:bg-slate-300"
          >
            {authLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            <span>
              {authLoading ? 'Memproses Masuk...' : 'Masuk dengan Google'}
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100">
      {/* Clean Header */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 bg-[#1B8EE6] px-4 text-white shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <div className="text-base font-bold tracking-tight whitespace-nowrap">
            KasirPOS
          </div>
          {syncingData && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/80" />
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setProductManagerOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-white/35 bg-white/10 px-3 text-xs font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/20"
          >
            <PackagePlus className="h-4 w-4" />
            <span className="hidden sm:inline">Kelola Produk</span>
          </button>

          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-white/35 bg-white/10 px-3 text-xs font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/20"
          >
            <History className="h-4 w-4" />
            <span>Riwayat ({transactions.length})</span>
          </button>

          <button
            type="button"
            onClick={handleReset}
            disabled={cart.length === 0 && discount.mode === 'none'}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-white/35 bg-white/10 px-3 text-xs font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            title={`Keluar (${user.displayName || user.email || 'Kasir'})`}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/25"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden md:inline max-w-[110px] truncate">
              {user.displayName?.split(' ')[0] || 'Keluar'}
            </span>
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {/* LEFT PANEL: 1. Cari/Scan Barang + 2. Qty, Keranjang, 3. Setting Diskon / Harga Pas, Total & Bayar */}
        <section className="flex h-full w-full flex-col border-r border-slate-200 bg-white md:w-[46%] lg:w-[44%]">
          {/* Input Bar: Cari / Scan Barang + Default Qty */}
          <div className="shrink-0 border-b border-slate-200 bg-slate-50/80 p-3.5">
            <div className="flex items-end gap-2.5">
              <div className="min-w-0 flex-1">
                <ProductSearchScan
                  products={products}
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                  onSelectProduct={handleSearchSelectProduct}
                />
              </div>

              <div className="w-20 shrink-0">
                <label
                  htmlFor="default-qty"
                  className="mb-1.5 block text-[11px] font-bold tracking-wider text-slate-500 uppercase"
                >
                  QTY
                </label>
                <input
                  id="default-qty"
                  type="number"
                  min={1}
                  max={999}
                  value={inputQty}
                  onChange={(e) =>
                    setInputQty(
                      Math.max(1, parseInt(e.target.value || '1', 10) || 1)
                    )
                  }
                  className="font-mono-num h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-center text-sm font-bold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Table Header */}
          <div className="grid shrink-0 grid-cols-12 items-center bg-[#9EA6AF] px-3.5 py-2 text-xs font-bold text-slate-900">
            <div className="col-span-5">Produk</div>
            <div className="col-span-4 text-center">Qty</div>
            <div className="col-span-3 text-right">Total</div>
          </div>

          {/* Scrollable Cart List */}
          <div className="pos-scroll flex-1 overflow-y-auto divide-y divide-slate-100">
            {cart.length === 0 ? (
              <div className="flex h-full min-h-[160px] flex-col items-center justify-center px-6 text-center">
                <ShoppingBag className="mb-2 h-8 w-8 text-slate-300" />
                <p className="text-sm font-semibold text-slate-700">
                  Keranjang masih kosong
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Ketik/scan barang di kolom atas atau ketuk produk di sebelah
                  kanan.
                </p>
              </div>
            ) : (
              cart.map((item, idx) => (
                <div
                  key={item.productId}
                  className={`grid grid-cols-12 items-center gap-2 px-3.5 py-2.5 ${
                    idx % 2 === 1 ? 'bg-[#F3F6FA]' : 'bg-white'
                  }`}
                >
                  <div className="col-span-5 min-w-0">
                    <div className="truncate text-[13.5px] font-semibold text-slate-900">
                      {item.name}
                    </div>
                    <div className="text-[11.5px] text-slate-500 tabular-nums">
                      {formatRupiah(item.unitPrice)}
                    </div>
                  </div>

                  {/* Inline Qty Stepper */}
                  <div className="col-span-4 flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateItemQty(item.productId, item.qty - 1)}
                      aria-label={`Kurangi ${item.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 active:scale-95"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(e) =>
                        updateItemQty(
                          item.productId,
                          parseInt(e.target.value || '0', 10) || 0
                        )
                      }
                      aria-label={`Qty ${item.name}`}
                      className="font-mono-num h-7 w-11 rounded-md border border-slate-300 bg-white text-center text-xs font-bold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => updateItemQty(item.productId, item.qty + 1)}
                      aria-label={`Tambah ${item.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-[#1B8EE6] text-white hover:bg-[#1479C9] active:scale-95"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="col-span-3 flex items-center justify-end gap-1.5">
                    <span className="font-mono-num text-[13px] font-bold text-slate-900">
                      {formatNumber(item.unitPrice * item.qty)}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateItemQty(item.productId, 0)}
                      aria-label={`Hapus ${item.name}`}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Setting Diskon / Harga Pas */}
          <div className="shrink-0 space-y-3 border-t border-slate-200 bg-white p-3.5">
            <DiscountControl
              discount={discount}
              totals={totals}
              vouchers={vouchers}
              onChange={setDiscount}
            />

            {/* Totals Breakdown */}
            <div className="space-y-1.5 px-1 text-sm tabular-nums">
              <div className="flex items-center justify-between text-slate-600">
                <span>Subtotal ({totals.totalQty} item)</span>
                <span className="font-semibold text-slate-800">
                  {formatRupiah(totals.subtotal)}
                </span>
              </div>

              {totals.adjustmentLabel && totals.discountAmount !== 0 && (
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span
                    className={
                      totals.discountAmount > 0
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }
                  >
                    {totals.adjustmentLabel}
                  </span>
                  <span
                    className={
                      totals.discountAmount > 0
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }
                  >
                    {totals.discountAmount > 0
                      ? `-${formatRupiah(totals.discountAmount)}`
                      : `+${formatRupiah(Math.abs(totals.discountAmount))}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Primary Pay Button */}
          <button
            type="button"
            disabled={cart.length === 0}
            onClick={() => setCheckoutOpen(true)}
            className="flex h-14 w-full shrink-0 items-center justify-between bg-[#4CAF50] px-5 text-white transition-colors hover:bg-[#43A047] active:bg-[#388E3C] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <span className="text-sm font-bold tracking-wide">BAYAR</span>
            <span className="font-mono-num text-xl font-extrabold">
              {formatRupiah(totals.grandTotal)}
            </span>
          </button>
        </section>

        {/* RIGHT PANEL: Katalog Produk Visual tersinkron real-time dengan Firestore */}
        <section className="flex h-full flex-1 flex-col overflow-hidden bg-[#1B8EE6]">
          {/* Simple Category Filter */}
          <div className="flex shrink-0 items-center justify-between gap-2 p-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {PRODUCT_CATEGORIES.map((cat) => {
                const active = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${
                      active
                        ? 'bg-white text-[#1B8EE6] shadow-sm'
                        : 'bg-white/15 text-white hover:bg-white/25'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
            <span className="hidden shrink-0 text-xs font-semibold text-white/85 sm:inline tabular-nums">
              {filteredProducts.length} produk
            </span>
          </div>

          {/* Product Cards Grid */}
          <div className="pos-scroll-blue flex-1 overflow-y-auto px-3 pb-3">
            {syncingData && products.length === 0 ? (
              <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-white">
                <Loader2 className="mb-2 h-6 w-6 animate-spin" />
                <p className="text-xs font-semibold">
                  Memuat katalog produk dari Firestore...
                </p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex h-full min-h-[180px] flex-col items-center justify-center rounded-xl bg-white/10 p-6 text-center text-white">
                <p className="text-sm font-semibold">Produk tidak ditemukan</p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setCategory('Semua');
                    }}
                    className="rounded-lg bg-white px-3.5 py-1.5 text-xs font-bold text-[#1B8EE6]"
                  >
                    Tampilkan Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductManagerOpen(true)}
                    className="rounded-lg border border-white/40 bg-white/15 px-3.5 py-1.5 text-xs font-bold text-white"
                  >
                    Tambah Produk
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                {filteredProducts.map((product) => (
                  <SimpleProductCard
                    key={product.id}
                    product={product}
                    inCartQty={qtyByProduct[product.id] ?? 0}
                    onAdd={() => addProductToCart(product, inputQty)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Loading overlay when fetching subcollection receipt items */}
      {loadingReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
          <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-3 text-xs font-bold text-slate-700 shadow-lg">
            <Loader2 className="h-4 w-4 animate-spin text-[#1B8EE6]" />
            <span>Memuat detail struk...</span>
          </div>
        </div>
      )}

      {/* Modals */}
      {checkoutOpen && (
        <SimpleCheckoutModal
          totals={totals}
          onClose={() => setCheckoutOpen(false)}
          onConfirm={(method, paid) => void handleConfirmPayment(method, paid)}
        />
      )}

      {activeReceipt && (
        <SimpleReceiptModal
          transaction={activeReceipt}
          onClose={() => setActiveReceipt(null)}
        />
      )}

      {historyOpen && (
        <SimpleHistoryModal
          transactions={transactions}
          onSelectReceipt={(tx) => void handleOpenHistoricalReceipt(tx)}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {productManagerOpen && (
        <ProductManagerModal
          products={products}
          onSave={(input) => saveProductToFirestore(user.uid, input)}
          onDelete={(id) => deleteProductFromFirestore(id)}
          onClose={() => setProductManagerOpen(false)}
        />
      )}
    </div>
  );
}

function SimpleProductCard({
  product,
  inCartQty,
  onAdd,
}: {
  product: Product;
  inCartQty: number;
  onAdd: () => void;
}) {
  const [imgError, setImgError] = useState(false);

  return (
    <button
      type="button"
      onClick={onAdd}
      className="group relative flex flex-col overflow-hidden rounded-lg bg-white text-left shadow-sm transition-transform duration-150 hover:shadow-md active:scale-[0.97]"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-50 p-1.5">
        {!imgError && product.image ? (
          <img
            src={product.image}
            alt={product.name}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="h-full w-full rounded object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded bg-slate-100 text-slate-400">
            <Utensils className="h-7 w-7" />
          </div>
        )}

        {inCartQty > 0 && (
          <span className="absolute top-2 right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#1B8EE6] px-1.5 text-[11px] font-bold text-white shadow tabular-nums">
            {inCartQty}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-between px-2.5 pt-1 pb-2.5">
        <div className="line-clamp-2 min-h-[32px] text-xs leading-snug font-semibold text-slate-700">
          {product.name}
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="font-mono-num text-[10.5px] text-slate-400">
            {product.sku}
          </span>
          <span className="font-mono-num text-[13px] font-bold text-slate-900">
            {formatNumber(product.price)}
          </span>
        </div>
      </div>
    </button>
  );
}
