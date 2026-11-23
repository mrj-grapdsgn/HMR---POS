import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ScanBarcode,
  X,
} from 'lucide-react';
import { Product } from '../types/pos';
import {
  findProductByScannedCode,
  playScanBeep,
} from '../utils/barcodeScanner';
import { formatRupiah } from '../utils/format';
import { BarcodeScannerModal, ScanFeedback } from './BarcodeScannerModal';

interface ProductSearchScanProps {
  products: Product[];
  stockByProductId: Record<string, number>;
  activeBranchName?: string;
  query: string;
  onQueryChange: (q: string) => void;
  onSelectProduct: (product: Product) => boolean;
  /** Disable background USB/Bluetooth listener when another modal (checkout/receipt) is open */
  scannerDisabled?: boolean;
}

export function ProductSearchScan({
  products,
  stockByProductId,
  activeBranchName,
  query,
  onQueryChange,
  onSelectProduct,
  scannerDisabled = false,
}: ProductSearchScanProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanNotice, setScanNotice] = useState<{
    text: string;
    tone: 'ok' | 'error';
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [products, query]);

  useEffect(() => {
    setHighlightedIdx(0);
  }, [query]);

  useEffect(() => {
    if (!scanNotice) return;
    const t = setTimeout(() => setScanNotice(null), 2800);
    return () => clearTimeout(t);
  }, [scanNotice]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const pickProduct = useCallback(
    (
      product: Product,
      options?: { beep?: boolean; keepFocus?: boolean; prefix?: string }
    ): ScanFeedback => {
      const avail = stockByProductId[product.id] ?? 0;
      if (avail <= 0) {
        if (options?.beep) playScanBeep('error');
        const msg = `Stok "${product.name}" habis di ${activeBranchName || 'cabang aktif'}`;
        setScanNotice({ text: msg, tone: 'error' });
        return { tone: 'error', message: msg, code: product.barcode || product.sku };
      }
      const added = onSelectProduct(product);
      if (!added) {
        if (options?.beep) playScanBeep('error');
        const msg = `Qty "${product.name}" sudah mencapai sisa stok (${avail} pcs)`;
        setScanNotice({ text: msg, tone: 'error' });
        return { tone: 'error', message: msg, code: product.barcode || product.sku };
      }
      if (options?.beep) playScanBeep('ok');
      onQueryChange('');
      setDropdownOpen(false);
      const msg = `${options?.prefix ? `${options.prefix}: ` : ''}${product.name} ditambahkan`;
      setScanNotice({ text: msg, tone: 'ok' });
      if (options?.keepFocus !== false) {
        inputRef.current?.focus();
      }
      return { tone: 'ok', message: msg, code: product.barcode || product.sku };
    },
    [stockByProductId, activeBranchName, onSelectProduct, onQueryChange]
  );

  const handleScannedCode = useCallback(
    (rawCode: string, source: 'camera' | 'hardware'): ScanFeedback => {
      const clean = rawCode.trim();
      const found = findProductByScannedCode(products, clean);
      if (!found) {
        playScanBeep('error');
        const msg = `Barcode "${clean}" tidak ditemukan di katalog`;
        setScanNotice({ text: msg, tone: 'error' });
        return { tone: 'error', message: msg, code: clean };
      }
      return pickProduct(found, {
        beep: true,
        keepFocus: source === 'hardware',
        prefix: source === 'hardware' ? 'Scan' : undefined,
      });
    },
    [products, pickProduct]
  );

  // Global USB / Bluetooth HID barcode scanner listener.
  // Physical scanners emit characters rapidly (< 85ms apart) ending with Enter or Tab.
  // Works even when the cashier didn't click inside the search input first.
  useEffect(() => {
    if (scannerDisabled || cameraOpen) return;

    let buffer = '';
    let lastKeyTime = 0;

    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastKeyTime > 120) {
        buffer = '';
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        if (buffer.length >= 4) {
          e.preventDefault();
          const scanned = buffer;
          buffer = '';
          handleScannedCode(scanned, 'hardware');
        } else {
          buffer = '';
        }
        return;
      }

      if (e.key.length === 1) {
        buffer += e.key;
        lastKeyTime = now;
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [scannerDisabled, cameraOpen, handleScannedCode]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDropdownOpen(true);
      setHighlightedIdx((idx) =>
        matches.length > 0 ? (idx + 1) % matches.length : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDropdownOpen(true);
      setHighlightedIdx((idx) =>
        matches.length > 0 ? (idx - 1 + matches.length) % matches.length : 0
      );
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const raw = query.trim();
      if (!raw) return;

      const exact = findProductByScannedCode(products, raw);
      if (exact) {
        e.preventDefault();
        pickProduct(exact, { beep: true, keepFocus: true });
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (matches[highlightedIdx]) {
          pickProduct(matches[highlightedIdx], { beep: true, keepFocus: true });
        } else {
          playScanBeep('error');
          setScanNotice({
            text: `Barcode / produk "${raw}" tidak ditemukan`,
            tone: 'error',
          });
          onQueryChange('');
        }
      }
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Label */}
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label
          htmlFor="cari-scan-barang"
          className="text-[11px] font-bold tracking-wider text-slate-500 uppercase"
        >
          CARI / SCAN BARANG (USB / KAMERA)
        </label>
        {scanNotice && (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
              scanNotice.tone === 'error' ? 'text-rose-600' : 'text-emerald-600'
            }`}
          >
            {scanNotice.tone === 'error' ? (
              <AlertCircle className="h-3 w-3 shrink-0" />
            ) : (
              <CheckCircle2 className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">{scanNotice.text}</span>
          </span>
        )}
      </div>

      {/* Segmented Search/Scan Control */}
      <div className="flex h-11 w-full overflow-hidden rounded-lg border border-slate-700/80 bg-[#141E27] shadow-sm transition-all focus-within:border-[#00C4A7] focus-within:ring-2 focus-within:ring-[#00C4A7]/25">
        <button
          type="button"
          onClick={() => {
            inputRef.current?.focus();
            setDropdownOpen(true);
          }}
          title="Siap terima scan alat barcode USB / Bluetooth"
          className="flex w-11 shrink-0 items-center justify-center border-r border-slate-700/80 bg-[#101820] text-[#00C4A7] transition-colors hover:bg-[#16222D]"
        >
          <ScanBarcode className="h-4.5 w-4.5" />
        </button>

        <div className="relative flex flex-1 items-center">
          <input
            ref={inputRef}
            id="cari-scan-barang"
            type="text"
            value={query}
            onFocus={() => setDropdownOpen(true)}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setDropdownOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Scan alat USB/Bluetooth atau ketik SKU / Nama..."
            autoComplete="off"
            className="h-full w-full bg-transparent px-3 text-sm font-medium text-white placeholder:text-slate-400 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                onQueryChange('');
                inputRef.current?.focus();
              }}
              aria-label="Hapus pencarian"
              className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          title="Scan barcode dengan kamera HP / webcam"
          className="flex shrink-0 items-center justify-center gap-1.5 border-l border-slate-700/80 bg-[#12393B] px-3 text-xs font-bold text-[#00D1B2] transition-colors hover:bg-[#174A4D] active:scale-95"
        >
          <Camera className="h-4 w-4" />
          <span className="hidden sm:inline">Kamera</span>
        </button>
      </div>

      {/* Instant Autocomplete Dropdown */}
      {dropdownOpen && (
        <div className="pos-scroll absolute top-full right-0 left-0 z-40 mt-1.5 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {matches.length === 0 ? (
            <div className="px-3.5 py-4 text-center text-xs text-slate-500">
              Barang &ldquo;{query}&rdquo; tidak ditemukan. Coba nama produk,
              Kode Item, atau scan barcode.
            </div>
          ) : (
            matches.map((p, idx) => {
              const active = idx === highlightedIdx;
              const stock = stockByProductId[p.id] ?? 0;
              const outOfStock = stock <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={outOfStock}
                  onMouseEnter={() => setHighlightedIdx(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!outOfStock) pickProduct(p, { beep: false });
                  }}
                  className={`flex w-full items-center justify-between gap-2.5 px-3 py-2 text-left transition-colors ${
                    outOfStock
                      ? 'cursor-not-allowed bg-slate-50/70 opacity-60'
                      : active
                        ? 'bg-slate-50'
                        : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {p.image ? (
                      <img
                        src={p.image}
                        alt={p.name}
                        referrerPolicy="no-referrer"
                        className="h-8 w-8 shrink-0 rounded bg-slate-100 object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-400">
                        <ScanBarcode className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-slate-900">
                        {p.name}
                      </div>
                      <div className="font-mono-num text-[11px] text-slate-500">
                        {p.sku} · {p.category} ·{' '}
                        <span
                          className={
                            outOfStock
                              ? 'font-bold text-rose-600'
                              : stock <= 2
                                ? 'font-bold text-amber-600'
                                : 'font-semibold text-emerald-700'
                          }
                        >
                          {outOfStock ? 'Stok Habis (0)' : `Sisa ${stock} pcs`}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="font-mono-num shrink-0 text-xs font-bold text-[#0F172A]">
                    {formatRupiah(p.price)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Cross-Browser Camera & Hardware Barcode Scanner Modal */}
      {cameraOpen && (
        <BarcodeScannerModal
          mode="pos"
          products={products}
          stockByProductId={stockByProductId}
          onScanCode={(code) => handleScannedCode(code, 'camera')}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}
