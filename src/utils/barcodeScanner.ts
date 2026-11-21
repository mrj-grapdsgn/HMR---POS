import { Product } from '../types/pos';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

/**
 * Play a crisp POS barcode scanner beep via Web Audio API.
 */
export function playScanBeep(kind: 'ok' | 'error'): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (kind === 'ok') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1850, now);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } else {
      // Double low tone for not-found or out-of-stock
      [0, 0.14].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(340, now + offset);
        gain.gain.setValueAtTime(0.001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.14, now + offset + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.11);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.12);
      });
    }
  } catch {
    // Ignore audio errors on restricted devices
  }
}

function stripNonAlnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Match a scanned barcode/SKU against the product catalog with safe tolerance
 * for EAN-13 leading-zero padding or trailing check digits on 12-digit SKUs.
 */
export function findProductByScannedCode(
  products: Product[],
  rawCode: string
): Product | null {
  const clean = rawCode.trim().toLowerCase();
  if (!clean) return null;

  // 1. Exact match on barcode or SKU
  const exact = products.find(
    (p) =>
      p.barcode.trim().toLowerCase() === clean ||
      p.sku.trim().toLowerCase() === clean
  );
  if (exact) return exact;

  // 2. Stripped punctuation/spaces match
  const compact = stripNonAlnum(clean);
  if (!compact) return null;

  const compactMatch = products.find(
    (p) =>
      stripNonAlnum(p.barcode) === compact || stripNonAlnum(p.sku) === compact
  );
  if (compactMatch) return compactMatch;

  // 3. Numeric EAN-13 / UPC-A compatibility (leading zero or trailing check digit)
  if (/^\d{8,14}$/.test(compact)) {
    const noLeadingZero = compact.replace(/^0+/, '');
    const numericMatch = products.find((p) => {
      const candidates = [stripNonAlnum(p.barcode), stripNonAlnum(p.sku)].filter(
        (c) => /^\d{8,14}$/.test(c)
      );
      return candidates.some((c) => {
        if (c.replace(/^0+/, '') === noLeadingZero) return true;
        // 13-digit EAN-13 scan matching a 12-digit SKU + 1 check digit
        if (compact.length === 13 && c.length === 12 && compact.startsWith(c)) {
          return true;
        }
        // 12-digit UPC scan matching a 13-digit EAN-13 with leading 0
        if (c.length === 13 && compact.length === 12 && c === `0${compact}`) {
          return true;
        }
        return false;
      });
    });
    if (numericMatch) return numericMatch;
  }

  return null;
}
