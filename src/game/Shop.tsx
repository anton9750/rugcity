import { Check, Coins, Gauge, Palette, Rocket, Sparkles, Store, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { drawPaint } from "./paint";
import {
  buyUpgrade,
  colorOf,
  COLORS,
  PATTERNS,
  pickColor,
  pickPattern,
  upgradePrice,
  UPGRADES,
  type PatternId,
  type SaveData,
  type UpgradeId,
} from "./save";

type Tab = "paint" | "patterns" | "boosters";

function PatternSwatch({ base, accent, pattern }: { base: string; accent: string; pattern: PatternId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawPaint(ref.current, base, accent, pattern);
  }, [base, accent, pattern]);
  return <canvas ref={ref} className="swatch-canvas" aria-hidden="true" />;
}

const UPGRADE_ICON: Record<UpgradeId, typeof Gauge> = {
  engine: Gauge,
  turbo: Rocket,
  nitro: Zap,
};

export function Shop({
  save,
  onChange,
  onClose,
}: {
  save: SaveData;
  onChange: (next: SaveData) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("paint");
  const [note, setNote] = useState<string | null>(null);
  const paint = colorOf(save);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const apply = (next: SaveData | null, price: number) => {
    if (next) {
      setNote(null);
      onChange(next);
    } else {
      setNote(`You need ${Math.max(0, price - save.coins)} more coins.`);
    }
  };

  return (
    <div className="shop-layer">
      <section className="shop-card" aria-label="Rug Garage shop">
        <header className="shop-head">
          <div>
            <p className="eyebrow">
              <Store size={14} /> Rug Garage
            </p>
            <h2>Customize</h2>
          </div>
          <div className="shop-wallet" aria-label={`${save.coins} coins`}>
            <Coins size={16} />
            <strong>{save.coins}</strong>
          </div>
          <button type="button" className="icon-btn shop-close" onClick={onClose} aria-label="Leave shop">
            <X size={18} />
          </button>
        </header>

        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "paint"} onClick={() => setTab("paint")}>
            <Palette size={15} /> Color
          </button>
          <button type="button" role="tab" aria-selected={tab === "patterns"} onClick={() => setTab("patterns")}>
            <Sparkles size={15} /> Patterns
          </button>
          <button type="button" role="tab" aria-selected={tab === "boosters"} onClick={() => setTab("boosters")}>
            <Zap size={15} /> Boosters
          </button>
        </div>

        <div className="shop-body">
          {tab === "paint" ? (
            <div className="grid">
              {COLORS.map((c) => {
                const owned = save.colors.includes(c.id);
                const equipped = save.color === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="tile"
                    data-active={equipped}
                    onClick={() => apply(pickColor(save, c.id), c.price)}
                  >
                    <span className="chip" style={{ background: c.hex }} />
                    <span className="tile-name">{c.name}</span>
                    <span className="tile-price">
                      {equipped ? (
                        <>
                          <Check size={13} /> On
                        </>
                      ) : owned ? (
                        "Owned"
                      ) : (
                        <>
                          <Coins size={13} /> {c.price}
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {tab === "patterns" ? (
            <div className="grid">
              {PATTERNS.map((p) => {
                const owned = save.patterns.includes(p.id);
                const equipped = save.pattern === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="tile"
                    data-active={equipped}
                    onClick={() => apply(pickPattern(save, p.id), p.price)}
                  >
                    <span className="chip chip-pattern">
                      <PatternSwatch base={paint.hex} accent={paint.accent} pattern={p.id} />
                    </span>
                    <span className="tile-name">{p.name}</span>
                    <span className="tile-price">
                      {equipped ? (
                        <>
                          <Check size={13} /> On
                        </>
                      ) : owned ? (
                        "Owned"
                      ) : (
                        <>
                          <Coins size={13} /> {p.price}
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {tab === "boosters" ? (
            <ul className="upgrades">
              {UPGRADES.map((u) => {
                const level = save[u.id];
                const price = upgradePrice(save, u.id);
                const Icon = UPGRADE_ICON[u.id];
                return (
                  <li key={u.id} className="upgrade">
                    <span className="upgrade-icon">
                      <Icon size={20} />
                    </span>
                    <div className="upgrade-text">
                      <strong>{u.name}</strong>
                      <span>{u.blurb}</span>
                      <span className="pips" aria-label={`Level ${level} of ${u.prices.length}`}>
                        {u.prices.map((_, i) => (
                          <i key={i} data-on={i < level} />
                        ))}
                      </span>
                      <span className="upgrade-next">
                        {price === null ? "Fully upgraded" : `Next: ${u.levels[level]}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary upgrade-buy"
                      disabled={price === null}
                      onClick={() => apply(buyUpgrade(save, u.id), price ?? 0)}
                    >
                      {price === null ? (
                        "Max"
                      ) : (
                        <>
                          <Coins size={14} /> {price}
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        <footer className="shop-foot">
          <p role="status">
            {note ?? "Collect coins on the roads to earn more. Changes apply to your car and plane."}
          </p>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Back to the road
          </button>
        </footer>
      </section>
    </div>
  );
}
