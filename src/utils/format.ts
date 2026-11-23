import {
  CartItem,
  DiscountConfig,
  SimpleTotals,
  VoucherDef,
} from '../types/pos';

export function formatNumber(amount: number): string {
  const rounded = Math.round(amount);
  const abs = Math.abs(rounded);
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return rounded < 0 ? `-${formatted}` : formatted;
}

export function formatRupiah(amount: number): string {
  return `Rp ${formatNumber(amount)}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function calculateSimpleTotals(
  items: CartItem[],
  discount: DiscountConfig,
  vouchers: VoucherDef[]
): SimpleTotals {
  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  const totalQty = items.reduce((sum, i) => sum + i.qty, 0);

  if (subtotal <= 0 || discount.mode === 'none') {
    return {
      subtotal,
      discountAmount: 0,
      adjustmentLabel: null,
      grandTotal: subtotal,
      totalQty,
      voucherError: null,
      appliedVoucher: null,
    };
  }

  if (discount.mode === 'fixed') {
    const cut = Math.min(subtotal, Math.max(0, Math.round(discount.fixedAmount)));
    return {
      subtotal,
      discountAmount: cut,
      adjustmentLabel: cut > 0 ? 'Potongan Harga' : null,
      grandTotal: Math.max(0, subtotal - cut),
      totalQty,
      voucherError: null,
      appliedVoucher: null,
    };
  }

  if (discount.mode === 'percent') {
    const pct = Math.min(100, Math.max(0, discount.percentValue));
    const cut = Math.round((subtotal * pct) / 100);
    return {
      subtotal,
      discountAmount: cut,
      adjustmentLabel: pct > 0 ? `Diskon ${pct}%` : null,
      grandTotal: Math.max(0, subtotal - cut),
      totalQty,
      voucherError: null,
      appliedVoucher: null,
    };
  }

  if (discount.mode === 'exact') {
    if (discount.exactTotal === null || Number.isNaN(discount.exactTotal)) {
      return {
        subtotal,
        discountAmount: 0,
        adjustmentLabel: null,
        grandTotal: subtotal,
        totalQty,
        voucherError: null,
        appliedVoucher: null,
      };
    }
    const target = Math.max(0, Math.round(discount.exactTotal));
    const diff = subtotal - target; // positive = discount, negative = markup
    return {
      subtotal,
      discountAmount: diff,
      adjustmentLabel: 'Harga Pas (Ubah Total)',
      grandTotal: target,
      totalQty,
      voucherError: null,
      appliedVoucher: null,
    };
  }

  if (discount.mode === 'b1g1') {
    const unitPrices: number[] = [];
    items.forEach((item) => {
      const p = Math.max(0, Math.round(item.unitPrice));
      for (let i = 0; i < item.qty; i++) {
        unitPrices.push(p);
      }
    });
    unitPrices.sort((a, b) => b - a);

    let discountAmount = 0;
    for (let i = 0; i < unitPrices.length; i += 2) {
      if (i + 1 < unitPrices.length) {
        discountAmount += unitPrices[i + 1];
      }
    }

    return {
      subtotal,
      discountAmount,
      adjustmentLabel: discountAmount > 0 ? 'Promo Buy 1 Get 1 Free' : null,
      grandTotal: Math.max(0, subtotal - discountAmount),
      totalQty,
      voucherError: null,
      appliedVoucher: null,
    };
  }

  // mode === 'voucher'
  const cleanCode = discount.voucherCode.trim().toUpperCase();
  if (!cleanCode) {
    return {
      subtotal,
      discountAmount: 0,
      adjustmentLabel: null,
      grandTotal: subtotal,
      totalQty,
      voucherError: null,
      appliedVoucher: null,
    };
  }

  const found = vouchers.find((v) => v.code.toUpperCase() === cleanCode);
  if (!found) {
    return {
      subtotal,
      discountAmount: 0,
      adjustmentLabel: null,
      grandTotal: subtotal,
      totalQty,
      voucherError: `Kode voucher "${cleanCode}" tidak ditemukan.`,
      appliedVoucher: null,
    };
  }

  if (found.minSubtotal && subtotal < found.minSubtotal) {
    return {
      subtotal,
      discountAmount: 0,
      adjustmentLabel: null,
      grandTotal: subtotal,
      totalQty,
      voucherError: `Minimal belanja ${formatRupiah(found.minSubtotal)} untuk voucher ${found.code}.`,
      appliedVoucher: null,
    };
  }

  const cut =
    found.type === 'percent'
      ? Math.round((subtotal * found.value) / 100)
      : Math.min(subtotal, found.value);

  return {
    subtotal,
    discountAmount: cut,
    adjustmentLabel: `Voucher ${found.code} (${found.label})`,
    grandTotal: Math.max(0, subtotal - cut),
    totalQty,
    voucherError: null,
    appliedVoucher: found,
  };
}
