import * as THREE from "three";
import type { PatternId } from "./save";

export const PAINT_W = 128;
export const PAINT_H = 256;

/** Paints a base colour plus one pattern into a 128x256 canvas (about the car's top-face shape). */
export function drawPaint(canvas: HTMLCanvasElement, base: string, accent: string, pattern: PatternId) {
  canvas.width = PAINT_W;
  canvas.height = PAINT_H;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.fillStyle = base;
  g.fillRect(0, 0, PAINT_W, PAINT_H);
  g.fillStyle = accent;
  g.strokeStyle = accent;

  switch (pattern) {
    case "stripes": {
      g.fillRect(PAINT_W * 0.34, 0, PAINT_W * 0.12, PAINT_H);
      g.fillRect(PAINT_W * 0.54, 0, PAINT_W * 0.12, PAINT_H);
      break;
    }
    case "checker": {
      const s = 16;
      for (let y = 0; y < PAINT_H / s; y++) {
        for (let x = 0; x < PAINT_W / s; x++) {
          if ((x + y) % 2 === 0) g.fillRect(x * s, y * s, s, s);
        }
      }
      break;
    }
    case "dots": {
      const s = 32;
      for (let y = 0; y < PAINT_H / s; y++) {
        for (let x = 0; x < PAINT_W / s; x++) {
          g.beginPath();
          g.arc(x * s + (y % 2 === 0 ? s / 2 : 0), y * s + s / 2, 8, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    }
    case "zigzag": {
      g.lineWidth = 9;
      g.lineJoin = "miter";
      for (let y = 8; y < PAINT_H; y += 40) {
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= PAINT_W; x += 32) {
          g.lineTo(x + 16, y + 16);
          g.lineTo(x + 32, y);
        }
        g.stroke();
      }
      break;
    }
    case "diagonal": {
      g.lineWidth = 14;
      for (let d = -PAINT_H; d < PAINT_W + PAINT_H; d += 42) {
        g.beginPath();
        g.moveTo(d, 0);
        g.lineTo(d + PAINT_H, PAINT_H);
        g.stroke();
      }
      break;
    }
    default:
      break;
  }
}

export type PaintTextures = {
  /** For the long car body / plane fuselage. */
  body: THREE.CanvasTexture;
  /** For the squarer cabin box: shows the same pattern at the same scale. */
  cabin: THREE.CanvasTexture;
  dispose: () => void;
};

export function makePaintTextures(base: string, accent: string, pattern: PatternId): PaintTextures {
  const canvas = document.createElement("canvas");
  drawPaint(canvas, base, accent, pattern);
  const setup = (t: THREE.CanvasTexture) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  const body = setup(new THREE.CanvasTexture(canvas));
  const cabin = setup(new THREE.CanvasTexture(canvas));
  cabin.repeat.set(1, 0.5);
  return {
    body,
    cabin,
    dispose: () => {
      body.dispose();
      cabin.dispose();
    },
  };
}
