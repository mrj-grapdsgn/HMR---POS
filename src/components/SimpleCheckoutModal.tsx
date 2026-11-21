import { useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  Landmark,
  Printer,
  QrCode,
  ReceiptText,
  X,
} from 'lucide-react';
import { PaymentMethod, SimpleTotals, SimpleTransaction } from '../types/pos';
import { formatDateTime, formatNumber, formatRupiah } from '../utils/format';

interface CheckoutModalProps {
  totals: SimpleTotals;
  onClose: () => void;
  onConfirm: (method: PaymentMethod, amountPaid: number) => void;
}

export function SimpleCheckoutModal({
  totals,
  onClose,
  onConfirm,
}: CheckoutModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidStr, setPaidStr] = useState(String(totals.grandTotal));

  const paidAmount =
    method === 'cash'
      ? Math.max(0, parseInt(paidStr || '0', 10) || 0)
      : totals.grandTotal;
  const change = Math.max(0, paidAmount - totals.grandTotal);
  const canConfirm = method !== 'cash' || paidAmount >= totals.grandTotal;

  const quickCash = Array.from(
    new Set([
      totals.grandTotal,
      Math.ceil(totals.grandTotal / 50000) * 50000,
      Math.ceil(totals.grandTotal / 100000) * 100000,
      Math.ceil(totals.grandTotal / 100000) * 100000 + 50000,
    ])
  )
    .filter((v) => v >= totals.grandTotal)
    .slice(0, 4);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-[1px]">
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#1B8EE6] px-5 py-3.5 text-white">
          <h2 className="text-sm font-bold">Konfirmasi Pembayaran</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Total Summary */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
            <div className="text-xs font-semibold text-slate-500">
              Total Pembayaran ({totals.totalQty} item)
            </div>
            <div className="font-mono-num mt-1 text-3xl font-extrabold text-slate-900">
              {formatRupiah(totals.grandTotal)}
            </div>
            {totals.adjustmentLabel && totals.discountAmount !== 0 && (
              <div className="mt-1 text-xs font-medium text-emerald-700">
                {totals.adjustmentLabel}:{' '}
                {totals.discountAmount > 0
                  ? `-${formatRupiah(totals.discountAmount)}`
                  : `+${formatRupiah(Math.abs(totals.discountAmount))}`}
              </div>
            )}
          </div>

          {/* Payment Method */}
          <div>
            <div className="mb-2 text-xs font-bold text-slate-600">
              Metode Bayar
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'cash', label: 'Tunai', icon: <Banknote className="h-4 w-4" /> },
                  { id: 'qris', label: 'QRIS', icon: <QrCode className="h-4 w-4" /> },
                  { id: 'transfer', label: 'Transfer', icon: <Landmark className="h-4 w-4" /> },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-xs font-bold transition-colors ${
                    method === m.id
                      ? 'border-[#1B8EE6] bg-sky-50 text-[#1B8EE6]'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {m.icon}
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Cash Input */}
          {method === 'cash' && (
            <div className="space-y-2.5">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-600">
                  Uang Diterima (Rp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={paidStr}
                  onChange={(e) => setPaidStr(e.target.value)}
                  className="font-mono-num h-11 w-full rounded-lg border border-slate-300 px-3 text-base font-bold text-slate-900 focus:border-[#1B8EE6] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {quickCash.map((amt, i) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setPaidStr(String(amt))}
                    className="rounded-md border border-sky-200 bg-sky-50 py-1.5 text-xs font-bold text-[#1B8EE6] hover:bg-sky-100 tabular-nums"
                  >
                    {i === 0 ? 'Uang Pas' : formatNumber(amt)}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3.5 py-2.5 text-xs">
                <span className="font-semibold text-slate-600">Kembalian</span>
                <span
                  className={`font-mono-num text-sm font-extrabold ${
                    paidAmount < totals.grandTotal
                      ? 'text-rose-600'
                      : 'text-emerald-700'
                  }`}
                >
                  {paidAmount < totals.grandTotal
                    ? `Kurang ${formatRupiah(totals.grandTotal - paidAmount)}`
                    : formatRupiah(change)}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm(method, paidAmount)}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-[#4CAF50] px-5 text-xs font-bold text-white hover:bg-[#43A047] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>Selesaikan Transaksi</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function SimpleReceiptModal({
  transaction,
  storeName = 'KasirPOS',
  onClose,
}: {
  transaction: SimpleTransaction;
  storeName?: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-[1px]">
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#1B8EE6] px-4 py-3 text-white">
          <h2 className="text-sm font-bold">Struk Pembayaran</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup struk"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pos-scroll flex-1 overflow-y-auto bg-slate-100 p-4">
          <div
            id="printable-receipt"
            className="mx-auto w-full rounded-md border border-slate-200 bg-white p-5 font-mono text-xs text-slate-800"
          >
            <div className="border-b border-dashed border-slate-300 pb-3 text-center">
              <div className="text-sm font-bold text-slate-900">
                {storeName}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                {transaction.invoiceNo} · {formatDateTime(transaction.createdAt)}
              </div>
              {transaction.cashierName && (
                <div className="mt-0.5 text-[11px] text-slate-500">
                  Kasir: {transaction.cashierName}
                </div>
              )}
            </div>

            <div className="space-y-2 border-b border-dashed border-slate-300 py-3">
              {transaction.items.map((item) => (
                <div key={item.productId}>
                  <div className="flex justify-between font-semibold text-slate-900">
                    <span>{item.name}</span>
                    <span className="tabular-nums">
                      {formatNumber(item.unitPrice * item.qty)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    {item.qty} x {formatNumber(item.unitPrice)}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1 border-b border-dashed border-slate-300 py-2.5 text-[11px] tabular-nums">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatNumber(transaction.subtotal)}</span>
              </div>
              {transaction.adjustmentLabel && transaction.discountAmount !== 0 && (
                <div className="flex justify-between">
                  <span>{transaction.adjustmentLabel}</span>
                  <span>
                    {transaction.discountAmount > 0
                      ? `-${formatNumber(transaction.discountAmount)}`
                      : `+${formatNumber(Math.abs(transaction.discountAmount))}`}
                  </span>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t border-slate-300 pt-1.5 text-sm font-bold text-slate-900">
                <span>TOTAL</span>
                <span>{formatRupiah(transaction.grandTotal)}</span>
              </div>
            </div>

            <div className="space-y-1 pt-2.5 text-[11px] tabular-nums">
              <div className="flex justify-between">
                <span>Metode</span>
                <span className="font-bold uppercase">
                  {transaction.paymentMethod}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Bayar</span>
                <span>{formatRupiah(transaction.amountPaid)}</span>
              </div>
              <div className="flex justify-between font-bold text-slate-900">
                <span>Kembalian</span>
                <span>{formatRupiah(transaction.change)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-slate-300 px-4 text-xs font-semibold text-slate-700"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-[#1B8EE6] px-4 text-xs font-bold text-white hover:bg-[#1479C9]"
          >
            <Printer className="h-4 w-4" />
            <span>Cetak Struk</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function SimpleHistoryModal({
  transactions,
  onSelectReceipt,
  onClose,
}: {
  transactions: SimpleTransaction[];
  onSelectReceipt: (tx: SimpleTransaction) => void;
  onClose: () => void;
}) {
  const totalSales = transactions.reduce((s, t) => s + t.grandTotal, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-[1px]">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#1B8EE6] px-5 py-3.5 text-white">
          <div>
            <h2 className="text-sm font-bold">Riwayat Transaksi</h2>
            <p className="text-[11px] text-white/85">
              {transactions.length} transaksi · Total {formatRupiah(totalSales)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup riwayat"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pos-scroll flex-1 space-y-2.5 overflow-y-auto p-4">
          {transactions.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Belum ada transaksi selesai.
            </div>
          ) : (
            transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3.5"
              >
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    {tx.invoiceNo}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {formatDateTime(tx.createdAt)} ·{' '}
                    {tx.totalQty ?? tx.items.reduce((s, i) => s + i.qty, 0)}{' '}
                    item ·{' '}
                    <span className="font-semibold uppercase">
                      {tx.paymentMethod}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono-num text-sm font-bold text-emerald-700">
                    {formatRupiah(tx.grandTotal)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelectReceipt(tx)}
                    className="flex h-8 items-center gap-1 rounded-md border border-slate-300 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <ReceiptText className="h-3.5 w-3.5" />
                    <span>Struk</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
