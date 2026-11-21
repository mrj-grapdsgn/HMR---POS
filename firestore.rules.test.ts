/**
 * Phase 0 Security Specification Test Suite (Dirty Dozen Verification)
 * Verifies all 12 adversarial payloads against firestore.rules.
 * Run with Firebase Emulator Suite when testing locally.
 */
export interface DirtyDozenTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Product Read',
    operation: 'get',
    path: '/products/chicken-wings',
    auth: null,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Product Create',
    operation: 'create',
    path: '/products/prod-unverified',
    auth: { uid: 'user-a', email_verified: false },
    payload: { ownerId: 'user-a', name: 'Test', price: 10000 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Identity Spoofing on Product Create',
    operation: 'create',
    path: '/products/prod-spoof',
    auth: { uid: 'attacker', email_verified: true },
    payload: { ownerId: 'victim', sku: 'X1', barcode: '123', name: 'Spoof', price: 1000, image: '', category: 'Makanan' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-Tenant Transaction Read',
    operation: 'get',
    path: '/transactions/tx-victim-1',
    auth: { uid: 'attacker', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow Ghost Field Injection',
    operation: 'create',
    path: '/products/prod-ghost',
    auth: { uid: 'user-a', email_verified: true },
    payload: { ownerId: 'user-a', sku: 'X2', barcode: '124', name: 'Item', price: 5000, image: '', category: 'Makanan', isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Path ID Poisoning (Invalid Chars)',
    operation: 'create',
    path: '/products/bad$id!@#',
    auth: { uid: 'user-a', email_verified: true },
    payload: { ownerId: 'user-a', sku: 'X3', barcode: '125', name: 'Item', price: 5000, image: '', category: 'Makanan' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Denial-of-Wallet Oversized String',
    operation: 'create',
    path: '/products/prod-huge',
    auth: { uid: 'user-a', email_verified: true },
    payload: { ownerId: 'user-a', sku: 'X4', barcode: '126', name: 'A'.repeat(250), price: 5000, image: '', category: 'Makanan' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Client-Spoofed Timestamp on Transaction',
    operation: 'create',
    path: '/transactions/tx-fake-time',
    auth: { uid: 'user-a', email_verified: true },
    payload: { ownerId: 'user-a', invoiceNo: 'INV-0001', itemCount: 1, totalQty: 1, subtotal: 10000, discountMode: 'none', discountAmount: 0, adjustmentLabel: '', grandTotal: 10000, paymentMethod: 'cash', amountPaid: 10000, change: 0, createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immutable Transaction Update Attempt',
    operation: 'update',
    path: '/transactions/tx-1',
    auth: { uid: 'user-a', email_verified: true },
    payload: { grandTotal: 0 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Orphaned Transaction Item Without Parent',
    operation: 'create',
    path: '/transactions/missing-parent/items/item-1',
    auth: { uid: 'user-a', email_verified: true },
    payload: { ownerId: 'user-a', transactionId: 'missing-parent', productId: 'p1', name: 'Wings', unitPrice: 32000, qty: 1, lineTotal: 32000 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Owner Reassignment on Product Update',
    operation: 'update',
    path: '/products/prod-1',
    auth: { uid: 'user-a', email_verified: true },
    payload: { ownerId: 'user-b' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Value Poisoning Negative Price on Update',
    operation: 'update',
    path: '/products/prod-1',
    auth: { uid: 'user-a', email_verified: true },
    payload: { price: -10000, category: 'InvalidCat' },
    expected: 'PERMISSION_DENIED',
  },
];
