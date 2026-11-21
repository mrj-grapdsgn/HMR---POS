import { useEffect, useMemo, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import {
  AlertCircle,
  Building2,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  Minus,
  Package,
  Plus,
  RotateCcw,
  ShoppingBag,
  Trash2,
  UserCheck,
} from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthScreen } from './components/AuthScreen';
import { DiscountControl } from './components/DiscountControl';
import { ProductSearchScan } from './components/ProductSearchScan';
import {
  SimpleCheckoutModal,
  SimpleHistoryModal,
  SimpleReceiptModal,
} from './components/SimpleCheckoutModal';
import { DEFAULT_DISCOUNT } from './data/catalog';
import { auth } from './firebase';
import {
  adjustBranchStockAtomic,
  createTransactionAtomic,
  deleteBranchFromFirestore,
  deleteProductFromFirestore,
  deleteStaffAccountFromFirestore,
  deleteVoucherFromFirestore,
  ensureUserProfile,
  fetchTransactionItems,
  hasLegacyCafeProducts,
  importCatalogRowsToFirestore,
  replaceLegacyCafeWithHikemore,
  saveBranchToFirestore,
  saveProductToFirestore,
  saveStaffAccountToFirestore,
  saveVoucherToFirestore,
  seedInitialDataIfNeeded,
  subscribeBranchStocks,
  subscribeBranches,
  subscribeProducts,
  subscribeSalesLines,
  subscribeStaffAccounts,
  subscribeStockLogs,
  subscribeTransactions,
  subscribeUserProfile,
  subscribeVouchers,
  updateUserProfile,
} from './services/posRepository';
import {
  Branch,
  BranchStock,
  CartItem,
  DiscountConfig,
  PaymentMethod,
  Product,
  SalesLine,
  SimpleTotals,
  SimpleTransaction,
  StaffAccount,
  StockLog,
  UserProfile,
  VoucherDef,
} from './types/pos';
import { formatNumber, formatRupiah } from './utils/format';

function computeSimpleTotals(
  cart: CartItem[],
  discount: DiscountConfig,
  vouchers: VoucherDef[]
): SimpleTotals {
  const subtotal = cart.reduce((s, item) => s + item.unitPrice * item.qty, 0);
  const totalQty = cart.reduce((s, item) => s + item.qty, 0);

  if (subtotal === 0) {
    return {
      subtotal: 0,
      discountAmount: 0,
      adjustmentLabel: null,
      grandTotal: 0,
      totalQty: 0,
      voucherError: null,
      appliedVoucher: null,
    };
  }

  let discountAmount = 0;
  let adjustmentLabel: string | null = null;
  let voucherError: string | null = null;
  let appliedVoucher: VoucherDef | null = null;

  if (discount.mode === 'fixed') {
    discountAmount = Math.min(subtotal, Math.max(0, discount.fixedAmount));
    if (discountAmount > 0) adjustmentLabel = 'Potongan Harga';
  } else if (discount.mode === 'percent') {
    const pct = Math.min(100, Math.max(0, discount.percentValue));
    discountAmount = Math.round((subtotal * pct) / 100);
    if (pct > 0) adjustmentLabel = `Diskon ${pct}%`;
  } else if (discount.mode === 'exact') {
    if (discount.exactTotal !== null && discount.exactTotal >= 0) {
      discountAmount = subtotal - discount.exactTotal;
      adjustmentLabel = 'Harga Pas';
    }
  } else if (discount.mode === 'voucher') {
    const code = discount.voucherCode.trim().toUpperCase();
    if (code) {
      const found = vouchers.find(
        (v) => v.active !== false && v.code.toUpperCase() === code
      );
      if (!found) {
        voucherError = `Kode voucher "${code}" tidak valid atau nonaktif.`;
      } else if (found.minSubtotal && subtotal < found.minSubtotal) {
        voucherError = `Minimal belanja ${formatRupiah(found.minSubtotal)} untuk voucher ${found.code}.`;
      } else {
        appliedVoucher = found;
        discountAmount =
          found.type === 'percent'
            ? Math.round((subtotal * found.value) / 100)
            : Math.min(subtotal, found.value);
        adjustmentLabel = `Voucher ${found.code}`;
      }
    }
  }

  const grandTotal = Math.max(0, subtotal - discountAmount);

  return {
    subtotal,
    discountAmount,
    adjustmentLabel,
    grandTotal,
    totalQty,
    voucherError,
    appliedVoucher,
  };
}

export default function App() {
  // Firebase Auth State
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  // Navigation Mode: POS Kasir vs Dashboard Pengelolaan Admin
  const [viewMode, setViewMode] = useState<'pos' | 'admin'>('pos');

  // Firestore-backed Data
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [branchStocks, setBranchStocks] = useState<BranchStock[]>([]);
  const [stockLogs, setStockLogs] = useState<StockLog[]>([]);
  const [vouchers, setVouchers] = useState<VoucherDef[]>([]);
  const [staffAccounts, setStaffAccounts] = useState<StaffAccount[]>([]);
  const [activeStaffId, setActiveStaffId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<SimpleTransaction[]>([]);
  const [salesLines, setSalesLines] = useState<SalesLine[]>([]);
  const [syncingData, setSyncingData] = useState(false);

  // POS Session State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [inputQty, setInputQty] = useState<number>(1);
  const [discount, setDiscount] = useState<DiscountConfig>(DEFAULT_DISCOUNT);
  const [category, setCategory] = useState<string>('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [stockAlert, setStockAlert] = useState<string | null>(null);

  // Modals
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<SimpleTransaction | null>(
    null
  );
  const [loadingReceipt, setLoadingReceipt] = useState(false);

  if (fatalError) {
    throw fatalError;
  }

  const showStockAlert = (msg: string) => {
    setStockAlert(msg);
    setTimeout(() => {
      setStockAlert((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setProfile(null);
        setBranches([]);
        setActiveBranchId(null);
        setProducts([]);
        setBranchStocks([]);
        setStockLogs([]);
        setVouchers([]);
        setStaffAccounts([]);
        setTransactions([]);
        setSalesLines([]);
        setCart([]);
        setActiveStaffId(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Attach Firestore listeners ONLY when authenticated
  useEffect(() => {
    if (!authReady || !user) return;

    let cancelled = false;
    setSyncingData(true);

    const ownerUsername = user.email?.split('@')[0] || 'admin';
    const ownerName = user.displayName || ownerUsername || 'Admin Utama';

    void (async () => {
      try {
        await ensureUserProfile(user.uid, ownerName);
        await seedInitialDataIfNeeded(user.uid, ownerName, ownerUsername);
      } catch (err) {
        if (!cancelled) {
          setFatalError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setSyncingData(false);
      }
    })();

    const unsubProfile = subscribeUserProfile(
      user.uid,
      (p) => setProfile(p),
      (err) => setFatalError(err)
    );

    const unsubBranches = subscribeBranches(
      user.uid,
      (list) => {
        setBranches(list);
        setActiveBranchId((prev) => {
          if (prev && list.some((b) => b.id === prev && b.active)) return prev;
          return list.find((b) => b.active)?.id ?? list[0]?.id ?? null;
        });
      },
      (err) => setFatalError(err)
    );

    const unsubProducts = subscribeProducts(
      user.uid,
      (list) => setProducts(list),
      (err) => setFatalError(err)
    );

    const unsubStocks = subscribeBranchStocks(
      user.uid,
      (list) => setBranchStocks(list),
      (err) => setFatalError(err)
    );

    const unsubLogs = subscribeStockLogs(
      user.uid,
      (list) => setStockLogs(list),
      (err) => setFatalError(err)
    );

    const unsubVouchers = subscribeVouchers(
      user.uid,
      (list) => setVouchers(list),
      (err) => setFatalError(err)
    );

    const unsubStaff = subscribeStaffAccounts(
      user.uid,
      (list) => {
        setStaffAccounts(list);
        setActiveStaffId((prev) => {
          if (prev && list.some((s) => s.id === prev && s.active)) return prev;
          return list.find((s) => s.active)?.id ?? null;
        });
      },
      (err) => setFatalError(err)
    );

    const unsubTxs = subscribeTransactions(
      user.uid,
      (list) => setTransactions(list),
      (err) => setFatalError(err)
    );

    const unsubSalesLines = subscribeSalesLines(
      user.uid,
      (list) => setSalesLines(list),
      (err) => setFatalError(err)
    );

    return () => {
      cancelled = true;
      unsubProfile();
      unsubBranches();
      unsubProducts();
      unsubStocks();
      unsubLogs();
      unsubVouchers();
      unsubStaff();
      unsubTxs();
      unsubSalesLines();
    };
  }, [authReady, user]);

  const activeBranch = useMemo(
    () => branches.find((b) => b.id === activeBranchId) ?? branches[0] ?? null,
    [branches, activeBranchId]
  );

  const activeBranchList = useMemo(
    () => branches.filter((b) => b.active),
    [branches]
  );

  const activeStaff = useMemo(
    () => staffAccounts.find((s) => s.id === activeStaffId) ?? null,
    [staffAccounts, activeStaffId]
  );

  const activeCashierName =
    activeStaff?.displayName ||
    profile?.displayName ||
    user?.displayName ||
    'Admin';

  // Live stock lookup for the active POS branch
  const stockByProductId = useMemo(() => {
    const map: Record<string, number> = {};
    if (!activeBranch) return map;
    for (const st of branchStocks) {
      if (st.branchId === activeBranch.id) {
        map[st.productId] = st.currentStock;
      }
    }
    return map;
  }, [branchStocks, activeBranch]);

  // Dynamic category tabs derived from live products
  const dynamicCategories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return ['Semua', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [products]);

  useEffect(() => {
    if (category !== 'Semua' && !dynamicCategories.includes(category)) {
      setCategory('Semua');
    }
  }, [category, dynamicCategories]);

  const legacyCafeDetected = useMemo(
    () => hasLegacyCafeProducts(products),
    [products]
  );

  const activeVouchers = useMemo(
    () => vouchers.filter((v) => v.active !== false),
    [vouchers]
  );

  const totals = useMemo(
    () => computeSimpleTotals(cart, discount, activeVouchers),
    [cart, discount, activeVouchers]
  );

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const catOk = category === 'Semua' || p.category === category;
      if (!catOk) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
  }, [products, category, searchQuery]);

  const qtyByProduct = useMemo(() => {
    const map: Record<string, number> = {};
    cart.forEach((item) => {
      map[item.productId] = item.qty;
    });
    return map;
  }, [cart]);

  const handleBranchSwitch = (nextBranchId: string) => {
    setActiveBranchId(nextBranchId);
    if (cart.length > 0) {
      setCart([]);
      setDiscount(DEFAULT_DISCOUNT);
      showStockAlert(
        'Keranjang direset karena cabang aktif diganti (stok terpisah per cabang).'
      );
    }
  };

  const addProductToCart = (product: Product, qtyToAdd: number): boolean => {
    const avail = stockByProductId[product.id] ?? 0;
    if (avail <= 0) {
      showStockAlert(
        `Stok "${product.name}" habis (0 pcs) di ${activeBranch?.name ?? 'cabang aktif'}.`
      );
      return false;
    }

    const currentInCart = qtyByProduct[product.id] ?? 0;
    const add = Math.max(1, Math.floor(qtyToAdd));
    if (currentInCart >= avail) {
      showStockAlert(
        `Tidak dapat menambah "${product.name}": sisa stok ${avail} pcs.`
      );
      return false;
    }

    const nextQty = Math.min(avail, currentInCart + add);
    if (currentInCart + add > avail) {
      showStockAlert(
        `Qty "${product.name}" disesuaikan ke sisa stok maksimum (${avail} pcs).`
      );
    }

    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id ? { ...i, qty: nextQty } : i
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          sku: product.sku,
          category: product.category,
          name: product.name,
          unitPrice: product.price,
          qty: nextQty,
        },
      ];
    });
    return true;
  };

  const handleSearchSelectProduct = (product: Product): boolean => {
    const ok = addProductToCart(product, inputQty);
    if (ok) setInputQty(1);
    return ok;
  };

  const updateItemQty = (productId: string, nextQty: number) => {
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((i) => i.productId !== productId));
      return;
    }
    const avail = stockByProductId[productId] ?? 0;
    if (avail <= 0) {
      setCart((prev) => prev.filter((i) => i.productId !== productId));
      showStockAlert('Produk dihapus dari keranjang karena stok cabang habis.');
      return;
    }
    const clamped = Math.min(avail, Math.floor(nextQty));
    if (nextQty > avail) {
      showStockAlert(`Maksimum pembelian sesuai sisa stok cabang (${avail} pcs).`);
    }
    setCart((prev) =>
      prev.map((i) =>
        i.productId === productId ? { ...i, qty: clamped } : i
      )
    );
  };

  const handleReset = () => {
    setCart([]);
    setDiscount(DEFAULT_DISCOUNT);
    setInputQty(1);
  };

  const handleConfirmPayment = async (
    method: PaymentMethod,
    amountPaid: number
  ) => {
    if (!user || cart.length === 0) return;
    if (!activeBranch) {
      throw new Error('Belum ada cabang aktif. Buat cabang di Dashboard Admin.');
    }

    const invoiceNo = `INV-${String(transactions.length + 1).padStart(4, '0')}`;
    const change = Math.max(0, amountPaid - totals.grandTotal);

    const tx = await createTransactionAtomic(user.uid, {
      branchId: activeBranch.id,
      branchName: activeBranch.name,
      invoiceNo,
      cashierName: activeCashierName,
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

    setCheckoutOpen(false);
    setActiveReceipt(tx);
    handleReset();
  };

  const handleOpenHistoricalReceipt = async (tx: SimpleTransaction) => {
    if (!user) return;
    if (tx.items.length > 0) {
      setHistoryOpen(false);
      setActiveReceipt(tx);
      return;
    }
    setLoadingReceipt(true);
    try {
      const items = await fetchTransactionItems(user.uid, tx.id);
      setHistoryOpen(false);
      setActiveReceipt({ ...tx, items });
    } catch (err) {
      setFatalError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoadingReceipt(false);
    }
  };

  if (!authReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin text-[#1B8EE6]" />
          <span>Memuat KasirPOS...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const activeStaffList = staffAccounts.filter((s) => s.active);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-100 select-none">
      {/* Top Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 bg-[#1B8EE6] px-4 text-white shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <div className="truncate text-base font-extrabold tracking-tight whitespace-nowrap">
            {profile?.storeName || 'Hikemore Store'}
          </div>

          <div className="flex items-center rounded-lg bg-white/15 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('pos')}
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-bold whitespace-nowrap transition-colors ${
                viewMode === 'pos'
                  ? 'bg-white text-[#1B8EE6] shadow-sm'
                  : 'text-white/90 hover:text-white'
              }`}
            >
              <ShoppingBag className="h-3.5 w-3.5" />
              <span>POS Kasir</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('admin')}
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-bold whitespace-nowrap transition-colors ${
                viewMode === 'admin'
                  ? 'bg-white text-[#1B8EE6] shadow-sm'
                  : 'text-white/90 hover:text-white'
              }`}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              <span>Dashboard Admin</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Active Branch Selector */}
          {activeBranchList.length > 0 && viewMode === 'pos' && (
            <div className="hidden items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-2.5 py-1 text-xs md:flex">
              <Building2 className="h-3.5 w-3.5 text-white/90" />
              <select
                aria-label="Pilih cabang aktif"
                value={activeBranch?.id ?? ''}
                onChange={(e) => handleBranchSwitch(e.target.value)}
                className="cursor-pointer bg-transparent font-bold text-white focus:outline-none"
              >
                {activeBranchList.map((b) => (
                  <option
                    key={b.id}
                    value={b.id}
                    className="bg-white text-slate-900"
                  >
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Active Cashier Selector */}
          {activeStaffList.length > 0 && (
            <div className="hidden items-center gap-1.5 rounded-lg border border-white/25 bg-white/10 px-2.5 py-1 text-xs lg:flex">
              <UserCheck className="h-3.5 w-3.5 text-white/85" />
              <select
                aria-label="Pilih kasir aktif"
                value={activeStaffId ?? activeStaffList[0].id}
                onChange={(e) => setActiveStaffId(e.target.value)}
                className="cursor-pointer bg-transparent font-semibold text-white focus:outline-none"
              >
                {activeStaffList.map((stf) => (
                  <option
                    key={stf.id}
                    value={stf.id}
                    className="bg-white text-slate-900"
                  >
                    {stf.displayName} ({stf.role === 'admin' ? 'Admin' : 'Kasir'})
                  </option>
                ))}
              </select>
            </div>
          )}

          {viewMode === 'pos' && (
            <>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-white/35 bg-white/10 px-3 text-xs font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/20"
              >
                <History className="h-4 w-4" />
                <span className="hidden sm:inline">
                  Riwayat ({transactions.length})
                </span>
              </button>

              <button
                type="button"
                onClick={handleReset}
                disabled={cart.length === 0 && discount.mode === 'none'}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-white/35 bg-white/10 px-3 text-xs font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">Reset</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => void signOut(auth)}
            title="Keluar akun"
            className="flex h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold whitespace-nowrap text-white transition-colors hover:bg-white/25"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      {viewMode === 'admin' ? (
        <AdminDashboard
          profile={profile}
          branches={branches}
          activeBranchId={activeBranch?.id ?? null}
          products={products}
          branchStocks={branchStocks}
          stockLogs={stockLogs}
          vouchers={vouchers}
          staffAccounts={staffAccounts}
          activeStaffId={activeStaffId}
          transactions={transactions}
          salesLines={salesLines}
          hasLegacyCafe={legacyCafeDetected}
          onBackToPos={() => setViewMode('pos')}
          onSelectActiveBranch={(id) => handleBranchSwitch(id)}
          onSelectActiveStaff={(id) => setActiveStaffId(id)}
          onUpdateProfile={(input) => updateUserProfile(user.uid, input)}
          onSaveBranch={async (input) => {
            await saveBranchToFirestore(user.uid, input);
          }}
          onDeleteBranch={(branchId) =>
            deleteBranchFromFirestore(user.uid, branchId)
          }
          onAdjustStock={(params) =>
            adjustBranchStockAtomic(user.uid, {
              ...params,
              actorName: activeCashierName,
            })
          }
          onReplaceLegacyCafe={() =>
            replaceLegacyCafeWithHikemore(
              user.uid,
              products,
              branches,
              branchStocks,
              activeCashierName
            )
          }
          onImportRows={(rows, includeSales) =>
            importCatalogRowsToFirestore(user.uid, rows, {
              existingBranches: branches,
              existingProducts: products,
              existingStocks: branchStocks,
              includeSales,
              actorName: activeCashierName,
            })
          }
          onSaveProduct={async (input) => {
            await saveProductToFirestore(user.uid, {
              ...input,
              actorName: activeCashierName,
            });
          }}
          onDeleteProduct={(id) => deleteProductFromFirestore(user.uid, id)}
          onSaveVoucher={(input) => saveVoucherToFirestore(user.uid, input)}
          onDeleteVoucher={(id) => deleteVoucherFromFirestore(id)}
          onSaveStaff={(input) => saveStaffAccountToFirestore(user.uid, input)}
          onDeleteStaff={(id) => deleteStaffAccountFromFirestore(id)}
          onViewReceipt={(tx) => void handleOpenHistoricalReceipt(tx)}
        />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {/* LEFT PANEL: Cari/Scan + Qty, Keranjang, Diskon, Bayar */}
          <section className="flex h-full w-full flex-col border-r border-slate-200 bg-white md:w-[46%] lg:w-[44%]">
            {/* Mobile Branch Switcher */}
            {activeBranchList.length > 0 && (
              <div className="flex items-center justify-between border-b border-slate-200 bg-sky-50 px-3.5 py-2 text-xs md:hidden">
                <span className="font-semibold text-slate-600">
                  Cabang Aktif:
                </span>
                <select
                  value={activeBranch?.id ?? ''}
                  onChange={(e) => handleBranchSwitch(e.target.value)}
                  className="rounded border border-sky-200 bg-white px-2 py-1 font-bold text-[#1B8EE6]"
                >
                  {activeBranchList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Input Bar */}
            <div className="shrink-0 border-b border-slate-200 bg-slate-50/80 p-3.5">
              <div className="flex items-end gap-2.5">
                <div className="min-w-0 flex-1">
                  <ProductSearchScan
                    products={products}
                    stockByProductId={stockByProductId}
                    activeBranchName={activeBranch?.name}
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

              {stockAlert && (
                <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{stockAlert}</span>
                </div>
              )}
            </div>

            {/* Table Header */}
            <div className="grid shrink-0 grid-cols-12 items-center bg-[#9EA6AF] px-3.5 py-2 text-xs font-bold text-slate-900">
              <div className="col-span-5">Produk</div>
              <div className="col-span-4 text-center">Qty</div>
              <div className="col-span-3 text-right">Total</div>
            </div>

            {/* Cart List */}
            <div className="pos-scroll flex-1 overflow-y-auto divide-y divide-slate-100">
              {cart.length === 0 ? (
                <div className="flex h-full min-h-[160px] flex-col items-center justify-center px-6 text-center">
                  <ShoppingBag className="mb-2 h-8 w-8 text-slate-300" />
                  <p className="text-sm font-semibold text-slate-700">
                    Keranjang masih kosong
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Cabang aktif:{' '}
                    <strong>{activeBranch?.name ?? 'Belum dipilih'}</strong>.
                    Ketik/scan Kode Item atau pilih produk di sebelah kanan.
                  </p>
                </div>
              ) : (
                cart.map((item, idx) => {
                  const avail = stockByProductId[item.productId] ?? 0;
                  return (
                    <div
                      key={item.productId}
                      className={`grid grid-cols-12 items-center gap-2 px-3.5 py-2.5 ${
                        idx % 2 === 1 ? 'bg-[#F3F6FA]' : 'bg-white'
                      }`}
                    >
                      <div className="col-span-5 min-w-0">
                        <div className="truncate text-[13px] font-semibold text-slate-900">
                          {item.name}
                        </div>
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          {formatRupiah(item.unitPrice)} · Sisa {avail} pcs
                        </div>
                      </div>

                      {/* Inline Qty Stepper */}
                      <div className="col-span-4 flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateItemQty(item.productId, item.qty - 1)
                          }
                          aria-label={`Kurangi ${item.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 active:scale-95"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={avail}
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
                          disabled={item.qty >= avail}
                          onClick={() =>
                            updateItemQty(item.productId, item.qty + 1)
                          }
                          aria-label={`Tambah ${item.name}`}
                          className="flex h-7 w-7 items-center justify-center rounded-md bg-[#1B8EE6] text-white hover:bg-[#1479C9] active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300"
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
                  );
                })
              )}
            </div>

            {/* Discount Control */}
            <div className="shrink-0 space-y-3 border-t border-slate-200 bg-white p-3.5">
              <DiscountControl
                discount={discount}
                totals={totals}
                vouchers={activeVouchers}
                onChange={setDiscount}
              />

              <div className="space-y-1.5 px-1 text-sm tabular-nums">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Subtotal ({totals.totalQty} pcs)</span>
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

            {/* Pay Button */}
            <button
              type="button"
              disabled={cart.length === 0 || !activeBranch}
              onClick={() => setCheckoutOpen(true)}
              className="flex h-14 w-full shrink-0 items-center justify-between bg-[#4CAF50] px-5 text-white transition-colors hover:bg-[#43A047] active:bg-[#388E3C] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <span className="text-sm font-bold tracking-wide">BAYAR</span>
              <span className="font-mono-num text-xl font-extrabold">
                {formatRupiah(totals.grandTotal)}
              </span>
            </button>
          </section>

          {/* RIGHT PANEL: Katalog Produk & Stok Cabang Aktif */}
          <section className="flex h-full flex-1 flex-col overflow-hidden bg-[#1B8EE6]">
            {/* Dynamic Category Filter */}
            <div className="flex shrink-0 items-center justify-between gap-2 p-3">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {dynamicCategories.map((cat) => {
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
              <span className="hidden shrink-0 text-xs font-semibold text-white/90 sm:inline tabular-nums">
                {activeBranch?.name ?? 'Cabang'} · {filteredProducts.length}{' '}
                produk
              </span>
            </div>

            {/* Product Cards Grid */}
            <div className="pos-scroll-blue flex-1 overflow-y-auto px-3 pb-3">
              {syncingData && products.length === 0 ? (
                <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-white">
                  <Loader2 className="mb-2 h-6 w-6 animate-spin" />
                  <p className="text-xs font-semibold">
                    Memuat katalog & stok cabang dari Firestore...
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
                      onClick={() => setViewMode('admin')}
                      className="rounded-lg border border-white/40 bg-white/15 px-3.5 py-1.5 text-xs font-bold text-white"
                    >
                      Buka Panel Admin
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                  {filteredProducts.map((product) => (
                    <SimpleProductCard
                      key={product.id}
                      product={product}
                      availableStock={stockByProductId[product.id] ?? 0}
                      inCartQty={qtyByProduct[product.id] ?? 0}
                      onAdd={() => addProductToCart(product, inputQty)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        </main>
      )}

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
          branchName={activeBranch?.name}
          onClose={() => setCheckoutOpen(false)}
          onConfirm={(method, paid) => handleConfirmPayment(method, paid)}
        />
      )}

      {activeReceipt && (
        <SimpleReceiptModal
          transaction={activeReceipt}
          storeName={profile?.storeName || 'Hikemore Store'}
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
    </div>
  );
}

function SimpleProductCard({
  product,
  availableStock,
  inCartQty,
  onAdd,
}: {
  product: Product;
  availableStock: number;
  inCartQty: number;
  onAdd: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const outOfStock = availableStock <= 0;

  return (
    <button
      type="button"
      disabled={outOfStock}
      onClick={onAdd}
      className={`group relative flex flex-col overflow-hidden rounded-lg bg-white text-left shadow-sm transition-transform duration-150 ${
        outOfStock
          ? 'cursor-not-allowed opacity-65'
          : 'hover:shadow-md active:scale-[0.97]'
      }`}
    >
      <div className="relative flex aspect-[4/2.6] w-full items-center justify-center overflow-hidden bg-slate-50 p-2">
        {!imgError && product.image ? (
          <img
            src={product.image}
            alt={product.name}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="h-full w-full rounded object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center rounded bg-slate-100 px-2 text-center text-slate-400">
            <Package className="h-6 w-6 text-slate-400" />
            <span className="mt-1 truncate text-[10px] font-semibold text-slate-500">
              {product.category}
            </span>
          </div>
        )}

        {inCartQty > 0 && (
          <span className="absolute top-2 right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#1B8EE6] px-1.5 text-[11px] font-bold text-white shadow tabular-nums">
            {inCartQty}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-between px-2.5 pt-2 pb-2.5">
        <div className="line-clamp-2 min-h-[32px] text-xs leading-snug font-semibold text-slate-800">
          {product.name}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-1">
          <span
            className={`font-mono-num text-[11px] font-bold ${
              outOfStock
                ? 'text-rose-600'
                : availableStock <= 2
                  ? 'text-amber-600'
                  : 'text-emerald-700'
            }`}
          >
            {outOfStock ? 'Stok Habis' : `Sisa ${availableStock} pcs`}
          </span>
          <span className="font-mono-num text-[12.5px] font-bold text-slate-900">
            {formatNumber(product.price)}
          </span>
        </div>
        <div className="font-mono-num mt-0.5 truncate text-[10px] text-slate-400">
          {product.sku}
        </div>
      </div>
    </button>
  );
}
