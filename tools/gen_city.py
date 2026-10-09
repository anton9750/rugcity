#!/usr/bin/env python3
"""
Rug City -> Real City asset generator.

Reads  public/city-rug.png + public/road-mask.bin
Writes public/real/ground.jpg          (photoreal-ish ground: asphalt, paint, curbs, sidewalks, lawns)
       public/real/road-mask-real.bin  (same grid as road-mask.bin, with buildings + tree trunks blocked)
       src/game/cityData.ts            (building / tree / lamp placement, in tile-local world units)

Run from the repo root:   python3 tools/gen_city.py
Needs: numpy, scipy, pillow.  The generated files are committed, so you only re-run this if you
change the rug, the mask, or the building list below.
"""
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUG = os.path.join(ROOT, "public", "city-rug.png")
MASK = os.path.join(ROOT, "public", "road-mask.bin")
OUT_DIR = os.path.join(ROOT, "public", "real")
OUT_TS = os.path.join(ROOT, "src", "game", "cityData.ts")

W, H = 1080, 720  # rug pixels
GW, GH = 360, 240  # mask grid
TILE_W = 16.0
TILE_H = TILE_W * GH / GW
PX = TILE_W / W  # world units per rug pixel
OUT_SCALE = 3  # ground texture is 3x the rug (3240 x 2160)

rng = np.random.default_rng(20261010)

# ---------------------------------------------------------------------------------------------
# Hand-placed building footprints, in rug pixels.  kind picks the 3D style in realCity.tsx.
#   (name, cx, cy, w, d, angle_deg, floors, kind, palette)
# Boxes that touch a tile edge are axis-aligned and end exactly on the edge: the rug is mirrored
# there, so the mirrored copy continues the building into one big mirrored block.
# ---------------------------------------------------------------------------------------------
BUILDINGS = [
    ("hospital", 632, 278, 300, 140, 8, 5, "hospital", 0),
    ("fire", 95, 358, 170, 100, 0, 2, "station", 1),
    ("post", 318, 408, 140, 100, -4, 2, "house", 2),
    ("house", 100, 578, 125, 100, 0, 2, "house", 3),
    ("townhall", 382, 625, 165, 115, 0, 3, "townhall", 4),
    ("store", 972, 543, 216, 192, 0, 4, "store", 5),
    ("shop", 1005, 285, 150, 100, 0, 3, "shop", 6),
    ("garage", 752, 675, 170, 90, 0, 4, "garage", 7),
]


def to_world(px, py):
    return (px / W - 0.5) * TILE_W, (py / H - 0.5) * TILE_H


def rect_corners(cx, cy, w, d, ang):
    r = math.radians(ang)
    c, s = math.cos(r), math.sin(r)
    out = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x, y = sx * w / 2, sy * d / 2
        out.append((cx + x * c - y * s, cy + x * s + y * c))
    return out


def poly_mask(shape, pts, grow=0.0):
    """Boolean mask of a convex polygon (pts in pixel coords of `shape`), grown by `grow` px."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    xx = xx + 0.5
    yy = yy + 0.5
    inside = np.ones(shape, dtype=bool)
    n = len(pts)
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        ex, ey = x2 - x1, y2 - y1
        ln = math.hypot(ex, ey) or 1.0
        nx, ny = ey / ln, -ex / ln
        if (cx - x1) * nx + (cy - y1) * ny > 0:
            nx, ny = -nx, -ny
        dist = (xx - x1) * nx + (yy - y1) * ny  # >0 = outside this edge
        inside &= dist <= grow
    return inside


def noise(h, w, scale, seed):
    """Smooth value noise, 0..1, feature size ~scale px."""
    r = np.random.default_rng(seed)
    gh, gw = int(math.ceil(h / scale)) + 3, int(math.ceil(w / scale)) + 3
    base = r.random((gh, gw)).astype(np.float32)
    big = ndi.zoom(base, scale, order=3)
    off = scale  # skip the border so the cubic spline edge does not show
    return np.clip(big[off : off + h, off : off + w], 0, 1)


def fbm(h, w, scales, seed, weights=None):
    out = np.zeros((h, w), np.float32)
    tot = 0.0
    for i, s in enumerate(scales):
        wgt = 1.0 if weights is None else weights[i]
        out += wgt * noise(h, w, s, seed + i * 17)
        tot += wgt
    return out / tot


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    rug = np.asarray(Image.open(RUG).convert("RGB")).astype(np.int32)
    mask = np.fromfile(MASK, dtype=np.uint8).reshape(GH, GW)
    R, G, B = rug[..., 0], rug[..., 1], rug[..., 2]
    lum = R * 0.3 + G * 0.59 + B * 0.11
    mx = np.maximum(np.maximum(R, G), B)
    mn = np.minimum(np.minimum(R, G), B)
    sat = (mx - mn) / np.maximum(mx, 1)

    # ---- building footprints in pixels -------------------------------------------------------
    polys = []
    for name, cx, cy, w, d, ang, floors, kind, pal in BUILDINGS:
        polys.append(rect_corners(cx, cy, w, d, ang))
    bld_mask = np.zeros((H, W), bool)
    lot_mask = np.zeros((H, W), bool)
    for p in polys:
        bld_mask |= poly_mask((H, W), p, 0)
        lot_mask |= poly_mask((H, W), p, 16)

    # ---- trees: dark teal blobs on the rug ---------------------------------------------------
    tree = (G >= R + 4) & (G >= B - 10) & (lum < 100) & (R < 95)
    tree = ndi.binary_opening(tree, structure=np.ones((3, 3)), iterations=2)
    tree = ndi.binary_opening(tree, structure=np.ones((3, 3)), iterations=5)  # drop thin outlines
    tree &= ~poly_mask((H, W), [(0, 0), (W, 0), (W, 0), (0, 0)], 0) | True
    tree &= ~lot_mask
    dist = ndi.distance_transform_edt(tree)
    peaks = []
    work = dist.copy()
    while True:
        y, x = np.unravel_index(np.argmax(work), work.shape)
        v = work[y, x]
        if v < 7:
            break
        peaks.append((x, y, v))
        yy, xx = np.ogrid[0:H, 0:W]
        work[(xx - x) ** 2 + (yy - y) ** 2 < (v * 0.9) ** 2] = 0
    trees = []
    for x, y, v in peaks:
        r_world = max(0.2, min(0.62, v * PX * 1.15))
        wx, wz = to_world(x, y)
        trees.append((wx, wz, r_world, int(rng.integers(0, 3))))
    print("trees", len(trees))

    # ---- classes ----------------------------------------------------------------------------
    grass = (G > R + 16) & (G > B + 22) & (lum > 85)
    grass = ndi.binary_closing(grass, iterations=2)
    grass = ndi.binary_opening(grass, iterations=1)
    treeground = ndi.binary_dilation(tree, iterations=3)
    grass_like = grass | treeground
    path = (R > 165) & (G > 120) & (B < 130) & ((R - B) > 65) & ~bld_mask
    path = ndi.binary_opening(path, iterations=1)
    # dark rug outlines that hug a gravel path belong to the park, not to the road
    near_path = ndi.binary_dilation(path, iterations=7)
    grass_like = grass_like | path | (near_path & (lum < 125) & ~bld_mask)
    grass_like = ndi.binary_closing(grass_like, iterations=2)
    # fill small holes (tree canopies, flowers) so they do not get their own kerb ring
    holes, nh = ndi.label(~grass_like)
    hs = ndi.sum(np.ones_like(holes), holes, range(1, nh + 1))
    for i, a in enumerate(hs):
        if a < 1800:
            grass_like[holes == i + 1] = True
    paint = (lum > 160) & (sat < 0.22) & ~bld_mask & ~grass_like

    # distance (rug px) from the grass edge, measured inside the grass and outside it
    d_in = ndi.distance_transform_edt(grass_like)  # inside grass: distance to nearest non-grass
    d_out = ndi.distance_transform_edt(~grass_like)  # outside grass: distance to grass

    # ---- real-mode collision mask ------------------------------------------------------------
    real = mask.copy()
    cell = W / GW
    gy, gx = np.mgrid[0:GH, 0:GW]
    cxp = (gx + 0.5) * cell
    cyp = (gy + 0.5) * cell
    for p in polys:
        pm = poly_mask((GH, GW), [(x / cell, y / cell) for x, y in p], 1.0)
        real[pm] = 0
    for wx, wz, r, _ in trees:
        px_ = (wx / TILE_W + 0.5) * W
        py_ = (wz / TILE_H + 0.5) * H
        rr = max(3.5, r * 0.22 / PX)
        real[((cxp - px_) ** 2 + (cyp - py_) ** 2) < rr * rr] = 0
    real.tofile(os.path.join(OUT_DIR, "road-mask-real.bin"))

    # ---- ground texture ----------------------------------------------------------------------
    S = OUT_SCALE
    HH, WW = H * S, W * S

    def up(a, order=1):
        return ndi.zoom(a.astype(np.float32), S, order=order)

    def soft(a, sigma=1.1):
        return np.clip(ndi.gaussian_filter(a.astype(np.float32), sigma), 0, 1)

    m_grass = up(soft(grass_like))
    m_tree = up(soft(treeground, 2.0))
    m_path = up(soft(path))
    m_paint = up(soft(paint, 0.8))
    m_lot = up(soft(lot_mask, 1.5))
    m_bld = up(soft(bld_mask, 1.0))
    d_in_u = up(d_in)
    d_out_u = up(d_out)

    n_big = fbm(HH, WW, [400, 160, 70], 11)
    n_mid = fbm(HH, WW, [30, 14], 41)
    n_fine = noise(HH, WW, 2, 71)
    n_speck = (rng.random((HH, WW)).astype(np.float32) - 0.5)

    # asphalt
    asph = np.empty((HH, WW, 3), np.float32)
    base = np.array([86, 87, 92], np.float32)
    k = 0.80 + 0.30 * n_big + 0.12 * (n_mid - 0.5) + 0.06 * (n_fine - 0.5)
    k += 0.10 * n_speck
    for c in range(3):
        asph[..., c] = base[c] * k
    # worn driving lines + darker patches
    wear = noise(HH, WW, 90, 5)
    asph *= (0.93 + 0.14 * wear)[..., None]

    # grass
    gr = np.empty((HH, WW, 3), np.float32)
    gk = fbm(HH, WW, [220, 80, 26, 9], 91, [1, 1, 0.8, 0.6])
    lo = np.array([44, 82, 28], np.float32)
    hi = np.array([96, 134, 52], np.float32)
    for c in range(3):
        gr[..., c] = lo[c] + (hi[c] - lo[c]) * gk
    blade = noise(HH, WW, 2, 33)
    gr *= (0.88 + 0.26 * blade + 0.08 * n_speck)[..., None]
    mow = 0.5 + 0.5 * np.sin(np.arange(WW, dtype=np.float32) / 26.0)
    gr *= (0.95 + 0.06 * mow)[None, :, None]

    # shade under trees
    tr_col = np.array([38, 62, 26], np.float32)
    gr = gr * (1 - 0.55 * m_tree[..., None]) + tr_col * (0.55 * m_tree[..., None]) * (0.8 + 0.4 * n_mid[..., None])

    # sidewalk + curb (inside the grass edge, next to asphalt)
    curb_w = 2.2 * S
    walk_w = 7.0 * S
    in_s = d_in_u * 1.0  # already in rug px; scale to output px below
    in_px = in_s * S
    walk = np.empty((HH, WW, 3), np.float32)
    wk = 0.85 + 0.20 * fbm(HH, WW, [60, 20], 7) + 0.05 * n_speck
    for c, v in enumerate((176, 173, 166)):
        walk[..., c] = v * wk
    # paving slabs: thin darker joints
    jx = np.abs(((np.arange(WW) % (16 * S)) - 8 * S)) > (8 * S - 1.2)
    jy = np.abs(((np.arange(HH) % (16 * S)) - 8 * S)) > (8 * S - 1.2)
    joints = (jy[:, None] | jx[None, :]).astype(np.float32)
    walk *= (1 - 0.09 * joints)[..., None]
    curb_col = np.array([205, 203, 196], np.float32)
    is_walk = ((in_px > 0) & (in_px < walk_w)).astype(np.float32)
    is_curb = ((in_px > 0) & (in_px < curb_w)).astype(np.float32)
    # inner edge of sidewalk blends into lawn
    walk_a = soft(is_walk, 1.0 * S) * m_grass
    curb_a = soft(is_curb, 0.7 * S) * m_grass
    gr = gr * (1 - walk_a[..., None]) + walk * walk_a[..., None]
    gr = gr * (1 - curb_a[..., None]) + curb_col * curb_a[..., None]

    # contact shadow of the curb on the asphalt
    shade = np.clip(1 - d_out_u * S / (5.0 * S) * 0.0 - 0.0, 0, 1)
    out_px = d_out_u * S
    asph *= (1 - 0.30 * np.clip(1 - out_px / (6.0 * S), 0, 1) * (1 - m_grass))[..., None]

    # yellow path -> gravel
    gv = np.empty((HH, WW, 3), np.float32)
    gvk = 0.82 + 0.26 * n_mid + 0.20 * n_speck
    for c, v in enumerate((184, 166, 128)):
        gv[..., c] = v * gvk

    # building lots: plaza concrete
    lot = np.empty((HH, WW, 3), np.float32)
    lk = 0.86 + 0.18 * fbm(HH, WW, [90, 30], 13) + 0.06 * n_speck
    for c, v in enumerate((158, 156, 150)):
        lot[..., c] = v * lk
    lot *= (1 - 0.13 * joints)[..., None]
    foot = np.array([66, 66, 68], np.float32)

    # paint: crisp, slightly worn white
    paint_col = np.array([228, 228, 222], np.float32)
    wearp = 0.72 + 0.28 * noise(HH, WW, 6, 19) + 0.08 * n_speck
    paint_a = np.clip(m_paint * 1.25 - 0.1, 0, 1) * np.clip(wearp, 0, 1)

    # compose: asphalt -> grass -> gravel -> lots -> paint
    img = asph * (1 - m_grass[..., None]) + gr * m_grass[..., None]
    img = img * (1 - m_path[..., None]) + gv * m_path[..., None]
    img = img * (1 - m_lot[..., None]) + lot * m_lot[..., None]
    img = img * (1 - m_bld[..., None]) + foot * m_bld[..., None]
    paint_a = paint_a * (1 - m_lot) * (1 - m_grass)
    img = img * (1 - paint_a[..., None]) + paint_col * paint_a[..., None]

    # soft vignette-free exposure tweak and write
    img = np.clip(img, 0, 255).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(OUT_DIR, "ground.jpg"), quality=86, optimize=True, subsampling=0)
    print("ground.jpg", img.shape)

    # ---- lamp posts: along the sidewalk edge, arm pointing at the road -----------------------
    gy_, gx_ = np.gradient(d_out)  # points away from grass (towards road)
    cand = np.argwhere((d_in > 3.5) & (d_in < 6) & grass_like & ~lot_mask)
    rng.shuffle(cand)
    lamps = []
    min_d = 100.0
    for y, x in cand:
        if y < 6 or x < 6 or y > H - 7 or x > W - 7:
            continue
        ok = True
        for lx, ly, _ in lamps:
            if (lx - x) ** 2 + (ly - y) ** 2 < min_d * min_d:
                ok = False
                break
        if not ok:
            continue
        # direction towards the nearest road pixel
        sub = d_in[max(0, y - 2) : y + 3, max(0, x - 2) : x + 3]
        gyv, gxv = np.gradient(d_in)
        dx, dy = -gxv[y, x], -gyv[y, x]
        ln = math.hypot(dx, dy)
        if ln < 1e-3:
            continue
        lamps.append((x, y, math.atan2(dy, dx)))
    lamp_out = []
    for x, y, a in lamps:
        wx, wz = to_world(x, y)
        lamp_out.append((wx, wz, a))
    print("lamps", len(lamp_out))

    # ---- write TypeScript data ---------------------------------------------------------------
    def f(v, n=3):
        return f"{v:.{n}f}"

    lines = []
    lines.append("// GENERATED by tools/gen_city.py - do not edit by hand.")
    lines.append("// Tile-local world units (x: -8..8, z: -5.33..5.33), same frame as the rug.")
    lines.append("")
    lines.append("/** [cx, cz, width, depth, rotation (rad, around Y), floors, kind, palette] */")
    lines.append("export type BuildingRow = [number, number, number, number, number, number, string, number];")
    lines.append("export const BUILDING_ROWS: BuildingRow[] = [")
    for name, cx, cy, w, d, ang, floors, kind, pal in BUILDINGS:
        wx, wz = to_world(cx, cy)
        lines.append(
            f"  [{f(wx)}, {f(wz)}, {f(w * PX)}, {f(d * PX)}, {f(-math.radians(ang), 4)}, {floors}, \"{kind}\", {pal}], // {name}"
        )
    lines.append("];")
    lines.append("")
    lines.append("/** [x, z, canopy radius, species 0..2] */")
    lines.append("export type TreeRow = [number, number, number, number];")
    lines.append("export const TREE_ROWS: TreeRow[] = [")
    for wx, wz, r, k in trees:
        lines.append(f"  [{f(wx)}, {f(wz)}, {f(r, 2)}, {k}],")
    lines.append("];")
    lines.append("")
    lines.append("/** [x, z, angle (rad) the arm points to, in the XZ plane] */")
    lines.append("export type LampRow = [number, number, number];")
    lines.append("export const LAMP_ROWS: LampRow[] = [")
    for wx, wz, a in lamp_out:
        lines.append(f"  [{f(wx)}, {f(wz)}, {f(a, 3)}],")
    lines.append("];")
    lines.append("")
    with open(OUT_TS, "w") as fh:
        fh.write("\n".join(lines))
    print("wrote", OUT_TS)


if __name__ == "__main__":
    sys.exit(main())
