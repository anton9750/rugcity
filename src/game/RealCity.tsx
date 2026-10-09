import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BUILDING_ROWS, LAMP_ROWS, TREE_ROWS, type BuildingRow } from "./cityData";
import { mirrorArm, mirrorRot, SUN_DIR, worldTiles, type Reveal } from "./cityHelpers";
import { WORLD_H, WORLD_W } from "./sim";

/** Height of one storey in world units (the car is 0.66 long). */
const FLOOR_H = 0.38;
/** Width of the soft front of the rising wave. */
const RISE_WIDTH = 3;

const C = (hex: string) => new THREE.Color(hex);

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/* ------------------------------------------------------------------------------------------ */
/* Shader patches: buildings and trees rise out of the ground, the real ground is revealed.   */
/* ------------------------------------------------------------------------------------------ */

type RiseUniforms = {
  uCenter: { value: THREE.Vector2 };
  uRadius: { value: number };
  uWidth: { value: number };
};

/** Scales the object's height from 0 to 1 as the wave (radius around uCenter) passes its origin. */
function patchRise<T extends THREE.Material>(mat: T, u: RiseUniforms): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCenter = u.uCenter;
    shader.uniforms.uRadius = u.uRadius;
    shader.uniforms.uWidth = u.uWidth;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec2 uCenter;\nuniform float uRadius;\nuniform float uWidth;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec4 riseOrigin = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          riseOrigin = instanceMatrix * riseOrigin;
        #endif
        riseOrigin = modelMatrix * riseOrigin;
        float riseD = length(riseOrigin.xz - uCenter);
        float riseK = 1.0 - smoothstep(uRadius - uWidth, uRadius, riseD);
        transformed.y *= max(riseK, 0.0001);`,
      );
  };
  mat.customProgramCacheKey = () => "real-rise-1";
  return mat;
}

/** The real ground only exists inside the wave; a thin bright ring marks its edge. */
function patchGround<T extends THREE.Material>(mat: T, u: RiseUniforms): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCenter = u.uCenter;
    shader.uniforms.uRadius = u.uRadius;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRealWP;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvRealWP = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec2 uCenter;\nuniform float uRadius;\nvarying vec3 vRealWP;",
      )
      .replace(
        "void main() {",
        "void main() {\n  float realGd = length(vRealWP.xz - uCenter);\n  if (realGd > uRadius) discard;",
      )
      .replace(
        "#include <dithering_fragment>",
        `float realRing = smoothstep(uRadius - 0.9, uRadius, realGd) * (1.0 - smoothstep(60.0, 100.0, uRadius));
        gl_FragColor.rgb += vec3(0.35, 0.75, 1.0) * realRing * 0.9;
        #include <dithering_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => "real-ground-1";
  return mat;
}

/* ------------------------------------------------------------------------------------------ */
/* Geometry builder with flat normals. Winding is counter-clockwise seen from outside.         */
/* ------------------------------------------------------------------------------------------ */

type V3 = [number, number, number];
type UV = [number, number];

class Mesher {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private withUv: boolean;

  constructor(withUv: boolean) {
    this.withUv = withUv;
  }

  tri(a: V3, b: V3, c: V3, color?: THREE.Color, uvs?: UV[]) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const pts = [a, b, c];
    for (let i = 0; i < 3; i++) {
      const p = pts[i]!;
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      if (this.withUv) {
        const t = uvs?.[i] ?? [0, 0];
        this.uv.push(t[0], t[1]);
      }
      if (color) this.col.push(color.r, color.g, color.b);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, color?: THREE.Color, uvs?: UV[]) {
    this.tri(a, b, c, color, uvs ? [uvs[0]!, uvs[1]!, uvs[2]!] : undefined);
    this.tri(a, c, d, color, uvs ? [uvs[0]!, uvs[2]!, uvs[3]!] : undefined);
  }

  /** Box standing on y0 (no bottom face). */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, color: THREE.Color) {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const y1 = y0 + sy;
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], color);
  }

  /** Four-sided pyramid with a rectangular base on y. */
  pyramid(cx: number, y: number, cz: number, sx: number, sz: number, h: number, color: THREE.Color) {
    const L = cx - sx;
    const R = cx + sx;
    const N = cz - sz;
    const F = cz + sz;
    const top: V3 = [cx, y + h, cz];
    this.tri([L, y, F], [R, y, F], top, color);
    this.tri([R, y, N], [L, y, N], top, color);
    this.tri([R, y, F], [R, y, N], top, color);
    this.tri([L, y, N], [L, y, F], top, color);
  }

  /** Gable roof, ridge along x. Slopes use roofCol, the two triangular ends use endCol. */
  gable(hw: number, hd: number, y: number, rise: number, over: number, roofCol: THREE.Color, endCol: THREE.Color) {
    const w = hw + over;
    const d = hd + over;
    const top = y + rise;
    this.quad([-w, y, d], [w, y, d], [w, top, 0], [-w, top, 0], roofCol);
    this.quad([w, y, -d], [-w, y, -d], [-w, top, 0], [w, top, 0], roofCol);
    this.tri([hw, y, hd], [hw, y, -hd], [hw, top, 0], endCol);
    this.tri([-hw, y, -hd], [-hw, y, hd], [-hw, top, 0], endCol);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.withUv) g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Building styles, one per palette index in cityData.ts                                       */
/* ------------------------------------------------------------------------------------------ */

type Pattern = "grid" | "ribbon" | "brick" | "shop";
type Style = {
  wall: string;
  trim: string;
  roof: string;
  gable: boolean;
  glass: string;
  frame: string;
  pattern: Pattern;
  winW: number;
  winH: number;
  bayW: number;
  /** Share of windows that are lit at night. */
  lit: number;
};

const STYLES: Style[] = [
  // 0 hospital
  { wall: "#e8ecef", trim: "#b4c2cc", roof: "#8c969d", gable: false, glass: "#6e9fc4", frame: "#f5f7f8", pattern: "ribbon", winW: 0.88, winH: 0.38, bayW: 0.5, lit: 0.6 },
  // 1 fire station
  { wall: "#a5473a", trim: "#e8dcc8", roof: "#4a4a4f", gable: false, glass: "#4b6578", frame: "#e8dcc8", pattern: "brick", winW: 0.38, winH: 0.52, bayW: 0.42, lit: 0.35 },
  // 2 post office
  { wall: "#e6d6b2", trim: "#9a6b4a", roof: "#8f4a38", gable: true, glass: "#7aa1bd", frame: "#fbf7ec", pattern: "grid", winW: 0.42, winH: 0.5, bayW: 0.45, lit: 0.5 },
  // 3 house
  { wall: "#cfe0d2", trim: "#8a7a6a", roof: "#6b4a3a", gable: true, glass: "#7aa1bd", frame: "#ffffff", pattern: "grid", winW: 0.4, winH: 0.5, bayW: 0.45, lit: 0.55 },
  // 4 town hall
  { wall: "#d8c6a4", trim: "#b9a47e", roof: "#6f6a62", gable: false, glass: "#5d7f9a", frame: "#f1e8d4", pattern: "grid", winW: 0.36, winH: 0.58, bayW: 0.46, lit: 0.45 },
  // 5 store
  { wall: "#dfe3e8", trim: "#d6453d", roof: "#80858b", gable: false, glass: "#7fb3d5", frame: "#aab2ba", pattern: "shop", winW: 0.86, winH: 0.6, bayW: 0.55, lit: 0.55 },
  // 6 shop
  { wall: "#efd48c", trim: "#8a3b32", roof: "#7b6e60", gable: false, glass: "#86b6d6", frame: "#fff6ea", pattern: "grid", winW: 0.5, winH: 0.5, bayW: 0.48, lit: 0.6 },
  // 7 garage
  { wall: "#8e949c", trim: "#6d737b", roof: "#55595f", gable: false, glass: "#2f3b47", frame: "#c7ccd2", pattern: "ribbon", winW: 0.86, winH: 0.3, bayW: 0.5, lit: 0.25 },
];

/** 4 bays x 4 floors of facade, plus a matching map that only has the lit windows (night). */
function facadeTextures(st: Style, seed: number) {
  const S = 512;
  const N = 4;
  const cell = S / N;
  const rand = seeded(seed);
  const a = document.createElement("canvas");
  const b = document.createElement("canvas");
  a.width = a.height = b.width = b.height = S;
  const ga = a.getContext("2d")!;
  const gb = b.getContext("2d")!;

  ga.fillStyle = st.wall;
  ga.fillRect(0, 0, S, S);
  gb.fillStyle = "#000000";
  gb.fillRect(0, 0, S, S);

  if (st.pattern === "brick") {
    ga.strokeStyle = "rgba(0,0,0,0.2)";
    ga.lineWidth = 1;
    for (let y = 0; y < S; y += 8) {
      ga.beginPath();
      ga.moveTo(0, y + 0.5);
      ga.lineTo(S, y + 0.5);
      ga.stroke();
      for (let x = ((y / 8) % 2) * 8; x < S; x += 16) {
        ga.beginPath();
        ga.moveTo(x + 0.5, y);
        ga.lineTo(x + 0.5, y + 8);
        ga.stroke();
      }
    }
  } else {
    for (let i = 0; i < 900; i++) {
      ga.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.04})`;
      ga.fillRect(rand() * S, rand() * S, 2 + rand() * 6, 1 + rand() * 3);
    }
  }

  for (let fy = 0; fy < N; fy++) {
    for (let fx = 0; fx < N; fx++) {
      const x0 = fx * cell;
      const y0 = fy * cell;
      const ww = cell * st.winW;
      const wh = cell * st.winH;
      const wx = x0 + (cell - ww) / 2;
      const wy = y0 + cell * (st.pattern === "ribbon" ? 0.3 : st.pattern === "shop" ? 0.2 : 0.22);

      ga.fillStyle = st.trim;
      ga.fillRect(x0, y0 + cell - 4, cell, 4);

      ga.fillStyle = st.frame;
      ga.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      const grad = ga.createLinearGradient(0, wy, 0, wy + wh);
      grad.addColorStop(0, st.glass);
      grad.addColorStop(1, "#1f2f3d");
      ga.fillStyle = grad;
      ga.fillRect(wx, wy, ww, wh);
      ga.fillStyle = "rgba(255,255,255,0.18)";
      ga.beginPath();
      ga.moveTo(wx, wy + wh * 0.55);
      ga.lineTo(wx + ww * 0.6, wy);
      ga.lineTo(wx + ww * 0.85, wy);
      ga.lineTo(wx, wy + wh * 0.9);
      ga.closePath();
      ga.fill();
      ga.strokeStyle = st.frame;
      ga.lineWidth = 3;
      ga.beginPath();
      if (st.pattern === "ribbon") {
        for (let k = 1; k < 4; k++) {
          ga.moveTo(wx + (ww * k) / 4, wy);
          ga.lineTo(wx + (ww * k) / 4, wy + wh);
        }
      } else {
        ga.moveTo(wx + ww / 2, wy);
        ga.lineTo(wx + ww / 2, wy + wh);
        if (st.pattern !== "shop") {
          ga.moveTo(wx, wy + wh / 2);
          ga.lineTo(wx + ww, wy + wh / 2);
        }
      }
      ga.stroke();
      ga.fillStyle = st.trim;
      ga.fillRect(wx - 6, wy + wh + 4, ww + 12, 4);

      if (rand() < st.lit) {
        gb.fillStyle = `rgb(255,${190 + Math.floor(rand() * 40)},${110 + Math.floor(rand() * 50)})`;
        gb.fillRect(wx, wy, ww, wh);
      }
    }
  }

  const make = (canvas: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  };
  return { map: make(a), emissive: make(b) };
}

/* ------------------------------------------------------------------------------------------ */
/* Building geometry                                                                           */
/* ------------------------------------------------------------------------------------------ */

/** The four textured walls. Texture units are bays, so windows keep their size on every wall. */
function wallGeometry(w: number, d: number, floors: number, st: Style): THREE.BufferGeometry {
  const m = new Mesher(true);
  const H = floors * FLOOR_H;
  const hw = w / 2;
  const hd = d / 2;
  const vMax = floors / 4;
  const uW = Math.max(1, Math.round(w / st.bayW)) / 4;
  const uD = Math.max(1, Math.round(d / st.bayW)) / 4;
  const uvW: UV[] = [[0, 0], [uW, 0], [uW, vMax], [0, vMax]];
  const uvD: UV[] = [[0, 0], [uD, 0], [uD, vMax], [0, vMax]];
  m.quad([-hw, 0, hd], [hw, 0, hd], [hw, H, hd], [-hw, H, hd], undefined, uvW);
  m.quad([hw, 0, -hd], [-hw, 0, -hd], [-hw, H, -hd], [hw, H, -hd], undefined, uvW);
  m.quad([hw, 0, hd], [hw, 0, -hd], [hw, H, -hd], [hw, H, hd], undefined, uvD);
  m.quad([-hw, 0, -hd], [-hw, 0, hd], [-hw, H, hd], [-hw, H, -hd], undefined, uvD);
  return m.build();
}

/** Plinth, roof, parapet, doors, awnings and rooftop details. Vertex colours, no texture. */
function detailGeometry(row: BuildingRow, st: Style): THREE.BufferGeometry {
  const [, , w, d, , floors, kind, pal] = row;
  const m = new Mesher(false);
  const rand = seeded(pal * 97 + 13);
  const H = floors * FLOOR_H;
  const hw = w / 2;
  const hd = d / 2;
  const trim = C(st.trim);
  const roof = C(st.roof);
  const door = C("#5b3a24");

  m.box(0, 0, 0, w + 0.05, 0.05, d + 0.05, trim);

  if (st.gable) {
    const rise = Math.min(w, d) * 0.36;
    m.gable(hw, hd, H, rise, 0.06, roof, C(st.wall));
    // chimney
    m.box(hw * 0.45, H, -hd * 0.3, 0.1, rise + 0.2, 0.1, C("#8a4a3c"));
  } else {
    m.box(0, H, 0, w + 0.06, 0.04, d + 0.06, roof);
    const t = 0.04;
    const ph = 0.07;
    m.box(0, H + 0.04, hd + 0.03 - t / 2, w + 0.06, ph, t, trim);
    m.box(0, H + 0.04, -(hd + 0.03 - t / 2), w + 0.06, ph, t, trim);
    m.box(hw + 0.03 - t / 2, H + 0.04, 0, t, ph, d + 0.06 - 2 * t, trim);
    m.box(-(hw + 0.03 - t / 2), H + 0.04, 0, t, ph, d + 0.06 - 2 * t, trim);
    for (let i = 0; i < 2; i++) {
      m.box((rand() - 0.5) * w * 0.6, H + 0.04, (rand() - 0.5) * d * 0.5, 0.16, 0.07, 0.12, C("#9aa0a6"));
    }
  }

  const doorX = w * 0.18;
  if (kind === "hospital") {
    m.box(0, H + 0.04, 0, 0.3, 0.05, 0.08, C("#d8352a"));
    m.box(0, H + 0.04, 0, 0.08, 0.05, 0.3, C("#d8352a"));
    m.box(0, 0.3, hd + 0.13, 0.7, 0.03, 0.26, C("#ffffff"));
    m.box(-0.3, 0, hd + 0.23, 0.03, 0.3, 0.03, C("#ffffff"));
    m.box(0.3, 0, hd + 0.23, 0.03, 0.3, 0.03, C("#ffffff"));
    m.box(0, 0.04, hd + 0.012, 0.26, 0.24, 0.02, C("#2f4a5c"));
  } else if (kind === "station") {
    m.box(hw - 0.3, H + 0.04, 0, 0.3, 0.45, 0.3, C("#8f3d32"));
    m.pyramid(hw - 0.3, H + 0.49, 0, 0.19, 0.19, 0.16, C("#3d3d42"));
    m.box(-w * 0.22, 0.05, hd + 0.012, 0.5, 0.34, 0.02, C("#e9e3d6"));
    m.box(w * 0.22, 0.05, hd + 0.012, 0.5, 0.34, 0.02, C("#e9e3d6"));
  } else if (kind === "townhall") {
    m.box(0, 0, hd + 0.1, 0.9, 0.05, 0.2, C("#cfc8b8"));
    m.box(0, H + 0.04, 0, 0.5, 0.55, 0.5, C(st.wall));
    m.pyramid(0, H + 0.59, 0, 0.3, 0.3, 0.42, C("#3f6f66"));
    m.box(0, H + 0.34, 0.255, 0.2, 0.2, 0.02, C("#f7f2e4"));
    m.box(0, H + 0.34, -0.255, 0.2, 0.2, 0.02, C("#f7f2e4"));
    m.box(0, 0.05, hd + 0.012, 0.18, 0.28, 0.02, door);
  } else if (kind === "store") {
    m.box(0, 0.3, hd + 0.09, w * 0.8, 0.03, 0.2, trim);
    m.box(0, H + 0.04, hd - 0.02, w * 0.5, 0.14, 0.04, trim);
    m.box(doorX, 0.04, hd + 0.012, 0.2, 0.26, 0.02, C("#3b4a58"));
  } else if (kind === "shop") {
    const n = 6;
    for (let i = 0; i < n; i++) {
      m.box(-w * 0.4 + (w * 0.8 * (i + 0.5)) / n, 0.3, hd + 0.09, (w * 0.8) / n, 0.03, 0.2, i % 2 ? C("#d6453d") : C("#fff6ea"));
    }
    m.box(doorX, 0.04, hd + 0.012, 0.14, 0.24, 0.02, door);
  } else if (kind === "garage") {
    m.box(-w * 0.2, 0.05, hd + 0.012, 0.5, 0.3, 0.02, C("#cfd3d8"));
    m.box(w * 0.2, 0.05, hd + 0.012, 0.5, 0.3, 0.02, C("#cfd3d8"));
    m.box(0, H + 0.04, hd - 0.02, 0.8, 0.12, 0.04, C("#d6453d"));
  } else {
    m.box(doorX, 0.04, hd + 0.012, 0.12, 0.22, 0.02, door);
  }
  return m.build();
}

/* ------------------------------------------------------------------------------------------ */
/* Trees and lamps                                                                             */
/* ------------------------------------------------------------------------------------------ */

function blob(sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + (hash3(x, y, z) - 0.5) * 0.32;
    p.setXYZ(i, x * k * sx, y * k * sy, z * k * sz);
  }
  g.computeVertexNormals();
  return g;
}

function cone(rad: number, h: number, y: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(rad, h, 7, 1, false).toNonIndexed();
  g.translate(0, y, 0);
  return g;
}

function paintByHeight(g: THREE.BufferGeometry, lo: string, hi: string, y0: number, y1: number) {
  const pos = g.getAttribute("position");
  const cols = new Float32Array(pos.count * 3);
  const a = C(lo);
  const b = C(hi);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)));
    c.lerpColors(a, b, t);
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  return g;
}

type Species = { geo: THREE.BufferGeometry; k: number; trunk: number };

function makeSpecies(): Species[] {
  const round = paintByHeight(blob(1, 0.9, 1), "#2c5a2a", "#86b84e", -0.9, 0.9);
  const conifer = paintByHeight(
    mergeGeometries([cone(1.0, 1.1, -0.45), cone(0.78, 1.0, 0.1), cone(0.55, 0.9, 0.65)]) ?? cone(1, 2, 0),
    "#1f4a38",
    "#4f8a5a",
    -1,
    1.1,
  );
  const poplar = paintByHeight(blob(0.62, 1.25, 0.62), "#4a6a24", "#a5c24c", -1.25, 1.25);
  return [
    { geo: round, k: 0.8, trunk: 0.9 },
    { geo: conifer, k: 1.0, trunk: 0.7 },
    { geo: poplar, k: 1.2, trunk: 0.9 },
  ];
}

function lampGeometry(): THREE.BufferGeometry {
  const m = new Mesher(false);
  const metal = C("#3a3f46");
  m.box(0, 0, 0, 0.07, 0.05, 0.07, C("#2c3036"));
  m.box(0, 0.05, 0, 0.026, 0.88, 0.026, metal);
  m.box(0.1, 0.91, 0, 0.2, 0.022, 0.022, metal);
  m.box(0.2, 0.89, 0, 0.08, 0.03, 0.055, C("#2c3036"));
  return m.build();
}

/* ------------------------------------------------------------------------------------------ */
/* Sky                                                                                         */
/* ------------------------------------------------------------------------------------------ */

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
varying vec3 vDir;
uniform float uNight;
uniform float uLevel;
uniform float uTime;
uniform vec3 uSun;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 hor = mix(vec3(0.78, 0.87, 0.95), vec3(0.07, 0.09, 0.20), uNight);
  vec3 top = mix(vec3(0.30, 0.52, 0.88), vec3(0.01, 0.02, 0.07), uNight);
  vec3 col = mix(hor, top, pow(h, 0.5));

  float sd = max(dot(d, normalize(uSun)), 0.0);
  vec3 glowCol = mix(vec3(1.0, 0.88, 0.6), vec3(0.65, 0.75, 1.0), uNight);
  col += glowCol * (pow(sd, 600.0) * 2.0 + pow(sd, 10.0) * 0.22);

  vec2 cp = d.xz / (d.y + 0.12) * 0.9 + vec2(uTime * 0.012, 0.0);
  float cl = smoothstep(0.48, 0.82, fbm(cp * 1.4)) * smoothstep(0.02, 0.3, d.y);
  vec3 cloudCol = mix(vec3(1.0), vec3(0.10, 0.12, 0.22), uNight);
  col = mix(col, cloudCol * mix(0.92, 1.0, h), cl * 0.85);

  float star = step(0.9985, hash3(floor(d * 260.0)));
  col += vec3(1.0) * star * uNight * smoothstep(0.1, 0.5, d.y) * (1.0 - cl);

  gl_FragColor = vec4(col, uLevel);
}`;

const GLOW_VERT = `
varying vec2 vUv;
varying float vK;
uniform vec2 uCenter;
uniform float uRadius;
void main() {
  vUv = uv;
  vec4 origin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vK = 1.0 - smoothstep(uRadius - 3.0, uRadius, length(origin.xz - uCenter));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const GLOW_FRAG = `
varying vec2 vUv;
varying float vK;
uniform float uAlpha;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(1.0 - d, 0.0), 2.2) * uAlpha * vK;
  gl_FragColor = vec4(1.0, 0.78, 0.42, a);
}`;

/* ------------------------------------------------------------------------------------------ */
/* The whole scene, built once                                                                 */
/* ------------------------------------------------------------------------------------------ */

export type RealCityScene = {
  group: THREE.Group;
  update: (reveal: Reveal, camPos: THREE.Vector3, time: number) => void;
  dispose: () => void;
};

export function buildRealCity(groundTexture: THREE.Texture): RealCityScene {
  const rise: RiseUniforms = {
    uCenter: { value: new THREE.Vector2(0, 0) },
    uRadius: { value: 0 },
    uWidth: { value: RISE_WIDTH },
  };
  const group = new THREE.Group();
  const ownedTextures: THREE.Texture[] = [];
  const tiles = worldTiles();
  const dummy = new THREE.Object3D();
  const depthMat = patchRise(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), rise);

  /* Ground: the real photo-ish ground inside the wave, a plain green apron around the rug. */
  const groundMat = patchGround(new THREE.MeshLambertMaterial({ map: groundTexture }), rise);
  groundMat.polygonOffset = true;
  groundMat.polygonOffsetFactor = -2;
  groundMat.polygonOffsetUnits = -2;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_W, WORLD_H), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.004;
  ground.receiveShadow = true;
  group.add(ground);

  const apronMat = patchGround(new THREE.MeshLambertMaterial({ color: "#46633a" }), rise);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), apronMat);
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.03;
  group.add(apron);

  /* Buildings: one walls mesh + one details mesh per building, one instance per rug tile. */
  const wallMats: THREE.MeshStandardMaterial[] = [];
  const detailMat = patchRise(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 }), rise);
  BUILDING_ROWS.forEach((row, bi) => {
    const [cx, cz, w, d, rot, floors, , pal] = row;
    const st = STYLES[pal % STYLES.length]!;
    const tex = facadeTextures(st, 1000 + bi * 31);
    ownedTextures.push(tex.map, tex.emissive);
    const wallMat = patchRise(
      new THREE.MeshStandardMaterial({
        map: tex.map,
        emissiveMap: tex.emissive,
        emissive: new THREE.Color("#ffffff"),
        emissiveIntensity: 0,
        roughness: 0.82,
        metalness: 0.02,
      }),
      rise,
    );
    wallMats.push(wallMat);
    const walls = new THREE.InstancedMesh(wallGeometry(w, d, floors, st), wallMat, tiles.length);
    const details = new THREE.InstancedMesh(detailGeometry(row, st), detailMat, tiles.length);
    tiles.forEach((t, i) => {
      dummy.position.set(t.ox + (t.fx ? -cx : cx), 0, t.oz + (t.fz ? -cz : cz));
      dummy.rotation.set(0, mirrorRot(rot, t.fx, t.fz), 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      walls.setMatrixAt(i, dummy.matrix);
      details.setMatrixAt(i, dummy.matrix);
    });
    for (const mesh of [walls, details]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.customDepthMaterial = depthMat;
      group.add(mesh);
    }
  });

  /* Trees. Tile-edge trees would be duplicated by the mirror, so identical spots are skipped. */
  const species = makeSpecies();
  const perSpecies: Array<Array<{ x: number; z: number; R: number; seed: number }>> = species.map(() => []);
  const seen = new Set<string>();
  for (const t of tiles) {
    TREE_ROWS.forEach(([x, z, r, sp], idx) => {
      const wx = t.ox + (t.fx ? -x : x);
      const wz = t.oz + (t.fz ? -z : z);
      const key = `${sp}:${Math.round(wx * 50)}:${Math.round(wz * 50)}`;
      if (seen.has(key)) return;
      seen.add(key);
      perSpecies[sp % species.length]!.push({ x: wx, z: wz, R: r * 1.7, seed: idx * 7 + Math.round(wx * 13 + wz * 29) });
    });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.06, 0.09, 1, 6).translate(0, 0.5, 0);
  const trunkMat = patchRise(new THREE.MeshStandardMaterial({ color: "#5a4030", roughness: 0.95 }), rise);
  const leafMat = patchRise(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }), rise);
  const total = perSpecies.reduce((n, list) => n + list.length, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, total));
  let ti = 0;
  const tint = new THREE.Color();
  perSpecies.forEach((list, si) => {
    const sp = species[si]!;
    const canopy = new THREE.InstancedMesh(sp.geo, leafMat, Math.max(1, list.length));
    list.forEach((tree, i) => {
      const rand = seeded(tree.seed);
      const trunkH = tree.R * sp.trunk;
      const yaw = rand() * Math.PI * 2;
      dummy.position.set(tree.x, trunkH + sp.k * tree.R, tree.z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(tree.R * (0.9 + rand() * 0.25));
      dummy.updateMatrix();
      canopy.setMatrixAt(i, dummy.matrix);
      tint.setRGB(0.85 + rand() * 0.3, 0.9 + rand() * 0.2, 0.8 + rand() * 0.25);
      canopy.setColorAt(i, tint);

      dummy.position.set(tree.x, 0, tree.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(tree.R * 1.1, trunkH + tree.R * 0.25, tree.R * 1.1);
      dummy.updateMatrix();
      trunks.setMatrixAt(ti++, dummy.matrix);
    });
    canopy.count = list.length;
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    canopy.frustumCulled = false;
    canopy.customDepthMaterial = depthMat;
    group.add(canopy);
  });
  trunks.count = total;
  trunks.castShadow = true;
  trunks.frustumCulled = false;
  trunks.customDepthMaterial = depthMat;
  group.add(trunks);

  /* Lamp posts: pole + arm, a glowing bulb, and a pool of light on the ground at night. */
  const lamps: Array<{ x: number; z: number; a: number }> = [];
  const seenLamp = new Set<string>();
  for (const t of tiles) {
    for (const [x, z, a] of LAMP_ROWS) {
      const wx = t.ox + (t.fx ? -x : x);
      const wz = t.oz + (t.fz ? -z : z);
      const key = `${Math.round(wx * 50)}:${Math.round(wz * 50)}`;
      if (seenLamp.has(key)) continue;
      seenLamp.add(key);
      lamps.push({ x: wx, z: wz, a: mirrorArm(a, t.fx, t.fz) });
    }
  }
  const poleMat = patchRise(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }), rise);
  const poles = new THREE.InstancedMesh(lampGeometry(), poleMat, lamps.length);
  const bulbMat = new THREE.MeshBasicMaterial({ color: "#7a7258", toneMapped: false });
  const bulbGeo = new THREE.BoxGeometry(0.05, 0.012, 0.04).translate(0.2, 0.872, 0);
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lamps.length);
  const glowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const glowMat = new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uCenter: rise.uCenter, uRadius: rise.uRadius, uAlpha: { value: 0 } },
  });
  const glows = new THREE.InstancedMesh(glowGeo, glowMat, lamps.length);
  lamps.forEach((lamp, i) => {
    dummy.position.set(lamp.x, 0, lamp.z);
    dummy.rotation.set(0, -lamp.a, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    bulbs.setMatrixAt(i, dummy.matrix);
    dummy.position.set(lamp.x + Math.cos(lamp.a) * 0.2, 0.012, lamp.z + Math.sin(lamp.a) * 0.2);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1.9, 1, 1.9);
    dummy.updateMatrix();
    glows.setMatrixAt(i, dummy.matrix);
  });
  poles.castShadow = true;
  for (const mesh of [poles, bulbs, glows]) {
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  poles.customDepthMaterial = depthMat;
  // Bulbs use the same rise as the poles so they never float.
  patchRise(bulbMat, rise);

  /* Sky dome that follows the camera. */
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uNight: { value: 0 },
      uLevel: { value: 0 },
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]) },
    },
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat);
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  dome.visible = false;

  const root = new THREE.Group();
  root.add(group, dome);

  const dayBulb = C("#7a7258");
  const nightBulb = C("#ffd9a0");

  return {
    group: root,
    update(rv, camPos, time) {
      rise.uCenter.value.set(rv.cx, rv.cz);
      rise.uRadius.value = rv.radius;
      group.visible = rv.radius > 0.01;
      dome.visible = rv.level > 0.002;
      dome.position.copy(camPos);
      skyMat.uniforms.uNight!.value = rv.night;
      skyMat.uniforms.uLevel!.value = rv.level;
      skyMat.uniforms.uTime!.value = time;
      for (const mat of wallMats) mat.emissiveIntensity = rv.night * 1.6;
      bulbMat.color.lerpColors(dayBulb, nightBulb, rv.night);
      glowMat.uniforms.uAlpha!.value = rv.night * 0.75;
    },
    dispose() {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      for (const m of [groundMat, apronMat, detailMat, trunkMat, leafMat, poleMat, bulbMat, glowMat, skyMat, depthMat, ...wallMats]) {
        m.dispose();
      }
      for (const t of ownedTextures) t.dispose();
    },
  };
}

/** Drop-in scene piece. Mount it once the real ground texture has loaded. */
export function RealCity({
  groundTexture,
  revealRef,
}: {
  groundTexture: THREE.Texture;
  revealRef: React.MutableRefObject<Reveal>;
}) {
  const { camera } = useThree();
  const city = useMemo(() => buildRealCity(groundTexture), [groundTexture]);
  useEffect(() => () => city.dispose(), [city]);
  useFrame((state) => {
    city.update(revealRef.current, camera.position, state.clock.elapsedTime);
  });
  return <primitive object={city.group} />;
}
