export type DiscountMode = 'none' | 'fixed' | 'percent' | 'exact' | 'voucher';

export type PaymentMethod = 'cash' | 'qris' | 'transfer';

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  price: number;
  image: string;
  category: 'Makanan' | 'Minuman' | 'Pastry' | 'Combo';
}

export interface CartItem {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
}

export interface VoucherDef {
  code: string;
  label: string;
  type: 'percent' | 'fixed';
  value: number;
  minSubtotal?: number;
}

export interface DiscountConfig {
  mode: DiscountMode;
  fixedAmount: number;
  percentValue: number;
  exactTotal: number | null;
  voucherCode: string;
}

export interface SimpleTotals {
  subtotal: number;
  discountAmount: number;
  adjustmentLabel: string | null;
  grandTotal: number;
  totalQty: number;
  voucherError: string | null;
  appliedVoucher: VoucherDef | null;
}

export interface SimpleTransaction {
  id: string;
  invoiceNo: string;
  items: CartItem[];
  totalQty?: number;
  subtotal: number;
  discountAmount: number;
  adjustmentLabel: string | null;
  grandTotal: number;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  change: number;
  createdAt: string;
}
