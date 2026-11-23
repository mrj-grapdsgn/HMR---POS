import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  DEFAULT_BRANCH,
  HIKEMORE_SEED_ROWS,
  LEGACY_CAFE_CATEGORIES,
  LEGACY_CAFE_SKUS,
  VOUCHERS,
} from '../data/catalog';
import { OperationType, db, handleFirestoreError } from '../firebase';
import {
  Branch,
  BranchStock,
  CartItem,
  DiscountMode,
  ImportProgress,
  ImportedCatalogRow,
  PaymentMethod,
  Product,
  SalesLine,
  SimpleTransaction,
  StaffAccount,
  StaffRole,
  StockLog,
  StockLogType,
  UserProfile,
  VoucherDef,
} from '../types/pos';
import {
  inferCategoryFromProductName,
  normalizeBranchKey,
  normalizeBranchName,
} from '../utils/productCategory';

// Validation constants synchronized verbatim with firebase-blueprint.json
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SKU_MAX = 32;
const BARCODE_MAX = 64;
const NAME_MAX = 100;
const CATEGORY_MAX = 50;
const BRANCH_NAME_MAX = 80;
const BRANCH_CODE_MAX = 24;
const ADDRESS_MAX = 160;
const NOTE_MAX = 160;
const DISPLAY_NAME_MAX = 80;
const USERNAME_MAX = 40;
const IMAGE_MAX = 300;
const LABEL_MAX = 100;
const VOUCHER_LABEL_MAX = 40;

export function makeBranchStockDocId(branchId: string, productId: string): string {
  return sanitizeId(`${branchId}__${productId}`, 'stk');
}

function sanitizeId(raw: string, fallbackPrefix: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
  if (cleaned && ID_PATTERN.test(cleaned)) return cleaned;
  return `${fallbackPrefix}-${Date.now()}`;
}

function sanitizeCode(raw: string, maxLen: number, fallback: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeUpperCode(raw: string, maxLen: number, fallback: string): string {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeCategory(raw: string, productName?: string): string {
  const inferred = inferCategoryFromProductName(productName ?? '', raw);
  return inferred.trim().slice(0, CATEGORY_MAX) || 'Umum';
}

function sanitizeInvoiceNo(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  if (cleaned.length >= 3) return cleaned;
  if (cleaned.length >= 1) return `TRX-${cleaned}`.slice(0, 32);
  return fallback.slice(0, 32);
}

function sanitizeUsername(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, USERNAME_MAX);
  return cleaned.length >= 2
    ? cleaned
    : `user${Date.now().toString().slice(-4)}`;
}

function toIsoString(ts: unknown): string {
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (typeof ts === 'string') return ts;
  return new Date().toISOString();
}

/* ==================== USER PROFILE ==================== */

export async function ensureUserProfile(
  ownerId: string,
  displayName: string,
  storeName?: string
): Promise<void> {
  const path = `userProfiles/${ownerId}`;
  try {
    const ref = doc(db, 'userProfiles', ownerId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId,
        displayName: (displayName.trim() || 'Admin Utama').slice(
          0,
          DISPLAY_NAME_MAX
        ),
        storeName: (storeName?.trim() || 'Hikemore Store').slice(0, NAME_MAX),
        role: 'admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateUserProfile(
  ownerId: string,
  input: { displayName: string; storeName: string }
): Promise<void> {
  const path = `userProfiles/${ownerId}`;
  try {
    await updateDoc(doc(db, 'userProfiles', ownerId), {
      displayName: (input.displayName.trim() || 'Admin Utama').slice(
        0,
        DISPLAY_NAME_MAX
      ),
      storeName: (input.storeName.trim() || 'Hikemore Store').slice(
        0,
        NAME_MAX
      ),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeUserProfile(
  ownerId: string,
  onData: (profile: UserProfile | null) => void,
  onError: (err: Error) => void
): () => void {
  const path = `userProfiles/${ownerId}`;
  return onSnapshot(
    doc(db, 'userProfiles', ownerId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      onData({
        ownerId: String(data.ownerId ?? ownerId),
        displayName: String(data.displayName ?? 'Admin Utama'),
        storeName: String(data.storeName ?? 'Hikemore Store'),
        role: 'admin',
        createdAt: toIsoString(data.createdAt),
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

/* ==================== SEEDING & MIGRATION ==================== */

export async function seedInitialDataIfNeeded(
  ownerId: string,
  ownerDisplayName: string,
  ownerUsername?: string
): Promise<void> {
  if (!ID_PATTERN.test(ownerId)) return;

  try {
    const [branchSnap, prodSnap, vouchSnap, staffSnap] = await Promise.all([
      getDocs(query(collection(db, 'branches'), where('ownerId', '==', ownerId))),
      getDocs(query(collection(db, 'products'), where('ownerId', '==', ownerId))),
      getDocs(query(collection(db, 'vouchers'), where('ownerId', '==', ownerId))),
      getDocs(
        query(collection(db, 'staffAccounts'), where('ownerId', '==', ownerId))
      ),
    ]);

    let defaultBranchId = branchSnap.docs[0]?.id ?? '';

    // Pass 1: Seed branch, vouchers, and staff if empty
    if (branchSnap.empty || vouchSnap.empty || staffSnap.empty) {
      const batch = writeBatch(db);

      if (branchSnap.empty) {
        defaultBranchId = sanitizeId(`${ownerId.slice(0, 8)}-cfd-senayan`, 'br');
        batch.set(doc(db, 'branches', defaultBranchId), {
          ownerId,
          code: DEFAULT_BRANCH.code,
          name: DEFAULT_BRANCH.name,
          address: DEFAULT_BRANCH.address,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (vouchSnap.empty) {
        for (const v of VOUCHERS) {
          const docId = sanitizeId(
            `${ownerId.slice(0, 8)}-${v.code.toLowerCase()}`,
            'vch'
          );
          batch.set(doc(db, 'vouchers', docId), {
            ownerId,
            code: sanitizeUpperCode(v.code, 32, 'PROMO'),
            label: v.label.trim().slice(0, VOUCHER_LABEL_MAX),
            type: v.type === 'fixed' ? 'fixed' : 'percent',
            value: Math.max(0, Math.round(v.value)),
            minSubtotal: Math.max(0, Math.round(v.minSubtotal ?? 0)),
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      if (staffSnap.empty) {
        const ownerStaffId = sanitizeId(`${ownerId.slice(0, 8)}-admin`, 'stf');
        batch.set(doc(db, 'staffAccounts', ownerStaffId), {
          ownerId,
          displayName: (ownerDisplayName.trim() || 'Admin Utama').slice(
            0,
            DISPLAY_NAME_MAX
          ),
          username: sanitizeUsername(ownerUsername || 'admin'),
          role: 'admin',
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const kasirStaffId = sanitizeId(`${ownerId.slice(0, 8)}-kasir1`, 'stf');
        batch.set(doc(db, 'staffAccounts', kasirStaffId), {
          ownerId,
          displayName: 'Kasir Shift 1',
          username: 'kasir1',
          role: 'kasir',
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }

    // Pass 2: If product catalog is empty, import the 13 Hikemore CFD Senayan products + stocks + July baseline sales
    if (prodSnap.empty) {
      const branchesAfter = await getDocs(
        query(collection(db, 'branches'), where('ownerId', '==', ownerId))
      );
      const mappedBranches: Branch[] = branchesAfter.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId,
          code: String(data.code ?? 'BR'),
          name: String(data.name ?? DEFAULT_BRANCH.name),
          address: String(data.address ?? ''),
          active: Boolean(data.active ?? true),
        };
      });

      await importCatalogRowsToFirestore(ownerId, HIKEMORE_SEED_ROWS, {
        existingBranches: mappedBranches,
        existingProducts: [],
        existingStocks: [],
        includeSales: true,
        actorName: ownerDisplayName || 'Admin Utama',
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seedInitialData');
  }
}

export function hasLegacyCafeProducts(products: Product[]): boolean {
  return products.some(
    (p) => LEGACY_CAFE_SKUS.has(p.sku) || LEGACY_CAFE_CATEGORIES.has(p.category)
  );
}

export async function replaceLegacyCafeWithHikemore(
  ownerId: string,
  existingProducts: Product[],
  existingBranches: Branch[],
  existingStocks: BranchStock[],
  actorName: string
): Promise<{ removedCafeCount: number; importedCount: number }> {
  const legacyProducts = existingProducts.filter(
    (p) => LEGACY_CAFE_SKUS.has(p.sku) || LEGACY_CAFE_CATEGORIES.has(p.category)
  );
  const legacyIds = new Set(legacyProducts.map((p) => p.id));

  try {
    if (legacyProducts.length > 0) {
      const refsToDelete = [
        ...legacyProducts.map((lp) => doc(db, 'products', lp.id)),
        ...existingStocks
          .filter((st) => legacyIds.has(st.productId))
          .map((st) => doc(db, 'branchStocks', st.id)),
      ];
      for (let i = 0; i < refsToDelete.length; i += 350) {
        const delBatch = writeBatch(db);
        refsToDelete.slice(i, i + 350).forEach((ref) => delBatch.delete(ref));
        await delBatch.commit();
      }
    }

    const remainingProducts = existingProducts.filter(
      (p) => !legacyIds.has(p.id)
    );
    const remainingStocks = existingStocks.filter(
      (st) => !legacyIds.has(st.productId)
    );

    const res = await importCatalogRowsToFirestore(ownerId, HIKEMORE_SEED_ROWS, {
      existingBranches,
      existingProducts: remainingProducts,
      existingStocks: remainingStocks,
      includeSales: true,
      actorName,
    });

    return {
      removedCafeCount: legacyProducts.length,
      importedCount: res.productsUpserted,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'products');
  }
}

/* ==================== SUBSCRIPTIONS ==================== */

export function subscribeBranches(
  ownerId: string,
  onData: (branches: Branch[]) => void,
  onError: (err: Error) => void
): () => void {
  const path = 'branches';
  const q = query(collection(db, path), where('ownerId', '==', ownerId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: Branch[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ownerId),
          code: String(data.code ?? 'BR'),
          name: String(data.name ?? 'Cabang'),
          address: String(data.address ?? ''),
          active: Boolean(data.active ?? true),
          createdAt: toIsoString(data.createdAt),
        };
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeProducts(
  ownerId: string,
  onData: (products: Product[]) => void,
  onError: (err: Error) => void
): () => void {
  const path = 'products';
  const q = query(collection(db, path), where('ownerId', '==', ownerId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: Product[] = snapshot.docs.map((d) => {
        const data = d.data();
        const nameStr = String(data.name ?? '');
        return {
          id: d.id,
          sku: String(data.sku ?? ''),
          barcode: String(data.barcode ?? ''),
          name: nameStr,
          price: Number(data.price ?? 0),
          image: String(data.image ?? ''),
          category: sanitizeCategory(String(data.category ?? 'Umum'), nameStr),
        };
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeBranchStocks(
  ownerId: string,
  onData: (stocks: BranchStock[]) => void,
  onError: (err: Error) => void
): () => void {
  const path = 'branchStocks';
  const q = query(collection(db, path), where('ownerId', '==', ownerId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: BranchStock[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ownerId),
          branchId: String(data.branchId ?? ''),
          productId: String(data.productId ?? ''),
          initialStock: Math.max(0, Number(data.initialStock ?? 0)),
          currentStock: Math.max(0, Number(data.currentStock ?? 0)),
          minThreshold: Math.max(0, Number(data.minThreshold ?? 2)),
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeStockLogs(
  ownerId: string,
  onData: (logs: StockLog[]) => void,
  onError: (err: Error) => void
): () => void {
  const path = 'stockLogs';
  const q = query(collection(db, path), where('ownerId', '==', ownerId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: StockLog[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ownerId),
          branchId: String(data.branchId ?? ''),
          branchName: String(data.branchName ?? ''),
          productId: String(data.productId ?? ''),
          productSku: String(data.productSku ?? ''),
          productName: String(data.productName ?? ''),
          type: (data.type ?? 'adjustment') as StockLogType,
          qtyDelta: Number(data.qtyDelta ?? 0),
          stockBefore: Number(data.stockBefore ?? 0),
          stockAfter: Number(data.stockAfter ?? 0),
          note: String(data.note ?? ''),
          actorName: String(data.actorName ?? 'Admin'),
          createdAt: toIsoString(data.createdAt),
        };
      });
      list.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeSalesLines(
  ownerId: string,
  onData: (lines: SalesLine[]) => void,
  onError: (err: Error) => void
): () => void {
  const path = 'salesLines';
  const q = query(collection(db, path), where('ownerId', '==', ownerId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: SalesLine[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ownerId),
          transactionId: String(data.transactionId ?? ''),
          branchId: String(data.branchId ?? ''),
          branchName: String(data.branchName ?? ''),
          productId: String(data.productId ?? ''),
          productSku: String(data.productSku ?? ''),
          productName: String(data.productName ?? ''),
          category: sanitizeCategory(
            String(data.category ?? 'Umum'),
            String(data.productName ?? '')
          ),
          qty: Number(data.qty ?? 0),
          unitPrice: Number(data.unitPrice ?? 0),
          lineTotal: Number(data.lineTotal ?? 0),
          saleYear: Number(data.saleYear ?? new Date().getFullYear()),
          saleMonth: Number(data.saleMonth ?? new Date().getMonth() + 1),
          source: (data.source === 'import' ? 'import' : 'pos') as
            | 'pos'
            | 'import',
          createdAt: toIsoString(data.createdAt),
        };
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeVouchers(
  ownerId: string,
  onData: (vouchers: VoucherDef[]) => void,
  onError: (err: Error) => void
): () => void {
  const path = 'vouchers';
  const q = query(collection(db, path), where('ownerId', '==', ownerId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: VoucherDef[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          code: String(data.code ?? ''),
          label: String(data.label ?? ''),
          type: (data.type === 'fixed' ? 'fixed' : 'percent') as
            | 'percent'
            | 'fixed',
          value: Number(data.value ?? 0),
          minSubtotal: Number(data.minSubtotal ?? 0) || undefined,
          active: Boolean(data.active ?? true),
        };
      });
      list.sort((a, b) => a.code.localeCompare(b.code));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeStaffAccounts(
  ownerId: string,
  onData: (staff: StaffAccount[]) => void,
  onError: (err: Error) => void
): () => void {
  const path = 'staffAccounts';
  const q = query(collection(db, path), where('ownerId', '==', ownerId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: StaffAccount[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? ownerId),
          displayName: String(data.displayName ?? ''),
          username: String(data.username ?? ''),
          role: (data.role === 'admin' ? 'admin' : 'kasir') as StaffRole,
          active: Boolean(data.active ?? true),
          createdAt: toIsoString(data.createdAt),
        };
      });
      list.sort((a, b) => {
        if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeTransactions(
  ownerId: string,
  onData: (txs: SimpleTransaction[]) => void,
  onError: (err: Error) => void
): () => void {
  const path = 'transactions';
  const q = query(collection(db, path), where('ownerId', '==', ownerId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: SimpleTransaction[] = snapshot.docs.map((d) => {
        const data = d.data();
        const createdIso = toIsoString(data.createdAt);
        const dt = new Date(createdIso);
        return {
          id: d.id,
          branchId: String(data.branchId ?? ''),
          branchName: String(data.branchName ?? 'Pusat'),
          invoiceNo: String(data.invoiceNo ?? d.id),
          cashierName: String(data.cashierName ?? 'Admin'),
          saleYear: Number(data.saleYear ?? dt.getFullYear()),
          saleMonth: Number(data.saleMonth ?? dt.getMonth() + 1),
          source: (data.source === 'import' ? 'import' : 'pos') as
            | 'pos'
            | 'import',
          items: [],
          totalQty: Number(data.totalQty ?? 0),
          subtotal: Number(data.subtotal ?? 0),
          discountAmount: Number(data.discountAmount ?? 0),
          adjustmentLabel: String(data.adjustmentLabel ?? '') || null,
          grandTotal: Number(data.grandTotal ?? 0),
          paymentMethod: (data.paymentMethod ?? 'cash') as PaymentMethod,
          amountPaid: Number(data.amountPaid ?? 0),
          change: Number(data.change ?? 0),
          createdAt: createdIso,
        };
      });
      list.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function fetchTransactionItems(
  ownerId: string,
  transactionId: string
): Promise<CartItem[]> {
  const path = `transactions/${transactionId}/items`;
  try {
    const q = query(
      collection(db, path),
      where('ownerId', '==', ownerId),
      where('transactionId', '==', transactionId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        productId: String(data.productId ?? d.id),
        name: String(data.name ?? ''),
        unitPrice: Number(data.unitPrice ?? 0),
        qty: Number(data.qty ?? 1),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

/* ==================== BRANCHES CRUD ==================== */

export async function saveBranchToFirestore(
  ownerId: string,
  input: {
    id?: string;
    code: string;
    name: string;
    address: string;
    active: boolean;
  }
): Promise<string> {
  const name = input.name.trim().slice(0, BRANCH_NAME_MAX);
  if (!name) throw new Error('Nama cabang wajib diisi.');
  const code = sanitizeUpperCode(
    input.code || name,
    BRANCH_CODE_MAX,
    `CAB-${Date.now().toString().slice(-3)}`
  );
  const address = input.address.trim().slice(0, ADDRESS_MAX);

  if (input.id) {
    const path = `branches/${input.id}`;
    try {
      await updateDoc(doc(db, 'branches', input.id), {
        code,
        name,
        address,
        active: Boolean(input.active),
        updatedAt: serverTimestamp(),
      });
      return input.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  const newId = sanitizeId(
    `${ownerId.slice(0, 8)}-${code.toLowerCase()}-${Date.now().toString().slice(-4)}`,
    'br'
  );
  const path = `branches/${newId}`;
  try {
    await setDoc(doc(db, 'branches', newId), {
      ownerId,
      code,
      name,
      address,
      active: Boolean(input.active),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return newId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteBranchFromFirestore(
  ownerId: string,
  branchId: string
): Promise<void> {
  const path = `branches/${branchId}`;
  try {
    const stockSnap = await getDocs(
      query(
        collection(db, 'branchStocks'),
        where('ownerId', '==', ownerId),
        where('branchId', '==', branchId)
      )
    );
    const refs = [
      ...stockSnap.docs.map((d) => d.ref),
      doc(db, 'branches', branchId),
    ];
    for (let i = 0; i < refs.length; i += 350) {
      const batch = writeBatch(db);
      refs.slice(i, i + 350).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/* ==================== PRODUCTS CRUD ==================== */

export async function saveProductToFirestore(
  ownerId: string,
  input: {
    id?: string;
    sku: string;
    barcode: string;
    name: string;
    price: number;
    image: string;
    category: string;
    initialBranchId?: string;
    initialBranchName?: string;
    initialStockQty?: number;
    actorName?: string;
  }
): Promise<string> {
  const sku = sanitizeCode(
    input.sku,
    SKU_MAX,
    `SKU-${Date.now().toString().slice(-4)}`
  );
  const barcode = sanitizeCode(
    input.barcode || sku,
    BARCODE_MAX,
    sku
  );
  const name = input.name.trim().slice(0, NAME_MAX);
  const price = Math.min(1000000000, Math.max(0, Math.round(input.price)));
  const image = input.image.trim().slice(0, IMAGE_MAX);
  const category = sanitizeCategory(input.category, name);

  if (!name) throw new Error('Nama produk tidak boleh kosong.');

  if (input.id) {
    const path = `products/${input.id}`;
    try {
      await updateDoc(doc(db, 'products', input.id), {
        sku,
        barcode,
        name,
        price,
        image,
        category,
        updatedAt: serverTimestamp(),
      });
      return input.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  const newId = sanitizeId(
    `${ownerId.slice(0, 8)}-${sku.toLowerCase()}-${Date.now().toString().slice(-4)}`,
    'prod'
  );
  const path = `products/${newId}`;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'products', newId), {
      ownerId,
      sku,
      barcode,
      name,
      price,
      image,
      category,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (
      input.initialBranchId &&
      typeof input.initialStockQty === 'number' &&
      input.initialStockQty >= 0
    ) {
      const qty = Math.min(1000000, Math.max(0, Math.round(input.initialStockQty)));
      const stockDocId = makeBranchStockDocId(input.initialBranchId, newId);
      batch.set(doc(db, 'branchStocks', stockDocId), {
        ownerId,
        branchId: input.initialBranchId,
        productId: newId,
        initialStock: qty,
        currentStock: qty,
        minThreshold: 2,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (qty > 0) {
        const logId = sanitizeId(
          `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          'log'
        );
        batch.set(doc(db, 'stockLogs', logId), {
          ownerId,
          branchId: input.initialBranchId,
          branchName: (input.initialBranchName || 'Cabang').slice(
            0,
            BRANCH_NAME_MAX
          ),
          productId: newId,
          productSku: sku,
          productName: name,
          type: 'initial',
          qtyDelta: qty,
          stockBefore: 0,
          stockAfter: qty,
          note: 'Stok awal produk baru',
          actorName: (input.actorName || 'Admin').slice(0, DISPLAY_NAME_MAX),
          createdAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();
    return newId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function autoCategorizeProductsInFirestore(
  ownerId: string,
  products: Product[]
): Promise<{ updatedCount: number }> {
  try {
    const snap = await getDocs(
      query(collection(db, 'products'), where('ownerId', '==', ownerId))
    );
    const updates: Array<{ id: string; category: string }> = [];
    snap.docs.forEach((d) => {
      const data = d.data();
      const rawCat = String(data.category ?? '').trim();
      const prodName = String(data.name ?? '').trim();
      const inferred = sanitizeCategory(rawCat, prodName);
      if (inferred !== rawCat && inferred !== 'Umum') {
        updates.push({ id: d.id, category: inferred });
      }
    });

    if (updates.length === 0 && products.length >= 0) {
      return { updatedCount: 0 };
    }

    for (let i = 0; i < updates.length; i += 150) {
      const chunk = updates.slice(i, i + 150);
      const batch = writeBatch(db);
      chunk.forEach((u) => {
        batch.update(doc(db, 'products', u.id), {
          category: u.category,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
    }

    return { updatedCount: updates.length };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'products');
  }
}

export async function deleteProductFromFirestore(
  ownerId: string,
  productId: string
): Promise<void> {
  const path = `products/${productId}`;
  try {
    const stockSnap = await getDocs(
      query(
        collection(db, 'branchStocks'),
        where('ownerId', '==', ownerId),
        where('productId', '==', productId)
      )
    );
    const batch = writeBatch(db);
    stockSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'products', productId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/* ==================== BRANCH STOCKS (RESTOK / OPNAME) ==================== */

export async function adjustBranchStockAtomic(
  ownerId: string,
  params: {
    branchId: string;
    branchName: string;
    product: Product;
    mode: 'restock' | 'opname';
    qtyInput: number;
    initialStockOverride?: number;
    minThreshold?: number;
    note: string;
    actorName: string;
  }
): Promise<void> {
  const stockDocId = makeBranchStockDocId(params.branchId, params.product.id);
  const stockRef = doc(db, 'branchStocks', stockDocId);
  const logId = sanitizeId(
    `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    'log'
  );
  const logRef = doc(db, 'stockLogs', logId);
  const path = `branchStocks/${stockDocId}`;

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(stockRef);
      const prevCurrent = snap.exists()
        ? Math.max(0, Number(snap.data().currentStock ?? 0))
        : 0;
      const prevInitial = snap.exists()
        ? Math.max(0, Number(snap.data().initialStock ?? prevCurrent))
        : 0;
      const prevThreshold = snap.exists()
        ? Math.max(0, Number(snap.data().minThreshold ?? 2))
        : 2;

      const cleanInput = Math.min(
        1000000,
        Math.max(0, Math.round(params.qtyInput))
      );
      const nextCurrent =
        params.mode === 'restock'
          ? Math.min(1000000, prevCurrent + cleanInput)
          : cleanInput;

      const nextInitial =
        params.initialStockOverride !== undefined
          ? Math.min(
              1000000,
              Math.max(0, Math.round(params.initialStockOverride))
            )
          : params.mode === 'restock'
            ? Math.min(1000000, prevInitial + cleanInput)
            : Math.max(prevInitial, nextCurrent);

      const nextThreshold =
        params.minThreshold !== undefined
          ? Math.min(100000, Math.max(0, Math.round(params.minThreshold)))
          : prevThreshold;

      if (snap.exists()) {
        tx.update(stockRef, {
          initialStock: nextInitial,
          currentStock: nextCurrent,
          minThreshold: nextThreshold,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(stockRef, {
          ownerId,
          branchId: params.branchId,
          productId: params.product.id,
          initialStock: nextInitial,
          currentStock: nextCurrent,
          minThreshold: nextThreshold,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const delta = nextCurrent - prevCurrent;
      tx.set(logRef, {
        ownerId,
        branchId: params.branchId,
        branchName: params.branchName.trim().slice(0, BRANCH_NAME_MAX) || 'Cabang',
        productId: params.product.id,
        productSku: sanitizeCode(params.product.sku, SKU_MAX, 'SKU'),
        productName: params.product.name.trim().slice(0, NAME_MAX) || 'Produk',
        type: params.mode === 'restock' ? 'restock' : 'adjustment',
        qtyDelta: delta,
        stockBefore: prevCurrent,
        stockAfter: nextCurrent,
        note: (
          params.note.trim() ||
          (params.mode === 'restock'
            ? `Restok masuk +${cleanInput} pcs`
            : `Stok opname -> ${nextCurrent} pcs`)
        ).slice(0, NOTE_MAX),
        actorName: (params.actorName.trim() || 'Admin').slice(0, DISPLAY_NAME_MAX),
        createdAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/* ==================== VOUCHERS & STAFF CRUD ==================== */

export async function saveVoucherToFirestore(
  ownerId: string,
  input: {
    id?: string;
    code: string;
    label: string;
    type: 'percent' | 'fixed';
    value: number;
    minSubtotal: number;
    active: boolean;
  }
): Promise<void> {
  const code = sanitizeUpperCode(input.code, 32, '');
  if (code.length < 2) {
    throw new Error('Kode voucher minimal 2 karakter (huruf/angka).');
  }
  const type = input.type === 'fixed' ? 'fixed' : 'percent';
  const value =
    type === 'percent'
      ? Math.min(100, Math.max(1, Math.round(input.value)))
      : Math.min(1000000000, Math.max(0, Math.round(input.value)));
  const minSubtotal = Math.min(
    1000000000,
    Math.max(0, Math.round(input.minSubtotal))
  );
  const label = (
    input.label.trim() ||
    (type === 'percent' ? `${value}%` : `Rp ${Math.round(value / 1000)}rb`)
  ).slice(0, VOUCHER_LABEL_MAX);

  if (input.id) {
    const path = `vouchers/${input.id}`;
    try {
      await updateDoc(doc(db, 'vouchers', input.id), {
        code,
        label,
        type,
        value,
        minSubtotal,
        active: Boolean(input.active),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
    return;
  }

  const newId = sanitizeId(
    `${ownerId.slice(0, 8)}-vch-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    'vch'
  );
  const path = `vouchers/${newId}`;
  try {
    await setDoc(doc(db, 'vouchers', newId), {
      ownerId,
      code,
      label,
      type,
      value,
      minSubtotal,
      active: Boolean(input.active),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteVoucherFromFirestore(
  voucherId: string
): Promise<void> {
  const path = `vouchers/${voucherId}`;
  try {
    await deleteDoc(doc(db, 'vouchers', voucherId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveStaffAccountToFirestore(
  ownerId: string,
  input: {
    id?: string;
    displayName: string;
    username: string;
    role: StaffRole;
    active: boolean;
  }
): Promise<void> {
  const displayName = input.displayName.trim().slice(0, DISPLAY_NAME_MAX);
  if (!displayName) throw new Error('Nama pengguna wajib diisi.');
  const username = sanitizeUsername(input.username || displayName);
  const role: StaffRole = input.role === 'admin' ? 'admin' : 'kasir';

  if (input.id) {
    const path = `staffAccounts/${input.id}`;
    try {
      await updateDoc(doc(db, 'staffAccounts', input.id), {
        displayName,
        username,
        role,
        active: Boolean(input.active),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
    return;
  }

  const newId = sanitizeId(
    `${ownerId.slice(0, 8)}-stf-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    'stf'
  );
  const path = `staffAccounts/${newId}`;
  try {
    await setDoc(doc(db, 'staffAccounts', newId), {
      ownerId,
      displayName,
      username,
      role,
      active: Boolean(input.active),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteStaffAccountFromFirestore(
  staffId: string
): Promise<void> {
  const path = `staffAccounts/${staffId}`;
  try {
    await deleteDoc(doc(db, 'staffAccounts', staffId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/* ==================== ATOMIC POS CHECKOUT WITH STOCK DEDUCTION ==================== */

export async function createTransactionAtomic(
  ownerId: string,
  params: {
    branchId: string;
    branchName: string;
    invoiceNo: string;
    cashierName: string;
    items: CartItem[];
    subtotal: number;
    discountMode: DiscountMode;
    discountAmount: number;
    adjustmentLabel: string | null;
    grandTotal: number;
    paymentMethod: PaymentMethod;
    amountPaid: number;
    change: number;
  }
): Promise<SimpleTransaction> {
  if (!params.branchId) {
    throw new Error('Pilih cabang aktif terlebih dahulu sebelum checkout.');
  }

  const now = new Date();
  const saleYear = now.getFullYear();
  const saleMonth = now.getMonth() + 1;

  const transactionId = sanitizeId(
    `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    'tx'
  );
  const invoiceNo = sanitizeCode(params.invoiceNo, 32, 'INV-0001');
  const branchName =
    params.branchName.trim().slice(0, BRANCH_NAME_MAX) || 'Cabang';
  const cashierName = (params.cashierName.trim() || 'Admin').slice(
    0,
    DISPLAY_NAME_MAX
  );
  const totalQty = params.items.reduce((s, i) => s + i.qty, 0);
  const safeSubtotal = Math.max(0, Math.round(params.subtotal));
  const safeGrandTotal = Math.max(0, Math.round(params.grandTotal));

  // Distribute net grandTotal proportionally across line items for exact SKU revenue analytics
  const distributedTotals = params.items.map((item) => {
    const gross = Math.max(0, Math.round(item.unitPrice)) * Math.max(1, Math.round(item.qty));
    if (safeSubtotal <= 0) return 0;
    return Math.round((gross / safeSubtotal) * safeGrandTotal);
  });
  const distSum = distributedTotals.reduce((a, b) => a + b, 0);
  if (distributedTotals.length > 0 && distSum !== safeGrandTotal) {
    distributedTotals[0] = Math.max(
      0,
      distributedTotals[0] + (safeGrandTotal - distSum)
    );
  }

  const txPath = `transactions/${transactionId}`;

  try {
    await runTransaction(db, async (tx) => {
      // 1. Read & verify every item's branch stock BEFORE any writes
      const stockSnapshots: Array<{
        item: CartItem;
        stockRef: ReturnType<typeof doc>;
        currentStock: number;
      }> = [];

      for (const item of params.items) {
        const stockDocId = makeBranchStockDocId(params.branchId, item.productId);
        const stockRef = doc(db, 'branchStocks', stockDocId);
        const snap = await tx.get(stockRef);
        const currentStock = snap.exists()
          ? Math.max(0, Number(snap.data().currentStock ?? 0))
          : 0;
        const requestedQty = Math.max(1, Math.round(item.qty));

        if (!snap.exists() || currentStock < requestedQty) {
          throw new Error(
            `STOCK_INSUFFICIENT::Stok "${item.name}" di cabang ${branchName} tidak mencukupi (tersisa ${currentStock} pcs, diminta ${requestedQty} pcs).`
          );
        }

        stockSnapshots.push({
          item,
          stockRef,
          currentStock,
        });
      }

      // 2. Write Transaction Header
      tx.set(doc(db, 'transactions', transactionId), {
        ownerId,
        branchId: params.branchId,
        branchName,
        invoiceNo,
        cashierName,
        saleYear,
        saleMonth,
        source: 'pos',
        itemCount: Math.max(1, params.items.length),
        totalQty: Math.max(1, totalQty),
        subtotal: safeSubtotal,
        discountMode: params.discountMode,
        discountAmount: Math.round(params.discountAmount),
        adjustmentLabel: (params.adjustmentLabel ?? '').slice(0, LABEL_MAX),
        grandTotal: safeGrandTotal,
        paymentMethod: params.paymentMethod,
        amountPaid: Math.max(0, Math.round(params.amountPaid)),
        change: Math.max(0, Math.round(params.change)),
        createdAt: serverTimestamp(),
      });

      // 3. Deduct branchStocks + write items subcollection + salesLines + stockLogs
      stockSnapshots.forEach(({ item, stockRef, currentStock }, index) => {
        const safeQty = Math.max(1, Math.round(item.qty));
        const safeUnitPrice = Math.max(0, Math.round(item.unitPrice));
        const nextStock = currentStock - safeQty;
        const safeSku = sanitizeCode(item.sku || item.productId, SKU_MAX, 'SKU');
        const safeName = item.name.trim().slice(0, NAME_MAX) || 'Produk';
        const safeCategory = sanitizeCategory(item.category || 'Umum', safeName);
        const netLineTotal = Math.max(0, distributedTotals[index] ?? safeUnitPrice * safeQty);

        tx.update(stockRef, {
          currentStock: nextStock,
          updatedAt: serverTimestamp(),
        });

        const itemId = sanitizeId(`item-${index + 1}-${item.productId}`, 'item');
        tx.set(doc(db, 'transactions', transactionId, 'items', itemId), {
          ownerId,
          transactionId,
          productId: sanitizeId(item.productId, 'prod'),
          name: safeName,
          unitPrice: safeUnitPrice,
          qty: safeQty,
          lineTotal: safeUnitPrice * safeQty,
          createdAt: serverTimestamp(),
        });

        const salesLineId = sanitizeId(
          `sl-${transactionId}-${index + 1}`,
          'sl'
        );
        tx.set(doc(db, 'salesLines', salesLineId), {
          ownerId,
          transactionId,
          branchId: params.branchId,
          branchName,
          productId: sanitizeId(item.productId, 'prod'),
          productSku: safeSku,
          productName: safeName,
          category: safeCategory,
          qty: safeQty,
          unitPrice: safeUnitPrice,
          lineTotal: netLineTotal,
          saleYear,
          saleMonth,
          source: 'pos',
          createdAt: serverTimestamp(),
        });

        const logId = sanitizeId(
          `log-${transactionId}-${index + 1}`,
          'log'
        );
        tx.set(doc(db, 'stockLogs', logId), {
          ownerId,
          branchId: params.branchId,
          branchName,
          productId: sanitizeId(item.productId, 'prod'),
          productSku: safeSku,
          productName: safeName,
          type: 'sale',
          qtyDelta: -safeQty,
          stockBefore: currentStock,
          stockAfter: nextStock,
          note: `Penjualan POS ${invoiceNo}`,
          actorName: cashierName,
          createdAt: serverTimestamp(),
        });
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('STOCK_INSUFFICIENT::')) {
      throw new Error(error.message.replace('STOCK_INSUFFICIENT::', ''));
    }
    handleFirestoreError(error, OperationType.CREATE, txPath);
  }

  return {
    id: transactionId,
    branchId: params.branchId,
    branchName,
    invoiceNo,
    cashierName,
    saleYear,
    saleMonth,
    source: 'pos',
    items: params.items,
    totalQty,
    subtotal: safeSubtotal,
    discountAmount: Math.round(params.discountAmount),
    adjustmentLabel: params.adjustmentLabel,
    grandTotal: safeGrandTotal,
    paymentMethod: params.paymentMethod,
    amountPaid: Math.max(0, Math.round(params.amountPaid)),
    change: Math.max(0, Math.round(params.change)),
    createdAt: now.toISOString(),
  };
}

/* ==================== RESET IMPORTED SALES (POS SALES STAY SAFE) ==================== */

export async function clearImportedSalesData(
  ownerId: string,
  onProgress?: (progress: ImportProgress) => void
): Promise<{ deletedTransactions: number; deletedSalesLines: number }> {
  const report = (stage: string, current: number, total: number) => {
    onProgress?.({ stage, current, total });
  };

  try {
    report('Memeriksa data penjualan impor lama...', 0, 1);

    const [txSnap, slSnap] = await Promise.all([
      getDocs(query(collection(db, 'transactions'), where('ownerId', '==', ownerId))),
      getDocs(query(collection(db, 'salesLines'), where('ownerId', '==', ownerId))),
    ]);

    const importedTxs = txSnap.docs.filter((d) => d.data().source === 'import');
    const importedSls = slSnap.docs.filter((d) => d.data().source === 'import');

    if (importedTxs.length === 0 && importedSls.length === 0) {
      return { deletedTransactions: 0, deletedSalesLines: 0 };
    }

    // Step 1: Fetch subcollection `items` of imported transactions in parallel groups of 15
    const itemsByTx: Array<{
      txId: string;
      refs: Array<ReturnType<typeof doc>>;
    }> = [];

    for (let i = 0; i < importedTxs.length; i += 15) {
      const slice = importedTxs.slice(i, i + 15);
      const fetched = await Promise.all(
        slice.map(async (txDoc) => {
          const itemSnap = await getDocs(
            query(
              collection(db, 'transactions', txDoc.id, 'items'),
              where('ownerId', '==', ownerId),
              where('transactionId', '==', txDoc.id)
            )
          );
          return {
            txId: txDoc.id,
            refs: itemSnap.docs.map((it) => it.ref),
          };
        })
      );
      fetched.forEach((entry) => {
        if (entry.refs.length > 0) itemsByTx.push(entry);
      });
    }

    // Step 2: Delete `items` BEFORE deleting parent `transactions` (items delete rule checks parent tx via get())
    // Pack <= 4 distinct txIds and <= 100 item deletes per batch to stay strictly below Firestore's 20-get() limit.
    const itemBatches: Array<Array<ReturnType<typeof doc>>> = [];
    let curBatchRefs: Array<ReturnType<typeof doc>> = [];
    let curDistinctTxs = 0;

    for (const entry of itemsByTx) {
      for (let k = 0; k < entry.refs.length; k += 100) {
        const refChunk = entry.refs.slice(k, k + 100);
        if (
          curBatchRefs.length > 0 &&
          (curDistinctTxs >= 4 || curBatchRefs.length + refChunk.length > 100)
        ) {
          itemBatches.push(curBatchRefs);
          curBatchRefs = [];
          curDistinctTxs = 0;
        }
        curBatchRefs.push(...refChunk);
        curDistinctTxs += 1;
      }
    }
    if (curBatchRefs.length > 0) itemBatches.push(curBatchRefs);

    const totalCleanSteps =
      itemBatches.length +
      Math.ceil(importedTxs.length / 350) +
      Math.ceil(importedSls.length / 350);
    let completedSteps = 0;

    report('Menghapus detail transaksi impor lama...', 0, Math.max(1, totalCleanSteps));

    for (let b = 0; b < itemBatches.length; b += 3) {
      const parallelGroup = itemBatches.slice(b, b + 3);
      await Promise.all(
        parallelGroup.map(async (refs) => {
          const batch = writeBatch(db);
          refs.forEach((ref) => batch.delete(ref));
          await batch.commit();
        })
      );
      completedSteps += parallelGroup.length;
      report(
        'Menghapus detail transaksi impor lama...',
        completedSteps,
        Math.max(1, totalCleanSteps)
      );
    }

    // Step 3: Delete imported `transactions` docs (0 rule get() calls -> 350 per batch)
    for (let i = 0; i < importedTxs.length; i += 350) {
      const chunk = importedTxs.slice(i, i + 350);
      const batch = writeBatch(db);
      chunk.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      completedSteps += 1;
      report(
        'Menghapus transaksi impor lama...',
        completedSteps,
        Math.max(1, totalCleanSteps)
      );
    }

    // Step 4: Delete imported `salesLines` docs (0 rule get() calls -> 350 per batch)
    for (let i = 0; i < importedSls.length; i += 350) {
      const chunk = importedSls.slice(i, i + 350);
      const batch = writeBatch(db);
      chunk.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      completedSteps += 1;
      report(
        'Menghapus rekapan penjualan impor lama...',
        completedSteps,
        Math.max(1, totalCleanSteps)
      );
    }

    return {
      deletedTransactions: importedTxs.length,
      deletedSalesLines: importedSls.length,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'transactions');
  }
}

/* ==================== BULK SPREADSHEET / SHEET IMPORT ==================== */

export async function importCatalogRowsToFirestore(
  ownerId: string,
  rows: ImportedCatalogRow[],
  options: {
    existingBranches: Branch[];
    existingProducts: Product[];
    existingStocks: BranchStock[];
    includeSales: boolean;
    replacePreviousImportedSales?: boolean;
    actorName: string;
    onProgress?: (progress: ImportProgress) => void;
  }
): Promise<{
  branchesCreated: number;
  productsUpserted: number;
  stocksUpdated: number;
  transactionsImported: number;
  transactionsSkipped: number;
  salesLinesImported: number;
  salesLinesSkipped: number;
}> {
  if (rows.length === 0) {
    return {
      branchesCreated: 0,
      productsUpserted: 0,
      stocksUpdated: 0,
      transactionsImported: 0,
      transactionsSkipped: 0,
      salesLinesImported: 0,
      salesLinesSkipped: 0,
    };
  }

  const actor = (options.actorName.trim() || 'Admin').slice(0, DISPLAY_NAME_MAX);
  const report = (stage: string, current: number, total: number) => {
    options.onProgress?.({ stage, current, total });
  };

  let branchesCreated = 0;
  let productsUpserted = 0;
  let stocksUpdated = 0;
  let transactionsImported = 0;
  let transactionsSkipped = 0;
  let salesLinesImported = 0;
  let salesLinesSkipped = 0;

  try {
    // Optional clean reset of previous `source === 'import'` sales (POS cashier sales are NEVER touched!)
    const incomingHasSales = rows.some((r) => (r.qtySold ?? 0) > 0);
    if (
      options.includeSales &&
      options.replacePreviousImportedSales &&
      incomingHasSales
    ) {
      await clearImportedSalesData(ownerId, options.onProgress);
    }

    report('Memeriksa data existing di Firebase...', 0, rows.length);

    // Fetch live snapshots from Firestore so we never overwrite existing createdAt or duplicate imported sales
    const [
      liveBranchesSnap,
      liveProductsSnap,
      liveStocksSnap,
      liveSalesSnap,
      liveTxSnap,
    ] = await Promise.all([
      getDocs(query(collection(db, 'branches'), where('ownerId', '==', ownerId))),
      getDocs(query(collection(db, 'products'), where('ownerId', '==', ownerId))),
      getDocs(
        query(collection(db, 'branchStocks'), where('ownerId', '==', ownerId))
      ),
      options.includeSales
        ? getDocs(
            query(collection(db, 'salesLines'), where('ownerId', '==', ownerId))
          )
        : Promise.resolve(null),
      options.includeSales
        ? getDocs(
            query(collection(db, 'transactions'), where('ownerId', '==', ownerId))
          )
        : Promise.resolve(null),
    ]);

    // Track already-imported sales per (branchId, productId, year, month) for summary-mode delta sync
    const existingImportedSales = new Map<
      string,
      { qty: number; lineTotal: number }
    >();
    if (liveSalesSnap) {
      liveSalesSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.source !== 'import') return;
        const key = `${String(data.branchId ?? '')}::${String(data.productId ?? '')}::${Number(data.saleYear ?? 0)}::${Number(data.saleMonth ?? 0)}`;
        const prev = existingImportedSales.get(key) ?? { qty: 0, lineTotal: 0 };
        existingImportedSales.set(key, {
          qty: prev.qty + Number(data.qty ?? 0),
          lineTotal: prev.lineTotal + Number(data.lineTotal ?? 0),
        });
      });
    }

    // Track already-imported invoiceNos per branch so per-transaction sync never duplicates existing TRX!
    const existingImportedInvoices = new Set<string>();
    if (liveTxSnap) {
      liveTxSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.source !== 'import') return;
        const bId = String(data.branchId ?? '');
        const inv = String(data.invoiceNo ?? '').trim().toLowerCase();
        if (bId && inv) {
          existingImportedInvoices.add(`${bId}::${inv}`);
        }
      });
    }

    const branchByName = new Map<string, Branch>();
    const branchIds = new Set<string>();
    liveBranchesSnap.docs.forEach((d) => {
      const data = d.data();
      const b: Branch = {
        id: d.id,
        ownerId,
        code: String(data.code ?? 'BR'),
        name: String(data.name ?? 'Cabang'),
        address: String(data.address ?? ''),
        active: Boolean(data.active ?? true),
      };
      const bKey = normalizeBranchKey(b.name);
      const prevBranch = branchByName.get(bKey);
      if (
        !prevBranch ||
        (prevBranch.name.includes('_') && !b.name.includes('_'))
      ) {
        branchByName.set(bKey, b);
      }
      branchIds.add(d.id);
    });

    const productBySku = new Map<string, Product>();
    const productById = new Map<string, Product>();
    liveProductsSnap.docs.forEach((d) => {
      const data = d.data();
      const prodName = String(data.name ?? '');
      const p: Product = {
        id: d.id,
        sku: String(data.sku ?? ''),
        barcode: String(data.barcode ?? ''),
        name: prodName,
        price: Number(data.price ?? 0),
        image: String(data.image ?? ''),
        category: sanitizeCategory(String(data.category ?? 'Umum'), prodName),
      };
      productById.set(d.id, p);
      if (p.sku) {
        productBySku.set(p.sku.trim().toLowerCase(), p);
        const sanitizedKey = sanitizeCode(p.sku, SKU_MAX, '').toLowerCase();
        if (sanitizedKey) productBySku.set(sanitizedKey, p);
      }
    });

    const stockById = new Map<string, BranchStock>();
    liveStocksSnap.docs.forEach((d) => {
      const data = d.data();
      stockById.set(d.id, {
        id: d.id,
        ownerId,
        branchId: String(data.branchId ?? ''),
        productId: String(data.productId ?? ''),
        initialStock: Math.max(0, Number(data.initialStock ?? 0)),
        currentStock: Math.max(0, Number(data.currentStock ?? 0)),
        minThreshold: Math.max(0, Number(data.minThreshold ?? 2)),
      });
    });

    // PASS 1A: Create any missing branches (chunked by 150) — normalize underscores so CFD_Senayan == CFD Senayan
    const uniqueBranchMap = new Map<string, string>();
    rows.forEach((r) => {
      const normalized = normalizeBranchName(r.branchName, DEFAULT_BRANCH.name).slice(
        0,
        BRANCH_NAME_MAX
      );
      const key = normalizeBranchKey(normalized);
      if (key && !uniqueBranchMap.has(key)) {
        uniqueBranchMap.set(key, normalized);
      }
    });

    const missingBranches = Array.from(uniqueBranchMap.entries())
      .filter(([key]) => !branchByName.has(key))
      .map(([, name]) => name);

    if (missingBranches.length > 0) {
      report('Membuat cabang baru...', 0, missingBranches.length);
      for (let i = 0; i < missingBranches.length; i += 150) {
        const chunk = missingBranches.slice(i, i + 150);
        const bBatch = writeBatch(db);
        chunk.forEach((bName, idx) => {
          const bCode = sanitizeUpperCode(
            bName,
            BRANCH_CODE_MAX,
            `BR-${i + idx + 1}`
          );
          let bId = sanitizeId(
            `${ownerId.slice(0, 8)}-${bCode.toLowerCase()}-${Date.now().toString().slice(-3)}${i + idx}`,
            'br'
          );
          while (branchIds.has(bId)) {
            bId = sanitizeId(`${bId}-x`, 'br');
          }
          branchIds.add(bId);
          bBatch.set(doc(db, 'branches', bId), {
            ownerId,
            code: bCode,
            name: bName,
            address: '',
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          branchByName.set(normalizeBranchKey(bName), {
            id: bId,
            ownerId,
            code: bCode,
            name: bName,
            address: '',
            active: true,
          });
          branchesCreated += 1;
        });
        await bBatch.commit();
        report(
          'Membuat cabang baru...',
          Math.min(i + chunk.length, missingBranches.length),
          missingBranches.length
        );
      }
    }

    // PASS 1B: Deduplicate products by sanitized SKU & candidate docId, then upsert in chunks of 150
    const uniqueProductsByCleanSku = new Map<
      string,
      {
        cleanSku: string;
        cleanBarcode: string;
        cleanName: string;
        cleanCategory: string;
        cleanPrice: number;
      }
    >();

    rows.forEach((r, idx) => {
      const cleanSku = sanitizeCode(r.sku, SKU_MAX, `SKU-${idx + 1}`);
      const skuKey = cleanSku.toLowerCase();
      const cleanBarcode = sanitizeCode(
        r.barcode || cleanSku,
        BARCODE_MAX,
        cleanSku
      );
      const cleanName = r.name.trim().slice(0, NAME_MAX) || cleanSku;
      const cleanCategory = sanitizeCategory(r.category, cleanName);
      const cleanPrice = Math.min(
        1000000000,
        Math.max(0, Math.round(r.price))
      );

      const prev = uniqueProductsByCleanSku.get(skuKey);
      if (!prev) {
        uniqueProductsByCleanSku.set(skuKey, {
          cleanSku,
          cleanBarcode,
          cleanName,
          cleanCategory,
          cleanPrice,
        });
      } else {
        uniqueProductsByCleanSku.set(skuKey, {
          cleanSku: prev.cleanSku,
          cleanBarcode: prev.cleanBarcode || cleanBarcode,
          cleanName: prev.cleanName || cleanName,
          cleanCategory:
            prev.cleanCategory !== 'Umum' ? prev.cleanCategory : cleanCategory,
          cleanPrice: prev.cleanPrice > 0 ? prev.cleanPrice : cleanPrice,
        });
      }
    });

    const prodEntries = Array.from(uniqueProductsByCleanSku.entries());
    report('Menyimpan katalog produk...', 0, prodEntries.length);

    for (let i = 0; i < prodEntries.length; i += 150) {
      const chunk = prodEntries.slice(i, i + 150);
      const pBatch = writeBatch(db);

      for (const [skuKey, entry] of chunk) {
        const candidateId = sanitizeId(
          `${ownerId.slice(0, 8)}-${entry.cleanSku.toLowerCase()}`,
          'prod'
        );
        const existing =
          productBySku.get(skuKey) ?? productById.get(candidateId);

        if (existing) {
          const finalPrice =
            entry.cleanPrice > 0 ? entry.cleanPrice : existing.price;
          const existingCleanCat = sanitizeCategory(
            existing.category,
            entry.cleanName || existing.name
          );
          const finalCategory =
            entry.cleanCategory !== 'Umum'
              ? entry.cleanCategory
              : existingCleanCat;
          pBatch.update(doc(db, 'products', existing.id), {
            sku: entry.cleanSku,
            barcode: entry.cleanBarcode,
            name: entry.cleanName,
            price: finalPrice,
            image: existing.image || '',
            category: finalCategory,
            updatedAt: serverTimestamp(),
          });
          const updatedProd: Product = {
            ...existing,
            sku: entry.cleanSku,
            barcode: entry.cleanBarcode,
            name: entry.cleanName,
            price: finalPrice,
            category: finalCategory,
          };
          productBySku.set(skuKey, updatedProd);
          productById.set(existing.id, updatedProd);
        } else {
          pBatch.set(doc(db, 'products', candidateId), {
            ownerId,
            sku: entry.cleanSku,
            barcode: entry.cleanBarcode,
            name: entry.cleanName,
            price: entry.cleanPrice,
            image: '',
            category: entry.cleanCategory,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          const createdProd: Product = {
            id: candidateId,
            sku: entry.cleanSku,
            barcode: entry.cleanBarcode,
            name: entry.cleanName,
            price: entry.cleanPrice,
            image: '',
            category: entry.cleanCategory,
          };
          productBySku.set(skuKey, createdProd);
          productById.set(candidateId, createdProd);
        }
        productsUpserted += 1;
      }

      await pBatch.commit();
      report(
        'Menyimpan katalog produk...',
        Math.min(i + chunk.length, prodEntries.length),
        prodEntries.length
      );
    }

    // PASS 2: Deduplicate branchStocks by stockDocId and split into Updates vs Creates.
    // CRITICAL: branchStocks `allow create` calls existsAfter+getAfter on branch & product (up to 4 rule reads/doc),
    // and Firestore enforces a hard max of 20 rule document-access calls per writeBatch!
    // Therefore, `stockCreates` MUST be batched in chunks of <= 4 (4 * 4 = 16 <= 20),
    // while `stockUpdates` make 0 rule reads and can run in chunks of 100.
    type StockTask = {
      stockDocId: string;
      branch: Branch;
      product: Product;
      initialStock: number;
      currentStock: number;
      hasStockData: boolean;
      existingStock?: BranchStock;
    };

    const stockTaskMap = new Map<string, StockTask>();
    rows.forEach((row, idx) => {
      const bName = normalizeBranchName(row.branchName, DEFAULT_BRANCH.name).slice(
        0,
        BRANCH_NAME_MAX
      );
      const cleanSku = sanitizeCode(row.sku, SKU_MAX, `SKU-${idx + 1}`);
      const branch = branchByName.get(normalizeBranchKey(bName));
      const product = productBySku.get(cleanSku.toLowerCase());
      if (!branch || !product) return;

      const stockDocId = makeBranchStockDocId(branch.id, product.id);
      const hasStockData = row.hasStockData !== false;
      const existingStock = stockById.get(stockDocId);

      // CRITICAL: If syncing a sales-only sheet (like Data_Penjualan where hasStockData === false),
      // do NOT overwrite existing branch stocks with 0!
      if (!hasStockData && existingStock) {
        return;
      }

      const initialStock = Math.min(
        1000000,
        Math.max(0, Math.round(row.initialStock))
      );
      const currentStock = Math.min(
        1000000,
        Math.max(0, Math.round(row.currentStock))
      );

      const prevTask = stockTaskMap.get(stockDocId);
      if (prevTask) {
        stockTaskMap.set(stockDocId, {
          ...prevTask,
          initialStock: hasStockData
            ? initialStock
            : prevTask.initialStock,
          currentStock: hasStockData
            ? currentStock
            : prevTask.currentStock,
          hasStockData: prevTask.hasStockData || hasStockData,
        });
      } else {
        stockTaskMap.set(stockDocId, {
          stockDocId,
          branch,
          product,
          initialStock,
          currentStock,
          hasStockData,
          existingStock,
        });
      }
    });

    const allStockTasks = Array.from(stockTaskMap.values());
    const stockUpdates = allStockTasks.filter((t) => Boolean(t.existingStock));
    const stockCreates = allStockTasks.filter((t) => !t.existingStock);
    let stocksDone = 0;

    report('Menyimpan stok cabang...', 0, allStockTasks.length);

    // 2A: Updates (0 rule getAfter calls -> 100 per batch)
    for (let i = 0; i < stockUpdates.length; i += 100) {
      const chunk = stockUpdates.slice(i, i + 100);
      const sBatch = writeBatch(db);
      chunk.forEach((task, idx) => {
        sBatch.update(doc(db, 'branchStocks', task.stockDocId), {
          initialStock: task.initialStock,
          currentStock: task.currentStock,
          minThreshold: task.existingStock?.minThreshold ?? 2,
          updatedAt: serverTimestamp(),
        });

        const logId = sanitizeId(
          `imp-u-${Date.now()}-${i + idx}-${Math.random().toString(36).slice(2, 5)}`,
          'log'
        );
        const prev = task.existingStock?.currentStock ?? 0;
        sBatch.set(doc(db, 'stockLogs', logId), {
          ownerId,
          branchId: task.branch.id,
          branchName: task.branch.name,
          productId: task.product.id,
          productSku: task.product.sku,
          productName: task.product.name,
          type: 'import',
          qtyDelta: task.currentStock - prev,
          stockBefore: prev,
          stockAfter: task.currentStock,
          note: `Impor pembaruan stok (Awal: ${task.initialStock}, Sisa: ${task.currentStock})`,
          actorName: actor,
          createdAt: serverTimestamp(),
        });
        stocksUpdated += 1;
      });
      await sBatch.commit();
      stocksDone += chunk.length;
      report('Menyimpan stok cabang...', stocksDone, allStockTasks.length);
    }

    // 2B: Creates (4 rule accesses per create -> strictly 4 per batch, run 3 batches in parallel for speed)
    const createChunks: StockTask[][] = [];
    for (let i = 0; i < stockCreates.length; i += 4) {
      createChunks.push(stockCreates.slice(i, i + 4));
    }

    for (let c = 0; c < createChunks.length; c += 3) {
      const parallelGroup = createChunks.slice(c, c + 3);
      await Promise.all(
        parallelGroup.map(async (chunk, groupOffset) => {
          const sBatch = writeBatch(db);
          chunk.forEach((task, idx) => {
            sBatch.set(doc(db, 'branchStocks', task.stockDocId), {
              ownerId,
              branchId: task.branch.id,
              productId: task.product.id,
              initialStock: task.initialStock,
              currentStock: task.currentStock,
              minThreshold: 2,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            const logId = sanitizeId(
              `imp-c-${Date.now()}-${c + groupOffset}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
              'log'
            );
            sBatch.set(doc(db, 'stockLogs', logId), {
              ownerId,
              branchId: task.branch.id,
              branchName: task.branch.name,
              productId: task.product.id,
              productSku: task.product.sku,
              productName: task.product.name,
              type: 'import',
              qtyDelta: task.currentStock,
              stockBefore: 0,
              stockAfter: task.currentStock,
              note: `Impor stok awal (Awal: ${task.initialStock}, Sisa: ${task.currentStock})`,
              actorName: actor,
              createdAt: serverTimestamp(),
            });
            stocksUpdated += 1;
          });
          await sBatch.commit();
        })
      );
      stocksDone += parallelGroup.reduce((s, ch) => s + ch.length, 0);
      report('Menyimpan stok cabang...', stocksDone, allStockTasks.length);
    }

    // PASS 3: Imported historical sales
    // Mode A (Real Per-Transaction): When rows carry `transactionCode` (from Data_Penjualan),
    // write 1 real Firestore `transactions` doc per unique `transactionCode` so Total Transaksi reflects the real TRX count!
    // Mode B (Monthly Summary Fallback): When rows have no `transactionCode`, use monthly delta sync.
    if (options.includeSales) {
      const rawSalesRows = rows.filter((r) => (r.qtySold ?? 0) > 0);
      const hasPerTxCodes = rawSalesRows.some((r) =>
        Boolean(r.transactionCode?.trim())
      );

      if (hasPerTxCodes) {
        type TxLineEntry = {
          product: Product;
          qty: number;
          unitPrice: number;
          grossTotal: number;
          discountAmount: number;
          discountType: DiscountMode;
          discountLabel?: string;
          lineTotal: number;
        };
        type PendingTxGroup = {
          branch: Branch;
          invoiceNo: string;
          saleYear: number;
          saleMonth: number;
          discountLabel?: string;
          linesByProduct: Map<string, TxLineEntry>;
        };

        const txGroups = new Map<string, PendingTxGroup>();
        rawSalesRows.forEach((sr, idx) => {
          const bName = normalizeBranchName(sr.branchName, DEFAULT_BRANCH.name).slice(
            0,
            BRANCH_NAME_MAX
          );
          const branch = branchByName.get(normalizeBranchKey(bName));
          const cleanSku = sanitizeCode(sr.sku, SKU_MAX, `SKU-${idx + 1}`);
          const product = productBySku.get(cleanSku.toLowerCase());
          if (!branch || !product) return;

          const saleYear = Math.min(
            2100,
            Math.max(2000, sr.saleYear ?? new Date().getFullYear())
          );
          const saleMonth = Math.min(
            12,
            Math.max(1, sr.saleMonth ?? new Date().getMonth() + 1)
          );
          const invoiceNo = sanitizeInvoiceNo(
            sr.transactionCode || '',
            `TRX-${saleYear}${String(saleMonth).padStart(2, '0')}-${idx + 1}`
          );
          const qty = Math.min(10000, Math.max(1, Math.round(sr.qtySold ?? 1)));
          const lineTotal = Math.min(
            1000000000,
            Math.max(
              0,
              Math.round(
                sr.totalSales !== undefined ? sr.totalSales : product.price * qty
              )
            )
          );
          const discountAmount = Math.min(
            1000000000,
            Math.max(0, Math.round(sr.discountAmount ?? 0))
          );
          const grossTotal = Math.min(
            1000000000,
            Math.max(
              lineTotal,
              Math.round(
                sr.grossSales !== undefined
                  ? sr.grossSales
                  : lineTotal + discountAmount
              )
            )
          );
          const discountType: DiscountMode =
            discountAmount > 0 && sr.discountType && sr.discountType !== 'none'
              ? sr.discountType
              : discountAmount > 0
                ? 'fixed'
                : 'none';
          const discountLabel = sr.discountLabel?.trim() || undefined;
          const unitPrice = Math.min(
            1000000000,
            grossTotal === 0
              ? 0
              : qty > 0 && grossTotal > 0
                ? Math.round(grossTotal / qty)
                : sr.price > 0
                  ? Math.round(sr.price)
                  : product.price
          );

          const gKey = `${branch.id}::${invoiceNo.toLowerCase()}`;
          let group = txGroups.get(gKey);
          if (!group) {
            group = {
              branch,
              invoiceNo,
              saleYear,
              saleMonth,
              discountLabel,
              linesByProduct: new Map<string, TxLineEntry>(),
            };
            txGroups.set(gKey, group);
          } else if (!group.discountLabel && discountLabel) {
            group.discountLabel = discountLabel;
          }

          const prevLine = group.linesByProduct.get(product.id);
          if (prevLine) {
            const nextQty = Math.min(10000, prevLine.qty + qty);
            const nextGross = Math.min(
              1000000000,
              prevLine.grossTotal + grossTotal
            );
            const nextDiscount = Math.min(
              1000000000,
              prevLine.discountAmount + discountAmount
            );
            const nextTotal = Math.min(1000000000, prevLine.lineTotal + lineTotal);
            group.linesByProduct.set(product.id, {
              product,
              qty: nextQty,
              unitPrice:
                nextGross === 0
                  ? 0
                  : nextQty > 0
                    ? Math.round(nextGross / nextQty)
                    : prevLine.unitPrice > 0
                      ? prevLine.unitPrice
                      : unitPrice,
              grossTotal: nextGross,
              discountAmount: nextDiscount,
              discountType:
                prevLine.discountType !== 'none'
                  ? prevLine.discountType
                  : discountType,
              discountLabel: prevLine.discountLabel ?? discountLabel,
              lineTotal: nextTotal,
            });
          } else {
            group.linesByProduct.set(product.id, {
              product,
              qty,
              unitPrice,
              grossTotal,
              discountAmount,
              discountType,
              discountLabel,
              lineTotal,
            });
          }
        });

        type FinalTxToWrite = {
          branch: Branch;
          invoiceNo: string;
          saleYear: number;
          saleMonth: number;
          discountLabel?: string;
          lines: TxLineEntry[];
        };

        const pendingTxs: FinalTxToWrite[] = [];
        for (const [gKey, group] of txGroups.entries()) {
          const allLines = Array.from(group.linesByProduct.values());
          if (allLines.length === 0) continue;

          if (existingImportedInvoices.has(gKey)) {
            transactionsSkipped += 1;
            salesLinesSkipped += allLines.length;
            continue;
          }

          // Split abnormally huge single-invoice groups so itemCount <= 60 & totalQty <= 9000
          let subChunk: TxLineEntry[] = [];
          let subQty = 0;
          let part = 1;
          for (const line of allLines) {
            if (
              subChunk.length >= 60 ||
              (subChunk.length > 0 && subQty + line.qty > 9000)
            ) {
              const partInvoice =
                part === 1
                  ? group.invoiceNo
                  : sanitizeInvoiceNo(`${group.invoiceNo}-${part}`, group.invoiceNo);
              pendingTxs.push({
                branch: group.branch,
                invoiceNo: partInvoice,
                saleYear: group.saleYear,
                saleMonth: group.saleMonth,
                discountLabel: group.discountLabel,
                lines: subChunk,
              });
              subChunk = [];
              subQty = 0;
              part += 1;
            }
            subChunk.push(line);
            subQty += line.qty;
          }
          if (subChunk.length > 0) {
            const partInvoice =
              part === 1
                ? group.invoiceNo
                : sanitizeInvoiceNo(`${group.invoiceNo}-${part}`, group.invoiceNo);
            pendingTxs.push({
              branch: group.branch,
              invoiceNo: partInvoice,
              saleYear: group.saleYear,
              saleMonth: group.saleMonth,
              discountLabel: group.discountLabel,
              lines: subChunk,
            });
          }
        }

        if (pendingTxs.length > 0) {
          report('Menyimpan transaksi penjualan...', 0, pendingTxs.length);

          // Pack <= 5 distinct transactions AND <= 150 writes per writeBatch
          // (5 distinct txIds -> at most 10 existsAfter/getAfter rule calls, strictly under Firestore's 20 limit!)
          const txBatches: FinalTxToWrite[][] = [];
          let curBatch: FinalTxToWrite[] = [];
          let curWrites = 0;

          for (const txItem of pendingTxs) {
            const neededWrites = 1 + txItem.lines.length * 2;
            if (
              curBatch.length > 0 &&
              (curBatch.length >= 5 || curWrites + neededWrites > 150)
            ) {
              txBatches.push(curBatch);
              curBatch = [];
              curWrites = 0;
            }
            curBatch.push(txItem);
            curWrites += neededWrites;
          }
          if (curBatch.length > 0) txBatches.push(curBatch);

          const baseStamp = Date.now();
          let txsDone = 0;

          for (let b = 0; b < txBatches.length; b += 3) {
            const parallelGroup = txBatches.slice(b, b + 3);
            await Promise.all(
              parallelGroup.map(async (batchTxs, groupOffset) => {
                const txBatch = writeBatch(db);
                batchTxs.forEach((txItem, txOffset) => {
                  const txId = sanitizeId(
                    `tx-imp-${baseStamp}-${b + groupOffset}-${txOffset}-${Math.random().toString(36).slice(2, 5)}`,
                    'tx'
                  );
                  const totalQty = Math.min(
                    10000,
                    Math.max(1, txItem.lines.reduce((s, l) => s + l.qty, 0))
                  );
                  const grandTotal = Math.min(
                    1000000000,
                    txItem.lines.reduce((s, l) => s + l.lineTotal, 0)
                  );
                  const txDiscountAmount = Math.min(
                    1000000000,
                    txItem.lines.reduce((s, l) => s + l.discountAmount, 0)
                  );
                  const txSubtotal = Math.min(
                    1000000000,
                    Math.max(
                      grandTotal,
                      txItem.lines.reduce((s, l) => s + l.grossTotal, 0)
                    )
                  );
                  const txDiscountMode: DiscountMode =
                    txDiscountAmount > 0
                      ? txItem.lines.find((l) => l.discountType !== 'none')
                          ?.discountType ?? 'fixed'
                      : 'none';
                  const resolvedLabel =
                    txItem.discountLabel ??
                    txItem.lines.find((l) => l.discountLabel)?.discountLabel;
                  const adjustmentLabel = (
                    resolvedLabel
                      ? `${resolvedLabel} · Sinkron ${txItem.saleMonth}/${txItem.saleYear}`
                      : txDiscountAmount > 0
                        ? `Diskon Transaksi · Sinkron ${txItem.saleMonth}/${txItem.saleYear}`
                        : `Sinkron Data Penjualan ${txItem.saleMonth}/${txItem.saleYear}`
                  ).slice(0, LABEL_MAX);

                  txBatch.set(doc(db, 'transactions', txId), {
                    ownerId,
                    branchId: txItem.branch.id,
                    branchName: txItem.branch.name,
                    invoiceNo: txItem.invoiceNo,
                    cashierName: actor,
                    saleYear: txItem.saleYear,
                    saleMonth: txItem.saleMonth,
                    source: 'import',
                    itemCount: Math.max(1, txItem.lines.length),
                    totalQty,
                    subtotal: txSubtotal,
                    discountMode: txDiscountMode,
                    discountAmount: txDiscountAmount,
                    adjustmentLabel,
                    grandTotal,
                    paymentMethod: 'cash',
                    amountPaid: grandTotal,
                    change: 0,
                    createdAt: serverTimestamp(),
                  });

                  txItem.lines.forEach((line, lineIdx) => {
                    const itemId = sanitizeId(
                      `item-${lineIdx + 1}-${line.product.id}`,
                      'item'
                    );
                    // Receipt item subcollection stores gross subtotal per item (consistent with Kasir POS receipts)
                    txBatch.set(doc(db, 'transactions', txId, 'items', itemId), {
                      ownerId,
                      transactionId: txId,
                      productId: line.product.id,
                      name: line.product.name,
                      unitPrice: line.unitPrice,
                      qty: line.qty,
                      lineTotal: line.grossTotal,
                      createdAt: serverTimestamp(),
                    });

                    // Analytical salesLines stores net proportional lineTotal (SUM(salesLines.lineTotal) === SUM(transactions.grandTotal))
                    const slId = sanitizeId(`sl-${txId}-${lineIdx + 1}`, 'sl');
                    txBatch.set(doc(db, 'salesLines', slId), {
                      ownerId,
                      transactionId: txId,
                      branchId: txItem.branch.id,
                      branchName: txItem.branch.name,
                      productId: line.product.id,
                      productSku: line.product.sku,
                      productName: line.product.name,
                      category: sanitizeCategory(
                        line.product.category,
                        line.product.name
                      ),
                      qty: line.qty,
                      unitPrice: line.unitPrice,
                      lineTotal: line.lineTotal,
                      saleYear: txItem.saleYear,
                      saleMonth: txItem.saleMonth,
                      source: 'import',
                      createdAt: serverTimestamp(),
                    });
                  });
                });

                await txBatch.commit();
              })
            );

            for (const batchTxs of parallelGroup) {
              transactionsImported += batchTxs.length;
              txsDone += batchTxs.length;
              for (const txItem of batchTxs) {
                salesLinesImported += txItem.lines.length;
              }
            }
            report('Menyimpan transaksi penjualan...', txsDone, pendingTxs.length);
          }
        }
      } else {
        // Monthly Summary Fallback Mode (no transactionCode column)
        type AggSalesEntry = {
          branch: Branch;
          product: Product;
          saleYear: number;
          saleMonth: number;
          qty: number;
          lineTotal: number;
          unitPrice: number;
        };

        const incomingAgg = new Map<string, AggSalesEntry>();
        rawSalesRows.forEach((sr, idx) => {
          const bName = normalizeBranchName(sr.branchName, DEFAULT_BRANCH.name).slice(
            0,
            BRANCH_NAME_MAX
          );
          const branch = branchByName.get(normalizeBranchKey(bName));
          const cleanSku = sanitizeCode(sr.sku, SKU_MAX, `SKU-${idx + 1}`);
          const product = productBySku.get(cleanSku.toLowerCase());
          if (!branch || !product) return;

          const saleYear = Math.min(
            2100,
            Math.max(2000, sr.saleYear ?? new Date().getFullYear())
          );
          const saleMonth = Math.min(
            12,
            Math.max(1, sr.saleMonth ?? new Date().getMonth() + 1)
          );
          const qty = Math.max(1, Math.round(sr.qtySold ?? 1));
          const lineTotal = Math.max(
            0,
            Math.round(
              sr.totalSales !== undefined ? sr.totalSales : product.price * qty
            )
          );
          const unitPrice =
            sr.price > 0
              ? Math.round(sr.price)
              : qty > 0
                ? Math.round(lineTotal / qty)
                : product.price;

          const aggKey = `${branch.id}::${product.id}::${saleYear}::${saleMonth}`;
          const prev = incomingAgg.get(aggKey);
          if (prev) {
            incomingAgg.set(aggKey, {
              ...prev,
              qty: prev.qty + qty,
              lineTotal: prev.lineTotal + lineTotal,
              unitPrice: prev.unitPrice > 0 ? prev.unitPrice : unitPrice,
            });
          } else {
            incomingAgg.set(aggKey, {
              branch,
              product,
              saleYear,
              saleMonth,
              qty,
              lineTotal,
              unitPrice,
            });
          }
        });

        const deltaEntries: AggSalesEntry[] = [];
        for (const [aggKey, entry] of incomingAgg.entries()) {
          const already = existingImportedSales.get(aggKey);
          if (already && already.qty >= entry.qty) {
            salesLinesSkipped += 1;
            continue;
          }
          const deltaQty = Math.min(
            10000,
            Math.max(1, entry.qty - (already?.qty ?? 0))
          );
          const deltaTotal = Math.min(
            1000000000,
            Math.max(0, entry.lineTotal - (already?.lineTotal ?? 0))
          );
          const unitPrice = Math.min(
            1000000000,
            entry.unitPrice > 0
              ? entry.unitPrice
              : deltaQty > 0
                ? Math.round(deltaTotal / deltaQty)
                : 0
          );
          deltaEntries.push({
            ...entry,
            qty: deltaQty,
            lineTotal: deltaTotal,
            unitPrice,
          });
        }

        if (deltaEntries.length > 0) {
          report('Menyinkronkan data penjualan...', 0, deltaEntries.length);
        }

        const groups = new Map<string, AggSalesEntry[]>();
        for (const entry of deltaEntries) {
          const gKey = `${entry.branch.id}::${entry.saleYear}::${entry.saleMonth}`;
          const list = groups.get(gKey) ?? [];
          list.push(entry);
          groups.set(gKey, list);
        }

        let groupIdx = 0;
        for (const [, groupRows] of groups.entries()) {
          groupIdx += 1;
          const first = groupRows[0];
          const branch = first.branch;
          const saleYear = first.saleYear;
          const saleMonth = first.saleMonth;

          const chunks: AggSalesEntry[][] = [];
          let currentChunk: AggSalesEntry[] = [];
          let currentChunkQty = 0;

          for (const entry of groupRows) {
            if (
              currentChunk.length >= 50 ||
              (currentChunk.length > 0 && currentChunkQty + entry.qty > 9000)
            ) {
              chunks.push(currentChunk);
              currentChunk = [];
              currentChunkQty = 0;
            }
            currentChunk.push(entry);
            currentChunkQty += entry.qty;
          }
          if (currentChunk.length > 0) chunks.push(currentChunk);

          for (let c = 0; c < chunks.length; c++) {
            const validEntries = chunks[c];
            if (validEntries.length === 0) continue;

            const txId = sanitizeId(
              `tx-imp-${Date.now()}-${groupIdx}-${c}-${Math.random().toString(36).slice(2, 5)}`,
              'tx'
            );
            const invoiceNo = sanitizeInvoiceNo(
              `IMP-${saleYear}${String(saleMonth).padStart(2, '0')}-${String(groupIdx).padStart(2, '0')}-${c + 1}`,
              'IMP-01'
            );

            const totalQty = Math.min(
              10000,
              validEntries.reduce((s, e) => s + e.qty, 0)
            );
            const grandTotal = Math.min(
              1000000000,
              validEntries.reduce((s, e) => s + e.lineTotal, 0)
            );

            const txBatch = writeBatch(db);
            txBatch.set(doc(db, 'transactions', txId), {
              ownerId,
              branchId: branch.id,
              branchName: branch.name,
              invoiceNo,
              cashierName: actor,
              saleYear,
              saleMonth,
              source: 'import',
              itemCount: validEntries.length,
              totalQty: Math.max(1, totalQty),
              subtotal: grandTotal,
              discountMode: 'none',
              discountAmount: 0,
              adjustmentLabel: `Sinkron Data Penjualan ${saleMonth}/${saleYear}`,
              grandTotal,
              paymentMethod: 'cash',
              amountPaid: grandTotal,
              change: 0,
              createdAt: serverTimestamp(),
            });

            validEntries.forEach((entry, idx) => {
              const itemId = sanitizeId(
                `item-${idx + 1}-${entry.product.id}`,
                'item'
              );
              txBatch.set(doc(db, 'transactions', txId, 'items', itemId), {
                ownerId,
                transactionId: txId,
                productId: entry.product.id,
                name: entry.product.name,
                unitPrice: entry.unitPrice,
                qty: entry.qty,
                lineTotal: entry.lineTotal,
                createdAt: serverTimestamp(),
              });

              const slId = sanitizeId(`sl-${txId}-${idx + 1}`, 'sl');
              txBatch.set(doc(db, 'salesLines', slId), {
                ownerId,
                transactionId: txId,
                branchId: branch.id,
                branchName: branch.name,
                productId: entry.product.id,
                productSku: entry.product.sku,
                productName: entry.product.name,
                category: sanitizeCategory(
                  entry.product.category,
                  entry.product.name
                ),
                qty: entry.qty,
                unitPrice: entry.unitPrice,
                lineTotal: entry.lineTotal,
                saleYear,
                saleMonth,
                source: 'import',
                createdAt: serverTimestamp(),
              });

              salesLinesImported += 1;
            });

            await txBatch.commit();
            transactionsImported += 1;
            report(
              'Menyinkronkan data penjualan...',
              salesLinesImported,
              deltaEntries.length
            );
          }
        }
      }
    }

    return {
      branchesCreated,
      productsUpserted,
      stocksUpdated,
      transactionsImported,
      transactionsSkipped,
      salesLinesImported,
      salesLinesSkipped,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'importCatalog');
  }
}
