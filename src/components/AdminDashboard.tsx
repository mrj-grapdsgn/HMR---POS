import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Check,
  Download,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  Store,
  Tag,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import { PRODUCT_CATEGORIES } from '../data/catalog';
import {
  PaymentMethod,
  Product,
  SimpleTransaction,
  StaffAccount,
  StaffRole,
  UserProfile,
  VoucherDef,
} from '../types/pos';
import { formatDateTime, formatNumber, formatRupiah } from '../utils/format';

type AdminTab = 'overview' | 'products' | 'vouchers' | 'users' | 'transactions';

interface AdminDashboardProps {
  profile: UserProfile | null;
  products: Product[];
  vouchers: VoucherDef[];
  staffAccounts: StaffAccount[];
  activeStaffId: string | null;
  transactions: SimpleTransaction[];
  onBackToPos: () => void;
  onSelectActiveStaff: (staffId: string) => void;
  onUpdateProfile: (input: {
    displayName: string;
    storeName: string;
  }) => Promise<void>;
  onSaveProduct: (input: {
    id?: string;
    sku: string;
    barcode: string;
    name: string;
    price: number;
    image: string;
    category: Product['category'];
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

const EDITABLE_CATEGORIES = PRODUCT_CATEGORIES.filter(
  (c): c is Product['category'] => c !== 'Semua'
);

export function AdminDashboard({
  profile,
  products,
  vouchers,
  staffAccounts,
  activeStaffId,
  transactions,
  onBackToPos,
  onSelectActiveStaff,
  onUpdateProfile,
  onSaveProduct,
  onDeleteProduct,
  onSaveVoucher,
  onDeleteVoucher,
  onSaveStaff,
  onDeleteStaff,
  onViewReceipt,
}: AdminDashboardProps) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [notice, setNotice] = useState<string | null>(null);

  const flashNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2600);
  };

  /* ---------- KPIs & Analytics ---------- */
  const stats = useMemo(() => {
    const totalRevenue = transactions.reduce((s, t) => s + t.grandTotal, 0);
    const txCount = transactions.length;
    const avgOrder = txCount > 0 ? Math.round(totalRevenue / txCount) : 0;
    const totalItemsSold = transactions.reduce(
      (s, t) => s + (t.totalQty ?? t.items.reduce((acc, i) => acc + i.qty, 0)),
      0
    );

    const byMethod: Record<PaymentMethod, number> = {
      cash: 0,
      qris: 0,
      transfer: 0,
    };
    transactions.forEach((t) => {
      byMethod[t.paymentMethod] =
        (byMethod[t.paymentMethod] ?? 0) + t.grandTotal;
    });

    // Last 7 days daily sales
    const days: { key: string; label: string; total: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
      });
      days.push({ key, label, total: 0 });
    }
    transactions.forEach((t) => {
      const key = t.createdAt.slice(0, 10);
      const bucket = days.find((d) => d.key === key);
      if (bucket) bucket.total += t.grandTotal;
    });
    const maxDayTotal = Math.max(1, ...days.map((d) => d.total));

    return {
      totalRevenue,
      txCount,
      avgOrder,
      totalItemsSold,
      byMethod,
      days,
      maxDayTotal,
    };
  }, [transactions]);

  /* ---------- Products Form State ---------- */
  const [prodSearch, setProdSearch] = useState('');
  const [prodEditId, setProdEditId] = useState<string | undefined>(undefined);
  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodBarcode, setProdBarcode] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodCategory, setProdCategory] =
    useState<Product['category']>('Makanan');
  const [prodImage, setProdImage] = useState('');
  const [prodSaving, setProdSaving] = useState(false);

  const resetProdForm = () => {
    setProdEditId(undefined);
    setProdName('');
    setProdSku('');
    setProdBarcode('');
    setProdPrice('');
    setProdCategory('Makanan');
    setProdImage('');
  };

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodName.trim()) return;
    setProdSaving(true);
    try {
      await onSaveProduct({
        id: prodEditId,
        name: prodName.trim(),
        sku: prodSku.trim(),
        barcode: prodBarcode.trim(),
        price: Math.max(0, parseInt(prodPrice || '0', 10) || 0),
        image: prodImage.trim(),
        category: prodCategory,
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
    profile?.storeName ?? 'KasirPOS Store'
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
  const [txMethodFilter, setTxMethodFilter] = useState<
    'all' | PaymentMethod
  >('all');

  const filteredTx = useMemo(() => {
    return transactions.filter((t) => {
      if (txMethodFilter !== 'all' && t.paymentMethod !== txMethodFilter) {
        return false;
      }
      if (txSearch.trim()) {
        const q = txSearch.toLowerCase().trim();
        return (
          t.invoiceNo.toLowerCase().includes(q) ||
          (t.cashierName ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [transactions, txMethodFilter, txSearch]);

  const exportCsv = () => {
    const headers = [
      'Invoice',
      'Waktu',
      'Kasir',
      'Item',
      'Subtotal',
      'Diskon',
      'Total Akhir',
      'Metode',
    ];
    const rows = filteredTx.map((t) => [
      t.invoiceNo,
      formatDateTime(t.createdAt),
      t.cashierName ?? 'Admin',
      String(t.totalQty ?? t.items.reduce((s, i) => s + i.qty, 0)),
      String(t.subtotal),
      String(t.discountAmount),
      String(t.grandTotal),
      t.paymentMethod.toUpperCase(),
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-kasirpos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredProducts = useMemo(() => {
    const q = prodSearch.toLowerCase().trim();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q)
    );
  }, [products, prodSearch]);

  const navItems: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Ringkasan', icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'products', label: 'Kelola Produk', icon: <Package className="h-4 w-4" /> },
    { id: 'vouchers', label: 'Kelola Voucher', icon: <Tag className="h-4 w-4" /> },
    { id: 'users', label: 'Akun Pengguna', icon: <Users className="h-4 w-4" /> },
    {
      id: 'transactions',
      label: 'Laporan Transaksi',
      icon: <ReceiptText className="h-4 w-4" />,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 md:flex-row">
      {/* Left Sidebar (Desktop) / Top Tab Strip (Mobile) */}
      <aside className="flex shrink-0 flex-col border-b border-slate-200 bg-white md:w-60 md:border-r md:border-b-0">
        <div className="hidden items-center justify-between border-b border-slate-200 px-4 py-3.5 md:flex">
          <div className="flex items-center gap-2 text-slate-900">
            <ShieldCheck className="h-5 w-5 text-[#1B8EE6]" />
            <span className="text-sm font-bold">Panel Admin</span>
          </div>
          <button
            type="button"
            onClick={onBackToPos}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#1B8EE6] hover:bg-sky-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Kasir</span>
          </button>
        </div>

        <nav className="flex gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-visible md:p-3">
          {navItems.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-sky-50 text-[#1B8EE6]'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="hidden border-t border-slate-200 p-3 md:block">
          <button
            type="button"
            onClick={onBackToPos}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#1B8EE6] text-xs font-bold text-white hover:bg-[#1479C9]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Kembali ke POS Kasir</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="pos-scroll flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Header Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
                {navItems.find((n) => n.id === tab)?.label}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                {profile?.storeName ?? 'KasirPOS Store'} · Sinkronisasi real-time
                Firebase Firestore
              </p>
            </div>
            {notice && (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                <Check className="h-3.5 w-3.5" />
                <span>{notice}</span>
              </div>
            )}
          </div>

          {/* TAB 1: OVERVIEW */}
          {tab === 'overview' && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  label="Total Omzet"
                  value={formatRupiah(stats.totalRevenue)}
                  sub={`${stats.totalItemsSold} item terjual`}
                />
                <KpiCard
                  label="Total Transaksi"
                  value={formatNumber(stats.txCount)}
                  sub="Seluruh metode bayar"
                />
                <KpiCard
                  label="Rata-rata Transaksi"
                  value={formatRupiah(stats.avgOrder)}
                  sub="Per struk selesai"
                />
                <KpiCard
                  label="Katalog & Pengguna"
                  value={`${products.length} produk`}
                  sub={`${vouchers.filter((v) => v.active !== false).length} voucher · ${staffAccounts.length} akun`}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                {/* 7-Day Bar Chart */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900">
                      Penjualan 7 Hari Terakhir
                    </h2>
                    <span className="text-xs text-slate-500">Dalam Rupiah</span>
                  </div>
                  <div className="flex h-48 items-end gap-3 pt-4">
                    {stats.days.map((d) => {
                      const pct = Math.max(
                        4,
                        Math.round((d.total / stats.maxDayTotal) * 100)
                      );
                      return (
                        <div
                          key={d.key}
                          className="flex flex-1 flex-col items-center gap-1.5"
                        >
                          <span className="font-mono-num text-[10px] font-semibold text-slate-500">
                            {d.total > 0
                              ? `${Math.round(d.total / 1000)}rb`
                              : '0'}
                          </span>
                          <div className="flex h-32 w-full items-end rounded-md bg-slate-100 p-1">
                            <div
                              style={{ height: `${d.total > 0 ? pct : 0}%` }}
                              className="w-full rounded bg-[#1B8EE6] transition-all duration-300"
                            />
                          </div>
                          <span className="text-[11px] font-medium text-slate-600">
                            {d.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Payment Method Breakdown */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4">
                  <h2 className="mb-4 text-sm font-bold text-slate-900">
                    Metode Pembayaran
                  </h2>
                  <div className="space-y-4">
                    {(
                      [
                        { id: 'cash', label: 'Tunai', color: 'bg-emerald-500' },
                        { id: 'qris', label: 'QRIS', color: 'bg-[#1B8EE6]' },
                        { id: 'transfer', label: 'Transfer', color: 'bg-amber-500' },
                      ] as const
                    ).map((m) => {
                      const amt = stats.byMethod[m.id] ?? 0;
                      const pct =
                        stats.totalRevenue > 0
                          ? Math.round((amt / stats.totalRevenue) * 100)
                          : 0;
                      return (
                        <div key={m.id}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-700">
                              {m.label}
                            </span>
                            <span className="font-mono-num font-bold text-slate-900">
                              {formatRupiah(amt)} ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              style={{ width: `${pct}%` }}
                              className={`h-full rounded-full ${m.color}`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Recent 5 Transactions */}
              <div className="rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
                  <h2 className="text-sm font-bold text-slate-900">
                    Transaksi Terbaru
                  </h2>
                  <button
                    type="button"
                    onClick={() => setTab('transactions')}
                    className="text-xs font-semibold text-[#1B8EE6] hover:underline"
                  >
                    Lihat Semua
                  </button>
                </div>
                {transactions.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    Belum ada transaksi tercatat.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-5 py-2.5 font-semibold">Invoice</th>
                          <th className="px-4 py-2.5 font-semibold">Waktu</th>
                          <th className="px-4 py-2.5 font-semibold">Kasir</th>
                          <th className="px-4 py-2.5 font-semibold">Metode</th>
                          <th className="px-5 py-2.5 text-right font-semibold">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {transactions.slice(0, 5).map((tx) => (
                          <tr key={tx.id} className="hover:bg-slate-50">
                            <td className="font-mono-num px-5 py-3 font-bold text-slate-900">
                              {tx.invoiceNo}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {formatDateTime(tx.createdAt)}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {tx.cashierName ?? 'Admin'}
                            </td>
                            <td className="px-4 py-3 font-semibold uppercase text-slate-600">
                              {tx.paymentMethod}
                            </td>
                            <td className="font-mono-num px-5 py-3 text-right font-bold text-emerald-700">
                              {formatRupiah(tx.grandTotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 2: KELOLA PRODUK */}
          {tab === 'products' && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <form
                onSubmit={handleProductSubmit}
                className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4"
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
                    placeholder="Contoh: Es Kopi Susu Gula Aren"
                    className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Harga (Rp)
                    </label>
                    <input
                      type="number"
                      required
                      min={0}
                      value={prodPrice}
                      onChange={(e) => setProdPrice(e.target.value)}
                      placeholder="25000"
                      className="font-mono-num h-10 w-full rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Kategori
                    </label>
                    <select
                      value={prodCategory}
                      onChange={(e) =>
                        setProdCategory(e.target.value as Product['category'])
                      }
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    >
                      {EDITABLE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      SKU
                    </label>
                    <input
                      type="text"
                      maxLength={32}
                      value={prodSku}
                      onChange={(e) => setProdSku(e.target.value)}
                      placeholder="MNM-10"
                      className="font-mono-num h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Barcode
                    </label>
                    <input
                      type="text"
                      maxLength={64}
                      value={prodBarcode}
                      onChange={(e) => setProdBarcode(e.target.value)}
                      placeholder="8992001010"
                      className="font-mono-num h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>
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
                        : 'Simpan Produk'}
                  </span>
                </button>
              </form>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-8">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                  <span className="text-xs font-bold text-slate-700">
                    Daftar Produk ({filteredProducts.length})
                  </span>
                  <div className="relative w-full sm:w-60">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={prodSearch}
                      onChange={(e) => setProdSearch(e.target.value)}
                      placeholder="Cari nama, SKU, barcode..."
                      className="h-8 w-full rounded-md border border-slate-300 pr-2.5 pl-8 text-xs text-slate-800 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Produk</th>
                        <th className="px-3 py-2.5 font-semibold">SKU / Barcode</th>
                        <th className="px-3 py-2.5 font-semibold">Kategori</th>
                        <th className="px-3 py-2.5 text-right font-semibold">
                          Harga
                        </th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Aksi
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredProducts.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-bold text-slate-900">
                            {p.name}
                          </td>
                          <td className="font-mono-num px-3 py-2.5 text-slate-500">
                            {p.sku} · {p.barcode}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">
                            {p.category}
                          </td>
                          <td className="font-mono-num px-3 py-2.5 text-right font-bold text-slate-900">
                            {formatRupiah(p.price)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="inline-flex items-center gap-1">
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
                                className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-sky-50 hover:text-[#1B8EE6]"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void onDeleteProduct(p.id).then(() =>
                                    flashNotice('Produk dihapus')
                                  );
                                }}
                                aria-label={`Hapus ${p.name}`}
                                className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
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

          {/* TAB 3: KELOLA VOUCHER */}
          {tab === 'vouchers' && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <form
                onSubmit={handleVoucherSubmit}
                className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">
                    {vchEditId ? 'Edit Voucher' : 'Tambah Kode Voucher'}
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
                    placeholder="PROMO15"
                    className="font-mono-num h-10 w-full rounded-lg border border-slate-300 px-3 text-xs font-bold uppercase text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Tipe Diskon
                    </label>
                    <select
                      value={vchType}
                      onChange={(e) =>
                        setVchType(e.target.value as 'percent' | 'fixed')
                      }
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    >
                      <option value="percent">Persen (%)</option>
                      <option value="fixed">Nominal (Rp)</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Nilai {vchType === 'percent' ? '(%)' : '(Rp)'}
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={vchType === 'percent' ? 100 : 1000000000}
                      value={vchValue}
                      onChange={(e) => setVchValue(e.target.value)}
                      placeholder={vchType === 'percent' ? '15' : '15000'}
                      className="font-mono-num h-10 w-full rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Label Singkat
                    </label>
                    <input
                      type="text"
                      maxLength={40}
                      value={vchLabel}
                      onChange={(e) => setVchLabel(e.target.value)}
                      placeholder="Diskon 15%"
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
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
                      className="font-mono-num h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
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
                  <span>Voucher Aktif</span>
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
                        ? 'Simpan Perubahan'
                        : 'Simpan Voucher'}
                  </span>
                </button>
              </form>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-8">
                <div className="border-b border-slate-200 px-4 py-3 text-xs font-bold text-slate-700">
                  Daftar Voucher Promo ({vouchers.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Kode</th>
                        <th className="px-3 py-2.5 font-semibold">Potongan</th>
                        <th className="px-3 py-2.5 font-semibold">Min. Belanja</th>
                        <th className="px-3 py-2.5 font-semibold">Status</th>
                        <th className="px-4 py-2.5 text-right font-semibold">
                          Aksi
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vouchers.map((v) => {
                        const isActive = v.active !== false;
                        return (
                          <tr key={v.id ?? v.code} className="hover:bg-slate-50">
                            <td className="font-mono-num px-4 py-3 font-bold text-slate-900">
                              {v.code}
                              <div className="font-sans text-[11px] font-normal text-slate-500">
                                {v.label}
                              </div>
                            </td>
                            <td className="font-mono-num px-3 py-3 font-bold text-[#1B8EE6]">
                              {v.type === 'percent'
                                ? `${v.value}%`
                                : formatRupiah(v.value)}
                            </td>
                            <td className="font-mono-num px-3 py-3 text-slate-600">
                              {v.minSubtotal
                                ? formatRupiah(v.minSubtotal)
                                : 'Tanpa minimum'}
                            </td>
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!v.id) return;
                                  void onSaveVoucher({
                                    id: v.id,
                                    code: v.code,
                                    label: v.label,
                                    type: v.type,
                                    value: v.value,
                                    minSubtotal: v.minSubtotal ?? 0,
                                    active: !isActive,
                                  }).then(() =>
                                    flashNotice('Status voucher diperbarui')
                                  );
                                }}
                                className={`text-xs font-bold underline-offset-2 hover:underline ${
                                  isActive
                                    ? 'text-emerald-700'
                                    : 'text-slate-400'
                                }`}
                              >
                                {isActive ? 'Aktif' : 'Nonaktif'}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVchEditId(v.id);
                                    setVchCode(v.code);
                                    setVchLabel(v.label);
                                    setVchType(v.type);
                                    setVchValue(String(v.value));
                                    setVchMinSub(String(v.minSubtotal ?? 0));
                                    setVchActive(isActive);
                                  }}
                                  aria-label={`Edit ${v.code}`}
                                  className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-sky-50 hover:text-[#1B8EE6]"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                {v.id && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void onDeleteVoucher(v.id!).then(() =>
                                        flashNotice('Voucher dihapus')
                                      );
                                    }}
                                    aria-label={`Hapus ${v.code}`}
                                    className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-rose-50 hover:text-rose-600"
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
          )}

          {/* TAB 4: AKUN PENGGUNA & TOKO */}
          {tab === 'users' && (
            <div className="space-y-5">
              {/* Store Owner Profile */}
              <form
                onSubmit={handleProfileSubmit}
                className="rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Store className="h-4 w-4 text-[#1B8EE6]" />
                  <span>Identitas Toko & Akun Pemilik</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Nama Toko (tampil di struk)
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={storeNameInput}
                      onChange={(e) => setStoreNameInput(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Nama Pemilik / Admin Utama
                    </label>
                    <input
                      type="text"
                      maxLength={80}
                      value={ownerNameInput}
                      onChange={(e) => setOwnerNameInput(e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      disabled={profileSaving}
                      className="h-10 w-full rounded-lg bg-[#1B8EE6] px-4 text-xs font-bold text-white hover:bg-[#1479C9] disabled:bg-slate-300"
                    >
                      {profileSaving ? 'Menyimpan...' : 'Simpan Profil Toko'}
                    </button>
                  </div>
                </div>
              </form>

              {/* Staff / Operator Accounts CRUD */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                <form
                  onSubmit={handleStaffSubmit}
                  className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900">
                      {staffEditId
                        ? 'Edit Akun Operator'
                        : 'Tambah Akun Operator / Kasir'}
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
                      className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
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
                      className="font-mono-num h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
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
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
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
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5 font-semibold">Nama</th>
                          <th className="px-3 py-2.5 font-semibold">Username</th>
                          <th className="px-3 py-2.5 font-semibold">Peran</th>
                          <th className="px-3 py-2.5 font-semibold">Status</th>
                          <th className="px-4 py-2.5 text-right font-semibold">
                            Aksi
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {staffAccounts.map((stf) => {
                          const isCurrentOperator = activeStaffId === stf.id;
                          return (
                            <tr key={stf.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3 font-bold text-slate-900">
                                {stf.displayName}
                                {isCurrentOperator && (
                                  <span className="ml-2 text-[11px] font-semibold text-[#1B8EE6]">
                                    · Bertugas
                                  </span>
                                )}
                              </td>
                              <td className="font-mono-num px-3 py-3 text-slate-500">
                                @{stf.username}
                              </td>
                              <td className="px-3 py-3 font-semibold text-slate-700">
                                {stf.role === 'admin' ? 'Admin' : 'Kasir'}
                              </td>
                              <td className="px-3 py-3">
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
                              <td className="px-4 py-3 text-right">
                                <div className="inline-flex items-center gap-1">
                                  {stf.active && !isCurrentOperator && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onSelectActiveStaff(stf.id);
                                        flashNotice(
                                          `Kasir aktif: ${stf.displayName}`
                                        );
                                      }}
                                      title="Jadikan operator bertugas"
                                      className="flex h-7 items-center gap-1 rounded px-2 text-[11px] font-semibold text-[#1B8EE6] hover:bg-sky-50"
                                    >
                                      <UserCheck className="h-3.5 w-3.5" />
                                      <span>Pakai</span>
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
                                    className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-sky-50 hover:text-[#1B8EE6]"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  {staffAccounts.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void onDeleteStaff(stf.id).then(() =>
                                          flashNotice('Akun pengguna dihapus')
                                        );
                                      }}
                                      aria-label={`Hapus ${stf.displayName}`}
                                      className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-rose-50 hover:text-rose-600"
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

          {/* TAB 5: LAPORAN TRANSAKSI */}
          {tab === 'transactions' && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-56">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={txSearch}
                      onChange={(e) => setTxSearch(e.target.value)}
                      placeholder="Cari invoice atau kasir..."
                      className="h-9 w-full rounded-lg border border-slate-300 pr-3 pl-8 text-xs text-slate-800 focus:border-[#1B8EE6] focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                    {(
                      [
                        { id: 'all', label: 'Semua' },
                        { id: 'cash', label: 'Tunai' },
                        { id: 'qris', label: 'QRIS' },
                        { id: 'transfer', label: 'Transfer' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setTxMethodFilter(m.id)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                          txMethodFilter === m.id
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={filteredTx.length === 0}
                  onClick={exportCsv}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>

              {filteredTx.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500">
                  Tidak ada transaksi yang cocok dengan filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Invoice</th>
                        <th className="px-3 py-2.5 font-semibold">Waktu</th>
                        <th className="px-3 py-2.5 font-semibold">Kasir</th>
                        <th className="px-3 py-2.5 font-semibold">Qty</th>
                        <th className="px-3 py-2.5 font-semibold">Diskon</th>
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
                      {filteredTx.map((tx) => (
                        <tr key={tx.id} className="hover:bg-slate-50">
                          <td className="font-mono-num px-4 py-3 font-bold text-slate-900">
                            {tx.invoiceNo}
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {formatDateTime(tx.createdAt)}
                          </td>
                          <td className="px-3 py-3 text-slate-700">
                            {tx.cashierName ?? 'Admin'}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-slate-700">
                            {tx.totalQty ??
                              tx.items.reduce((s, i) => s + i.qty, 0)}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-slate-600">
                            {tx.discountAmount !== 0
                              ? formatRupiah(tx.discountAmount)
                              : '-'}
                          </td>
                          <td className="px-3 py-3 font-semibold uppercase text-slate-600">
                            {tx.paymentMethod}
                          </td>
                          <td className="font-mono-num px-3 py-3 text-right font-bold text-emerald-700">
                            {formatRupiah(tx.grandTotal)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => onViewReceipt(tx)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              <ReceiptText className="h-3 w-3" />
                              <span>Lihat</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="font-mono-num mt-1.5 text-xl font-extrabold text-slate-900">
        {value}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}
