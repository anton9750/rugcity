# Rug City

Drive a small red car along the roads of a city play rug (React + three.js via react-three-fiber).
The rug is tiled 5×5 and mirrored at every edge, so the roads connect into one big map.

## Shop, coins, boosters and the plane

- **Coins** lie on the roads all over the rug (yellow = 1, blue gem = 5). They respawn after about 45 seconds. Your coins and everything you buy are saved in the browser.
- **Shops** are the little garages with a gold ring on the road (yellow dot on the minimap). Drive onto the ring to go in. Leave the ring and come back to enter again.
- In the shop you can buy and switch **colors** (red, green, blue, orange, black, white), **patterns** (racing stripes, checkered, polka dots, zigzag, candy stripes) and **boosters**:
  - **Engine**: higher top speed (3 levels).
  - **Turbo**: faster acceleration (3 levels).
  - **Nitro**: hold `Shift` / `Space` (or the lightning button on touch screens) for a burst of speed. Bigger tank with each level.
- **Plane**: press `F` (or the plane button) to take off and fly over the city, looking down from above. Press it again to land back on the nearest road. The plane wears your car's paint and can collect coins too. You cannot enter shops while flying.

The catalog and prices live in `src/game/save.ts`, so they are easy to change.

## Night mode

The moon/sun button (on the start card and in the HUD) switches the city to night: everything goes dark, the car gets headlights, and music plays.

Put your track at `public/assets/night-city.mp3`. If the file is missing, night mode still works, just silently.

## Real City

The building button (HUD, and on the start card) turns the flat rug into a 3D city. A wave spreads out from the car: the realistic ground appears, and buildings and trees rise out of it. You get a sky with clouds (stars at night), fog, sun shadows that follow the car, lit windows and glowing lamp posts at night. Press it again and the wave collapses back to the car.

- Collisions use `public/real/road-mask-real.bin`, so buildings and tree trunks block the car. If one appears on top of the car, the car is moved to the nearest open road.
- The real assets load only the first time you press the button.
- `tools/gen_city.py` regenerates the ground, mask and `src/game/cityData.ts`; the 3D part lives in `src/game/RealCity.tsx`.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (http://localhost:5173).

## Deploy to GitHub Pages

1. Push this repo to GitHub on the `main` branch.
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml` and publishes the site.

The Vite `base` is relative (`./`), so it works under `https://<user>.github.io/<repo>/` with no config.
