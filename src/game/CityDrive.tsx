import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Building2,
  Car,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Coins,
  Moon,
  Plane,
  RotateCcw,
  Sun,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { makePaintTextures, type PaintTextures } from "./paint";
import { createReveal, nearestOpen, REAL_IN_SECONDS, REAL_OUT_SECONDS, REVEAL_MAX, SUN_DIR, type Reveal } from "./cityHelpers";
import { RealCity } from "./RealCity";
import { colorOf, loadSave, persistSave, tuningOf, type PatternId, type SaveData } from "./save";
import { Shop } from "./Shop";
import {
  CELL_BLOCK,
  createSim,
  findShopSite,
  findSpawn,
  inputFromHeld,
  makeCoins,
  PLANE_HEIGHT,
  sample,
  shopsInWorld,
  step,
  TILE_H,
  TILE_W,
  TILES,
  WORLD_H,
  WORLD_W,
  type Coin,
  type ControlsProbe,
  type Shop as ShopSpot,
  type ShopSite,
  type SimState,
  type Spawn,
} from "./sim";

const BASE = import.meta.env.BASE_URL;
const RUG_URL = `${BASE}city-rug.png`;
const MASK_URL = `${BASE}road-mask.bin`;
/** Real City assets are only fetched the first time the player asks for them. */
const REAL_GROUND_URL = `${BASE}real/ground.jpg`;
const REAL_MASK_URL = `${BASE}real/road-mask-real.bin`;

/** Put your track at public/assets/night-city.mp3 — it plays while night mode is on. */
const MUSIC_URL = `${BASE}assets/night-city.mp3`;

const DAY_BG = new THREE.Color("#2a241e");
const NIGHT_BG = new THREE.Color("#070912");
const WHITE = new THREE.Color("#ffffff");
const MOON = new THREE.Color("#7787cc");
const DAY_SKY = new THREE.Color("#fff6ea");
const NIGHT_SKY = new THREE.Color("#33417f");
const DAY_GROUND = new THREE.Color("#6d5b48");
const NIGHT_GROUND = new THREE.Color("#10131f");
const SUN_WARM = new THREE.Color("#ffe9c4");
/** Fog matches the horizon colour of the Real City sky dome. */
const FOG_DAY = new THREE.Color("#c7def2");
const FOG_NIGHT = new THREE.Color("#121733");

const DRIVE_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", "Space"];

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type AudioNodes = { ctx: AudioContext; osc: OscillatorNode; gain: GainNode };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

async function loadRealAssets(): Promise<{ texture: THREE.Texture; mask: Uint8Array }> {
  const [texture, mask] = await Promise.all([
    new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(
        REAL_GROUND_URL,
        (next) => {
          next.colorSpace = THREE.SRGBColorSpace;
          next.anisotropy = 8;
          // Same mirroring as the rug, so roads and the collision mask line up.
          next.wrapS = THREE.MirroredRepeatWrapping;
          next.wrapT = THREE.MirroredRepeatWrapping;
          next.repeat.set(TILES, TILES);
          next.needsUpdate = true;
          resolve(next);
        },
        undefined,
        () => reject(new Error("real ground")),
      );
    }),
    fetch(REAL_MASK_URL)
      .then((res) => {
        if (!res.ok) throw new Error("real mask");
        return res.arrayBuffer();
      })
      .then((buf) => new Uint8Array(buf)),
  ]);
  return { texture, mask };
}

function PaintedCar({
  wheels,
  tex,
  base,
  accent,
  plain,
}: {
  wheels: React.MutableRefObject<Array<THREE.Group | null>>;
  tex: PaintTextures;
  base: string;
  accent: string;
  plain: boolean;
}) {
  const emissive = useMemo(() => new THREE.Color(base).multiplyScalar(0.22), [base]);
  const setWheel = (index: number) => (node: THREE.Group | null) => {
    wheels.current[index] = node;
  };
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[0.26, 20]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.32} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.09, 0]} castShadow>
        <boxGeometry args={[0.3, 0.1, 0.66]} />
        <meshStandardMaterial map={tex.body} emissive={emissive} roughness={0.4} metalness={0.18} />
      </mesh>
      <mesh position={[0, 0.175, 0.05]} castShadow>
        <boxGeometry args={[0.26, 0.09, 0.28]} />
        <meshStandardMaterial map={tex.cabin} color="#e2e2e2" roughness={0.45} metalness={0.12} />
      </mesh>
      <mesh position={[0, 0.2, -0.08]}>
        <boxGeometry args={[0.22, 0.07, 0.06]} />
        <meshStandardMaterial color="#163044" metalness={0.55} roughness={0.18} />
      </mesh>
      <mesh position={[0, 0.195, 0.18]}>
        <boxGeometry args={[0.2, 0.06, 0.04]} />
        <meshStandardMaterial color="#163044" metalness={0.45} roughness={0.2} />
      </mesh>
      {plain ? (
        <mesh position={[0, 0.23, 0.05]}>
          <boxGeometry args={[0.08, 0.012, 0.3]} />
          <meshStandardMaterial color={accent} roughness={0.5} />
        </mesh>
      ) : null}
      {[-0.1, 0.1].map((x) => (
        <mesh key={`t${x}`} position={[x, 0.1, 0.33]}>
          <boxGeometry args={[0.07, 0.035, 0.02]} />
          <meshStandardMaterial color="#ff3b30" emissive="#ff2a22" emissiveIntensity={0.7} />
        </mesh>
      ))}
      {[-0.1, 0.1].map((x) => (
        <mesh key={`h${x}`} position={[x, 0.09, -0.33]}>
          <boxGeometry args={[0.06, 0.04, 0.02]} />
          <meshStandardMaterial color="#fff4cc" emissive="#ffe7a3" emissiveIntensity={0.85} />
        </mesh>
      ))}
      {[
        [-0.155, -0.2, 0],
        [0.155, -0.2, 1],
        [-0.155, 0.2, 2],
        [0.155, 0.2, 3],
      ].map(([x, z, index]) => (
        <group key={index} ref={setWheel(index ?? 0)} position={[x ?? 0, 0.05, z ?? 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 0.04, 14]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.75} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.026, 0.026, 0.046, 10]} />
            <meshStandardMaterial color="#d9d3c8" metalness={0.65} roughness={0.28} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** The plane wears the same paint as the car. Its nose points down -z like the car's. */
function PlaneModel({
  propRef,
  tex,
  base,
  accent,
}: {
  propRef: React.MutableRefObject<THREE.Group | null>;
  tex: PaintTextures;
  base: string;
  accent: string;
}) {
  const emissive = useMemo(() => new THREE.Color(base).multiplyScalar(0.22), [base]);
  return (
    <group>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.17, 0.17, 0.86]} />
        <meshStandardMaterial map={tex.body} emissive={emissive} roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.2, -0.5]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.085, 0.14, 14]} />
        <meshStandardMaterial color={accent} roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.3, -0.08]}>
        <boxGeometry args={[0.12, 0.07, 0.22]} />
        <meshStandardMaterial color="#163044" metalness={0.55} roughness={0.18} />
      </mesh>
      <mesh position={[0, 0.2, -0.04]}>
        <boxGeometry args={[1.1, 0.03, 0.26]} />
        <meshStandardMaterial color={base} emissive={emissive} roughness={0.45} metalness={0.15} />
      </mesh>
      {[-0.49, 0.49].map((x) => (
        <mesh key={`tip${x}`} position={[x, 0.2, -0.04]}>
          <boxGeometry args={[0.12, 0.034, 0.26]} />
          <meshStandardMaterial color={accent} roughness={0.45} />
        </mesh>
      ))}
      <mesh position={[0, 0.22, 0.38]}>
        <boxGeometry args={[0.42, 0.025, 0.14]} />
        <meshStandardMaterial color={base} emissive={emissive} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.3, 0.38]}>
        <boxGeometry args={[0.025, 0.17, 0.15]} />
        <meshStandardMaterial color={accent} roughness={0.45} />
      </mesh>
      {[-0.1, 0.1].map((x) => (
        <mesh key={`nav${x}`} position={[x * 5.2, 0.2, -0.04]}>
          <boxGeometry args={[0.03, 0.04, 0.04]} />
          <meshStandardMaterial
            color={x < 0 ? "#ff3b30" : "#34d058"}
            emissive={x < 0 ? "#ff2a22" : "#22c04a"}
            emissiveIntensity={0.9}
          />
        </mesh>
      ))}
      <group ref={propRef} position={[0, 0.2, -0.58]}>
        <mesh>
          <boxGeometry args={[0.5, 0.035, 0.025]} />
          <meshStandardMaterial color="#222222" roughness={0.6} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.035, 0.5, 0.025]} />
          <meshStandardMaterial color="#222222" roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

function shopSignTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#d6453d";
    g.fillRect(0, 0, 256, 96);
    g.strokeStyle = "#fff6ea";
    g.lineWidth = 6;
    g.strokeRect(5, 5, 246, 86);
    g.fillStyle = "#fff6ea";
    g.font = "bold 60px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("SHOP", 128, 52);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A little garage on the grass beside the road, plus a glowing pad to drive onto. */
function ShopBuildings({ shops }: { shops: ShopSpot[] }) {
  const sign = useMemo(() => shopSignTexture(), []);
  const pads = useRef<Array<THREE.Group | null>>([]);
  useEffect(() => () => sign.dispose(), [sign]);
  useFrame((state) => {
    const pulse = 1 + 0.08 * Math.sin(state.clock.elapsedTime * 3);
    for (const pad of pads.current) pad?.scale.set(pulse, 1, pulse);
  });
  return (
    <>
      {shops.map((shop, i) => (
        <group key={i}>
          <group position={[shop.bx, 0, shop.bz]} rotation={[0, shop.rot, 0]}>
            <mesh position={[0, 0.17, 0]}>
              <boxGeometry args={[0.62, 0.34, 0.5]} />
              <meshStandardMaterial color="#efe3c8" roughness={0.8} />
            </mesh>
            <mesh position={[0, 0.365, 0]}>
              <boxGeometry args={[0.7, 0.05, 0.58]} />
              <meshStandardMaterial color="#8a3b32" roughness={0.7} />
            </mesh>
            {[-0.24, -0.08, 0.08, 0.24].map((x, k) => (
              <mesh key={x} position={[x, 0.28, 0.34]} rotation={[0.45, 0, 0]}>
                <boxGeometry args={[0.16, 0.025, 0.2]} />
                <meshStandardMaterial color={k % 2 === 0 ? "#d6453d" : "#fff6ea"} roughness={0.7} />
              </mesh>
            ))}
            <mesh position={[0.17, 0.1, 0.256]}>
              <boxGeometry args={[0.13, 0.2, 0.012]} />
              <meshStandardMaterial color="#5b3a24" roughness={0.8} />
            </mesh>
            <mesh position={[-0.12, 0.17, 0.256]}>
              <boxGeometry args={[0.24, 0.13, 0.012]} />
              <meshStandardMaterial color="#9fd0ff" emissive="#ffd9a0" emissiveIntensity={0.5} />
            </mesh>
            <mesh position={[0, 0.5, 0.05]}>
              <planeGeometry args={[0.46, 0.17]} />
              <meshBasicMaterial map={sign} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
          </group>
          <group
            ref={(node) => {
              pads.current[i] = node;
            }}
            position={[shop.padX, 0, shop.padZ]}
          >
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
              <ringGeometry args={[0.24, 0.31, 36]} />
              <meshBasicMaterial color="#ffd54a" transparent opacity={0.95} depthWrite={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]}>
              <circleGeometry args={[0.24, 36]} />
              <meshBasicMaterial color="#ffd54a" transparent opacity={0.28} depthWrite={false} />
            </mesh>
            <mesh position={[0, 0.7, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 1.4, 8]} />
              <meshBasicMaterial color="#ffd54a" transparent opacity={0.3} depthWrite={false} />
            </mesh>
          </group>
        </group>
      ))}
    </>
  );
}

/** Coins lying on the road. Yellow = 1, blue gem = 5. They come back after a while. */
function CoinField({
  coins,
  simRef,
  pausedRef,
  onCoin,
}: {
  coins: Coin[];
  simRef: React.MutableRefObject<SimState>;
  pausedRef: React.MutableRefObject<boolean>;
  onCoin: (value: number) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const respawn = useMemo(() => new Float32Array(coins.length), [coins]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const coin = new THREE.Color("#ffcf33");
    const gem = new THREE.Color("#3ec5ff");
    coins.forEach((c, i) => m.setColorAt(i, c.value > 1 ? gem : coin));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [coins]);

  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    const sim = simRef.current;
    const reach = sim.alt > 0.5 ? 0.5 : 0.3;
    const active = sim.started && !pausedRef.current;
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i]!;
      let alive = (respawn[i] ?? 0) <= t;
      if (alive && active && Math.hypot(sim.x - c.x, sim.z - c.z) < reach) {
        respawn[i] = t + 45;
        alive = false;
        onCoin(c.value);
      }
      const size = alive ? (c.value > 1 ? 1.3 : 1) : 0.0001;
      dummy.position.set(c.x, 0.15 + Math.sin(t * 2.2 + i) * 0.02, c.z);
      dummy.rotation.set(0, t * 2.5 + i, Math.PI / 2);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, coins.length]} frustumCulled={false}>
      <cylinderGeometry args={[0.085, 0.085, 0.022, 20]} />
      <meshStandardMaterial color="#ffffff" emissive="#7a5a00" emissiveIntensity={0.55} metalness={0.5} roughness={0.3} />
    </instancedMesh>
  );
}

function Rug({
  texture,
  materialRef,
}: {
  texture: THREE.Texture;
  materialRef: React.MutableRefObject<THREE.MeshLambertMaterial | null>;
}) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[WORLD_W, WORLD_H]} />
      {/* Day: the photo is shown flat through the emissive channel (same look as an unlit
          material). Night: the emissive fades out and the real lights, headlights included,
          reveal the rug instead. */}
      <meshLambertMaterial
        ref={materialRef}
        map={texture}
        emissiveMap={texture}
        emissive="#ffffff"
        color="#000000"
        toneMapped={false}
      />
    </mesh>
  );
}

function World({
  texture,
  maskRef,
  simRef,
  keysRef,
  injectedRef,
  mutedRef,
  nightRef,
  audioRef,
  dotRef,
  onHud,
  shops,
  coins,
  pausedRef,
  onEnterShop,
  onCoin,
  paintBase,
  paintAccent,
  pattern,
  realRef,
  revealRef,
  realTexture,
}: {
  realRef: React.MutableRefObject<boolean>;
  revealRef: React.MutableRefObject<Reveal>;
  realTexture: THREE.Texture | null;
  shops: ShopSpot[];
  coins: Coin[];
  pausedRef: React.MutableRefObject<boolean>;
  onEnterShop: () => void;
  onCoin: (value: number) => void;
  paintBase: string;
  paintAccent: string;
  pattern: PatternId;
  texture: THREE.Texture;
  maskRef: React.MutableRefObject<Uint8Array | null>;
  simRef: React.MutableRefObject<SimState>;
  keysRef: React.MutableRefObject<Set<string>>;
  injectedRef: React.MutableRefObject<Set<string>>;
  mutedRef: React.MutableRefObject<boolean>;
  nightRef: React.MutableRefObject<boolean>;
  audioRef: React.MutableRefObject<AudioNodes | null>;
  dotRef: React.MutableRefObject<HTMLDivElement | null>;
  onHud: (speed: number, distance: number, nitro: number, boosting: boolean) => void;
}) {
  const yawGroup = useRef<THREE.Group>(null);
  const leanGroup = useRef<THREE.Group>(null);
  const carGroup = useRef<THREE.Group>(null);
  const planeGroup = useRef<THREE.Group>(null);
  const planeLean = useRef<THREE.Group>(null);
  const propRef = useRef<THREE.Group | null>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const shadowMat = useRef<THREE.MeshBasicMaterial>(null);
  const armed = useRef(true);
  const tex = useMemo(() => makePaintTextures(paintBase, paintAccent, pattern), [paintBase, paintAccent, pattern]);
  useEffect(() => () => tex.dispose(), [tex]);
  const ring = useRef<THREE.Mesh>(null);
  const wheels = useRef<Array<THREE.Group | null>>([null, null, null, null]);
  const look = useRef(new THREE.Vector3());
  const held = useRef(new Set<string>());
  const hudT = useRef(0);
  const nightLevel = useRef(0);
  const bg = useRef<THREE.Color>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const headlights = useRef<THREE.SpotLight>(null);
  const headlightTarget = useRef<THREE.Object3D>(null);
  const glow = useRef<THREE.PointLight>(null);
  const rugMat = useRef<THREE.MeshLambertMaterial | null>(null);
  const fog = useRef<THREE.Fog>(null);
  const sunTarget = useRef<THREE.Object3D>(null);
  const realProg = useRef(0);
  const lastReal = useRef(false);
  const { camera, gl } = useThree();

  // The sun's shadow box follows the car, so a small box is enough.
  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    if (sunTarget.current) light.target = sunTarget.current;
    const cam = light.shadow.camera;
    cam.left = -9;
    cam.right = 9;
    cam.top = 9;
    cam.bottom = -9;
    cam.near = 1;
    cam.far = 50;
    cam.updateProjectionMatrix();
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.bias = -0.0006;
    light.shadow.normalBias = 0.03;
  }, []);

  useEffect(() => {
    if (headlights.current && headlightTarget.current) {
      headlights.current.target = headlightTarget.current;
    }
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();

    const aim = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(plane, hit)) {
        const limitX = WORLD_W / 2 - 0.15;
        const limitZ = WORLD_H / 2 - 0.15;
        simRef.current.pointerX = Math.max(-limitX, Math.min(limitX, hit.x));
        simRef.current.pointerZ = Math.max(-limitZ, Math.min(limitZ, hit.z));
      }
    };

    const down = (event: PointerEvent) => {
      if (!simRef.current.started || event.button !== 0 || pausedRef.current) return;
      el.setPointerCapture(event.pointerId);
      simRef.current.dragging = true;
      aim(event);
      el.closest(".play-root")?.classList.add("is-dragging");
    };
    const move = (event: PointerEvent) => {
      if (!simRef.current.dragging) return;
      aim(event);
    };
    const up = () => {
      simRef.current.dragging = false;
      el.closest(".play-root")?.classList.remove("is-dragging");
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [camera, gl, simRef, pausedRef]);

  useFrame((state, delta) => {
    const sim = simRef.current;
    const mask = maskRef.current;
    const dt = Math.min(delta, 0.1);

    // Fade between day and night.
    const nightTarget = nightRef.current ? 1 : 0;
    nightLevel.current += (nightTarget - nightLevel.current) * (1 - Math.exp(-3 * dt));
    if (Math.abs(nightTarget - nightLevel.current) < 0.002) nightLevel.current = nightTarget;
    const n = nightLevel.current;

    // Real City reveal: a wave spreads out from where the car was when the button was pressed.
    // Buildings and trees rise as it passes; turning it off collapses the wave back to the car.
    const reveal = revealRef.current;
    const wantReal = realRef.current;
    if (wantReal !== lastReal.current) {
      lastReal.current = wantReal;
      reveal.cx = sim.x;
      reveal.cz = sim.z;
    }
    realProg.current = Math.min(
      1,
      Math.max(0, realProg.current + (wantReal ? dt / REAL_IN_SECONDS : -dt / REAL_OUT_SECONDS)),
    );
    const prog = realProg.current;
    reveal.radius = prog * prog * (3 - 2 * prog) * REVEAL_MAX;
    reveal.level = smooth(0.04, 0.8, prog);
    reveal.night = n;
    const lv = reveal.level;

    bg.current?.lerpColors(DAY_BG, NIGHT_BG, n);
    if (fog.current) {
      fog.current.near = lerp(1000, 10, lv);
      fog.current.far = lerp(2000, 62, lv);
      fog.current.color.lerpColors(FOG_DAY, FOG_NIGHT, n);
    }
    if (ambient.current) {
      ambient.current.intensity = (0.55 - 0.25 * n) * (1 - 0.45 * lv);
      ambient.current.color.lerpColors(WHITE, MOON, n);
    }
    if (hemi.current) {
      hemi.current.intensity = (0.55 - 0.4 * n) * (1 + 0.1 * lv);
      hemi.current.color.lerpColors(DAY_SKY, NIGHT_SKY, n);
      hemi.current.groundColor.lerpColors(DAY_GROUND, NIGHT_GROUND, n);
    }
    if (sun.current) {
      sun.current.intensity = 1.25 - 0.95 * n + lv * (1.1 - 1.0 * n);
      sun.current.color.lerpColors(WHITE, MOON, n);
      if (lv > 0) sun.current.color.lerp(SUN_WARM, 0.5 * lv * (1 - n));
      // Keep the light direction fixed but let the light (and its shadow box) travel with the car.
      sun.current.position.set(sim.x + SUN_DIR[0] * 24, SUN_DIR[1] * 24, sim.z + SUN_DIR[2] * 24);
      sunTarget.current?.position.set(sim.x, 0, sim.z);
      const casts = lv > 0.01;
      if (sun.current.castShadow !== casts) sun.current.castShadow = casts;
    }
    if (headlights.current) headlights.current.intensity = 18 * n;
    if (glow.current) glow.current.intensity = 0.5 * n;
    const mat = rugMat.current;
    if (mat) {
      mat.color.setScalar(n);
      mat.emissiveIntensity = 1 - 0.94 * n;
      mat.emissive.setRGB(1 - 0.45 * n, 1 - 0.4 * n, 1 - 0.1 * n);
    }

    const paused = pausedRef.current;
    if (sim.started && mask && !paused) {
      held.current.clear();
      for (const code of keysRef.current) held.current.add(code);
      for (const code of injectedRef.current) held.current.add(code);
      const pointer = sim.dragging ? { x: sim.pointerX, z: sim.pointerZ } : null;
      const input = inputFromHeld(held.current, sim.steerOverride, pointer);
      step(sim, mask, input, dt);
    }

    // Driving onto a shop pad opens the shop. You have to leave the pad before it re-arms.
    if (sim.started && !paused && !sim.wantPlane && sim.alt < 0.02) {
      let nearest = Infinity;
      for (const shop of shops) {
        const d = Math.hypot(shop.padX - sim.x, shop.padZ - sim.z);
        if (d < nearest) nearest = d;
      }
      if (nearest < 0.34 && armed.current) {
        armed.current = false;
        sim.speed = 0;
        sim.dragging = false;
        onEnterShop();
      } else if (nearest > 0.75) {
        armed.current = true;
      }
    }

    // Car <-> plane transformation, driven by altitude.
    const fly = smooth(0, 0.12, sim.alt);
    if (carGroup.current) {
      carGroup.current.visible = fly < 0.99;
      carGroup.current.scale.setScalar(Math.max(0.0001, 1 - fly));
    }
    if (planeGroup.current) {
      planeGroup.current.visible = fly > 0.01;
      planeGroup.current.scale.setScalar(Math.max(0.0001, fly));
    }
    if (planeLean.current) {
      planeLean.current.rotation.z = -sim.face * 0.65;
      planeLean.current.rotation.x = sim.wantPlane ? 0.28 * (1 - sim.alt) : 0;
    }
    if (propRef.current) propRef.current.rotation.z = sim.wheel * 2.2;
    if (shadow.current && shadowMat.current) {
      shadow.current.visible = fly > 0.02;
      shadow.current.position.set(sim.x, 0.018, sim.z);
      shadow.current.rotation.set(-Math.PI / 2, 0, sim.yaw);
      shadow.current.scale.set(0.55 + 0.1 * (1 - sim.alt), 0.85, 1);
      shadowMat.current.opacity = 0.3 * fly;
    }
    if (headlightTarget.current) headlightTarget.current.position.set(0, -sim.alt * PLANE_HEIGHT, -2.6);

    if (yawGroup.current) {
      yawGroup.current.position.set(sim.x, sim.alt * PLANE_HEIGHT, sim.z);
      yawGroup.current.rotation.y = sim.yaw;
    }
    if (leanGroup.current) {
      leanGroup.current.rotation.z = -sim.face * 0.08;
    }
    for (let i = 0; i < wheels.current.length; i++) {
      const wheel = wheels.current[i];
      if (!wheel) continue;
      wheel.rotation.x = sim.wheel;
      wheel.rotation.y = i < 2 ? sim.face * 0.4 : 0;
    }
    if (ring.current) {
      ring.current.visible = sim.started && sim.dragging;
      ring.current.position.set(sim.pointerX, 0.025, sim.pointerZ);
    }

    if (!sim.started) {
      const t = state.clock.elapsedTime;
      camera.position.set(Math.sin(t * 0.12) * 0.4, 9.2, 7.4);
      camera.lookAt(0, 0, 0.15);
    } else if (paused) {
      // In the shop: slowly orbit the car so you can see the new paint.
      const t = state.clock.elapsedTime;
      const a = sim.yaw + Math.PI * 0.8 + t * 0.35;
      const r = 1.4;
      const k = 1 - Math.exp(-5 * dt);
      camera.position.x += (sim.x + Math.sin(a) * r - camera.position.x) * k;
      camera.position.y += (0.8 - camera.position.y) * k;
      camera.position.z += (sim.z + Math.cos(a) * r - camera.position.z) * k;
      // Nudge the car out from behind the shop panel (right side on desktop, bottom on phones).
      const wide = window.innerWidth > 820;
      const dx = sim.x - camera.position.x;
      const dz = sim.z - camera.position.z;
      const len = Math.hypot(dx, dz) || 1;
      const shift = wide ? 0.32 : 0;
      look.current.set(sim.x + (-dz / len) * shift, wide ? 0.12 : -0.22, sim.z + (dx / len) * shift);
      camera.lookAt(look.current);
    } else {
      const a = sim.alt;
      const fx = -Math.sin(sim.yaw);
      const fz = -Math.cos(sim.yaw);
      // Real City: sit lower and look further ahead so the horizon and the sky come into view.
      const rl = lv * (1 - a);
      const back = 2.7 - 1.0 * a + 0.5 * rl;
      const height = 2.35 + 5.6 * a - 0.75 * rl;
      const ahead = 0.9 + 0.9 * a + 1.5 * rl;
      const destX = sim.x - fx * back + (Math.random() - 0.5) * sim.shake * 0.06;
      const destY = height + (Math.random() - 0.5) * sim.shake * 0.04;
      const destZ = sim.z - fz * back;
      const k = 1 - Math.exp(-(4.4 + 2.6 * a) * dt);
      camera.position.x += (destX - camera.position.x) * k;
      camera.position.y += (destY - camera.position.y) * k;
      camera.position.z += (destZ - camera.position.z) * k;
      look.current.set(sim.x + fx * ahead, 0.16 * (1 - a) + 0.5 * rl, sim.z + fz * ahead);
      camera.lookAt(look.current);
    }

    const audio = audioRef.current;
    if (audio && sim.started) {
      const pace = Math.abs(sim.speed);
      audio.osc.frequency.value = 54 + pace * 40;
      audio.gain.gain.value = mutedRef.current ? 0 : Math.min(0.04, 0.005 + pace * 0.013);
    }

    const dot = dotRef.current;
    if (dot) {
      // Minimap shows the rug tile the car is currently on (mirrored like the world).
      const u = sim.x / TILE_W + 0.5;
      const v = sim.z / TILE_H + 0.5;
      const tu = Math.floor(u);
      const tv = Math.floor(v);
      const flipX = (tu & 1) === 1;
      const flipZ = (tv & 1) === 1;
      const fu = flipX ? 1 - (u - tu) : u - tu;
      const fv = flipZ ? 1 - (v - tv) : v - tv;
      const hx = -Math.sin(sim.yaw) * (flipX ? -1 : 1);
      const hz = -Math.cos(sim.yaw) * (flipZ ? -1 : 1);
      dot.style.left = `${fu * 100}%`;
      dot.style.top = `${fv * 100}%`;
      dot.style.transform = `translate(-50%, -60%) rotate(${Math.atan2(hx, -hz)}rad)`;
    }

    hudT.current += dt;
    if (hudT.current > 0.12) {
      hudT.current = 0;
      onHud(sim.speed, sim.distance, sim.nitro, sim.boosting);
    }
  });

  return (
    <>
      <color ref={bg} attach="background" args={["#2a241e"]} />
      {/* Starts so far away that it changes nothing; Real City pulls it in. */}
      <fog ref={fog} attach="fog" args={["#c7def2", 1000, 2000]} />
      <hemisphereLight ref={hemi} args={["#fff6ea", "#6d5b48", 0.55]} />
      <ambientLight ref={ambient} intensity={0.55} />
      <directionalLight ref={sun} position={[5, 9, 4]} intensity={1.25} />
      <object3D ref={sunTarget} />
      <Rug texture={texture} materialRef={rugMat} />
      {realTexture ? <RealCity groundTexture={realTexture} revealRef={revealRef} /> : null}
      <ShopBuildings shops={shops} />
      <CoinField coins={coins} simRef={simRef} pausedRef={pausedRef} onCoin={onCoin} />
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <circleGeometry args={[0.5, 24]} />
        <meshBasicMaterial ref={shadowMat} color="#000000" transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.1, 0.16, 24]} />
        <meshBasicMaterial color="#d6453d" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <group ref={yawGroup}>
        <group ref={carGroup}>
          <group ref={leanGroup}>
            <PaintedCar
              wheels={wheels}
              tex={tex}
              base={paintBase}
              accent={paintAccent}
              plain={pattern === "none"}
            />
          </group>
        </group>
        <group ref={planeGroup} visible={false}>
          <group ref={planeLean}>
            <PlaneModel propRef={propRef} tex={tex} base={paintBase} accent={paintAccent} />
          </group>
        </group>
        <spotLight
          ref={headlights}
          position={[0, 0.45, -0.3]}
          angle={0.75}
          penumbra={0.9}
          intensity={0}
          distance={8}
          decay={2}
          color="#fff1c9"
        />
        <object3D ref={headlightTarget} position={[0, 0, -2.6]} />
        <pointLight ref={glow} position={[0, 0.5, 0]} intensity={0} distance={3} decay={2} color="#ffd9a0" />
      </group>
    </>
  );
}

function holdProps(keys: Set<string>, code: string) {
  return {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      keys.add(code);
    },
    onPointerUp: () => keys.delete(code),
    onPointerCancel: () => keys.delete(code),
  };
}

export function CityDrive() {
  const simRef = useRef<SimState>(createSim());
  const maskRef = useRef<Uint8Array | null>(null);
  const keysRef = useRef(new Set<string>());
  const injectedRef = useRef(new Set<string>());
  const spawnRef = useRef<Spawn | null>(null);
  const mutedRef = useRef(false);
  const nightRef = useRef(false);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = useRef<AudioNodes | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [night, setNight] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [best, setBest] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveData>(loadSave);
  const [shops, setShops] = useState<ShopSpot[]>([]);
  const [shopSite, setShopSite] = useState<ShopSite | null>(null);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [shopOpen, setShopOpen] = useState(false);
  const [flying, setFlying] = useState(false);
  const [nitro, setNitro] = useState(1);
  const [boosting, setBoosting] = useState(false);
  const [coinBump, setCoinBump] = useState(0);
  const shopOpenRef = useRef(false);
  const baseMaskRef = useRef<Uint8Array | null>(null);
  const realAssetsRef = useRef<{ texture: THREE.Texture; mask: Uint8Array } | null>(null);
  const realRef = useRef(false);
  const revealRef = useRef<Reveal>(createReveal());
  const [real, setReal] = useState(false);
  const [realLoading, setRealLoading] = useState(false);
  const [realFailed, setRealFailed] = useState(false);
  const [realTexture, setRealTexture] = useState<THREE.Texture | null>(null);
  const [realMask, setRealMask] = useState<Uint8Array | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Save progress and push the shop upgrades into the physics.
  useEffect(() => {
    persistSave(save);
    const tune = tuningOf(save);
    const sim = simRef.current;
    sim.topMul = tune.topMul;
    sim.accelMul = tune.accelMul;
    if (tune.nitroLevel > sim.nitroLevel) sim.nitro = 1;
    sim.nitroLevel = tune.nitroLevel;
  }, [save]);

  useEffect(() => {
    const stored = Number(localStorage.getItem("rug-city-best-m") ?? "0");
    if (Number.isFinite(stored) && stored > 0) setBest(stored);
  }, []);

  useEffect(() => {
    let dead = false;
    const loader = new THREE.TextureLoader();
    let tex: THREE.Texture | null = null;
    loader.load(
      RUG_URL,
      (next) => {
        next.colorSpace = THREE.SRGBColorSpace;
        next.anisotropy = 8;
        // The one rug tile repeats across the whole world, mirrored at each edge
        // so roads line up with the mirrored mask in sim.ts.
        next.wrapS = THREE.MirroredRepeatWrapping;
        next.wrapT = THREE.MirroredRepeatWrapping;
        next.repeat.set(TILES, TILES);
        next.needsUpdate = true;
        tex = next;
        if (!dead) setTexture(next);
      },
      undefined,
      () => {
        if (!dead) setLoadError("The rug photo did not load.");
      },
    );
    fetch(MASK_URL)
      .then((res) => {
        if (!res.ok) throw new Error("mask");
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (dead) return;
        const mask = new Uint8Array(buf);
        baseMaskRef.current = mask;
        maskRef.current = mask;
        const spawn = findSpawn(mask);
        spawnRef.current = spawn;
        simRef.current.x = spawn.x;
        simRef.current.z = spawn.z;
        simRef.current.yaw = spawn.yaw;
        const site = findShopSite(mask, spawn);
        const shopList = site ? shopsInWorld(site) : [];
        setShopSite(site);
        setShops(shopList);
        setCoins(
          makeCoins(mask, 320, [
            { x: spawn.x, z: spawn.z },
            ...shopList.map((shop) => ({ x: shop.padX, z: shop.padZ })),
          ]),
        );
        setReady(true);
      })
      .catch(() => {
        if (!dead) setLoadError("The street map did not load.");
      });
    return () => {
      dead = true;
      tex?.dispose();
    };
  }, []);

  useEffect(() => {
    const keys = keysRef.current;
    const down = (event: KeyboardEvent) => {
      if (DRIVE_KEYS.includes(event.code)) event.preventDefault();
      keys.add(event.code);
      if (event.code === "KeyF" && !event.repeat) togglePlane();
    };
    const up = (event: KeyboardEvent) => {
      // Stops Space from "clicking" whichever HUD button was last focused.
      if (DRIVE_KEYS.includes(event.code)) event.preventDefault();
      keys.delete(event.code);
    };
    const blur = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    const probe: ControlsProbe = {
      getYaw: () => simRef.current.yaw,
      getSpeed: () => simRef.current.speed,
      setSteer: (v: number) => {
        simRef.current.steerOverride = Math.max(-1, Math.min(1, v));
      },
      setKeys: (codes: string[]) => {
        injectedRef.current = new Set(codes);
      },
    };
    window.__controlsTest = probe;
    return () => {
      if (window.__controlsTest === probe) delete window.__controlsTest;
    };
  }, []);

  useEffect(() => {
    return () => {
      musicRef.current?.pause();
      musicRef.current = null;
      realAssetsRef.current?.texture.dispose();
    };
  }, []);

  // Coins that would sit inside a building or tree trunk are hidden while Real City is on.
  const visibleCoins = useMemo(
    () => (real && realMask ? coins.filter((c) => sample(realMask, c.x, c.z) !== CELL_BLOCK) : coins),
    [real, realMask, coins],
  );

  useEffect(() => {
    if (!started) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "triangle";
    osc.frequency.value = 60;
    gain.gain.value = 0.0001;
    filter.type = "lowpass";
    filter.frequency.value = 480;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    void ctx.resume();
    audioRef.current = { ctx, osc, gain };
    const onVis = () => {
      if (document.visibilityState === "visible") void ctx.resume();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      osc.stop();
      void ctx.close();
      audioRef.current = null;
    };
  }, [started]);

  function togglePlane() {
    const sim = simRef.current;
    if (!sim.started || shopOpenRef.current) return;
    sim.wantPlane = !sim.wantPlane;
    setFlying(sim.wantPlane);
  }

  const openShop = () => {
    shopOpenRef.current = true;
    setShopOpen(true);
  };

  const closeShop = () => {
    shopOpenRef.current = false;
    setShopOpen(false);
  };

  const onCoin = (value: number) => {
    setSave((prev) => ({ ...prev, coins: prev.coins + value }));
    setCoinBump((n) => n + 1);
    const audio = audioRef.current;
    if (!audio || mutedRef.current) return;
    const { ctx } = audio;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const f = value > 1 ? 988 : 784;
    osc.type = "square";
    osc.frequency.setValueAtTime(f, ctx.currentTime);
    osc.frequency.setValueAtTime(f * 1.5, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.045, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
  };

  const onHud = (nextSpeed: number, nextDistance: number, nextNitro: number, nextBoosting: boolean) => {
    setSpeed(nextSpeed);
    setDistance(nextDistance);
    setNitro(nextNitro);
    setBoosting(nextBoosting);
    const meters = Math.round(nextDistance * 8);
    setBest((prev) => {
      if (meters <= prev) return prev;
      localStorage.setItem("rug-city-best-m", String(meters));
      return meters;
    });
  };

  const begin = () => {
    simRef.current.started = true;
    setStarted(true);
  };

  const reset = () => {
    const spawn = spawnRef.current;
    const sim = simRef.current;
    if (!spawn) return;
    sim.x = spawn.x;
    sim.z = spawn.z;
    sim.yaw = spawn.yaw;
    sim.speed = 0;
    sim.face = 0;
    sim.wheel = 0;
    sim.distance = 0;
    sim.shake = 0;
    sim.alt = 0;
    sim.wantPlane = false;
    sim.airborne = false;
    setFlying(false);
    setSpeed(0);
    setDistance(0);
  };

  const toggleMute = () => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (musicRef.current) musicRef.current.muted = mutedRef.current;
  };

  const toggleReal = async () => {
    if (realLoading) return;
    const next = !realRef.current;
    const sim = simRef.current;
    if (next) {
      if (!realAssetsRef.current) {
        setRealLoading(true);
        try {
          realAssetsRef.current = await loadRealAssets();
        } catch {
          setRealLoading(false);
          setRealFailed(true);
          return;
        }
        setRealTexture(realAssetsRef.current.texture);
        setRealLoading(false);
      }
      const assets = realAssetsRef.current;
      setRealMask(assets.mask);
      maskRef.current = assets.mask;
      // A building or tree may now stand where the car is: move the car to the nearest open road.
      if (sim.alt < 0.05) {
        const open = nearestOpen(assets.mask, sim.x, sim.z);
        if (open && (open.x !== sim.x || open.z !== sim.z)) {
          sim.x = open.x;
          sim.z = open.z;
          sim.speed = 0;
        }
      }
    } else {
      maskRef.current = baseMaskRef.current;
    }
    realRef.current = next;
    setReal(next);
  };

  const toggleNight = () => {
    const next = !nightRef.current;
    nightRef.current = next;
    setNight(next);
    if (next) {
      if (!musicRef.current) {
        const music = new Audio(MUSIC_URL);
        music.loop = true;
        music.volume = 0.5;
        musicRef.current = music;
      }
      musicRef.current.muted = mutedRef.current;
      // Starts from the button press, so browsers allow it. A missing file just stays silent.
      musicRef.current.play().catch(() => {});
    } else {
      musicRef.current?.pause();
    }
  };

  const paint = colorOf(save);
  const pace = Math.round(Math.abs(speed) * 32);
  const meters = Math.round(distance * 8);
  const keys = keysRef.current;

  return (
    <main className="play-root" data-night={night}>
      {mounted && texture ? (
        <Canvas
          dpr={[1, 1.6]}
          camera={{ fov: 40, position: [0, 9.2, 7.4], near: 0.05, far: 150 }}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            gl.shadowMap.enabled = true;
            gl.shadowMap.type = THREE.PCFShadowMap;
          }}
        >
          <World
            texture={texture}
            maskRef={maskRef}
            simRef={simRef}
            keysRef={keysRef}
            injectedRef={injectedRef}
            mutedRef={mutedRef}
            nightRef={nightRef}
            audioRef={audioRef}
            dotRef={dotRef}
            onHud={onHud}
            shops={shops}
            coins={visibleCoins}
            realRef={realRef}
            revealRef={revealRef}
            realTexture={realTexture}
            pausedRef={shopOpenRef}
            onEnterShop={openShop}
            onCoin={onCoin}
            paintBase={paint.hex}
            paintAccent={paint.accent}
            pattern={save.pattern}
          />
        </Canvas>
      ) : mounted ? (
        <Canvas
          dpr={[1, 1.5]}
          camera={{ fov: 40, position: [0, 9.2, 7.4], near: 0.05, far: 80 }}
          gl={{ antialias: true }}
        >
          <color attach="background" args={["#2a241e"]} />
        </Canvas>
      ) : null}

      {started ? (
        <div className="hud">
          <div className="hud-top">
            <div className="stat-row">
              <div className="stat">
                <span>Speed</span>
                <strong>{pace}</strong>
              </div>
              <div className="stat">
                <span>Drive</span>
                <strong>{meters} m</strong>
              </div>
              <div className="stat">
                <span>Best</span>
                <strong>{best} m</strong>
              </div>
              <div className="stat stat-coins" key={coinBump} data-bump={coinBump > 0}>
                <span>Coins</span>
                <strong>
                  <Coins size={15} /> {save.coins}
                </strong>
              </div>
            </div>
            <div className="minimap" aria-hidden="true">
              <img src={RUG_URL} alt="" draggable={false} />
              {shopSite ? (
                <div
                  className="minimap-shop"
                  style={{
                    left: `${(shopSite.padX / TILE_W + 0.5) * 100}%`,
                    top: `${(shopSite.padZ / TILE_H + 0.5) * 100}%`,
                  }}
                />
              ) : null}
              <div className="minimap-dot" ref={dotRef} />
            </div>
          </div>
          <div className="hud-bottom">
            <div className="cluster">
              <p className="hint hint-desktop">
                Drag or use arrows/WASD. F = plane, Shift = nitro. Drive onto a gold ring to shop.
              </p>
              {save.nitro > 0 ? (
                <div className="nitro-bar" data-boosting={boosting} aria-label="Nitro tank">
                  <Zap size={14} />
                  <span>
                    <i style={{ width: `${Math.round(nitro * 100)}%` }} />
                  </span>
                </div>
              ) : null}
              <div className="stat-row">
                <button type="button" className="icon-btn" onClick={reset} aria-label="Reset car">
                  <RotateCcw size={18} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute sound" : "Mute sound"}
                >
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={togglePlane}
                  aria-label={flying ? "Land and drive" : "Switch to plane"}
                  aria-pressed={flying}
                >
                  {flying ? <Car size={18} /> : <Plane size={18} />}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={toggleNight}
                  aria-label={night ? "Switch to day" : "Switch to night"}
                  aria-pressed={night}
                >
                  {night ? <Sun size={18} /> : <Moon size={18} />}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void toggleReal()}
                  disabled={realLoading}
                  aria-label={real ? "Back to the rug" : "Real City"}
                  aria-pressed={real}
                  aria-busy={realLoading}
                  title={realFailed ? "Real City did not load" : real ? "Back to the rug" : "Real City"}
                >
                  <Building2 size={18} />
                </button>
              </div>
            </div>
            <div className="dpad" aria-label="Drive controls">
              <button type="button" className="up" aria-label="Accelerate" {...holdProps(keys, "ArrowUp")}>
                <ChevronUp size={22} />
              </button>
              <button type="button" className="left" aria-label="Steer left" {...holdProps(keys, "ArrowLeft")}>
                <ChevronLeft size={22} />
              </button>
              <button type="button" className="down" aria-label="Brake or reverse" {...holdProps(keys, "ArrowDown")}>
                <ChevronDown size={22} />
              </button>
              <button type="button" className="right" aria-label="Steer right" {...holdProps(keys, "ArrowRight")}>
                <ChevronRight size={22} />
              </button>
              {save.nitro > 0 ? (
                <button type="button" className="boost" aria-label="Nitro" {...holdProps(keys, "ShiftLeft")}>
                  <Zap size={22} />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {!started ? (
        <div className="start-layer">
          <div className="start-card">
            <p className="eyebrow">Play rug</p>
            <h1>Rug City</h1>
            <p className="lede">
              A little car on your city rug. Drag along the gray streets, or drive with the arrow keys.
              Collect coins, then drive onto a gold ring to enter a shop. Press F to turn into a plane.
            </p>
            <div className="keys" aria-label="Arrow keys">
              <kbd>Up</kbd>
              <kbd>Down</kbd>
              <kbd>Left</kbd>
              <kbd>Right</kbd>
              <kbd>F plane</kbd>
              <kbd>Shift nitro</kbd>
            </div>
            <div className="start-actions">
              <button type="button" className="btn btn-primary" onClick={begin} disabled={!ready || !texture}>
                {loadError ? "Could not load" : ready && texture ? "Start" : "Preparing"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={toggleNight} aria-pressed={night}>
                {night ? <Sun size={16} /> : <Moon size={16} />}
                {night ? "Day" : "Night"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void toggleReal()}
                disabled={realLoading || !ready}
                aria-pressed={real}
              >
                <Building2 size={16} />
                {realLoading ? "Loading" : realFailed ? "Real city unavailable" : real ? "Rug" : "Real city"}
              </button>
            </div>
            {loadError ? <p className="lede">{loadError}</p> : null}
          </div>
        </div>
      ) : null}

      {shopOpen ? <Shop save={save} onChange={setSave} onClose={closeShop} /> : null}
    </main>
  );
}
