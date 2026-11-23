import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Calendar,
  Download,
  PackagePlus,
  TrendingUp,
  Trophy,
  X,
} from 'lucide-react';
import { MONTH_OPTIONS } from '../data/catalog';
import {
  Branch,
  BranchStock,
  Product,
  SalesLine,
  SimpleTransaction,
} from '../types/pos';
import { formatNumber, formatRupiah } from '../utils/format';
import { normalizeBranchKey } from '../utils/productCategory';

interface RestockAnalyticsPanelProps {
  branches: Branch[];
  products: Product[];
  branchStocks: BranchStock[];
  transactions: SimpleTransaction[];
  salesLines: SalesLine[];
  onQuickRestock: (params: {
    branchId: string;
    branchName: string;
    product: Product;
    qtyAdd: number;
    note: string;
  }) => Promise<void>;
}

interface AggregatedSku {
  productId: string;
  sku: string;
  name: string;
  category: string;
  qtySold: number;
  totalSales: number;
}

interface RestockRow extends AggregatedSku {
  criteria: 'Top Terlaris & Omset' | 'Top Terlaris' | 'Top Omset';
  initialStock: number;
  currentStock: number;
  pctSold: number;
  status: 'Habis (Kritis)' | 'Restok Mendesak' | 'Perlu Restok' | 'Stok Aman';
  urgency: 'Prioritas 1' | 'Prioritas 2' | 'Prioritas 3' | 'Normal';
  recommendation:
    | 'Segera PO & Restok'
    | 'Restok Cepat'
    | 'Jadwalkan Pengadaan'
    | 'Pantau Penjualan';
}

function classifyRestock(
  initialStock: number,
  currentStock: number,
  qtySold: number
): Pick<RestockRow, 'pctSold' | 'status' | 'urgency' | 'recommendation'> {
  const denom =
    initialStock > 0 && initialStock >= currentStock
      ? initialStock
      : Math.max(initialStock, currentStock + qtySold);
  const pctSold =
    denom > 0 ? Math.min(100, Math.max(0, ((denom - currentStock) / denom) * 100)) : 0;

  if (currentStock <= 0) {
    return {
      pctSold: denom > 0 ? 100 : 0,
      status: 'Habis (Kritis)',
      urgency: 'Prioritas 1',
      recommendation: 'Segera PO & Restok',
    };
  }
  if (currentStock <= 1 || pctSold >= 75) {
    return {
      pctSold,
      status: 'Restok Mendesak',
      urgency: 'Prioritas 2',
      recommendation: 'Restok Cepat',
    };
  }
  if (currentStock <= 2 || pctSold >= 60) {
    return {
      pctSold,
      status: 'Perlu Restok',
      urgency: 'Prioritas 3',
      recommendation: 'Jadwalkan Pengadaan',
    };
  }
  return {
    pctSold,
    status: 'Stok Aman',
    urgency: 'Normal',
    recommendation: 'Pantau Penjualan',
  };
}

export function RestockAnalyticsPanel({
  branches,
  products,
  branchStocks,
  transactions,
  salesLines,
  onQuickRestock,
}: RestockAnalyticsPanelProps) {
  const [selectedBranchKey, setSelectedBranchKey] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'import' | 'pos'>(
    'all'
  );
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const availableYears = useMemo(() => {
    const yrs = new Set<number>([new Date().getFullYear()]);
    salesLines.forEach((s) => yrs.add(s.saleYear));
    transactions.forEach((t) => {
      if (t.saleYear) yrs.add(t.saleYear);
    });
    return Array.from(yrs).sort((a, b) => b - a);
  }, [salesLines, transactions]);
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');

  // Consolidate branches sharing the same normalized key (e.g., "CFD_Senayan" and "CFD Senayan")
  const unifiedBranches = useMemo(() => {
    const map = new Map<
      string,
      { key: string; primary: Branch; branchIds: Set<string>; codes: string[] }
    >();
    for (const b of branches) {
      const key = normalizeBranchKey(b.name);
      const existing = map.get(key);
      if (existing) {
        existing.branchIds.add(b.id);
        if (b.code && !existing.codes.includes(b.code)) {
          existing.codes.push(b.code);
        }
        if (existing.primary.name.includes('_') && !b.name.includes('_')) {
          existing.primary = b;
        }
      } else {
        map.set(key, {
          key,
          primary: b,
          branchIds: new Set([b.id]),
          codes: b.code ? [b.code] : [],
        });
      }
    }
    return Array.from(map.values());
  }, [branches]);

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    branches.forEach((b) => map.set(b.id, b.name));
    return map;
  }, [branches]);

  const activeUnifiedBranch = useMemo(
    () =>
      selectedBranchKey === 'all'
        ? null
        : unifiedBranches.find((u) => u.key === selectedBranchKey) ?? null,
    [unifiedBranches, selectedBranchKey]
  );

  // Quick restock modal state
  const [restockTarget, setRestockTarget] = useState<Product | null>(null);
  const [restockBranchId, setRestockBranchId] = useState<string>('');
  const [restockQty, setRestockQty] = useState('10');
  const [restockNote, setRestockNote] = useState('PO Restok Produk Unggulan');
  const [restockSaving, setRestockSaving] = useState(false);

  const toggleMonth = (m: number) => {
    setSelectedMonths((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m].sort((a, b) => a - b)
    );
  };

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const productBySkuKey = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => {
      const k = p.sku.trim().toLowerCase();
      if (k && !map.has(k)) map.set(k, p);
    });
    return map;
  }, [products]);

  const txById = useMemo(() => {
    const map = new Map<string, SimpleTransaction>();
    transactions.forEach((tx) => map.set(tx.id, tx));
    return map;
  }, [transactions]);

  const sourceCounts = useMemo(() => {
    let importLines = 0;
    let posLines = 0;
    for (const line of salesLines) {
      if (line.source === 'pos') posLines += 1;
      else importLines += 1;
    }
    return { importLines, posLines };
  }, [salesLines]);

  const filteredLines = useMemo(() => {
    return salesLines.filter((line) => {
      if (selectedBranchKey !== 'all') {
        const matchById = activeUnifiedBranch?.branchIds.has(line.branchId);
        const lineBranchKey = normalizeBranchKey(
          line.branchName || branchNameById.get(line.branchId) || ''
        );
        if (!matchById && lineBranchKey !== selectedBranchKey) {
          return false;
        }
      }
      if (sourceFilter !== 'all' && line.source !== sourceFilter) {
        return false;
      }
      if (selectedYear !== 'all' && line.saleYear !== selectedYear) {
        return false;
      }
      if (
        selectedMonths.length > 0 &&
        !selectedMonths.includes(line.saleMonth)
      ) {
        return false;
      }
      return true;
    });
  }, [
    salesLines,
    selectedBranchKey,
    activeUnifiedBranch,
    branchNameById,
    sourceFilter,
    selectedYear,
    selectedMonths,
  ]);

  // Compute unique transaction count, gross subtotal & total discount directly from filtered salesLines (matching Sheet COUNTUNIQUE(ID Transaksi))
  const { filteredTxCount, filteredGrossTotal, filteredDiscountTotal } =
    useMemo(() => {
      const uniqueTxKeys = new Set<string>();
      const countedTxIds = new Set<string>();
      let totalGross = 0;
      let totalDiscount = 0;
      for (const line of filteredLines) {
        if (line.qty <= 0) continue;
        const tx = txById.get(line.transactionId);
        const branchScopeKey = normalizeBranchKey(
          line.branchName || branchNameById.get(line.branchId) || line.branchId
        );
        const canonicalCode = tx?.invoiceNo?.trim().toLowerCase();
        if (canonicalCode) {
          uniqueTxKeys.add(`${branchScopeKey}::${canonicalCode}`);
        } else if (line.transactionId) {
          uniqueTxKeys.add(`${branchScopeKey}::${line.transactionId}`);
        }
        if (tx) {
          if (!countedTxIds.has(tx.id)) {
            countedTxIds.add(tx.id);
            const rawSub = Math.max(0, Math.round(tx.subtotal || 0));
            const rawDisc = Math.max(0, Math.round(tx.discountAmount || 0));
            const rawGrand = Math.max(0, Math.round(tx.grandTotal || 0));
            const txGross = Math.max(rawSub, rawGrand + rawDisc);
            totalGross += txGross;
            if (rawDisc > 0) {
              totalDiscount += rawDisc;
            }
          }
        } else {
          totalGross += line.lineTotal;
        }
      }
      return {
        filteredTxCount: uniqueTxKeys.size,
        filteredGrossTotal: totalGross,
        filteredDiscountTotal: totalDiscount,
      };
    }, [filteredLines, txById, branchNameById]);

  const analytics = useMemo(() => {
    const skuMap = new Map<string, AggregatedSku & { skuKey: string }>();
    let totalRevenue = 0;
    let totalQty = 0;

    for (const line of filteredLines) {
      totalRevenue += line.lineTotal;
      totalQty += line.qty;
      if (line.qty <= 0) continue;

      const liveProd =
        productById.get(line.productId) ??
        productBySkuKey.get((line.productSku || '').trim().toLowerCase());
      const resolvedSku = (liveProd?.sku || line.productSku || line.productId).trim();
      const skuKey = resolvedSku.toLowerCase();
      const existing = skuMap.get(skuKey);
      if (existing) {
        existing.qtySold += line.qty;
        existing.totalSales += line.lineTotal;
        if (!productById.has(existing.productId) && liveProd) {
          existing.productId = liveProd.id;
        }
      } else {
        skuMap.set(skuKey, {
          skuKey,
          productId: liveProd?.id ?? line.productId,
          sku: resolvedSku,
          name: liveProd?.name ?? line.productName,
          category: liveProd?.category ?? line.category,
          qtySold: line.qty,
          totalSales: line.lineTotal,
        });
      }
    }

    const allSkus = Array.from(skuMap.values());

    const topByQty = [...allSkus]
      .sort((a, b) => b.qtySold - a.qtySold || b.totalSales - a.totalSales)
      .slice(0, 10);

    const topByRevenue = [...allSkus]
      .sort((a, b) => b.totalSales - a.totalSales || b.qtySold - a.qtySold)
      .slice(0, 10);

    const topQtyKeys = new Set(topByQty.map((x) => x.skuKey));
    const topRevKeys = new Set(topByRevenue.map((x) => x.skuKey));

    // Combine top 10 by qty + top 10 by revenue preserving order (matching the spreadsheet)
    const combinedMap = new Map<string, AggregatedSku & { skuKey: string }>();
    for (const item of topByQty) combinedMap.set(item.skuKey, item);
    for (const item of topByRevenue) {
      if (!combinedMap.has(item.skuKey)) {
        combinedMap.set(item.skuKey, item);
      }
    }

    // Stock aggregation scoped to selectedBranchKey (or consolidated across all branches), keyed by normalized SKU
    const stockAgg = new Map<string, { initial: number; current: number }>();
    for (const st of branchStocks) {
      if (selectedBranchKey !== 'all') {
        const matchById = activeUnifiedBranch?.branchIds.has(st.branchId);
        const stBranchKey = normalizeBranchKey(
          branchNameById.get(st.branchId) || ''
        );
        if (!matchById && stBranchKey !== selectedBranchKey) {
          continue;
        }
      }
      const prod = productById.get(st.productId);
      const skuKey = (prod?.sku || st.productId).trim().toLowerCase();
      const prev = stockAgg.get(skuKey) ?? { initial: 0, current: 0 };
      prev.initial += st.initialStock;
      prev.current += st.currentStock;
      stockAgg.set(skuKey, prev);
    }

    const restockRows: RestockRow[] = Array.from(combinedMap.values()).map(
      (item) => {
        const inQty = topQtyKeys.has(item.skuKey);
        const inRev = topRevKeys.has(item.skuKey);
        const criteria: RestockRow['criteria'] =
          inQty && inRev
            ? 'Top Terlaris & Omset'
            : inQty
              ? 'Top Terlaris'
              : 'Top Omset';

        const stock = stockAgg.get(item.skuKey) ?? { initial: 0, current: 0 };
        const classified = classifyRestock(
          stock.initial,
          stock.current,
          item.qtySold
        );

        return {
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          category: item.category,
          qtySold: item.qtySold,
          totalSales: item.totalSales,
          criteria,
          initialStock: stock.initial,
          currentStock: stock.current,
          ...classified,
        };
      }
    );

    const urgentCount = restockRows.filter(
      (r) => r.urgency === 'Prioritas 1' || r.urgency === 'Prioritas 2'
    ).length;

    const restockTotals = restockRows.reduce(
      (acc, r) => ({
        qtySold: acc.qtySold + r.qtySold,
        totalSales: acc.totalSales + r.totalSales,
        initialStock: acc.initialStock + r.initialStock,
        currentStock: acc.currentStock + r.currentStock,
      }),
      { qtySold: 0, totalSales: 0, initialStock: 0, currentStock: 0 }
    );

    const overallDenom = Math.max(
      restockTotals.initialStock,
      restockTotals.currentStock
    );
    const overallPctSold =
      overallDenom > 0
        ? Math.min(
            100,
            Math.max(
              0,
              ((overallDenom - restockTotals.currentStock) / overallDenom) * 100
            )
          )
        : 0;

    const paidSkuCount = allSkus.filter((s) => s.totalSales > 0).length;
    const freeSkuCount = allSkus.length - paidSkuCount;

    return {
      totalRevenue,
      totalQty,
      uniqueSkuCount: allSkus.length,
      paidSkuCount,
      freeSkuCount,
      topByQty,
      topByRevenue,
      topQtyTotals: {
        qty: topByQty.reduce((s, r) => s + r.qtySold, 0),
        rev: topByQty.reduce((s, r) => s + r.totalSales, 0),
      },
      topRevTotals: {
        qty: topByRevenue.reduce((s, r) => s + r.qtySold, 0),
        rev: topByRevenue.reduce((s, r) => s + r.totalSales, 0),
      },
      restockRows,
      urgentCount,
      restockTotals,
      overallPctSold,
    };
  }, [
    filteredLines,
    branchStocks,
    selectedBranchKey,
    activeUnifiedBranch,
    branchNameById,
    productById,
    productBySkuKey,
  ]);

  const activeBranchLabel =
    selectedBranchKey === 'all'
      ? 'Semua Cabang (Konsolidasi)'
      : activeUnifiedBranch?.primary.name ?? 'Cabang';

  const openQuickRestock = (productId: string) => {
    const prod = productById.get(productId);
    if (!prod) return;
    setRestockTarget(prod);
    setRestockBranchId(
      activeUnifiedBranch?.primary.id ?? branches[0]?.id ?? ''
    );
    setRestockQty('10');
    setRestockNote('Restok cepat dari Dasbor Analisis Prioritas');
  };

  const handleSubmitQuickRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockTarget || !restockBranchId) return;
    const branch = branches.find((b) => b.id === restockBranchId);
    if (!branch) return;
    const qty = Math.max(1, parseInt(restockQty || '0', 10) || 0);
    setRestockSaving(true);
    try {
      await onQuickRestock({
        branchId: branch.id,
        branchName: branch.name,
        product: restockTarget,
        qtyAdd: qty,
        note: restockNote,
      });
      setRestockTarget(null);
    } finally {
      setRestockSaving(false);
    }
  };

  const handleExportCsv = () => {
    const header = [
      'No',
      'Kode Item',
      'Nama Produk',
      'Kategori',
      'Kriteria Nominasi',
      'Qty Terjual',
      'Total Penjualan',
      'Stok Awal',
      'Sisa Stok',
      '% Terjual',
      'Status Restok',
      'Urgensi',
      'Rekomendasi Tindakan',
    ];
    const lines = analytics.restockRows.map((r, i) => [
      i + 1,
      r.sku,
      `"${r.name.replace(/"/g, '""')}"`,
      `"${r.category.replace(/"/g, '""')}"`,
      `"${r.criteria}"`,
      r.qtySold,
      r.totalSales,
      r.initialStock,
      r.currentStock,
      `${r.pctSold.toFixed(1)}%`,
      `"${r.status}"`,
      `"${r.urgency}"`,
      `"${r.recommendation}"`,
    ]);
    const csv = [header.join(','), ...lines.map((l) => l.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rekapan-restok-${activeBranchLabel.toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Filter Control Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Dasbor Rekapan Penjualan & Analisis Restok Produk
            </h2>
            <p className="text-xs text-slate-500">
              {activeBranchLabel} ·{' '}
              {selectedMonths.length === 0
                ? 'Semua Bulan'
                : selectedMonths
                    .map(
                      (m) =>
                        MONTH_OPTIONS.find((mo) => mo.num === m)?.full ?? m
                    )
                    .join(', ')}{' '}
              · {selectedYear === 'all' ? 'Semua Tahun' : selectedYear}
              {sourceFilter !== 'all'
                ? ` · ${sourceFilter === 'import' ? 'Khusus Impor Sheet' : 'Khusus Kasir POS'}`
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={analytics.restockRows.length === 0}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV Rekapan</span>
          </button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
          {/* Branch Picker */}
          <div className="lg:col-span-3">
            <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <Building2 className="h-3.5 w-3.5" />
              <span>Pilih Cabang</span>
            </label>
            <select
              value={selectedBranchKey}
              onChange={(e) => setSelectedBranchKey(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:border-[#0F172A] focus:outline-none"
            >
              <option value="all">Semua Cabang (Konsolidasi)</option>
              {unifiedBranches.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.primary.name} ({u.codes.join('/') || u.primary.code})
                </option>
              ))}
            </select>
          </div>

          {/* Year Picker */}
          <div className="lg:col-span-2">
            <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <Calendar className="h-3.5 w-3.5" />
              <span>Tahun</span>
            </label>
            <select
              value={selectedYear}
              onChange={(e) =>
                setSelectedYear(
                  e.target.value === 'all' ? 'all' : Number(e.target.value)
                )
              }
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:border-[#0F172A] focus:outline-none"
            >
              <option value="all">Semua</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Source Filter */}
          <div className="lg:col-span-2">
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">
              Sumber Data
            </label>
            <select
              value={sourceFilter}
              onChange={(e) =>
                setSourceFilter(e.target.value as 'all' | 'import' | 'pos')
              }
              className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 focus:border-[#0F172A] focus:outline-none"
            >
              <option value="all">Semua Sumber</option>
              <option value="import">
                Impor Sheet ({sourceCounts.importLines})
              </option>
              <option value="pos">Kasir POS ({sourceCounts.posLines})</option>
            </select>
          </div>

          {/* Multi-Month Checkboxes (Jan–Des) */}
          <div className="lg:col-span-5">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span>Filter Multi-Bulan</span>
              {selectedMonths.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedMonths([])}
                  className="font-semibold text-[#0F172A] hover:underline"
                >
                  Tampilkan Semua Bulan
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setSelectedMonths([])}
                className={`h-8 rounded-md px-2.5 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  selectedMonths.length === 0
                    ? 'bg-[#0F172A] text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                Semua
              </button>
              {MONTH_OPTIONS.map((m) => {
                const active = selectedMonths.includes(m.num);
                return (
                  <button
                    key={m.num}
                    type="button"
                    onClick={() => toggleMonth(m.num)}
                    className={`h-8 rounded-md px-2 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#0F172A] text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {m.short}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Omset (Total Bayar Net)
          </div>
          <div className="font-mono-num mt-1.5 text-xl font-extrabold text-slate-900">
            {formatRupiah(analytics.totalRevenue)}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {filteredDiscountTotal > 0 ? (
              <span>
                Subtotal Item{' '}
                <span className="font-mono-num font-semibold text-slate-600">
                  {formatRupiah(filteredGrossTotal)}
                </span>{' '}
                − Potongan{' '}
                <span className="font-mono-num font-semibold text-rose-600">
                  {formatRupiah(filteredDiscountTotal)}
                </span>
              </span>
            ) : (
              'Nilai bersih penjualan periode aktif'
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Kuantitas Terjual
          </div>
          <div className="font-mono-num mt-1.5 text-xl font-extrabold text-slate-900">
            {formatNumber(analytics.totalQty)} pcs
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            Akumulasi unit produk terjual
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Transaksi
          </div>
          <div className="font-mono-num mt-1.5 text-xl font-extrabold text-slate-900">
            {formatNumber(filteredTxCount)} trx
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {sourceFilter === 'import'
              ? 'Khusus data impor Google Sheet'
              : sourceFilter === 'pos'
                ? 'Khusus transaksi Kasir POS'
                : 'POS kasir & rekapan impor'}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Total SKU Terjual
          </div>
          <div className="font-mono-num mt-1.5 text-xl font-extrabold text-slate-900">
            {formatNumber(analytics.uniqueSkuCount)} SKU
          </div>
          <div className="mt-1 text-[11px]">
            {analytics.freeSkuCount > 0 ? (
              <span className="text-slate-500">
                <span className="font-mono-num font-semibold text-slate-700">
                  {formatNumber(analytics.paidSkuCount)}
                </span>{' '}
                berbayar ·{' '}
                <span className="font-mono-num font-semibold text-amber-600">
                  {formatNumber(analytics.freeSkuCount)}
                </span>{' '}
                gratis
                {analytics.urgentCount > 0 && (
                  <span className="font-medium text-rose-600">
                    {' '}
                    · {analytics.urgentCount} restok
                  </span>
                )}
              </span>
            ) : (
              <span className="font-medium text-rose-600">
                {analytics.urgentCount > 0
                  ? `${analytics.urgentCount} produk butuh restok segera`
                  : 'Semua produk unggulan aman'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Top 10 Side-by-Side Tables */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Top 10 Terlaris (Qty) */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <Trophy className="h-4 w-4 text-amber-500" />
              <span>Top 10 Produk Terlaris (Volume Kuantitas)</span>
            </div>
            <span className="font-mono-num text-[11px] font-semibold text-slate-500">
              {formatNumber(analytics.topQtyTotals.qty)} pcs
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">No</th>
                  <th className="px-2 py-2.5 font-semibold">Produk</th>
                  <th className="px-2 py-2.5 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    Total Penjualan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analytics.topByQty.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-slate-400"
                    >
                      Belum ada data penjualan pada filter cabang & bulan ini.
                    </td>
                  </tr>
                ) : (
                  analytics.topByQty.map((row, idx) => (
                    <tr key={row.productId} className="hover:bg-slate-50">
                      <td className="font-mono-num px-3 py-2.5 text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="font-semibold text-slate-900">
                          {row.name}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {row.category}
                        </div>
                      </td>
                      <td className="font-mono-num px-2 py-2.5 text-right font-bold text-slate-900 whitespace-nowrap">
                        {row.qtySold} pcs
                      </td>
                      <td className="font-mono-num px-3 py-2.5 text-right font-semibold text-slate-700 whitespace-nowrap">
                        {formatRupiah(row.totalSales)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {analytics.topByQty.length > 0 && (
                <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-slate-900">
                  <tr>
                    <td colSpan={2} className="px-3 py-2.5 text-xs">
                      Total Top 10 Terlaris
                    </td>
                    <td className="font-mono-num px-2 py-2.5 text-right whitespace-nowrap">
                      {analytics.topQtyTotals.qty} pcs
                    </td>
                    <td className="font-mono-num px-3 py-2.5 text-right whitespace-nowrap">
                      {formatRupiah(analytics.topQtyTotals.rev)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Top 10 Omset Tertinggi */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              <span>Top 10 Produk Omset Tertinggi (Nilai Penjualan)</span>
            </div>
            <span className="font-mono-num text-[11px] font-semibold text-emerald-700">
              {formatRupiah(analytics.topRevTotals.rev)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">No</th>
                  <th className="px-2 py-2.5 font-semibold">Produk</th>
                  <th className="px-2 py-2.5 text-right font-semibold">
                    Total Penjualan
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analytics.topByRevenue.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-slate-400"
                    >
                      Belum ada data omset pada filter cabang & bulan ini.
                    </td>
                  </tr>
                ) : (
                  analytics.topByRevenue.map((row, idx) => (
                    <tr key={row.productId} className="hover:bg-slate-50">
                      <td className="font-mono-num px-3 py-2.5 text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="font-semibold text-slate-900">
                          {row.name}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {row.category}
                        </div>
                      </td>
                      <td className="font-mono-num px-2 py-2.5 text-right font-bold text-emerald-700 whitespace-nowrap">
                        {formatRupiah(row.totalSales)}
                      </td>
                      <td className="font-mono-num px-3 py-2.5 text-right font-semibold text-slate-700 whitespace-nowrap">
                        {row.qtySold} pcs
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {analytics.topByRevenue.length > 0 && (
                <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-slate-900">
                  <tr>
                    <td colSpan={2} className="px-3 py-2.5 text-xs">
                      Total Top 10 Omset
                    </td>
                    <td className="font-mono-num px-2 py-2.5 text-right text-emerald-700 whitespace-nowrap">
                      {formatRupiah(analytics.topRevTotals.rev)}
                    </td>
                    <td className="font-mono-num px-3 py-2.5 text-right whitespace-nowrap">
                      {analytics.topRevTotals.qty} pcs
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      {/* Analisis Prioritas Restok Produk Unggulan */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-xs font-bold text-slate-900">
              Analisis Prioritas Restok Produk Unggulan (Nominasi Terlaris &
              Omset Tertinggi)
            </h3>
            <p className="text-[11px] text-slate-500">
              Status stok dihitung otomatis dari sisa stok cabang aktif vs stok
              awal. Klik Restok untuk langsung menambah stok masuk.
            </p>
          </div>
          {analytics.urgentCount > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-bold text-rose-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>
                {analytics.urgentCount} Produk Perlu Restok Mendesak / Kritis
              </span>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] text-slate-500">
              <tr>
                <th className="px-3 py-2.5 font-semibold">No</th>
                <th className="px-2 py-2.5 font-semibold">Produk & Kode Item</th>
                <th className="px-2 py-2.5 font-semibold">Nominasi</th>
                <th className="px-2 py-2.5 text-right font-semibold">Terjual</th>
                <th className="px-2 py-2.5 text-right font-semibold">Omset</th>
                <th className="px-2 py-2.5 text-right font-semibold">
                  Stok Awal
                </th>
                <th className="px-2 py-2.5 text-right font-semibold">
                  Sisa Stok
                </th>
                <th className="px-2 py-2.5 text-right font-semibold">
                  % Terjual
                </th>
                <th className="px-2 py-2.5 font-semibold">Status & Urgensi</th>
                <th className="px-2 py-2.5 font-semibold">Rekomendasi</th>
                <th className="px-3 py-2.5 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analytics.restockRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    className="px-4 py-10 text-center text-slate-400"
                  >
                    Belum ada produk unggulan yang terjual pada periode ini.
                  </td>
                </tr>
              ) : (
                analytics.restockRows.map((row, idx) => {
                  const statusColor =
                    row.urgency === 'Prioritas 1'
                      ? 'text-rose-700 font-bold'
                      : row.urgency === 'Prioritas 2'
                        ? 'text-amber-700 font-bold'
                        : row.urgency === 'Prioritas 3'
                          ? 'text-amber-600 font-semibold'
                          : 'text-emerald-700 font-semibold';

                  return (
                    <tr key={row.productId} className="hover:bg-slate-50">
                      <td className="font-mono-num px-3 py-2.5 text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="font-semibold text-slate-900">
                          {row.name}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-400">
                          {row.sku} · {row.category}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-[11px] text-slate-600 whitespace-nowrap">
                        {row.criteria}
                      </td>
                      <td className="font-mono-num px-2 py-2.5 text-right font-semibold text-slate-800 whitespace-nowrap">
                        {row.qtySold} pcs
                      </td>
                      <td className="font-mono-num px-2 py-2.5 text-right text-slate-700 whitespace-nowrap">
                        {formatRupiah(row.totalSales)}
                      </td>
                      <td className="font-mono-num px-2 py-2.5 text-right text-slate-600 whitespace-nowrap">
                        {row.initialStock} pcs
                      </td>
                      <td
                        className={`font-mono-num px-2 py-2.5 text-right font-bold whitespace-nowrap ${
                          row.currentStock <= 0
                            ? 'text-rose-600'
                            : row.currentStock <= 2
                              ? 'text-amber-600'
                              : 'text-slate-900'
                        }`}
                      >
                        {row.currentStock} pcs
                      </td>
                      <td className="font-mono-num px-2 py-2.5 text-right text-slate-700 whitespace-nowrap">
                        {row.pctSold.toFixed(1).replace('.', ',')}%
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <div className={statusColor}>{row.status}</div>
                        <div className="text-[11px] text-slate-500">
                          {row.urgency}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-[11px] font-medium text-slate-700 whitespace-nowrap">
                        {row.recommendation}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openQuickRestock(row.productId)}
                          disabled={!productById.has(row.productId)}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:border-[#0F172A] hover:text-[#0F172A] disabled:opacity-40"
                        >
                          <PackagePlus className="h-3.5 w-3.5" />
                          <span>Restok</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {analytics.restockRows.length > 0 && (
              <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-slate-900">
                <tr>
                  <td colSpan={3} className="px-3 py-2.5">
                    Total Nominasi Restok Unggulan
                  </td>
                  <td className="font-mono-num px-2 py-2.5 text-right whitespace-nowrap">
                    {analytics.restockTotals.qtySold} pcs
                  </td>
                  <td className="font-mono-num px-2 py-2.5 text-right whitespace-nowrap">
                    {formatRupiah(analytics.restockTotals.totalSales)}
                  </td>
                  <td className="font-mono-num px-2 py-2.5 text-right whitespace-nowrap">
                    {analytics.restockTotals.initialStock} pcs
                  </td>
                  <td className="font-mono-num px-2 py-2.5 text-right whitespace-nowrap">
                    {analytics.restockTotals.currentStock} pcs
                  </td>
                  <td className="font-mono-num px-2 py-2.5 text-right whitespace-nowrap">
                    {analytics.overallPctSold.toFixed(1).replace('.', ',')}%
                  </td>
                  <td colSpan={3} className="px-2 py-2.5 text-rose-700">
                    {analytics.urgentCount} Produk Perlu Restok Mendesak / Kritis
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Quick Restock Modal */}
      {restockTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-[1px]">
          <form
            onSubmit={handleSubmitQuickRestock}
            className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            <div className="flex items-center justify-between bg-[#0F172A] px-5 py-3.5 text-white">
              <h3 className="text-sm font-bold">Restok Cepat Produk</h3>
              <button
                type="button"
                onClick={() => setRestockTarget(null)}
                aria-label="Tutup"
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3.5 p-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-bold text-slate-900">
                  {restockTarget.name}
                </div>
                <div className="font-mono-num mt-0.5 text-[11px] text-slate-500">
                  {restockTarget.sku} · {restockTarget.category}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Cabang Tujuan Restok
                </label>
                <select
                  required
                  value={restockBranchId}
                  onChange={(e) => setRestockBranchId(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 focus:border-[#0F172A] focus:outline-none"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Jumlah Stok Masuk (pcs)
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={100000}
                  value={restockQty}
                  onChange={(e) => setRestockQty(e.target.value)}
                  className="font-mono-num h-10 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-900 focus:border-[#0F172A] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Catatan PO / Restok
                </label>
                <input
                  type="text"
                  maxLength={160}
                  value={restockNote}
                  onChange={(e) => setRestockNote(e.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-900 focus:border-[#0F172A] focus:outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => setRestockTarget(null)}
                className="h-9 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={restockSaving}
                className="h-9 rounded-lg bg-[#4CAF50] px-4 text-xs font-bold text-white hover:bg-[#43A047] disabled:bg-slate-300"
              >
                {restockSaving ? 'Menyimpan...' : 'Simpan Restok'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
