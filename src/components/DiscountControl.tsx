import { AlertCircle, CheckCircle2, ChevronDown, Tag } from 'lucide-react';
import {
  DiscountConfig,
  DiscountMode,
  SimpleTotals,
  VoucherDef,
} from '../types/pos';
import { formatNumber, formatRupiah } from '../utils/format';

interface DiscountControlProps {
  discount: DiscountConfig;
  totals: SimpleTotals;
  vouchers: VoucherDef[];
  onChange: (next: DiscountConfig) => void;
}

const DISCOUNT_OPTIONS: { value: DiscountMode; label: string }[] = [
  { value: 'none', label: 'Tanpa Diskon' },
  { value: 'fixed', label: 'Potongan Harga (Rp)' },
  { value: 'percent', label: 'Diskon Persen (%)' },
  { value: 'exact', label: 'Harga Pas (Ubah Total)' },
  { value: 'voucher', label: 'Kode Voucher' },
  { value: 'b1g1', label: 'Promo Buy 1 Get 1 Free (B1G1)' },
];

export function DiscountControl({
  discount,
  totals,
  vouchers,
  onChange,
}: DiscountControlProps) {
  const handleModeChange = (mode: DiscountMode) => {
    onChange({
      ...discount,
      mode,
      exactTotal:
        mode === 'exact'
          ? discount.exactTotal ?? (totals.subtotal > 0 ? totals.subtotal : null)
          : discount.exactTotal,
    });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3.5">
      <label
        htmlFor="discount-mode-select"
        className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-wide text-slate-600"
      >
        <Tag className="h-3.5 w-3.5 text-[#0F172A]" />
        <span>TERAPKAN DISKON / HARGA PAS</span>
      </label>

      {/* Dropdown Matching Reference Screenshot */}
      <div className="relative">
        <select
          id="discount-mode-select"
          value={discount.mode}
          onChange={(e) => handleModeChange(e.target.value as DiscountMode)}
          className="h-11 w-full appearance-none rounded-lg border-2 border-[#0F172A]/60 bg-white pr-10 pl-3.5 text-sm font-semibold text-slate-900 transition-colors focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-100"
        >
          {DISCOUNT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
      </div>

      {/* Mode 2: Potongan Harga (Rp) */}
      {discount.mode === 'fixed' && (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs font-bold text-slate-500">
              Rp
            </span>
            <input
              type="number"
              min={0}
              value={discount.fixedAmount > 0 ? discount.fixedAmount : ''}
              onChange={(e) =>
                onChange({
                  ...discount,
                  fixedAmount: Math.max(0, parseInt(e.target.value || '0', 10) || 0),
                })
              }
              placeholder="Masukkan nominal potongan..."
              className="font-mono-num h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm font-bold text-slate-900 focus:border-[#0F172A] focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[5000, 10000, 15000, 25000].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => onChange({ ...discount, fixedAmount: val })}
                className={`rounded-md border py-1.5 text-xs font-semibold tabular-nums transition-colors ${
                  discount.fixedAmount === val
                    ? 'border-[#0F172A] bg-slate-50 text-[#0F172A]'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                {formatNumber(val)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mode 3: Diskon Persen (%) */}
      {discount.mode === 'percent' && (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <input
              type="number"
              min={0}
              max={100}
              value={discount.percentValue > 0 ? discount.percentValue : ''}
              onChange={(e) => {
                const v = Math.min(
                  100,
                  Math.max(0, parseFloat(e.target.value || '0') || 0)
                );
                onChange({ ...discount, percentValue: v });
              }}
              placeholder="Masukkan persentase (0 - 100)"
              className="font-mono-num h-10 w-full rounded-lg border border-slate-300 bg-white pr-9 pl-3 text-sm font-bold text-slate-900 focus:border-[#0F172A] focus:outline-none"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-bold text-slate-500">
              %
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[5, 10, 15, 20].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => onChange({ ...discount, percentValue: pct })}
                className={`rounded-md border py-1.5 text-xs font-semibold tabular-nums transition-colors ${
                  discount.percentValue === pct
                    ? 'border-[#0F172A] bg-slate-50 text-[#0F172A]'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mode 4: Harga Pas (Ubah Total) */}
      {discount.mode === 'exact' && (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs font-bold text-slate-500">
              Rp
            </span>
            <input
              type="number"
              min={0}
              value={discount.exactTotal !== null ? discount.exactTotal : ''}
              onChange={(e) => {
                const raw = e.target.value;
                onChange({
                  ...discount,
                  exactTotal:
                    raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0),
                });
              }}
              placeholder="Masukkan total akhir yang diinginkan..."
              className="font-mono-num h-10 w-full rounded-lg border border-slate-300 bg-white pr-3 pl-9 text-sm font-bold text-slate-900 focus:border-[#0F172A] focus:outline-none"
            />
          </div>
          {totals.subtotal > 0 && discount.exactTotal !== null && (
            <div className="flex items-center justify-between text-xs text-slate-600 tabular-nums">
              <span>Subtotal normal: {formatRupiah(totals.subtotal)}</span>
              <span
                className={`font-semibold ${
                  totals.discountAmount >= 0 ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {totals.discountAmount >= 0
                  ? `Hemat ${formatRupiah(totals.discountAmount)}`
                  : `Tambah ${formatRupiah(Math.abs(totals.discountAmount))}`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Mode 5: Kode Voucher */}
      {discount.mode === 'voucher' && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={discount.voucherCode}
            onChange={(e) =>
              onChange({
                ...discount,
                voucherCode: e.target.value.toUpperCase(),
              })
            }
            placeholder="Ketik kode voucher (mis. HEMAT10)"
            className="font-mono-num h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold uppercase text-slate-900 focus:border-[#0F172A] focus:outline-none"
          />

          {/* Quick clickable voucher presets */}
          <div className="flex flex-wrap gap-1.5">
            {vouchers.map((v) => {
              const active =
                discount.voucherCode.trim().toUpperCase() === v.code;
              return (
                <button
                  key={v.code}
                  type="button"
                  onClick={() => onChange({ ...discount, voucherCode: v.code })}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    active
                      ? 'border-[#0F172A] bg-slate-50 text-[#0F172A]'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {v.code} · {v.label}
                </button>
              );
            })}
          </div>

          {totals.appliedVoucher && (
            <div className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>
                Voucher <strong>{totals.appliedVoucher.code}</strong> aktif (-
                {formatRupiah(totals.discountAmount)})
              </span>
            </div>
          )}

          {totals.voucherError && (
            <div className="flex items-center gap-1.5 rounded-md bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{totals.voucherError}</span>
            </div>
          )}
        </div>
      )}

      {/* Mode 6: Buy 1 Get 1 Free */}
      {discount.mode === 'b1g1' && (
        <div className="mt-3 space-y-2">
          <div className="flex items-start gap-2 rounded-lg bg-slate-100 p-2.5 text-xs text-slate-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0F172A]" />
            <span>
              <strong>Promo Buy 1 Get 1 Free Aktif:</strong> Untuk setiap 2 item dalam keranjang, pelanggan hanya membayar produk dengan harga tertinggi (produk termurah digratiskan).
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
