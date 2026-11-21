import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CameraOff,
  CheckCircle2,
  ScanBarcode,
  Video,
  X,
} from 'lucide-react';
import { Product } from '../types/pos';
import { formatRupiah } from '../utils/format';

interface ProductSearchScanProps {
  products: Product[];
  query: string;
  onQueryChange: (q: string) => void;
  onSelectProduct: (product: Product) => void;
}

interface BarcodeDetectorLike {
  detect: (
    source: HTMLVideoElement
  ) => Promise<Array<{ rawValue?: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: {
      formats?: string[];
    }) => BarcodeDetectorLike;
  }
}

export function ProductSearchScan({
  products,
  query,
  onQueryChange,
  onSelectProduct,
}: ProductSearchScanProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 6);
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q)
    );
  }, [products, query]);

  useEffect(() => {
    setHighlightedIdx(0);
  }, [query]);

  useEffect(() => {
    if (!scanNotice) return;
    const t = setTimeout(() => setScanNotice(null), 2200);
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

  const pickProduct = (product: Product) => {
    onSelectProduct(product);
    onQueryChange('');
    setDropdownOpen(false);
    setScanNotice(`${product.name} ditambahkan`);
    inputRef.current?.focus();
  };

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
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const raw = query.trim().toLowerCase();
      if (!raw) return;

      // Exact barcode or SKU match takes priority (for USB barcode scanners)
      const exact = products.find(
        (p) =>
          p.barcode.toLowerCase() === raw || p.sku.toLowerCase() === raw
      );
      if (exact) {
        pickProduct(exact);
        return;
      }

      if (matches[highlightedIdx]) {
        pickProduct(matches[highlightedIdx]);
      }
    }
  };

  const handleCameraDetected = (code: string) => {
    const clean = code.trim().toLowerCase();
    const found = products.find(
      (p) =>
        p.barcode.toLowerCase() === clean || p.sku.toLowerCase() === clean
    );
    if (found) {
      setCameraOpen(false);
      pickProduct(found);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Label matching reference image */}
      <div className="mb-1.5 flex items-center justify-between">
        <label
          htmlFor="cari-scan-barang"
          className="text-[11px] font-bold tracking-wider text-slate-500 uppercase"
        >
          CARI / SCAN BARANG
        </label>
        {scanNotice && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
            <CheckCircle2 className="h-3 w-3" />
            {scanNotice}
          </span>
        )}
      </div>

      {/* Segmented Search/Scan Control matching screenshot */}
      <div className="flex h-11 w-full overflow-hidden rounded-lg border border-slate-700/80 bg-[#141E27] shadow-sm transition-all focus-within:border-[#00C4A7] focus-within:ring-2 focus-within:ring-[#00C4A7]/25">
        {/* Left Barcode Slot */}
        <button
          type="button"
          onClick={() => {
            inputRef.current?.focus();
            setDropdownOpen(true);
          }}
          title="Fokus input barcode / pencarian"
          className="flex w-11 shrink-0 items-center justify-center border-r border-slate-700/80 bg-[#101820] text-[#00C4A7] transition-colors hover:bg-[#16222D]"
        >
          <ScanBarcode className="h-4.5 w-4.5" />
        </button>

        {/* Middle Search / Barcode Input */}
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
            placeholder="Ketik/Scan Barang..."
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

        {/* Right Camera Scan Button */}
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          title="Scan barcode dengan kamera"
          className="flex w-12 shrink-0 items-center justify-center border-l border-slate-700/80 bg-[#12393B] text-[#00D1B2] transition-colors hover:bg-[#174A4D] active:scale-95"
        >
          <Video className="h-4.5 w-4.5 fill-current" />
        </button>
      </div>

      {/* Instant Autocomplete Dropdown */}
      {dropdownOpen && (
        <div className="pos-scroll absolute top-full right-0 left-0 z-40 mt-1.5 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {matches.length === 0 ? (
            <div className="px-3.5 py-4 text-center text-xs text-slate-500">
              Barang &ldquo;{query}&rdquo; tidak ditemukan. Coba nama produk,
              SKU, atau kode barcode.
            </div>
          ) : (
            matches.map((p, idx) => {
              const active = idx === highlightedIdx;
              return (
                <button
                  key={p.id}
                  type="button"
                  onMouseEnter={() => setHighlightedIdx(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickProduct(p);
                  }}
                  className={`flex w-full items-center justify-between gap-2.5 px-3 py-2 text-left transition-colors ${
                    active ? 'bg-sky-50' : 'hover:bg-slate-50'
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
                        {p.barcode} · {p.sku}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono-num shrink-0 text-xs font-bold text-[#1B8EE6]">
                    {formatRupiah(p.price)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {/* Camera Barcode Scanner Modal */}
      {cameraOpen && (
        <CameraScannerModal
          products={products}
          onDetected={handleCameraDetected}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}

function CameraScannerModal({
  products,
  onDetected,
  onClose,
}: {
  products: Product[];
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectorSupported, setDetectorSupported] = useState(true);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId = 0;
    let active = true;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Browser tidak mendukung akses kamera.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if (window.BarcodeDetector) {
          const detector = new window.BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code'],
          });

          const scanLoop = async () => {
            if (!active || !videoRef.current) return;
            try {
              if (videoRef.current.readyState >= 2) {
                const results = await detector.detect(videoRef.current);
                if (results.length > 0 && results[0].rawValue) {
                  onDetected(results[0].rawValue);
                  return;
                }
              }
            } catch {
              // ignore single frame decode errors
            }
            rafId = requestAnimationFrame(scanLoop);
          };
          rafId = requestAnimationFrame(scanLoop);
        } else {
          setDetectorSupported(false);
        }
      } catch {
        setCameraError(
          'Kamera tidak tersedia atau izin ditolak. Anda tetap bisa memilih barcode uji di bawah ini.'
        );
      }
    }

    startCamera();

    return () => {
      active = false;
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-[1px]">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#141E27] text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <ScanBarcode className="h-4.5 w-4.5 text-[#00D1B2]" />
            <h3 className="text-sm font-bold">Scan Barcode Kamera</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup kamera"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-300 hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Camera Viewport */}
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-950">
          {cameraError ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-300">
              <CameraOff className="mb-2 h-8 w-8 text-slate-500" />
              <p className="text-xs leading-relaxed">{cameraError}</p>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                muted
                playsInline
                className="h-full w-full object-cover"
              />
              {/* Scanning Frame Overlay */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-28 w-56 rounded-lg border-2 border-[#00D1B2]/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                  <div className="absolute top-1/2 right-2 left-2 h-0.5 bg-[#00D1B2]" />
                </div>
              </div>
              {!detectorSupported && (
                <div className="absolute right-2 bottom-2 left-2 rounded bg-slate-900/85 px-2.5 py-1.5 text-center text-[11px] text-amber-300">
                  Auto-decode kamera tidak didukung browser ini — gunakan pilih
                  cepat barcode di bawah.
                </div>
              )}
            </>
          )}
        </div>

        {/* Quick-Scan Barcode List */}
        <div className="pos-scroll max-h-56 overflow-y-auto p-3.5">
          <div className="mb-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
            Simulasi Scan Barcode Cepat
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {products.slice(0, 8).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onDetected(p.barcode)}
                className="flex items-center justify-between rounded-lg border border-slate-700/80 bg-[#1B2834] px-2.5 py-2 text-left transition-colors hover:border-[#00C4A7] hover:bg-[#1F3140]"
              >
                <div className="min-w-0 pr-2">
                  <div className="truncate text-xs font-semibold text-white">
                    {p.name}
                  </div>
                  <div className="font-mono-num text-[10px] text-[#00D1B2]">
                    {p.barcode}
                  </div>
                </div>
                <span className="font-mono-num shrink-0 text-[11px] font-bold text-slate-200">
                  {formatRupiah(p.price)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
