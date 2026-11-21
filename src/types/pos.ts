export type DiscountMode = 'none' | 'fixed' | 'percent' | 'exact' | 'voucher';

export type PaymentMethod = 'cash' | 'qris' | 'transfer';

export type StaffRole = 'admin' | 'kasir';

export type StockLogType = 'initial' | 'restock' | 'adjustment' | 'sale' | 'import';

export interface UserProfile {
  ownerId: string;
  displayName: string;
  storeName: string;
  role: 'admin';
  createdAt?: string;
}

export interface StaffAccount {
  id: string;
  ownerId: string;
  displayName: string;
  username: string;
  role: StaffRole;
  active: boolean;
  createdAt?: string;
}

export interface Branch {
  id: string;
  ownerId: string;
  code: string;
  name: string;
  address: string;
  active: boolean;
  createdAt?: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  price: number;
  image: string;
  category: string;
}

export interface BranchStock {
  id: string;
  ownerId: string;
  branchId: string;
  productId: string;
  initialStock: number;
  currentStock: number;
  minThreshold: number;
  updatedAt?: string;
}

export interface StockLog {
  id: string;
  ownerId: string;
  branchId: string;
  branchName: string;
  productId: string;
  productSku: string;
  productName: string;
  type: StockLogType;
  qtyDelta: number;
  stockBefore: number;
  stockAfter: number;
  note: string;
  actorName: string;
  createdAt: string;
}

export interface SalesLine {
  id: string;
  ownerId: string;
  transactionId: string;
  branchId: string;
  branchName: string;
  productId: string;
  productSku: string;
  productName: string;
  category: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  saleYear: number;
  saleMonth: number;
  source: 'pos' | 'import';
  createdAt: string;
}

export interface CartItem {
  productId: string;
  sku?: string;
  category?: string;
  name: string;
  unitPrice: number;
  qty: number;
}

export interface VoucherDef {
  id?: string;
  code: string;
  label: string;
  type: 'percent' | 'fixed';
  value: number;
  minSubtotal?: number;
  active?: boolean;
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
  branchId?: string;
  branchName?: string;
  invoiceNo: string;
  cashierName?: string;
  saleYear?: number;
  saleMonth?: number;
  source?: 'pos' | 'import';
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

export interface ImportedCatalogRow {
  sku: string;
  barcode: string;
  name: string;
  category: string;
  price: number;
  branchName: string;
  initialStock: number;
  currentStock: number;
  hasStockData?: boolean;
  transactionCode?: string;
  qtySold?: number;
  totalSales?: number;
  saleMonth?: number;
  saleYear?: number;
}

export interface ImportProgress {
  stage: string;
  current: number;
  total: number;
}

