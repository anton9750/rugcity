/** Rug City driving sim. Pure so control signs can be checked without three.js. */

/**
 * The world is a (TILES x TILES) grid of the same rug tile. Every other tile is
 * mirrored, so a road that reaches a tile edge continues seamlessly into the
 * neighbouring tile (and the texture uses MirroredRepeatWrapping to match).
 */
export const TILE_W = 16;
export const GRID_W = 360;
export const GRID_H = 240;
export const TILE_H = (TILE_W * GRID_H) / GRID_W;
/** Tiles on each side of the centre tile. Keep it even so the centre tile is unmirrored. */
export const TILE_HALF = 2;
export const TILES = TILE_HALF * 2 + 1;
export const WORLD_W = TILE_W * TILES;
export const WORLD_H = TILE_H * TILES;

export const CELL_BLOCK = 0;
export const CELL_GRASS = 1;
export const CELL_ROAD = 2;

export type SimState = {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  distance: number;
  wheel: number;
  /** Visual front-wheel steer, -1..1. Positive = left. */
  face: number;
  shake: number;
  started: boolean;
  dragging: boolean;
  pointerX: number;
  pointerZ: number;
  steerOverride: number | null;
  /** 0 = on the ground, 1 = cruising altitude. Eases while taking off / landing. */
  alt: number;
  /** Player asked for the plane. */
  wantPlane: boolean;
  /** Was flying last step (so we can snap back to a road on landing). */
  airborne: boolean;
  /** Nitro tank 0..1. */
  nitro: number;
  nitroEmpty: boolean;
  boosting: boolean;
  /** Shop upgrades (1 = stock). */
  topMul: number;
  accelMul: number;
  nitroLevel: number;
};

export type DriveInput = {
  throttle: number;
  steer: number;
  pointer: { x: number; z: number } | null;
  boost: boolean;
};

/** How high the plane flies above the rug, in world units. */
export const PLANE_HEIGHT = 2.4;
const NITRO_SECONDS = [0, 2.5, 4, 6];
const NITRO_THRUST = 1.55;

export type Spawn = { x: number; z: number; yaw: number };

export function createSim(): SimState {
  return {
    x: 0,
    z: 0,
    yaw: 0,
    speed: 0,
    distance: 0,
    wheel: 0,
    face: 0,
    shake: 0,
    started: false,
    dragging: false,
    pointerX: 0,
    pointerZ: 0,
    steerOverride: null,
    alt: 0,
    wantPlane: false,
    airborne: false,
    nitro: 1,
    nitroEmpty: false,
    boosting: false,
    topMul: 1,
    accelMul: 1,
    nitroLevel: 0,
  };
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Mask lookup in world space; the single tile mask is mirrored across tile borders. */
export function sample(mask: Uint8Array, x: number, z: number): number {
  const u = x / TILE_W + 0.5;
  const v = z / TILE_H + 0.5;
  const tu = Math.floor(u);
  const tv = Math.floor(v);
  if (Math.abs(tu) > TILE_HALF || Math.abs(tv) > TILE_HALF) return CELL_BLOCK;
  let fu = u - tu;
  let fv = v - tv;
  if (tu & 1) fu = 1 - fu;
  if (tv & 1) fv = 1 - fv;
  const gx = Math.min(GRID_W - 1, Math.floor(fu * GRID_W));
  const gz = Math.min(GRID_H - 1, Math.floor(fv * GRID_H));
  return mask[gz * GRID_W + gx] ?? CELL_BLOCK;
}

/** Centre of a cell inside the centre (unmirrored) tile. */
function cellCenter(gx: number, gz: number): { x: number; z: number } {
  return {
    x: ((gx + 0.5) / GRID_W) * TILE_W - TILE_W / 2,
    z: ((gz + 0.5) / GRID_H) * TILE_H - TILE_H / 2,
  };
}

/** Longest clear road ray, so the car starts pointed down a street. */
function roadRun(mask: Uint8Array, x: number, z: number, yaw: number): number {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let dist = 0;
  for (let i = 1; i <= 48; i++) {
    const s = sample(mask, x + fx * i * 0.1, z + fz * i * 0.1);
    if (s !== CELL_ROAD) break;
    dist = i * 0.1;
  }
  return dist;
}

export function findSpawn(mask: Uint8Array): Spawn {
  let bestScore = -Infinity;
  let best: Spawn = { x: 0, z: 0.4, yaw: 0 };

  for (let gz = 6; gz < GRID_H - 6; gz += 3) {
    for (let gx = 6; gx < GRID_W - 6; gx += 3) {
      if (mask[gz * GRID_W + gx] !== CELL_ROAD) continue;
      const { x, z } = cellCenter(gx, gz);
      let run = 0;
      let yaw = 0;
      for (let i = 0; i < 16; i++) {
        const candidate = (i / 16) * Math.PI * 2;
        const along = roadRun(mask, x, z, candidate);
        if (along > run) {
          run = along;
          yaw = candidate;
        }
      }
      if (run < 1.4) continue;
      const score = run - Math.abs(x) * 0.08 - Math.abs(z) * 0.04;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z, yaw };
      }
    }
  }
  return best;
}

function nearestRoad(
  mask: Uint8Array,
  x: number,
  z: number,
  radius: number,
): { x: number; z: number } | null {
  const cell = TILE_W / GRID_W;
  const steps = Math.ceil(radius / cell);
  const cx0 = Math.floor(x / cell);
  const cz0 = Math.floor(z / cell);
  let best: { x: number; z: number } | null = null;
  let bestD = radius * radius;
  for (let dz = -steps; dz <= steps; dz++) {
    for (let dx = -steps; dx <= steps; dx++) {
      const px = (cx0 + dx + 0.5) * cell;
      const pz = (cz0 + dz + 0.5) * cell;
      if (sample(mask, px, pz) !== CELL_ROAD) continue;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: px, z: pz };
      }
    }
  }
  return best;
}

/** Nose hits a building or the rug edge. Side kisses are allowed so lanes stay drivable. */
function noseBlocked(mask: Uint8Array, x: number, z: number, yaw: number): boolean {
  if (sample(mask, x, z) === CELL_BLOCK) return true;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  if (sample(mask, x + fx * 0.2, z + fz * 0.2) === CELL_BLOCK) return true;
  return false;
}

function accelerate(speed: number, throttle: number, dt: number, accelMul: number, topMul: number): number {
  const accel = 5.4 * accelMul;
  const brake = 8;
  const coast = 2.6;
  const maxF = 2.45 * topMul;
  const maxR = 1.2;
  let next = speed;
  if (throttle > 0.05) next += throttle * accel * dt;
  else if (throttle < -0.05) next += throttle * brake * dt;
  else next -= Math.sign(next) * Math.min(Math.abs(next), coast * dt);
  return Math.max(-maxR, Math.min(maxF, next));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Drains / refills the nitro tank. Returns the speed multiplier for this step. */
function nitroFactor(sim: SimState, wantBoost: boolean, dt: number): number {
  const cap = NITRO_SECONDS[Math.min(3, sim.nitroLevel)] ?? 0;
  if (cap <= 0) {
    sim.boosting = false;
    sim.nitro = 0;
    return 1;
  }
  if (sim.nitroEmpty && sim.nitro > 0.25) sim.nitroEmpty = false;
  if (wantBoost && !sim.nitroEmpty && sim.nitro > 0) {
    sim.nitro = Math.max(0, sim.nitro - dt / cap);
    if (sim.nitro === 0) sim.nitroEmpty = true;
    sim.boosting = true;
    return NITRO_THRUST;
  }
  sim.boosting = false;
  sim.nitro = Math.min(1, sim.nitro + dt / (cap * 1.6));
  return 1;
}

/** Landing: drop back onto the nearest street. */
function land(sim: SimState, mask: Uint8Array) {
  sim.alt = 0;
  sim.airborne = false;
  if (sample(mask, sim.x, sim.z) !== CELL_ROAD) {
    const road = nearestRoad(mask, sim.x, sim.z, 6);
    if (road) {
      sim.x = road.x;
      sim.z = road.z;
    }
  }
  sim.speed = Math.min(sim.speed, 0.8);
  sim.face = 0;
}

/** Free flight above the city: no collisions, only the edge of the rug. */
function stepPlane(sim: SimState, input: DriveInput, boost: number, dt: number) {
  const tune = 1 + (sim.topMul - 1) * 0.6;
  let target = 2.3;
  if (input.throttle > 0.05) target = 4;
  else if (input.throttle < -0.05) target = 1.2;
  target *= tune * boost;

  let steer = input.steer;
  const pointer = input.pointer;
  if (pointer && Math.abs(input.throttle) < 0.05 && Math.abs(input.steer) < 0.05) {
    const dx = pointer.x - sim.x;
    const dz = pointer.z - sim.z;
    if (Math.hypot(dx, dz) > 0.15) {
      const desired = Math.atan2(-dx, -dz);
      const diff = wrapAngle(desired - sim.yaw);
      const maxStep = 2.4 * dt;
      sim.yaw = wrapAngle(sim.yaw + clamp(diff, -maxStep, maxStep));
      steer = clamp(diff / 0.6, -1, 1);
    } else {
      steer = 0;
    }
  } else {
    sim.yaw = wrapAngle(sim.yaw + steer * 1.9 * dt);
  }

  sim.speed += (target - sim.speed) * Math.min(1, 1.6 * dt);
  sim.face += (steer - sim.face) * Math.min(1, 6 * dt);

  const limX = WORLD_W / 2 - 0.3;
  const limZ = WORLD_H / 2 - 0.3;
  const nx = clamp(sim.x - Math.sin(sim.yaw) * sim.speed * dt, -limX, limX);
  const nz = clamp(sim.z - Math.cos(sim.yaw) * sim.speed * dt, -limZ, limZ);
  sim.distance += Math.hypot(nx - sim.x, nz - sim.z);
  sim.x = nx;
  sim.z = nz;
  sim.wheel += dt * (14 + sim.speed * 6);
  sim.shake *= Math.max(0, 1 - 3.5 * dt);
}

function stepOnce(sim: SimState, mask: Uint8Array, input: DriveInput, dt: number) {
  const target = sim.wantPlane ? 1 : 0;
  sim.alt += (target - sim.alt) * Math.min(1, 1.8 * dt);
  if (Math.abs(target - sim.alt) < 0.004) sim.alt = target;

  const driving = input.throttle > 0.05 || input.pointer !== null || sim.wantPlane || sim.alt > 0.03;
  const boost = nitroFactor(sim, input.boost && driving, dt);

  if (sim.wantPlane || sim.alt > 0.03) {
    sim.airborne = true;
    stepPlane(sim, input, boost, dt);
    return;
  }
  if (sim.airborne) land(sim, mask);

  let throttle = input.throttle;
  let steer = input.steer;
  const pointer = input.pointer;

  if (pointer && Math.abs(input.throttle) < 0.05 && Math.abs(input.steer) < 0.05) {
    const dx = pointer.x - sim.x;
    const dz = pointer.z - sim.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.035) {
      const desired = Math.atan2(-dx, -dz);
      const diff = wrapAngle(desired - sim.yaw);
      const maxStep = 5.2 * dt;
      const applied = Math.max(-maxStep, Math.min(maxStep, diff));
      sim.yaw = wrapAngle(sim.yaw + applied);
      sim.face += (Math.max(-1, Math.min(1, diff / 0.55)) - sim.face) * Math.min(1, 12 * dt);
      const topSpeed = 2.45 * sim.topMul * boost;
      const want = dist < 0.1 ? 0 : Math.min(topSpeed, Math.max(0, (dist - 0.06) * 2.7 * boost));
      if (Math.abs(diff) < 1.05) {
        sim.speed += (want * Math.max(0, Math.cos(diff)) - sim.speed) * Math.min(1, 10 * dt);
      } else {
        sim.speed += (0 - sim.speed) * Math.min(1, 8 * dt);
      }
    } else {
      sim.speed += (0 - sim.speed) * Math.min(1, 14 * dt);
      sim.face += (0 - sim.face) * Math.min(1, 10 * dt);
    }
  } else {
    const turnRate = 2.7;
    const speedFactor = Math.min(1, Math.max(0.55, Math.abs(sim.speed) / 0.65));
    const reverse = sim.speed >= -0.04 ? 1 : -1;
    sim.yaw = wrapAngle(sim.yaw + steer * turnRate * speedFactor * reverse * dt);
    sim.speed = accelerate(sim.speed, throttle, dt, sim.accelMul * (boost > 1 ? 1.8 : 1), sim.topMul * boost);
    sim.face += (steer - sim.face) * Math.min(1, 10 * dt);
  }

  const here = sample(mask, sim.x, sim.z);
  if (here === CELL_GRASS) {
    const cap = 0.42;
    if (sim.speed > cap) sim.speed += (cap - sim.speed) * Math.min(1, 9 * dt);
    else if (sim.speed < -cap) sim.speed += (-cap - sim.speed) * Math.min(1, 9 * dt);
  }

  const fx = -Math.sin(sim.yaw);
  const fz = -Math.cos(sim.yaw);
  let nx = sim.x + fx * sim.speed * dt;
  let nz = sim.z + fz * sim.speed * dt;
  const hit = noseBlocked(mask, nx, nz, sim.yaw);
  if (hit) {
    const xOk = !noseBlocked(mask, nx, sim.z, sim.yaw);
    const zOk = !noseBlocked(mask, sim.x, nz, sim.yaw);
    if (xOk && !zOk) nz = sim.z;
    else if (zOk && !xOk) nx = sim.x;
    else if (xOk && zOk) {
      // Prefer the axis that stays on pavement.
      if (sample(mask, nx, sim.z) === CELL_ROAD) nz = sim.z;
      else nx = sim.x;
    } else {
      nx = sim.x;
      nz = sim.z;
      if (Math.abs(sim.speed) > 0.35) sim.shake = Math.min(1, sim.shake + 0.85);
      sim.speed *= 0.35;
    }
  }

  if (sample(mask, nx, nz) === CELL_GRASS) {
    const pull = nearestRoad(mask, nx, nz, 0.5);
    if (pull) {
      const mx = nx + (pull.x - nx) * Math.min(1, 4 * dt);
      const mz = nz + (pull.z - nz) * Math.min(1, 4 * dt);
      if (!noseBlocked(mask, mx, mz, sim.yaw)) {
        nx = mx;
        nz = mz;
      }
    }
  }

  const moved = Math.hypot(nx - sim.x, nz - sim.z);
  sim.distance += moved;
  sim.x = nx;
  sim.z = nz;
  sim.wheel += sim.speed * dt * 11;
  sim.shake *= Math.max(0, 1 - 3.5 * dt);
}

export function step(sim: SimState, mask: Uint8Array, input: DriveInput, dt: number) {
  let left = Math.min(Math.max(dt, 0), 0.1);
  while (left > 1e-5) {
    const h = Math.min(left, 1 / 60);
    stepOnce(sim, mask, input, h);
    left -= h;
  }
}

export function inputFromHeld(
  held: ReadonlySet<string>,
  steerOverride: number | null,
  pointer: { x: number; z: number } | null,
): DriveInput {
  let steer = 0;
  let throttle = 0;
  const left = held.has("KeyA") || held.has("ArrowLeft");
  const right = held.has("KeyD") || held.has("ArrowRight");
  const up = held.has("KeyW") || held.has("ArrowUp");
  const down = held.has("KeyS") || held.has("ArrowDown");
  if (left) steer += 1;
  if (right) steer -= 1;
  if (up) throttle += 1;
  if (down) throttle -= 1;
  if (steerOverride !== null) steer = Math.max(-1, Math.min(1, steerOverride));
  const keying = up || down || left || right || steerOverride !== null;
  return {
    throttle,
    steer,
    pointer: !keying && pointer ? pointer : null,
    boost: held.has("ShiftLeft") || held.has("ShiftRight") || held.has("Space"),
  };
}

// ---------------------------------------------------------------------------
// Shops and coins
// ---------------------------------------------------------------------------

export type ShopSite = { padX: number; padZ: number; bx: number; bz: number };
export type Shop = { padX: number; padZ: number; bx: number; bz: number; rot: number };
export type Coin = { x: number; z: number; value: number };

function solidRoad(mask: Uint8Array, x: number, z: number, r: number): boolean {
  if (sample(mask, x, z) !== CELL_ROAD) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (sample(mask, x + Math.cos(a) * r, z + Math.sin(a) * r) !== CELL_ROAD) return false;
  }
  return true;
}

function clearOfRoad(mask: Uint8Array, x: number, z: number, r: number): boolean {
  if (sample(mask, x, z) === CELL_ROAD) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (sample(mask, x + Math.cos(a) * r, z + Math.sin(a) * r) === CELL_ROAD) return false;
  }
  return true;
}

/**
 * Finds a spot in the centre tile: a pad on wide, solid road with a patch of
 * grass or buildings right beside it where the little shop building can stand.
 */
export function findShopSite(mask: Uint8Array, spawn: Spawn): ShopSite | null {
  let best: ShopSite | null = null;
  let bestScore = Infinity;
  for (let gz = 14; gz < GRID_H - 14; gz += 2) {
    for (let gx = 14; gx < GRID_W - 14; gx += 2) {
      if (mask[gz * GRID_W + gx] !== CELL_ROAD) continue;
      const { x, z } = cellCenter(gx, gz);
      if (!solidRoad(mask, x, z, 0.4)) continue;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const bx = x + Math.cos(a) * 0.95;
        const bz = z + Math.sin(a) * 0.95;
        if (!clearOfRoad(mask, bx, bz, 0.3)) continue;
        // Aim for a shop a short drive from the start.
        const score = Math.abs(Math.hypot(x - spawn.x, z - spawn.z) - 2.2);
        if (score < bestScore) {
          bestScore = score;
          best = { padX: x, padZ: z, bx, bz };
        }
      }
    }
  }
  return best;
}

/** Position of a centre-tile point inside tile (tu, tv) of the mirrored world. */
function mirrorPoint(tu: number, tv: number, x: number, z: number): { x: number; z: number } {
  const fu = x / TILE_W + 0.5;
  const fv = z / TILE_H + 0.5;
  const mu = tu & 1 ? 1 - fu : fu;
  const mv = tv & 1 ? 1 - fv : fv;
  return { x: (tu + mu - 0.5) * TILE_W, z: (tv + mv - 0.5) * TILE_H };
}

/** One shop in every rug tile, mirrored like the roads. */
export function shopsInWorld(site: ShopSite): Shop[] {
  const out: Shop[] = [];
  for (let tv = -TILE_HALF; tv <= TILE_HALF; tv++) {
    for (let tu = -TILE_HALF; tu <= TILE_HALF; tu++) {
      const pad = mirrorPoint(tu, tv, site.padX, site.padZ);
      const b = mirrorPoint(tu, tv, site.bx, site.bz);
      const dx = b.x - pad.x;
      const dz = b.z - pad.z;
      out.push({ padX: pad.x, padZ: pad.z, bx: b.x, bz: b.z, rot: Math.atan2(-dx, -dz) });
    }
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scatters coins on the pavement across the whole world. Every 8th is a worth-5 blue one. */
export function makeCoins(
  mask: Uint8Array,
  count: number,
  avoid: ReadonlyArray<{ x: number; z: number }>,
): Coin[] {
  const rand = mulberry32(20261009);
  const coins: Coin[] = [];
  const limX = WORLD_W / 2 - 0.5;
  const limZ = WORLD_H / 2 - 0.5;
  for (let tries = 0; tries < 60000 && coins.length < count; tries++) {
    const x = (rand() * 2 - 1) * limX;
    const z = (rand() * 2 - 1) * limZ;
    if (!solidRoad(mask, x, z, 0.14)) continue;
    if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < 0.9)) continue;
    if (coins.some((c) => Math.hypot(c.x - x, c.z - z) < 0.75)) continue;
    coins.push({ x, z, value: coins.length % 8 === 7 ? 5 : 1 });
  }
  return coins;
}

export type ControlsProbe = {
  getYaw: () => number;
  getSpeed: () => number;
  setSteer?: (v: number) => void;
  setKeys?: (codes: string[]) => void;
};

declare global {
  interface Window {
    __controlsTest?: ControlsProbe;
  }
}
