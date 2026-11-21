import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
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
  VoucherDef,
} from '../types/pos';

// Validation constants synchronized verbatim with firebase-blueprint.json
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SKU_MAX = 32;
const BARCODE_MAX = 64;
const NAME_MAX = 100;
const IMAGE_MAX = 300;
const LABEL_MAX = 100;
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

function toIsoString(ts: unknown): string {
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (typeof ts === 'string') return ts;
  return new Date().toISOString();
}

export async function seedInitialDataIfNeeded(ownerId: string): Promise<void> {
  if (!ID_PATTERN.test(ownerId)) return;

  // Check if user already has products in Firestore
  const productsPath = 'products';
  try {
    const prodSnap = await getDocs(
      query(collection(db, productsPath), where('ownerId', '==', ownerId))
    );
    const vouchSnap = await getDocs(
      query(collection(db, 'vouchers'), where('ownerId', '==', ownerId))
    );

    if (prodSnap.empty || vouchSnap.empty) {
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
            code: v.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32),
            label: v.label.trim().slice(0, 40),
            type: v.type === 'fixed' ? 'fixed' : 'percent',
            value: Math.max(0, Math.round(v.value)),
            minSubtotal: Math.max(0, Math.round(v.minSubtotal ?? 0)),
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
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
      const list: VoucherDef[] = snapshot.docs
        .map((d) => {
          const data = d.data();
          return {
            code: String(data.code ?? ''),
            label: String(data.label ?? ''),
            type: (data.type === 'fixed' ? 'fixed' : 'percent') as
              | 'percent'
              | 'fixed',
            value: Number(data.value ?? 0),
            minSubtotal: Number(data.minSubtotal ?? 0) || undefined,
            active: Boolean(data.active ?? true),
          };
        })
        .filter((v) => v.active);
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
  const sku = sanitizeCode(input.sku, SKU_MAX, `SKU-${Date.now().toString().slice(-4)}`);
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

  if (!name) {
    throw new Error('Nama produk tidak boleh kosong.');
  }

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

export async function deleteProductFromFirestore(productId: string): Promise<void> {
  const path = `products/${productId}`;
  try {
    await deleteDoc(doc(db, 'products', productId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createTransactionAtomic(
  ownerId: string,
  params: {
    invoiceNo: string;
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
  const totalQty = params.items.reduce((s, i) => s + i.qty, 0);

  const txPath = `transactions/${transactionId}`;
  const batch = writeBatch(db);

  batch.set(doc(db, 'transactions', transactionId), {
    ownerId,
    invoiceNo,
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
