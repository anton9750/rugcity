/** Real City helpers that do not need three.js. */

import { CELL_BLOCK, CELL_ROAD, sample, TILE_H, TILE_HALF, TILE_W } from "./sim";

/** Reveal wave: how far (world units) the real city has spread from the car. Bigger than the world. */
export const REVEAL_MAX = 120;
export const REAL_IN_SECONDS = 3.4;
export const REAL_OUT_SECONDS = 2.4;

/** Shared, mutable state that the game loop writes and the Real City scene reads every frame. */
export type Reveal = {
  /** Wave radius around (cx, cz). 0 = nothing revealed. */
  radius: number;
  /** 0..1, eased. Drives lighting, fog, sky and camera blending. */
  level: number;
  /** 0 = day, 1 = night. */
  night: number;
  cx: number;
  cz: number;
};

export function createReveal(): Reveal {
  return { radius: 0, level: 0, night: 0, cx: 0, cz: 0 };
}

/** Direction towards the sun (and the moon, which sits in the same spot). Already normalised. */
export const SUN_DIR: [number, number, number] = (() => {
  const v: [number, number, number] = [5, 9, 4];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

/** One copy of the rug tile in the 5x5 world. Odd tiles are mirrored like the rug and the mask. */
export type TileXf = { ox: number; oz: number; fx: boolean; fz: boolean };

export function worldTiles(): TileXf[] {
  const out: TileXf[] = [];
  for (let j = -TILE_HALF; j <= TILE_HALF; j++) {
    for (let i = -TILE_HALF; i <= TILE_HALF; i++) {
      out.push({ ox: i * TILE_W, oz: j * TILE_H, fx: (i & 1) === 1, fz: (j & 1) === 1 });
    }
  }
  return out;
}

/** Yaw of a rectangle after the tile it sits in is mirrored. */
export function mirrorRot(rot: number, fx: boolean, fz: boolean): number {
  return fx !== fz ? -rot : rot;
}

/** Direction angle in the XZ plane (x = cos a, z = sin a) after mirroring. */
export function mirrorArm(a: number, fx: boolean, fz: boolean): number {
  let r = a;
  if (fx) r = Math.PI - r;
  if (fz) r = -r;
  return r;
}

/**
 * When Real City appears, a building or tree trunk can land on top of the car. Returns the
 * nearest spot that is not blocked (preferring a road with some room around it), or null.
 */
export function nearestOpen(mask: Uint8Array, x: number, z: number): { x: number; z: number } | null {
  if (sample(mask, x, z) !== CELL_BLOCK) return { x, z };
  const roomy = (px: number, pz: number) =>
    sample(mask, px, pz) === CELL_ROAD &&
    sample(mask, px + 0.12, pz) !== CELL_BLOCK &&
    sample(mask, px - 0.12, pz) !== CELL_BLOCK &&
    sample(mask, px, pz + 0.12) !== CELL_BLOCK &&
    sample(mask, px, pz - 0.12) !== CELL_BLOCK;
  for (let r = 0.06; r <= 8; r += 0.06) {
    const n = Math.max(12, Math.round(r * 60));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (roomy(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}
