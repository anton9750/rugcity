# Real City - progress

Done:
- tools/gen_city.py : generates the realistic ground, collision mask and placement data
- public/real/ground.jpg, public/real/road-mask-real.bin, src/game/cityData.ts : generated assets
- src/game/cityHelpers.ts : tile mirroring helpers, reveal state, car relocation (pure, no three.js)
- src/game/RealCity.tsx : 3D buildings, trees, lamp posts, sky dome, real ground, rise shader
- src/game/CityDrive.tsx : Real City button (HUD + start card), lazy loading of the real assets,
  collision mask swap, car moved off any building, lighting / fog / shadow / camera blending

Not verified yet (written without being able to run npm install or the browser):
- run `npm install`, `npm run typecheck`, `npm run dev` and look at it
- tune FLOOR_H, tree size (R = radius * 1.7), fog distances and light intensities in RealCity.tsx / CityDrive.tsx
