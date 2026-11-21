import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { PRODUCTS, VOUCHERS } from '../data/catalog';
import { OperationType, db, handleFirestoreError } from '../firebase';
import {
  CartItem,
  DiscountMode,
  PaymentMethod,
  Product,
  SimpleTransaction,
  StaffAccount,
  StaffRole,
  UserProfile,
  VoucherDef,
} from '../types/pos';

// Validation constants synchronized verbatim with firebase-blueprint.json
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SKU_MAX = 32;
const BARCODE_MAX = 64;
const NAME_MAX = 100;
const DISPLAY_NAME_MAX = 80;
const USERNAME_MAX = 40;
const IMAGE_MAX = 300;
const LABEL_MAX = 100;
const VOUCHER_LABEL_MAX = 40;
const VALID_CATEGORIES = new Set(['Makanan', 'Minuman', 'Pastry', 'Combo']);

function sanitizeId(raw: string, fallbackPrefix: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  if (cleaned && ID_PATTERN.test(cleaned)) return cleaned;
  return `${fallbackPrefix}-${Date.now()}`;
}

function sanitizeCode(raw: string, maxLen: number, fallback: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeUsername(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, USERNAME_MAX);
  return cleaned.length >= 2 ? cleaned : `user${Date.now().toString().slice(-4)}`;
}

function toIsoString(ts: unknown): string {
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (typeof ts === 'string') return ts;
  return new Date().toISOString();
}

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
        storeName: (storeName?.trim() || 'KasirPOS Store').slice(0, NAME_MAX),
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
      storeName: (input.storeName.trim() || 'KasirPOS Store').slice(0, NAME_MAX),
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
        storeName: String(data.storeName ?? 'KasirPOS Store'),
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

export async function seedInitialDataIfNeeded(
  ownerId: string,
  ownerDisplayName: string
): Promise<void> {
  if (!ID_PATTERN.test(ownerId)) return;

  const productsPath = 'products';
  try {
    const [prodSnap, vouchSnap, staffSnap] = await Promise.all([
      getDocs(
        query(collection(db, productsPath), where('ownerId', '==', ownerId))
      ),
      getDocs(
        query(collection(db, 'vouchers'), where('ownerId', '==', ownerId))
      ),
      getDocs(
        query(collection(db, 'staffAccounts'), where('ownerId', '==', ownerId))
      ),
    ]);

    if (prodSnap.empty || vouchSnap.empty || staffSnap.empty) {
      const batch = writeBatch(db);

      if (prodSnap.empty) {
        for (const p of PRODUCTS) {
          const docId = sanitizeId(`${ownerId.slice(0, 8)}-${p.id}`, 'prod');
          batch.set(doc(db, productsPath, docId), {
            ownerId,
            sku: sanitizeCode(p.sku, SKU_MAX, 'SKU-1'),
            barcode: sanitizeCode(p.barcode, BARCODE_MAX, '8990001'),
            name: p.name.trim().slice(0, NAME_MAX),
            price: Math.max(0, Math.round(p.price)),
            image: p.image.slice(0, IMAGE_MAX),
            category: VALID_CATEGORIES.has(p.category) ? p.category : 'Makanan',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      if (vouchSnap.empty) {
        for (const v of VOUCHERS) {
          const docId = sanitizeId(
            `${ownerId.slice(0, 8)}-${v.code.toLowerCase()}`,
            'vch'
          );
          batch.set(doc(db, 'vouchers', docId), {
            ownerId,
            code: v.code
              .toUpperCase()
              .replace(/[^A-Z0-9_-]/g, '')
              .slice(0, 32),
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
          username: 'admin',
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
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, productsPath);
  }
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
        return {
          id: d.id,
          sku: String(data.sku ?? ''),
          barcode: String(data.barcode ?? ''),
          name: String(data.name ?? ''),
          price: Number(data.price ?? 0),
          image: String(data.image ?? ''),
          category: (VALID_CATEGORIES.has(String(data.category))
            ? data.category
            : 'Makanan') as Product['category'],
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
        return {
          id: d.id,
          invoiceNo: String(data.invoiceNo ?? d.id),
          cashierName: String(data.cashierName ?? 'Admin'),
          items: [],
          totalQty: Number(data.totalQty ?? 0),
          subtotal: Number(data.subtotal ?? 0),
          discountAmount: Number(data.discountAmount ?? 0),
          adjustmentLabel: String(data.adjustmentLabel ?? '') || null,
          grandTotal: Number(data.grandTotal ?? 0),
          paymentMethod: (data.paymentMethod ?? 'cash') as PaymentMethod,
          amountPaid: Number(data.amountPaid ?? 0),
          change: Number(data.change ?? 0),
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

export async function saveProductToFirestore(
  ownerId: string,
  input: {
    id?: string;
    sku: string;
    barcode: string;
    name: string;
    price: number;
    image: string;
    category: Product['category'];
  }
): Promise<void> {
  const sku = sanitizeCode(
    input.sku,
    SKU_MAX,
    `SKU-${Date.now().toString().slice(-4)}`
  );
  const barcode = sanitizeCode(
    input.barcode,
    BARCODE_MAX,
    `899${Date.now().toString().slice(-7)}`
  );
  const name = input.name.trim().slice(0, NAME_MAX);
  const price = Math.min(1000000000, Math.max(0, Math.round(input.price)));
  const image = input.image.trim().slice(0, IMAGE_MAX);
  const category = VALID_CATEGORIES.has(input.category)
    ? input.category
    : 'Makanan';

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
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
    return;
  }

  const newId = sanitizeId(
    `${ownerId.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    'prod'
  );
  const path = `products/${newId}`;
  try {
    await setDoc(doc(db, 'products', newId), {
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
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteProductFromFirestore(
  productId: string
): Promise<void> {
  const path = `products/${productId}`;
  try {
    await deleteDoc(doc(db, 'products', productId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

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
  const code = input.code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 32);
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

export async function createTransactionAtomic(
  ownerId: string,
  params: {
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
  const transactionId = sanitizeId(
    `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    'tx'
  );
  const invoiceNo = sanitizeCode(params.invoiceNo, 32, 'INV-0001');
  const cashierName = (params.cashierName.trim() || 'Admin').slice(
    0,
    DISPLAY_NAME_MAX
  );
  const totalQty = params.items.reduce((s, i) => s + i.qty, 0);

  const txPath = `transactions/${transactionId}`;
  const batch = writeBatch(db);

  batch.set(doc(db, 'transactions', transactionId), {
    ownerId,
    invoiceNo,
    cashierName,
    itemCount: Math.max(1, params.items.length),
    totalQty: Math.max(1, totalQty),
    subtotal: Math.max(0, Math.round(params.subtotal)),
    discountMode: params.discountMode,
    discountAmount: Math.round(params.discountAmount),
    adjustmentLabel: (params.adjustmentLabel ?? '').slice(0, LABEL_MAX),
    grandTotal: Math.max(0, Math.round(params.grandTotal)),
    paymentMethod: params.paymentMethod,
    amountPaid: Math.max(0, Math.round(params.amountPaid)),
    change: Math.max(0, Math.round(params.change)),
    createdAt: serverTimestamp(),
  });

  params.items.forEach((item, index) => {
    const itemId = sanitizeId(`item-${index + 1}-${item.productId}`, 'item');
    const safeUnitPrice = Math.max(0, Math.round(item.unitPrice));
    const safeQty = Math.max(1, Math.round(item.qty));

    batch.set(doc(db, 'transactions', transactionId, 'items', itemId), {
      ownerId,
      transactionId,
      productId: sanitizeId(item.productId, 'prod'),
      name: item.name.trim().slice(0, NAME_MAX) || 'Produk',
      unitPrice: safeUnitPrice,
      qty: safeQty,
      lineTotal: safeUnitPrice * safeQty,
      createdAt: serverTimestamp(),
    });
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, txPath);
  }

  return {
    id: transactionId,
    invoiceNo,
    cashierName,
    items: params.items,
    totalQty,
    subtotal: Math.max(0, Math.round(params.subtotal)),
    discountAmount: Math.round(params.discountAmount),
    adjustmentLabel: params.adjustmentLabel,
    grandTotal: Math.max(0, Math.round(params.grandTotal)),
    paymentMethod: params.paymentMethod,
    amountPaid: Math.max(0, Math.round(params.amountPaid)),
    change: Math.max(0, Math.round(params.change)),
    createdAt: new Date().toISOString(),
  };
}
