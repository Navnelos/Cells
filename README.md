# Cells

A generative tool for cellular foam illustrations: rounded holes in a lobed shape, yellow walls,
a patchwork border band of greens, limes and blues. The default reproduces the reference image;
every part of it can be tweaked, rotated in 3D and exported.

## How it's made

Everything is computed. No images are traced.

1. **Outline** is a smooth union of circles (metaballs). The default lobes were fitted to the
   reference outline by least squares (93% overlap). Other options: random lobes, a superformula
   (Gielis 2003) or a circle.
2. **Cells** start as Poisson-disk seeds (or clusters, a honeycomb, or a sunflower spiral), then go
   through Lloyd relaxation. That's the k-means step: each cell moves to the centre of its area.
3. **Walls** come from a multiplicatively weighted Voronoi diagram. Its walls are circular arcs, so
   big cells push into small ones like soap bubbles. Each hole is its cell shrunk by half the wall,
   with corners filleted by a smooth minimum. Other hole shapes: Worley's F2 − F1 cellular basis
   (SIGGRAPH 1996), sharp polygons, or inscribed circles.
4. **Border band** is a noisy offset of the outline. Holes are cut back from it with a smooth maximum.
5. **Patches** are a second, domain-warped Voronoi with Perlin noise, coloured from five weighted
   colours. They show on the band and on cells left filled.
6. Every field is sampled on a grid and traced with marching squares, so the output is vector.
   The same paths drive the canvas, the PNG/JPEG export and the SVG export.

## Use

- **Drag** to rotate in 3D, **shift-drag** to spin flat, **double-click** to return to flat,
  **scroll** to zoom.
- **R** gives a new seed and **Space** toggles auto-rotation. **⌘Z / ⇧⌘Z** undo and redo.
- **3D tab:** camera angles, slab thickness, see-through holes, perspective.
- **Export tab:** SVG / PNG / JPEG in social formats, copy/paste recipes, and saved presets.

## Develop

```
npm install
npm run dev
```

Vite + React + Tailwind v4 + shadcn/ui, with a plain Canvas 2D renderer. The engine lives in
`src/lib`: `geometry.ts` (all the maths), `render.ts` (camera, canvas and SVG), `engine.ts` (loop,
input, export) and `params.ts` (defaults).
