# Cells

A generative tool for one illustration: a foam of large dark cells, hair-thin lime strands with
fanned junction webs, and a ring of micro-foam (lime, green, blue, white lace) inside a lobed outline.

## How it's made

- **Outline:** a smooth union of circles. Edit them on the canvas with **Edit shape** (or E).
- **Bubbles:** circle packing. Bubbles of very mixed sizes are placed by a size field (large
  cavities inside, shrinking to fine foam toward the edge, with nested clusters between), then
  inflated until they press against their neighbours. Each bubble is round and flattens only
  where it touches another, so the gaps at the junctions are small concave triangles.
- **Strands and webs:** each large bubble is outlined by a thin strand. The web lines are the same
  bubble grown step by step into the gaps around it, so they fan out at the junctions.
- **Foam:** small bubbles are drawn as coloured walls with dark holes (lime, green, blue), medium
  ones partly as white lace. **Flat colour** mode fills them solid.

**Keys:** R gives a new seed, E toggles shape editing, ⌘Z / ⇧⌘Z undo and redo. Export to SVG, PNG or JPEG.

## Develop

```
npm install
npm run dev
```

Vite + React + Tailwind v4 + shadcn/ui, with a Canvas 2D renderer that also writes the SVG.
The engine is in `src/lib`: `geometry.ts`, `render.ts`, `engine.ts` and `params.ts`.
