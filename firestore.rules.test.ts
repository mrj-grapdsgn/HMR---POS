/**
 * Security TDD Specification for KasirPOS Multi-Branch Firestore Rules.
 * Verifies all 12 "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 */

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  actorUid: string | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Cross-tenant branchStock read',
    operation: 'get',
    path: '/branchStocks/branchA__prodA',
    actorUid: 'attacker-uid',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Negative stock deduction bypass',
    operation: 'update',
    path: '/branchStocks/branchA__prodA',
    actorUid: 'owner-uid',
    payload: { currentStock: -1 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Orphan branchStock with missing branch',
    operation: 'create',
    path: '/branchStocks/fakeBranch__prodA',
    actorUid: 'owner-uid',
    payload: {
      ownerId: 'owner-uid',
      branchId: 'nonexistent-branch',
      productId: 'prodA',
      initialStock: 10,
      currentStock: 10,
      minThreshold: 2,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow field injection on branch update',
    operation: 'update',
    path: '/branches/branchA',
    actorUid: 'owner-uid',
    payload: { name: 'CFD Senayan', isVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Immutable salesLine tampering',
    operation: 'update',
    path: '/salesLines/line-1',
    actorUid: 'owner-uid',
    payload: { lineTotal: 0 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Immutable stockLog deletion',
    operation: 'delete',
    path: '/stockLogs/log-1',
    actorUid: 'owner-uid',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Orphan salesLine without parent transaction',
    operation: 'create',
    path: '/salesLines/line-orphan',
    actorUid: 'owner-uid',
    payload: {
      ownerId: 'owner-uid',
      transactionId: 'missing-tx',
      branchId: 'branchA',
      branchName: 'CFD Senayan',
      productId: 'prodA',
      productSku: '101021002000',
      productName: 'Daypack Hikemore',
      category: 'Daypack',
      qty: 1,
      unitPrice: 200000,
      lineTotal: 200000,
      saleYear: 2026,
      saleMonth: 7,
      source: 'pos',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Oversized dynamic category string on product',
    operation: 'create',
    path: '/products/prod-poison',
    actorUid: 'owner-uid',
    payload: {
      ownerId: 'owner-uid',
      sku: 'SKU-1',
      barcode: '123456',
      name: 'Test Item',
      price: 10000,
      image: '',
      category: 'X'.repeat(120),
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'ID poisoning with invalid characters',
    operation: 'create',
    path: '/branches/bad$branch!id',
    actorUid: 'owner-uid',
    payload: { ownerId: 'owner-uid', code: 'BAD', name: 'Bad', address: '', active: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Client timestamp forgery on transaction create',
    operation: 'create',
    path: '/transactions/tx-forged',
    actorUid: 'owner-uid',
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Invalid saleMonth out of range',
    operation: 'create',
    path: '/transactions/tx-bad-month',
    actorUid: 'owner-uid',
    payload: { saleMonth: 13, saleYear: 2026 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unauthenticated list scrape on salesLines',
    operation: 'list',
    path: '/salesLines',
    actorUid: null,
    expected: 'PERMISSION_DENIED',
  },
];
