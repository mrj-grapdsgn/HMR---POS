export const POLLUTED_CATEGORIES = new Set([
  'persen',
  'tidak_ada',
  'tidak ada',
  'nominal',
  'fixed',
  'percent',
  'none',
  'cash',
  'tunai',
  'qris',
  'transfer',
  'umum',
  '-',
  '—',
]);

interface CategoryRule {
  category: string;
  patterns: RegExp[];
}

// Ordered from most specific (multi-word) to general so e.g. "Celana Panjang" beats "Celana"
// and "Kaos Kaki" beats "Kaos".
const CATEGORY_RULES: CategoryRule[] = [
  // Celana
  {
    category: 'Celana Panjang',
    patterns: [
      /\bcelana\s+panjang\b/i,
      /\blong\s*pants?\b/i,
      /\bcelana\s+(gunung|trekking|hiking|outdoor|cargo\s+panjang)\b/i,
    ],
  },
  {
    category: 'Celana Pendek',
    patterns: [
      /\bcelana\s+pendek\b/i,
      /\bshort\s*pants?\b/i,
      /\bboard\s*short\b/i,
      /\bshorts?\b/i,
    ],
  },
  {
    category: 'Celana',
    patterns: [/\bcelana\b/i, /\bpants?\b/i, /\btrousers?\b/i, /\bjogger\b/i, /\blegging\b/i],
  },

  // Kemeja
  {
    category: 'Kemeja Panjang',
    patterns: [
      /\bkemeja\s+(lengan\s+)?panjang\b/i,
      /\bflan+el\s+panjang\b/i,
    ],
  },
  {
    category: 'Kemeja Pendek',
    patterns: [
      /\bkemeja\s+(lengan\s+)?pendek\b/i,
      /\bflan+el\s+pendek\b/i,
    ],
  },
  {
    category: 'Kemeja',
    patterns: [/\bkemeja\b/i, /\bflan+el\b/i, /\blong\s*sleeve\s*shirt\b/i],
  },

  // Atasan & Outerwear
  {
    category: 'Sarung Tangan',
    patterns: [/\bsarung\s+tangan\b/i, /\bgloves?\b/i],
  },
  {
    category: 'Kaos Kaki',
    patterns: [/\bk[au]os\s+kaki\b/i, /\bsocks?\b/i],
  },
  {
    category: 'Baselayer',
    patterns: [/\bbase\s*layer\b/i, /\bmanset\b/i],
  },
  {
    category: 'Kaos',
    patterns: [/\bk[au]os\b/i, /\bt[\s-]?shirt\b/i, /\bpolo\b/i, /\bjersey\b/i],
  },
  {
    category: 'Vest / Rompi',
    patterns: [/\brompi\b/i, /\bvest\b/i],
  },
  {
    category: 'Jaket',
    patterns: [
      /\bjaket\b/i,
      /\bjacket\b/i,
      /\bparka\b/i,
      /\bwindbreaker\b/i,
      /\bfleece\b/i,
      /\bhoodie\b/i,
      /\bsweater\b/i,
      /\banorak\b/i,
      /\bbomber\b/i,
      /\bcoach\b/i,
    ],
  },

  // Tas & Pack
  {
    category: 'Hydropack',
    patterns: [/\bhydro\s*pack\b/i, /\bhydration\b/i],
  },
  {
    category: 'Daypack',
    patterns: [/\bday\s*pack\b/i, /\bransel\b/i, /\bback\s*pack\b/i],
  },
  {
    category: 'Carrier',
    patterns: [/\bcarrier\b/i, /\bkeril\b/i, /\btas\s+gunung\b/i, /\brucksack\b/i],
  },
  {
    category: 'Waistbag',
    patterns: [/\bwaist\s*bag\b/i, /\btas\s+pinggang\b/i, /\bbum\s*bag\b/i],
  },
  {
    category: 'Slingbag',
    patterns: [/\bsling\s*bag\b/i, /\btas\s+selempang\b/i, /\bcross\s*body\b/i, /\bmessenger\b/i],
  },
  {
    category: 'Travel Pouch',
    patterns: [/\btravel\s*pouch\b/i, /\bpouch\b/i, /\bhand\s*bag\b/i, /\bclutch\b/i, /\borganizer\b/i],
  },
  {
    category: 'Drybag',
    patterns: [/\bdry\s*bag\b/i],
  },
  {
    category: 'Duffel Bag',
    patterns: [/\bduff(?:el|le)\b/i, /\btravel\s*bag\b/i, /\btas\s+travel\b/i],
  },
  {
    category: 'Tote Bag',
    patterns: [/\btote\s*bag\b/i, /\btas\s+lipat\b/i, /\btas\s+jinjing\b/i, /\bfoldable\s*bag\b/i],
  },
  {
    category: 'Rain Cover',
    patterns: [/\brain\s*cover\b/i, /\bcover\s*bag\b/i],
  },
  {
    category: 'Jas Hujan',
    patterns: [/\bjas\s+hujan\b/i, /\brain\s*coat\b/i, /\bponc[ho]o?\b/i],
  },
  {
    category: 'Tas',
    patterns: [/\btas\b/i, /\bbag\b/i],
  },

  // Kepala, Kaki & Perlindungan
  {
    category: 'Topi',
    patterns: [/\btopi\b/i, /\bcap\b/i, /\bhat\b/i, /\bbeanie\b/i, /\bkupluk\b/i, /\brimba\b/i, /\bbucket\b/i, /\bvisor\b/i],
  },
  {
    category: 'Buff & Masker',
    patterns: [/\bbuff\b/i, /\bbandana\b/i, /\bmasker\b/i, /\bbalaclava\b/i, /\bneck\s*gaiter\b/i, /\bsyal\b/i, /\bscarf\b/i],
  },
  {
    category: 'Sandal',
    patterns: [/\bs[ae]ndal\b/i, /\bslipper\b/i],
  },
  {
    category: 'Sepatu',
    patterns: [/\bsepatu\b/i, /\bshoes?\b/i, /\bboots?\b/i],
  },
  {
    category: 'Gaiter',
    patterns: [/\bgaiter\b/i],
  },

  // Perlengkapan Camping & Outdoor
  {
    category: 'Tenda',
    patterns: [/\btenda\b/i, /\btent\b/i, /\bfly\s*sheet\b/i, /\bfoot\s*print\b/i],
  },
  {
    category: 'Sleeping Bag',
    patterns: [/\bsleeping\s*bag\b/i, /\bkantong\s+tidur\b/i],
  },
  {
    category: 'Matras',
    patterns: [/\bmatras\b/i, /\bmattress\b/i, /\bsleeping\s*pad\b/i],
  },
  {
    category: 'Hammock',
    patterns: [/\bhammock\b/i],
  },
  {
    category: 'Trekking Pole',
    patterns: [/\btrek+ing\s*pole\b/i, /\btracking\s*pole\b/i, /\btongkat\b/i],
  },
  {
    category: 'Lampu & Headlamp',
    patterns: [/\bhead\s*lamp\b/i, /\bsenter\b/i, /\bflash\s*light\b/i, /\blampu\b/i, /\blantern\b/i],
  },
  {
    category: 'Botol & Tumbler',
    patterns: [/\bbotol\b/i, /\bbottle\b/i, /\btumbler\b/i, /\bflask\b/i, /\bwater\s*bladder\b/i, /\bbladder\b/i],
  },
  {
    category: 'Alat Masak',
    patterns: [/\bkompor\b/i, /\bstove\b/i, /\bnesting\b/i, /\bcook(?:ing)?\s*set\b/i, /\bmug\b/i, /\bgelas\b/i, /\bpanci\b/i, /\bkettle\b/i, /\bspork\b/i],
  },
  {
    category: 'Kursi & Meja Lipat',
    patterns: [/\bkursi\b/i, /\bchair\b/i, /\bmeja\b/i, /\btable\b/i],
  },

  // Aksesoris
  {
    category: 'Dompet',
    patterns: [/\bdompet\b/i, /\bwallet\b/i, /\bcard\s*holder\b/i],
  },
  {
    category: 'Ikat Pinggang',
    patterns: [/\bikat\s+pinggang\b/i, /\bsabuk\b/i, /\bbelt\b/i],
  },
  {
    category: 'Kacamata',
    patterns: [/\bkaca\s*mata\b/i, /\bsunglass/i, /\bgoggles?\b/i],
  },
  {
    category: 'Aksesoris Outdoor',
    patterns: [
      /\b[ck]arabiner\b/i,
      /\bwebbing\b/i,
      /\bparacord\b/i,
      /\btali\b/i,
      /\bkompas\b/i,
      /\bpeluit\b/i,
      /\bwhistle\b/i,
      /\bdry\s*box\b/i,
      /\bgantungan\b/i,
      /\bkey\s*chain\b/i,
      /\bstic?ker\b/i,
      /\bpatch\b/i,
      /\bemblem\b/i,
    ],
  },
];

function toTitleCase(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Normalizes branch names so e.g. "CFD_Senayan" and "CFD Senayan" map to the exact same branch.
 */
export function normalizeBranchName(raw: string, fallback = 'CFD Senayan'): string {
  const cleaned = raw
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function normalizeBranchKey(raw: string): string {
  return normalizeBranchName(raw, '').toLowerCase();
}

/**
 * Checks whether a raw category value is meaningful (not empty, 'Umum', or polluted discount/payment metadata).
 */
export function isExplicitValidCategory(raw?: string | null): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return !POLLUTED_CATEGORIES.has(trimmed.toLowerCase());
}

/**
 * Automatically infers a clean Indonesian product category from the product name
 * (e.g. "Celana Panjang Alfea" -> "Celana Panjang", "Hydropack Hikemore Hydration" -> "Hydropack").
 */
export function inferCategoryFromProductName(
  productName: string,
  explicitCategory?: string | null
): string {
  if (isExplicitValidCategory(explicitCategory)) {
    return explicitCategory!.trim().slice(0, 50);
  }

  const name = productName.trim();
  if (!name) return 'Umum';

  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((re) => re.test(name))) {
      return rule.category;
    }
  }

  // Fallback for "<Product Type> Hikemore <Model>" patterns not listed above
  const brandMatch = name.match(/^([A-Za-z][A-Za-z\s/-]{1,28}?)\s+hikemore\b/i);
  if (brandMatch && brandMatch[1]) {
    const words = brandMatch[1].trim().split(/\s+/);
    if (words.length >= 1 && words.length <= 3) {
      const candidate = toTitleCase(words.join(' '));
      if (isExplicitValidCategory(candidate)) {
        return candidate.slice(0, 50);
      }
    }
  }

  return 'Umum';
}
