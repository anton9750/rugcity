/** Shop catalog + saved progress (coins, paint, upgrades). Pure data, no three.js. */

export type PatternId = "none" | "stripes" | "checker" | "dots" | "zigzag" | "diagonal";
export type UpgradeId = "engine" | "turbo" | "nitro";

export type PaintColor = { id: string; name: string; hex: string; accent: string; price: number };
export type PatternItem = { id: PatternId; name: string; price: number };
export type UpgradeItem = {
  id: UpgradeId;
  name: string;
  blurb: string;
  prices: number[];
  /** What each level gives, shown under the name. */
  levels: string[];
};

export const COLORS: PaintColor[] = [
  { id: "red", name: "Red", hex: "#e10600", accent: "#ffffff", price: 0 },
  { id: "green", name: "Green", hex: "#1fb84a", accent: "#ffffff", price: 25 },
  { id: "blue", name: "Blue", hex: "#1e63e9", accent: "#ffffff", price: 25 },
  { id: "orange", name: "Orange", hex: "#ff8a00", accent: "#1a1a1a", price: 25 },
  { id: "black", name: "Black", hex: "#151515", accent: "#ffd54a", price: 30 },
  { id: "white", name: "White", hex: "#f4f4f4", accent: "#1a1a1a", price: 30 },
];

export const PATTERNS: PatternItem[] = [
  { id: "none", name: "Plain", price: 0 },
  { id: "stripes", name: "Racing stripes", price: 40 },
  { id: "checker", name: "Checkered", price: 60 },
  { id: "dots", name: "Polka dots", price: 40 },
  { id: "zigzag", name: "Zigzag", price: 50 },
  { id: "diagonal", name: "Candy stripes", price: 50 },
];

export const UPGRADES: UpgradeItem[] = [
  {
    id: "engine",
    name: "Engine",
    blurb: "Higher top speed.",
    prices: [60, 120, 220],
    levels: ["+15% top speed", "+30% top speed", "+50% top speed"],
  },
  {
    id: "turbo",
    name: "Turbo",
    blurb: "Gets up to speed faster.",
    prices: [50, 100, 180],
    levels: ["+30% acceleration", "+60% acceleration", "+100% acceleration"],
  },
  {
    id: "nitro",
    name: "Nitro",
    blurb: "Hold Shift or Space for a big burst. Works in the plane too.",
    prices: [80, 150, 260],
    levels: ["2.5 s tank", "4 s tank", "6 s tank"],
  },
];

export const ENGINE_MUL = [1, 1.15, 1.3, 1.5];
export const TURBO_MUL = [1, 1.3, 1.6, 2];

export type SaveData = {
  coins: number;
  colors: string[];
  patterns: PatternId[];
  color: string;
  pattern: PatternId;
  engine: number;
  turbo: number;
  nitro: number;
};

const KEY = "rug-city-save-v1";

export function defaultSave(): SaveData {
  return {
    coins: 0,
    colors: ["red"],
    patterns: ["none"],
    color: "red",
    pattern: "none",
    engine: 0,
    turbo: 0,
    nitro: 0,
  };
}

const lvl = (v: unknown) => Math.max(0, Math.min(3, Math.floor(Number(v) || 0)));

export function loadSave(): SaveData {
  const base = defaultSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const d = JSON.parse(raw) as Partial<SaveData>;
    const colors = Array.isArray(d.colors) ? d.colors.filter((c) => COLORS.some((k) => k.id === c)) : [];
    const patterns = Array.isArray(d.patterns)
      ? (d.patterns.filter((p) => PATTERNS.some((k) => k.id === p)) as PatternId[])
      : [];
    if (!colors.includes("red")) colors.unshift("red");
    if (!patterns.includes("none")) patterns.unshift("none");
    const color = typeof d.color === "string" && colors.includes(d.color) ? d.color : "red";
    const pattern = patterns.includes(d.pattern as PatternId) ? (d.pattern as PatternId) : "none";
    return {
      coins: Math.max(0, Math.floor(Number(d.coins) || 0)),
      colors,
      patterns,
      color,
      pattern,
      engine: lvl(d.engine),
      turbo: lvl(d.turbo),
      nitro: lvl(d.nitro),
    };
  } catch {
    return base;
  }
}

export function persistSave(save: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* private mode etc: progress just won't persist */
  }
}

export function colorOf(save: SaveData): PaintColor {
  return COLORS.find((c) => c.id === save.color) ?? COLORS[0]!;
}

export function tuningOf(save: SaveData) {
  return {
    topMul: ENGINE_MUL[save.engine] ?? 1,
    accelMul: TURBO_MUL[save.turbo] ?? 1,
    nitroLevel: save.nitro,
  };
}

/** Buy (if needed) and equip a paint colour. Returns null if you can't afford it. */
export function pickColor(save: SaveData, id: string): SaveData | null {
  const item = COLORS.find((c) => c.id === id);
  if (!item) return null;
  if (save.colors.includes(id)) return { ...save, color: id };
  if (save.coins < item.price) return null;
  return { ...save, coins: save.coins - item.price, colors: [...save.colors, id], color: id };
}

export function pickPattern(save: SaveData, id: PatternId): SaveData | null {
  const item = PATTERNS.find((p) => p.id === id);
  if (!item) return null;
  if (save.patterns.includes(id)) return { ...save, pattern: id };
  if (save.coins < item.price) return null;
  return { ...save, coins: save.coins - item.price, patterns: [...save.patterns, id], pattern: id };
}

export function upgradePrice(save: SaveData, id: UpgradeId): number | null {
  const item = UPGRADES.find((u) => u.id === id);
  const level = save[id];
  if (!item || level >= item.prices.length) return null;
  return item.prices[level] ?? null;
}

export function buyUpgrade(save: SaveData, id: UpgradeId): SaveData | null {
  const price = upgradePrice(save, id);
  if (price === null || save.coins < price) return null;
  return { ...save, coins: save.coins - price, [id]: save[id] + 1 };
}
