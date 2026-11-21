/**
 * Phase 0 Security Specification Test Suite (Dirty Dozen Verification)
 * Verifies all 12 adversarial payloads against firestore.rules.
 */
export interface DirtyDozenTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string } | null;
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
    name: 'Cross-Tenant UserProfile Read',
    operation: 'get',
    path: '/userProfiles/victim-uid',
    auth: { uid: 'attacker-uid' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Identity Spoofing on StaffAccount Create',
    operation: 'create',
    path: '/staffAccounts/stf-spoof',
    auth: { uid: 'attacker-uid' },
    payload: { ownerId: 'victim-uid', displayName: 'Evil', username: 'evil', role: 'admin', active: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-Tenant Transaction Read',
    operation: 'get',
    path: '/transactions/tx-victim-1',
    auth: { uid: 'attacker-uid' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow Ghost Field Injection on Voucher',
    operation: 'create',
    path: '/vouchers/v-ghost',
    auth: { uid: 'user-a' },
    payload: { ownerId: 'user-a', code: 'TEST10', label: '10%', type: 'percent', value: 10, minSubtotal: 0, active: true, superAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Path ID Poisoning (Invalid Chars)',
    operation: 'create',
    path: '/products/bad$id!@#',
    auth: { uid: 'user-a' },
    payload: { ownerId: 'user-a', sku: 'X3', barcode: '125', name: 'Item', price: 5000, image: '', category: 'Makanan' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Denial-of-Wallet Oversized Staff DisplayName',
    operation: 'create',
    path: '/staffAccounts/stf-huge',
    auth: { uid: 'user-a' },
    payload: { ownerId: 'user-a', displayName: 'A'.repeat(250), username: 'user1', role: 'kasir', active: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Client-Spoofed Timestamp on Transaction',
    operation: 'create',
    path: '/transactions/tx-fake-time',
    auth: { uid: 'user-a' },
    payload: { ownerId: 'user-a', invoiceNo: 'INV-0001', cashierName: 'Admin', itemCount: 1, totalQty: 1, subtotal: 10000, discountMode: 'none', discountAmount: 0, adjustmentLabel: '', grandTotal: 10000, paymentMethod: 'cash', amountPaid: 10000, change: 0, createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immutable Transaction Update Attempt',
    operation: 'update',
    path: '/transactions/tx-1',
    auth: { uid: 'user-a' },
    payload: { grandTotal: 0 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Orphaned Transaction Item Without Parent',
    operation: 'create',
    path: '/transactions/missing-parent/items/item-1',
    auth: { uid: 'user-a' },
    payload: { ownerId: 'user-a', transactionId: 'missing-parent', productId: 'p1', name: 'Wings', unitPrice: 32000, qty: 1, lineTotal: 32000 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Owner Reassignment on StaffAccount Update',
    operation: 'update',
    path: '/staffAccounts/stf-1',
    auth: { uid: 'user-a' },
    payload: { ownerId: 'user-b' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Value Poisoning Invalid Role on StaffAccount Update',
    operation: 'update',
    path: '/staffAccounts/stf-1',
    auth: { uid: 'user-a' },
    payload: { role: 'superadmin' },
    expected: 'PERMISSION_DENIED',
  },
];
