# Cells

A generative tool for one illustration: a foam of large dark cells, hair-thin lime strands with
fanned junction webs, and a ring of micro-foam (lime, green, blue, white lace) inside a lobed outline.

## How it's made

Everything is exact vector geometry. Nothing is traced from a grid, so edges stay smooth at any size.

- **Outline:** a smooth union of circles. Edit them on the canvas with **Edit shape** (or the E key):
  drag inside a circle to move it, drag its edge to resize, double-click to add one, right-click to
  remove one.
- **Cells:** a power diagram (a weighted Voronoi diagram with exactly computed walls) of seeds placed
  by Poisson darts and relaxed with Lloyd's algorithm. Giant bubbles are seeds with a large weight,
  and cells get smaller toward the edge. Each wall bows into the smaller of its two cells.
- **Strands:** every hole is its cell inset by half the wall, with corners rounded by circular-arc
  Béziers. The junction webs repeat that construction at smaller insets and fillets, so the fine
  lines converge on the walls and fan out at the corners. Strands brighten toward the centre.
- **Foam:** variable-radius circle packing inside the filled cells, coloured by a domain-warped patch
  mosaic. Cells that reach the outline are always filled. **Flat colour** mode replaces the bubbles
  with solid fills.

**Keys:** R gives a new seed, E toggles shape editing, ⌘Z / ⇧⌘Z undo and redo. Export to SVG, PNG or JPEG.

## Develop

```
npm install
npm run dev
```

Vite + React + Tailwind v4 + shadcn/ui, with a Canvas 2D renderer that also writes the SVG.
The engine is in `src/lib`: `geometry.ts`, `render.ts`, `engine.ts` and `params.ts`.
