import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import {
  AlertCircle,
  CameraOff,
  CheckCircle2,
  Flashlight,
  FlashlightOff,
  ImageUp,
  Keyboard,
  Loader2,
  Repeat,
  ScanBarcode,
  SwitchCamera,
  X,
} from 'lucide-react';
import { Product } from '../types/pos';
import { formatRupiah } from '../utils/format';

export interface ScanFeedback {
  tone: 'ok' | 'error';
  message: string;
  code: string;
}

interface BarcodeScannerModalProps {
  /** 'pos' adds matched products to cart; 'capture' returns raw scanned code for form inputs */
  mode?: 'pos' | 'capture';
  products?: Product[];
  stockByProductId?: Record<string, number>;
  /** Called when a barcode is decoded. Returns feedback to show inside the scanner modal. */
  onScanCode: (code: string) => ScanFeedback;
  onClose: () => void;
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

const SUPPORTED_ZXING_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
];

function createZxingReader(): BrowserMultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_ZXING_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 160,
    delayBetweenScanSuccess: 600,
  });
}

export function BarcodeScannerModal({
  mode = 'pos',
  products = [],
  stockByProductId = {},
  onScanCode,
  onClose,
}: BarcodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const onScanRef = useRef(onScanCode);
  const onCloseRef = useRef(onClose);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const continuousRef = useRef(mode === 'pos');

  useEffect(() => {
    onScanRef.current = onScanCode;
  }, [onScanCode]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const [cameraStarting, setCameraStarting] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>(
    'environment'
  );
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [continuousScan, setContinuousScan] = useState(mode === 'pos');
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [decodingPhoto, setDecodingPhoto] = useState(false);
  const [showQuickPick, setShowQuickPick] = useState(false);

  const activeStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    continuousRef.current = continuousScan;
  }, [continuousScan]);

  const processDecodedCode = (rawCode: string, forceImmediate = false) => {
    const clean = rawCode.trim();
    if (!clean) return;
    const now = Date.now();
    if (
      !forceImmediate &&
      lastScanRef.current.code === clean &&
      now - lastScanRef.current.at < 1500
    ) {
      return;
    }
    lastScanRef.current = { code: clean, at: now };

    const res = onScanRef.current(clean);
    setFeedback(res);

    if (res.tone === 'ok' && (!continuousRef.current || mode === 'capture')) {
      setTimeout(() => {
        onCloseRef.current();
      }, 280);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let controls: IScannerControls | null = null;
    let nativeRafId = 0;

    async function stopMedia() {
      if (nativeRafId) {
        cancelAnimationFrame(nativeRafId);
        nativeRafId = 0;
      }
      if (controls) {
        try {
          controls.stop();
        } catch {
          // ignore
        }
        controls = null;
      }
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((t) => t.stop());
        activeStreamRef.current = null;
      }
    }

    async function startScanner() {
      setCameraStarting(true);
      setCameraError(null);
      setTorchSupported(false);
      setTorchOn(false);

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStarting(false);
        setCameraError(
          'Browser ini tidak menyediakan akses kamera langsung. Gunakan tombol "Foto / Unggah Barcode" atau alat scan USB/Bluetooth di bawah.'
        );
        return;
      }

      const videoConstraints: MediaTrackConstraints = selectedDeviceId
        ? {
            deviceId: { exact: selectedDeviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          };

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch {
        // Fallback to minimal constraint if ideal resolution or facingMode is rejected
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } catch (err) {
          if (cancelled) return;
          setCameraStarting(false);
          const msg =
            err instanceof Error && err.name === 'NotAllowedError'
              ? 'Izin kamera ditolak oleh browser. Aktifkan izin kamera pada ikon gembok/pengaturan browser, atau gunakan tombol "Foto Barcode" di bawah.'
              : 'Kamera tidak ditemukan atau sedang dipakai aplikasi lain. Anda tetap bisa memakai alat scan USB/Bluetooth atau tombol "Foto Barcode".';
          setCameraError(msg);
          return;
        }
      }

      if (cancelled || !stream) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }

      activeStreamRef.current = stream;

      // Detect torch capability & enumerate cameras after permission granted
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          const caps = track.getCapabilities?.() as
            | (MediaTrackCapabilities & { torch?: boolean })
            | undefined;
          if (caps && caps.torch) {
            setTorchSupported(true);
          }
          // Try enabling continuous autofocus on mobile rear cameras
          const advCaps = caps as
            | (MediaTrackCapabilities & { focusMode?: string[] })
            | undefined;
          if (advCaps?.focusMode?.includes('continuous')) {
            void track
              .applyConstraints({
                advanced: [
                  { focusMode: 'continuous' } as MediaTrackConstraintSet,
                ],
              })
              .catch(() => {});
          }
        } catch {
          // ignore capability check error
        }
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        if (!cancelled) setCameras(videoInputs);
      } catch {
        // ignore
      }

      const videoEl = videoRef.current;
      if (!videoEl) {
        await stopMedia();
        return;
      }

      videoEl.srcObject = stream;
      try {
        await videoEl.play();
      } catch {
        // Some mobile browsers auto-play once muted + playsInline is attached
      }

      if (cancelled) {
        await stopMedia();
        return;
      }
      setCameraStarting(false);

      // Engine 1: Cross-browser ZXing decoder (works on iOS Safari, Android Chrome, Firefox, Desktop)
      const zxingReader = createZxingReader();
      try {
        controls = await zxingReader.decodeFromStream(
          stream,
          videoEl,
          (result) => {
            if (cancelled) return;
            const text = result?.getText();
            if (text) {
              processDecodedCode(text);
            }
          }
        );
      } catch {
        // If ZXing stream attach fails, native detector below may still handle it
      }

      // Engine 2: Native BarcodeDetector in parallel when available (extra fast on Android Chrome)
      if (window.BarcodeDetector) {
        try {
          const detector = new window.BarcodeDetector({
            formats: [
              'code_128',
              'code_39',
              'ean_13',
              'ean_8',
              'upc_a',
              'upc_e',
              'itf',
              'codabar',
              'qr_code',
            ],
          });

          let lastTick = 0;
          const nativeLoop = async (ts: number) => {
            if (cancelled || !videoRef.current) return;
            if (ts - lastTick >= 220 && videoRef.current.readyState >= 2) {
              lastTick = ts;
              try {
                const hits = await detector.detect(videoRef.current);
                if (hits.length > 0 && hits[0].rawValue) {
                  processDecodedCode(hits[0].rawValue);
                }
              } catch {
                // ignore single frame error
              }
            }
            nativeRafId = requestAnimationFrame(nativeLoop);
          };
          nativeRafId = requestAnimationFrame(nativeLoop);
        } catch {
          // ZXing is already decoding
        }
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      void stopMedia();
    };
  }, [facingMode, selectedDeviceId, mode]);

  const handleToggleTorch = async () => {
    const track = activeStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  const handleSwitchCamera = () => {
    if (cameras.length > 1) {
      const currIdx = cameras.findIndex((c) => c.deviceId === selectedDeviceId);
      const nextCamera = cameras[(currIdx + 1) % cameras.length];
      setSelectedDeviceId(nextCamera.deviceId);
    } else {
      setSelectedDeviceId('');
      setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDecodingPhoto(true);
    setFeedback(null);

    const objectUrl = URL.createObjectURL(file);
    try {
      const reader = createZxingReader();
      const result = await reader.decodeFromImageUrl(objectUrl);
      const text = result.getText();
      if (text) {
        processDecodedCode(text, true);
      } else {
        setFeedback({
          tone: 'error',
          code: '',
          message: 'Barcode tidak terbaca dari foto. Pastikan garis barcode tajam & terang.',
        });
      }
    } catch {
      setFeedback({
        tone: 'error',
        code: '',
        message: 'Barcode tidak terbaca dari foto ini. Coba foto lebih dekat & fokus.',
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
      setDecodingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = manualCode.trim();
    if (!val) return;
    processDecodedCode(val, true);
    setManualCode('');
    manualInputRef.current?.focus();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-3 backdrop-blur-[1px]">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#141E27] text-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <ScanBarcode className="h-4.5 w-4.5 text-[#00D1B2]" />
            <div>
              <h3 className="text-sm font-bold leading-tight">
                Scan Barcode Kamera
              </h3>
              <p className="text-[11px] text-slate-400">
                Arahkan kamera HP/webcam ke barcode atau QR produk
              </p>
            </div>
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
                autoPlay
                className="h-full w-full object-cover"
              />
              {cameraStarting && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/80 text-xs text-slate-300">
                  <Loader2 className="h-6 w-6 animate-spin text-[#00D1B2]" />
                  <span>Menyiapkan kamera...</span>
                </div>
              )}

              {/* Viewfinder Frame */}
              {!cameraStarting && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="relative h-32 w-64 rounded-lg border-2 border-[#00D1B2]/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                    <div className="absolute top-1/2 right-2.5 left-2.5 h-0.5 bg-[#00D1B2] shadow-[0_0_8px_#00D1B2]" />
                  </div>
                </div>
              )}

              {/* Top-Right Camera Controls (Switch Camera + Flash) */}
              {!cameraStarting && (
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                  {torchSupported && (
                    <button
                      type="button"
                      onClick={() => void handleToggleTorch()}
                      title={torchOn ? 'Matikan flash' : 'Nyalakan flash'}
                      className={`flex h-8 items-center gap-1 rounded-lg px-2.5 text-[11px] font-bold backdrop-blur-sm transition-colors ${
                        torchOn
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-900/75 text-white hover:bg-slate-900'
                      }`}
                    >
                      {torchOn ? (
                        <FlashlightOff className="h-3.5 w-3.5" />
                      ) : (
                        <Flashlight className="h-3.5 w-3.5" />
                      )}
                      <span>Flash</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSwitchCamera}
                    title="Ganti kamera depan / belakang"
                    className="flex h-8 items-center gap-1 rounded-lg bg-slate-900/75 px-2.5 text-[11px] font-bold text-white backdrop-blur-sm hover:bg-slate-900"
                  >
                    <SwitchCamera className="h-3.5 w-3.5" />
                    <span>Ganti Kamera</span>
                  </button>
                </div>
              )}

              {/* Bottom Camera Status */}
              {!cameraStarting && (
                <div className="pointer-events-none absolute right-2 bottom-2 left-2 flex justify-center">
                  <span className="rounded-md bg-slate-950/80 px-2.5 py-1 text-[11px] font-medium text-slate-200">
                    Mendukung EAN-13, Code 128, Code 39, UPC &amp; QR
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Live Scan Feedback Banner */}
        {feedback && (
          <div
            className={`flex items-center gap-2 border-b px-4 py-2.5 text-xs font-semibold ${
              feedback.tone === 'ok'
                ? 'border-emerald-700/60 bg-emerald-950/70 text-emerald-300'
                : 'border-rose-700/60 bg-rose-950/70 text-rose-300'
            }`}
          >
            {feedback.tone === 'ok' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{feedback.message}</span>
          </div>
        )}

        {/* Controls: Continuous Scan + Photo Fallback + USB/Manual Input */}
        <div className="pos-scroll space-y-3 overflow-y-auto p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {mode === 'pos' && (
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-200">
                <input
                  type="checkbox"
                  checked={continuousScan}
                  onChange={(e) => setContinuousScan(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#00D1B2]"
                />
                <Repeat className="h-3.5 w-3.5 text-[#00D1B2]" />
                <span>Scan beruntun (banyak item)</span>
              </label>
            )}

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => void handlePhotoUpload(e)}
              className="hidden"
            />
            <button
              type="button"
              disabled={decodingPhoto}
              onClick={() => photoInputRef.current?.click()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-600 bg-[#1B2834] px-2.5 text-[11px] font-bold text-slate-200 hover:border-[#00D1B2] hover:text-white disabled:opacity-50"
            >
              {decodingPhoto ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00D1B2]" />
              ) : (
                <ImageUp className="h-3.5 w-3.5 text-[#00D1B2]" />
              )}
              <span>
                {decodingPhoto ? 'Membaca Foto...' : 'Foto / Unggah Barcode'}
              </span>
            </button>
          </div>

          {/* Direct USB / Bluetooth Handheld Scanner or Manual Entry */}
          <form onSubmit={handleManualSubmit} className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
              <Keyboard className="h-3.5 w-3.5 text-[#00D1B2]" />
              <span>
                Atau tembak dengan Alat Scan Barcode (USB / Bluetooth) / ketik
                kode:
              </span>
            </label>
            <div className="flex gap-2">
              <input
                ref={manualInputRef}
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Scan kode barcode lalu Enter..."
                autoComplete="off"
                className="font-mono-num h-9 flex-1 rounded-lg border border-slate-600 bg-[#0F171F] px-3 text-xs font-semibold text-white placeholder:text-slate-500 focus:border-[#00D1B2] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!manualCode.trim()}
                className="h-9 rounded-lg bg-[#00C4A7] px-3.5 text-xs font-bold text-slate-950 hover:bg-[#00D9B9] disabled:bg-slate-700 disabled:text-slate-400"
              >
                Cari
              </button>
            </div>
          </form>

          {/* Optional Quick Test List for POS mode */}
          {mode === 'pos' && products.length > 0 && (
            <div className="border-t border-slate-700/70 pt-2.5">
              <button
                type="button"
                onClick={() => setShowQuickPick((v) => !v)}
                className="text-[11px] font-semibold text-slate-400 hover:text-[#00D1B2]"
              >
                {showQuickPick
                  ? 'Sembunyikan daftar uji barcode'
                  : 'Uji cepat barcode produk katalog'}
              </button>

              {showQuickPick && (
                <div className="mt-2 grid max-h-36 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                  {products.slice(0, 8).map((p) => {
                    const stock = stockByProductId[p.id] ?? 0;
                    const disabled = stock <= 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          processDecodedCode(p.barcode || p.sku, true)
                        }
                        className="flex items-center justify-between rounded-lg border border-slate-700/80 bg-[#1B2834] px-2.5 py-1.5 text-left transition-colors hover:border-[#00C4A7] hover:bg-[#1F3140] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="truncate text-[11px] font-semibold text-white">
                            {p.name}
                          </div>
                          <div className="font-mono-num text-[10px] text-[#00D1B2]">
                            {p.barcode || p.sku} ·{' '}
                            {disabled ? 'Habis' : `${stock} pcs`}
                          </div>
                        </div>
                        <span className="font-mono-num shrink-0 text-[10px] font-bold text-slate-200">
                          {formatRupiah(p.price)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
