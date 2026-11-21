import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  Check,
  Download,
  FileSpreadsheet,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  Tag,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import { SUGGESTED_CATEGORIES } from '../data/catalog';
import {
  Branch,
  BranchStock,
  ImportProgress,
  ImportedCatalogRow,
  PaymentMethod,
  Product,
  SalesLine,
  SimpleTransaction,
  StaffAccount,
  StaffRole,
  StockLog,
  UserProfile,
  VoucherDef,
} from '../types/pos';
import { formatDateTime, formatNumber, formatRupiah } from '../utils/format';
import { ImportMigrationPanel } from './ImportMigrationPanel';
import { InventoryBranchPanel } from './InventoryBranchPanel';
import { RestockAnalyticsPanel } from './RestockAnalyticsPanel';

type AdminTab =
  | 'analytics'
  | 'inventory'
  | 'import'
  | 'products'
  | 'vouchers'
  | 'users'
  | 'reports';

interface AdminDashboardProps {
  profile: UserProfile | null;
  branches: Branch[];
  activeBranchId: string | null;
  products: Product[];
  branchStocks: BranchStock[];
  stockLogs: StockLog[];
  vouchers: VoucherDef[];
  staffAccounts: StaffAccount[];
  activeStaffId: string | null;
  transactions: SimpleTransaction[];
  salesLines: SalesLine[];
  hasLegacyCafe: boolean;
  onBackToPos: () => void;
  onSelectActiveBranch: (branchId: string) => void;
  onSelectActiveStaff: (staffId: string) => void;
  onUpdateProfile: (input: {
    displayName: string;
    storeName: string;
  }) => Promise<void>;
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
    salesLinesSkipped?: number;
  }>;
  onSaveProduct: (input: {
    id?: string;
    sku: string;
    barcode: string;
    name: string;
    price: number;
    image: string;
    category: string;
    initialBranchId?: string;
    initialBranchName?: string;
    initialStockQty?: number;
  }) => Promise<void>;
  onDeleteProduct: (productId: string) => Promise<void>;
  onSaveVoucher: (input: {
    id?: string;
    code: string;
    label: string;
    type: 'percent' | 'fixed';
    value: number;
    minSubtotal: number;
    active: boolean;
  }) => Promise<void>;
  onDeleteVoucher: (voucherId: string) => Promise<void>;
  onSaveStaff: (input: {
    id?: string;
    displayName: string;
    username: string;
    role: StaffRole;
    active: boolean;
  }) => Promise<void>;
  onDeleteStaff: (staffId: string) => Promise<void>;
  onViewReceipt: (tx: SimpleTransaction) => void;
}

export function AdminDashboard({
  profile,
  branches,
  activeBranchId,
  products,
  branchStocks,
  stockLogs,
  vouchers,
  staffAccounts,
  activeStaffId,
  transactions,
  salesLines,
  hasLegacyCafe,
  onBackToPos,
  onSelectActiveBranch,
  onSelectActiveStaff,
  onUpdateProfile,
  onSaveBranch,
  onDeleteBranch,
  onAdjustStock,
  onReplaceLegacyCafe,
  onImportRows,
  onSaveProduct,
  onDeleteProduct,
  onSaveVoucher,
  onDeleteVoucher,
  onSaveStaff,
  onDeleteStaff,
  onViewReceipt,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('analytics');
  const [notice, setNotice] = useState<string | null>(null);

  const flashNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => {
      setNotice((prev) => (prev === msg ? null : prev));
    }, 2800);
  };

  /* ---------- Dynamic Categories & Total Stock Map ---------- */
  const categorySuggestions = useMemo(() => {
    const set = new Set<string>(SUGGESTED_CATEGORIES);
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const totalStockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const st of branchStocks) {
      map.set(st.productId, (map.get(st.productId) ?? 0) + st.currentStock);
    }
    return map;
  }, [branchStocks]);

  /* ---------- Products Form State ---------- */
  const [prodSearch, setProdSearch] = useState('');
  const [prodEditId, setProdEditId] = useState<string | undefined>(undefined);
  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodBarcode, setProdBarcode] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodCategory, setProdCategory] = useState('Daypack');
  const [prodImage, setProdImage] = useState('');
  const [prodInitBranchId, setProdInitBranchId] = useState(
    activeBranchId ?? branches[0]?.id ?? ''
  );
  const [prodInitStock, setProdInitStock] = useState('10');
  const [prodSaving, setProdSaving] = useState(false);

  useEffect(() => {
    if (!prodInitBranchId && branches.length > 0) {
      setProdInitBranchId(activeBranchId ?? branches[0].id);
    }
  }, [branches, activeBranchId, prodInitBranchId]);

  const resetProdForm = () => {
    setProdEditId(undefined);
    setProdName('');
    setProdSku('');
    setProdBarcode('');
    setProdPrice('');
    setProdCategory('Daypack');
    setProdImage('');
    setProdInitStock('10');
  };

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodName.trim()) return;
    setProdSaving(true);
    try {
      const targetBranch = branches.find((b) => b.id === prodInitBranchId);
      await onSaveProduct({
        id: prodEditId,
        name: prodName.trim(),
        sku: prodSku.trim(),
        barcode: prodBarcode.trim(),
        price: Math.max(0, parseInt(prodPrice || '0', 10) || 0),
        image: prodImage.trim(),
        category: prodCategory.trim() || 'Umum',
        initialBranchId: !prodEditId ? targetBranch?.id : undefined,
        initialBranchName: !prodEditId ? targetBranch?.name : undefined,
        initialStockQty: !prodEditId
          ? Math.max(0, parseInt(prodInitStock || '0', 10) || 0)
          : undefined,
      });
      flashNotice(prodEditId ? 'Produk diperbarui' : 'Produk ditambahkan');
      resetProdForm();
    } finally {
      setProdSaving(false);
    }
  };

  /* ---------- Vouchers Form State ---------- */
  const [vchEditId, setVchEditId] = useState<string | undefined>(undefined);
  const [vchCode, setVchCode] = useState('');
  const [vchLabel, setVchLabel] = useState('');
  const [vchType, setVchType] = useState<'percent' | 'fixed'>('percent');
  const [vchValue, setVchValue] = useState('');
  const [vchMinSub, setVchMinSub] = useState('');
  const [vchActive, setVchActive] = useState(true);
  const [vchSaving, setVchSaving] = useState(false);

  const resetVchForm = () => {
    setVchEditId(undefined);
    setVchCode('');
    setVchLabel('');
    setVchType('percent');
    setVchValue('');
    setVchMinSub('');
    setVchActive(true);
  };

  const handleVoucherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vchCode.trim()) return;
    setVchSaving(true);
    try {
      await onSaveVoucher({
        id: vchEditId,
        code: vchCode.trim().toUpperCase(),
        label: vchLabel.trim(),
        type: vchType,
        value: Math.max(0, parseInt(vchValue || '0', 10) || 0),
        minSubtotal: Math.max(0, parseInt(vchMinSub || '0', 10) || 0),
        active: vchActive,
      });
      flashNotice(vchEditId ? 'Voucher diperbarui' : 'Voucher ditambahkan');
      resetVchForm();
    } finally {
      setVchSaving(false);
    }
  };

  /* ---------- Users & Store Profile State ---------- */
  const [storeNameInput, setStoreNameInput] = useState(
    profile?.storeName ?? 'Hikemore Store'
  );
  const [ownerNameInput, setOwnerNameInput] = useState(
    profile?.displayName ?? 'Admin Utama'
  );
  const [profileSaving, setProfileSaving] = useState(false);

  useEffect(() => {
    if (profile?.storeName) setStoreNameInput(profile.storeName);
    if (profile?.displayName) setOwnerNameInput(profile.displayName);
  }, [profile?.storeName, profile?.displayName]);

  const [staffEditId, setStaffEditId] = useState<string | undefined>(undefined);
  const [staffName, setStaffName] = useState('');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffRole, setStaffRole] = useState<StaffRole>('kasir');
  const [staffActive, setStaffActive] = useState(true);
  const [staffSaving, setStaffSaving] = useState(false);

  const resetStaffForm = () => {
    setStaffEditId(undefined);
    setStaffName('');
    setStaffUsername('');
    setStaffRole('kasir');
    setStaffActive(true);
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    try {
      await onUpdateProfile({
        displayName: ownerNameInput,
        storeName: storeNameInput,
      });
      flashNotice('Profil toko diperbarui');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffName.trim()) return;
    setStaffSaving(true);
    try {
      await onSaveStaff({
        id: staffEditId,
        displayName: staffName.trim(),
        username: staffUsername.trim(),
        role: staffRole,
        active: staffActive,
      });
      flashNotice(
        staffEditId ? 'Akun pengguna diperbarui' : 'Akun pengguna ditambahkan'
      );
      resetStaffForm();
    } finally {
      setStaffSaving(false);
    }
  };

  /* ---------- Transactions Filter & CSV Export ---------- */
  const [txSearch, setTxSearch] = useState('');
  const [txBranchFilter, setTxBranchFilter] = useState<string>('all');
  const [txMethodFilter, setTxMethodFilter] = useState<'all' | PaymentMethod>(
    'all'
  );

  const filteredTx = useMemo(() => {
    return transactions.filter((t) => {
      if (txBranchFilter !== 'all' && t.branchId !== txBranchFilter) {
        return false;
      }
      if (txMethodFilter !== 'all' && t.paymentMethod !== txMethodFilter) {
        return false;
      }
      if (txSearch.trim()) {
        const q = txSearch.toLowerCase().trim();
        return (
          t.invoiceNo.toLowerCase().includes(q) ||
          (t.cashierName ?? '').toLowerCase().includes(q) ||
          (t.branchName ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [transactions, txBranchFilter, txMethodFilter, txSearch]);

  const handleExportCsv = () => {
    const header = [
      'Invoice',
      'Cabang',
      'Waktu',
      'Kasir',
      'Sumber',
      'Qty',
      'Subtotal',
      'Diskon',
      'Total',
      'Metode',
    ];
    const rows = filteredTx.map((t) => [
      t.invoiceNo,
      `"${(t.branchName ?? 'Pusat').replace(/"/g, '""')}"`,
      formatDateTime(t.createdAt),
      `"${(t.cashierName ?? 'Admin').replace(/"/g, '""')}"`,
      t.source ?? 'pos',
      t.totalQty ?? 0,
      t.subtotal,
      t.discountAmount,
      t.grandTotal,
      t.paymentMethod.toUpperCase(),
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-transaksi-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredProducts = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [products, prodSearch]);

  const navItems: Array<{
    id: AdminTab;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }> = [
    {
      id: 'analytics',
      label: 'Rekapan & Restok',
      icon: <BarChart3 className="h-4 w-4" />,
    },
    {
      id: 'inventory',
      label: 'Cabang & Stok',
      icon: <Building2 className="h-4 w-4" />,
      count: branches.length,
    },
    {
      id: 'import',
      label: 'Impor & Migrasi',
      icon: <FileSpreadsheet className="h-4 w-4" />,
    },
    {
      id: 'products',
      label: 'Kelola Produk',
      icon: <Package className="h-4 w-4" />,
      count: products.length,
    },
    {
      id: 'vouchers',
      label: 'Kelola Voucher',
      icon: <Tag className="h-4 w-4" />,
      count: vouchers.length,
    },
    {
      id: 'users',
      label: 'Akun Pengguna',
      icon: <Users className="h-4 w-4" />,
      count: staffAccounts.length,
    },
    {
      id: 'reports',
      label: 'Laporan Transaksi',
      icon: <ReceiptText className="h-4 w-4" />,
      count: transactions.length,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[#F8FAFC]">
      {/* Left Sidebar Navigation */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-200 px-4 py-4">
          <div className="text-xs font-semibold text-slate-400">
            Dashboard Admin
          </div>
          <div className="mt-0.5 truncate text-sm font-bold text-slate-900">
            {profile?.storeName || 'Hikemore Store'}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500">
            {profile?.displayName || 'Admin Utama'}
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-sky-50 text-[#1B8EE6]'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 whitespace-nowrap">
                  {item.icon}
                  <span>{item.label}</span>
                </span>
                {item.count !== undefined && (
                  <span className="font-mono-num text-[11px] text-slate-400">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <button
            type="button"
            onClick={onBackToPos}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#1B8EE6] text-xs font-bold text-white transition-colors hover:bg-[#1479C9]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Kembali ke Kasir POS</span>
          </button>
        </div>
      </aside>

      {/* Main Dashboard Viewport */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile Tab Switcher */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${
                activeTab === item.id
                  ? 'bg-[#1B8EE6] text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Scrollable Content */}
        <div className="pos-scroll flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-6xl space-y-5">
            {/* Notification Toast */}
            {notice && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800">
                <Check className="h-4 w-4" />
                <span>{notice}</span>
              </div>
            )}

            {/* Quick Legacy Cafe Cleanup Banner (shown on other tabs so user notices immediately) */}
            {hasLegacyCafe && activeTab !== 'import' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-xs text-amber-900">
                  <strong>Produk contoh kafe masih ada di katalog.</strong>{' '}
                  Ganti sekali klik ke 13 produk Hikemore (CFD Senayan) agar
                  katalog & stok bersih.
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('import')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700 whitespace-nowrap"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Buka Migrasi Data</span>
                </button>
              </div>
            )}

            {/* ================= TAB 1: REKAPAN & RESTOK ================= */}
            {activeTab === 'analytics' && (
              <RestockAnalyticsPanel
                branches={branches}
                products={products}
                branchStocks={branchStocks}
                transactions={transactions}
                salesLines={salesLines}
                onQuickRestock={async ({
                  branchId,
                  branchName,
                  product,
                  qtyAdd,
                  note,
                }) => {
                  await onAdjustStock({
                    branchId,
                    branchName,
                    product,
                    mode: 'restock',
                    qtyInput: qtyAdd,
                    note,
                  });
                  flashNotice(
                    `Restok +${qtyAdd} pcs untuk ${product.name} (${branchName}) berhasil`
                  );
                }}
              />
            )}

            {/* ================= TAB 2: CABANG & STOK ================= */}
            {activeTab === 'inventory' && (
              <InventoryBranchPanel
                branches={branches}
                products={products}
                branchStocks={branchStocks}
                stockLogs={stockLogs}
                activeBranchId={activeBranchId}
                onSelectActiveBranch={onSelectActiveBranch}
                onSaveBranch={onSaveBranch}
                onDeleteBranch={onDeleteBranch}
                onAdjustStock={onAdjustStock}
                onNotify={flashNotice}
              />
            )}

            {/* ================= TAB 3: IMPOR & MIGRASI ================= */}
            {activeTab === 'import' && (
              <ImportMigrationPanel
                branches={branches}
                hasLegacyCafe={hasLegacyCafe}
                onReplaceLegacyCafe={onReplaceLegacyCafe}
                onImportRows={onImportRows}
                onNotify={flashNotice}
              />
            )}

            {/* ================= TAB 4: KELOLA PRODUK ================= */}
            {activeTab === 'products' && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                {/* Product Form */}
                <form
                  onSubmit={handleProductSubmit}
                  className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-4"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900">
                      {prodEditId ? 'Edit Produk' : 'Tambah Produk Baru'}
                    </h2>
                    {prodEditId && (
                      <button
                        type="button"
                        onClick={resetProdForm}
                        className="text-xs font-semibold text-[#1B8EE6] hover:underline"
                      >
                        Batal
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Nama Produk
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={100}
                      value={prodName}
                      onChange={(e) => setProdName(e.target.value)}
                      placeholder="Contoh: Daypack Hikemore Wagner NV"
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Harga Jual (Rp)
                      </label>
                      <input
                        type="number"
                        required
                        min={0}
                        value={prodPrice}
                        onChange={(e) => setProdPrice(e.target.value)}
                        placeholder="217000"
                        className="font-mono-num h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Kategori (Bebas)
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={50}
                        list="category-suggestions"
                        value={prodCategory}
                        onChange={(e) => setProdCategory(e.target.value)}
                        placeholder="Daypack / Jacket"
                        className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      />
                      <datalist id="category-suggestions">
                        {categorySuggestions.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Kode Item / SKU
                      </label>
                      <input
                        type="text"
                        maxLength={32}
                        value={prodSku}
                        onChange={(e) => setProdSku(e.target.value)}
                        placeholder="101021002000"
                        className="font-mono-num h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Barcode (Opsional)
                      </label>
                      <input
                        type="text"
                        maxLength={64}
                        value={prodBarcode}
                        onChange={(e) => setProdBarcode(e.target.value)}
                        placeholder="Otomatis ikut SKU"
                        className="font-mono-num h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>
                  </div>

                  {!prodEditId && branches.length > 0 && (
                    <div className="grid grid-cols-2 gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                          Stok Awal Cabang
                        </label>
                        <select
                          value={prodInitBranchId}
                          onChange={(e) => setProdInitBranchId(e.target.value)}
                          className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900"
                        >
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                          Jumlah Awal (pcs)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={1000000}
                          value={prodInitStock}
                          onChange={(e) => setProdInitStock(e.target.value)}
                          className="font-mono-num h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-900"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      URL Foto Produk (Opsional)
                    </label>
                    <input
                      type="text"
                      maxLength={300}
                      value={prodImage}
                      onChange={(e) => setProdImage(e.target.value)}
                      placeholder="Kosongkan jika tanpa foto"
                      className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={prodSaving}
                    className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-[#4CAF50] text-xs font-bold text-white hover:bg-[#43A047] disabled:bg-slate-300"
                  >
                    <Plus className="h-4 w-4" />
                    <span>
                      {prodSaving
                        ? 'Menyimpan...'
                        : prodEditId
                          ? 'Simpan Perubahan'
                          : 'Tambah Produk'}
                    </span>
                  </button>
                </form>

                {/* Product Table */}
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-8">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                    <span className="text-xs font-bold text-slate-700">
                      Master Produk ({filteredProducts.length})
                    </span>
                    <div className="relative w-full sm:w-56">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={prodSearch}
                        onChange={(e) => setProdSearch(e.target.value)}
                        placeholder="Cari nama, Kode Item, kategori..."
                        className="h-8 w-full rounded-lg border border-slate-300 pr-3 pl-8 text-xs focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5 font-semibold">Produk</th>
                          <th className="px-3 py-2.5 font-semibold">
                            Kategori
                          </th>
                          <th className="px-3 py-2.5 text-right font-semibold">
                            Total Stok
                          </th>
                          <th className="px-3 py-2.5 text-right font-semibold">
                            Harga
                          </th>
                          <th className="px-4 py-2.5 text-right font-semibold">
                            Aksi
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredProducts.map((p) => {
                          const totalStk = totalStockByProduct.get(p.id) ?? 0;
                          return (
                            <tr key={p.id} className="hover:bg-slate-50">
                              <td className="px-4 py-2.5">
                                <div className="font-semibold text-slate-900">
                                  {p.name}
                                </div>
                                <div className="font-mono-num text-[11px] text-slate-400">
                                  {p.sku}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-slate-600">
                                {p.category}
                              </td>
                              <td
                                className={`font-mono-num px-3 py-2.5 text-right font-bold whitespace-nowrap ${
                                  totalStk <= 0
                                    ? 'text-rose-600'
                                    : 'text-slate-700'
                                }`}
                              >
                                {totalStk} pcs
                              </td>
                              <td className="font-mono-num px-3 py-2.5 text-right font-bold text-slate-900 whitespace-nowrap">
                                {formatRupiah(p.price)}
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                <div className="inline-flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setProdEditId(p.id);
                                      setProdName(p.name);
                                      setProdSku(p.sku);
                                      setProdBarcode(p.barcode);
                                      setProdPrice(String(p.price));
                                      setProdCategory(p.category);
                                      setProdImage(p.image);
                                    }}
                                    aria-label={`Edit ${p.name}`}
                                    className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void onDeleteProduct(p.id);
                                      flashNotice('Produk dihapus');
                                    }}
                                    aria-label={`Hapus ${p.name}`}
                                    className="flex h-7 w-7 items-center justify-center rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
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
            )}

            {/* ================= TAB 5: KELOLA VOUCHER ================= */}
            {activeTab === 'vouchers' && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <form
                  onSubmit={handleVoucherSubmit}
                  className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-4"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900">
                      {vchEditId ? 'Edit Voucher' : 'Buat Voucher Promo'}
                    </h2>
                    {vchEditId && (
                      <button
                        type="button"
                        onClick={resetVchForm}
                        className="text-xs font-semibold text-[#1B8EE6] hover:underline"
                      >
                        Batal
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Kode Voucher
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={32}
                      value={vchCode}
                      onChange={(e) => setVchCode(e.target.value.toUpperCase())}
                      placeholder="Contoh: CFD15"
                      className="font-mono-num h-9 w-full rounded-lg border border-slate-300 px-3 text-xs uppercase text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Jenis Diskon
                      </label>
                      <select
                        value={vchType}
                        onChange={(e) =>
                          setVchType(e.target.value as 'percent' | 'fixed')
                        }
                        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      >
                        <option value="percent">Persen (%)</option>
                        <option value="fixed">Nominal (Rp)</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Nilai ({vchType === 'percent' ? '%' : 'Rp'})
                      </label>
                      <input
                        type="number"
                        required
                        min={1}
                        max={vchType === 'percent' ? 100 : 1000000000}
                        value={vchValue}
                        onChange={(e) => setVchValue(e.target.value)}
                        placeholder={vchType === 'percent' ? '15' : '25000'}
                        className="font-mono-num h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Label Ringkas
                      </label>
                      <input
                        type="text"
                        maxLength={40}
                        value={vchLabel}
                        onChange={(e) => setVchLabel(e.target.value)}
                        placeholder="15% / Rp 25rb"
                        className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Min. Belanja (Rp)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={vchMinSub}
                        onChange={(e) => setVchMinSub(e.target.value)}
                        placeholder="0"
                        className="font-mono-num h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={vchActive}
                      onChange={(e) => setVchActive(e.target.checked)}
                      className="h-4 w-4 accent-[#1B8EE6]"
                    />
                    <span>Aktifkan voucher di POS</span>
                  </label>

                  <button
                    type="submit"
                    disabled={vchSaving}
                    className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-[#4CAF50] text-xs font-bold text-white hover:bg-[#43A047] disabled:bg-slate-300"
                  >
                    <Plus className="h-4 w-4" />
                    <span>
                      {vchSaving
                        ? 'Menyimpan...'
                        : vchEditId
                          ? 'Simpan Voucher'
                          : 'Tambah Voucher'}
                    </span>
                  </button>
                </form>

                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-8">
                  <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold text-slate-700">
                    Daftar Voucher ({vouchers.length})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5 font-semibold">Kode</th>
                          <th className="px-3 py-2.5 font-semibold">Potongan</th>
                          <th className="px-3 py-2.5 font-semibold">
                            Min. Belanja
                          </th>
                          <th className="px-3 py-2.5 font-semibold">Status</th>
                          <th className="px-4 py-2.5 text-right font-semibold">
                            Aksi
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {vouchers.map((v) => (
                          <tr key={v.id ?? v.code} className="hover:bg-slate-50">
                            <td className="font-mono-num px-4 py-2.5 font-bold text-slate-900">
                              {v.code}
                            </td>
                            <td className="font-mono-num px-3 py-2.5 font-semibold text-emerald-700">
                              {v.type === 'percent'
                                ? `${v.value}%`
                                : formatRupiah(v.value)}
                            </td>
                            <td className="font-mono-num px-3 py-2.5 text-slate-600">
                              {v.minSubtotal
                                ? formatRupiah(v.minSubtotal)
                                : 'Tanpa minimum'}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`text-xs font-semibold ${
                                  v.active !== false
                                    ? 'text-emerald-700'
                                    : 'text-slate-400'
                                }`}
                              >
                                {v.active !== false ? 'Aktif' : 'Nonaktif'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                              <div className="inline-flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVchEditId(v.id);
                                    setVchCode(v.code);
                                    setVchLabel(v.label);
                                    setVchType(v.type);
                                    setVchValue(String(v.value));
                                    setVchMinSub(String(v.minSubtotal ?? 0));
                                    setVchActive(v.active !== false);
                                  }}
                                  aria-label={`Edit ${v.code}`}
                                  className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                {v.id && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void onDeleteVoucher(v.id!);
                                      flashNotice('Voucher dihapus');
                                    }}
                                    aria-label={`Hapus ${v.code}`}
                                    className="flex h-7 w-7 items-center justify-center rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ================= TAB 6: AKUN PENGGUNA & TOKO ================= */}
            {activeTab === 'users' && (
              <div className="space-y-4">
                <form
                  onSubmit={handleProfileSubmit}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
                    <Store className="h-4 w-4 text-[#1B8EE6]" />
                    <span>Identitas Toko & Pemilik Akun</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Nama Toko (Tampil di Struk)
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={100}
                        value={storeNameInput}
                        onChange={(e) => setStoreNameInput(e.target.value)}
                        className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Nama Admin Utama
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={80}
                        value={ownerNameInput}
                        onChange={(e) => setOwnerNameInput(e.target.value)}
                        className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={profileSaving}
                        className="h-9 w-full rounded-lg bg-[#1B8EE6] text-xs font-bold text-white hover:bg-[#1479C9] disabled:bg-slate-300"
                      >
                        {profileSaving ? 'Menyimpan...' : 'Simpan Profil Toko'}
                      </button>
                    </div>
                  </div>
                </form>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <form
                    onSubmit={handleStaffSubmit}
                    className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-4"
                  >
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-bold text-slate-900">
                        {staffEditId
                          ? 'Edit Akun Operator'
                          : 'Tambah Operator / Kasir'}
                      </h2>
                      {staffEditId && (
                        <button
                          type="button"
                          onClick={resetStaffForm}
                          className="text-xs font-semibold text-[#1B8EE6] hover:underline"
                        >
                          Batal
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Nama Lengkap
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={80}
                        value={staffName}
                        onChange={(e) => setStaffName(e.target.value)}
                        placeholder="Contoh: Rina Wijaya"
                        className="h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Username
                      </label>
                      <input
                        type="text"
                        maxLength={40}
                        value={staffUsername}
                        onChange={(e) => setStaffUsername(e.target.value)}
                        placeholder="rina.kasir"
                        className="font-mono-num h-9 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">
                        Peran (Role)
                      </label>
                      <select
                        value={staffRole}
                        onChange={(e) =>
                          setStaffRole(e.target.value as StaffRole)
                        }
                        className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                      >
                        <option value="kasir">Kasir (Operasional POS)</option>
                        <option value="admin">Admin (Akses Penuh)</option>
                      </select>
                    </div>

                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={staffActive}
                        onChange={(e) => setStaffActive(e.target.checked)}
                        className="h-4 w-4 accent-[#1B8EE6]"
                      />
                      <span>Status Akun Aktif</span>
                    </label>

                    <button
                      type="submit"
                      disabled={staffSaving}
                      className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-[#4CAF50] text-xs font-bold text-white hover:bg-[#43A047] disabled:bg-slate-300"
                    >
                      <Plus className="h-4 w-4" />
                      <span>
                        {staffSaving
                          ? 'Menyimpan...'
                          : staffEditId
                            ? 'Simpan Perubahan'
                            : 'Tambah Pengguna'}
                      </span>
                    </button>
                  </form>

                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-8">
                    <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold text-slate-700">
                      Daftar Pengguna & Operator Kasir ({staffAccounts.length})
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                          <tr>
                            <th className="px-4 py-2.5 font-semibold">Nama</th>
                            <th className="px-3 py-2.5 font-semibold">
                              Username
                            </th>
                            <th className="px-3 py-2.5 font-semibold">Peran</th>
                            <th className="px-3 py-2.5 font-semibold">
                              Status
                            </th>
                            <th className="px-4 py-2.5 text-right font-semibold">
                              Aksi
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {staffAccounts.map((stf) => {
                            const isCurrent = stf.id === activeStaffId;
                            return (
                              <tr key={stf.id} className="hover:bg-slate-50">
                                <td className="px-4 py-2.5 font-semibold text-slate-900">
                                  {stf.displayName}
                                  {isCurrent && (
                                    <span className="ml-2 text-[11px] font-bold text-[#1B8EE6]">
                                      · Aktif di POS
                                    </span>
                                  )}
                                </td>
                                <td className="font-mono-num px-3 py-2.5 text-slate-600">
                                  @{stf.username}
                                </td>
                                <td className="px-3 py-2.5">
                                  <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                                    {stf.role === 'admin' ? (
                                      <ShieldCheck className="h-3.5 w-3.5 text-[#1B8EE6]" />
                                    ) : (
                                      <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                                    )}
                                    {stf.role === 'admin' ? 'Admin' : 'Kasir'}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5">
                                  <span
                                    className={`font-semibold ${
                                      stf.active
                                        ? 'text-emerald-700'
                                        : 'text-slate-400'
                                    }`}
                                  >
                                    {stf.active ? 'Aktif' : 'Nonaktif'}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1">
                                    {stf.active && !isCurrent && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onSelectActiveStaff(stf.id);
                                          flashNotice(
                                            `Kasir aktif diubah ke ${stf.displayName}`
                                          );
                                        }}
                                        className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-bold text-[#1B8EE6] hover:bg-sky-100"
                                      >
                                        Pakai
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setStaffEditId(stf.id);
                                        setStaffName(stf.displayName);
                                        setStaffUsername(stf.username);
                                        setStaffRole(stf.role);
                                        setStaffActive(stf.active);
                                      }}
                                      aria-label={`Edit ${stf.displayName}`}
                                      className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    {staffAccounts.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void onDeleteStaff(stf.id);
                                          flashNotice('Akun operator dihapus');
                                        }}
                                        aria-label={`Hapus ${stf.displayName}`}
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
              </div>
            )}

            {/* ================= TAB 7: LAPORAN TRANSAKSI ================= */}
            {activeTab === 'reports' && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={txSearch}
                        onChange={(e) => setTxSearch(e.target.value)}
                        placeholder="Cari invoice, cabang, kasir..."
                        className="h-8 w-52 rounded-lg border border-slate-300 pr-3 pl-8 text-xs focus:border-[#1B8EE6] focus:outline-none"
                      />
                    </div>
                    <select
                      value={txBranchFilter}
                      onChange={(e) => setTxBranchFilter(e.target.value)}
                      className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 focus:border-[#1B8EE6] focus:outline-none"
                    >
                      <option value="all">Semua Cabang</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={txMethodFilter}
                      onChange={(e) =>
                        setTxMethodFilter(
                          e.target.value as 'all' | PaymentMethod
                        )
                      }
                      className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 focus:border-[#1B8EE6] focus:outline-none"
                    >
                      <option value="all">Semua Metode</option>
                      <option value="cash">Tunai</option>
                      <option value="qris">QRIS</option>
                      <option value="transfer">Transfer</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleExportCsv}
                    disabled={filteredTx.length === 0}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-[#1B8EE6] px-3 text-xs font-bold text-white hover:bg-[#1479C9] disabled:bg-slate-300 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Export CSV ({filteredTx.length})</span>
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Invoice</th>
                        <th className="px-3 py-2.5 font-semibold">Cabang</th>
                        <th className="px-3 py-2.5 font-semibold">Waktu</th>
                        <th className="px-3 py-2.5 font-semibold">Kasir</th>
                        <th className="px-3 py-2.5 font-semibold">Metode</th>
                        <th className="px-3 py-2.5 text-right font-semibold">
                          Total
                        </th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Struk
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTx.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="px-4 py-10 text-center text-slate-400"
                          >
                            Tidak ada transaksi sesuai filter.
                          </td>
                        </tr>
                      ) : (
                        filteredTx.map((tx) => (
                          <tr key={tx.id} className="hover:bg-slate-50">
                            <td className="font-mono-num px-4 py-2.5 font-bold text-slate-900">
                              {tx.invoiceNo}
                              {tx.source === 'import' && (
                                <span className="ml-1.5 text-[10px] font-medium text-slate-400">
                                  (Impor)
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 font-medium text-slate-700">
                              {tx.branchName || 'Pusat'}
                            </td>
                            <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">
                              {formatDateTime(tx.createdAt)}
                            </td>
                            <td className="px-3 py-2.5 text-slate-700">
                              {tx.cashierName || 'Admin'}
                            </td>
                            <td className="px-3 py-2.5 font-semibold text-slate-700 uppercase">
                              {tx.paymentMethod}
                            </td>
                            <td className="font-mono-num px-3 py-2.5 text-right font-bold text-emerald-700 whitespace-nowrap">
                              {formatRupiah(tx.grandTotal)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => onViewReceipt(tx)}
                                className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                <ReceiptText className="h-3 w-3" />
                                <span>Lihat</span>
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
