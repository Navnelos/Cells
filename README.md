# Cells

A generative tool for one illustration: a foam of large dark cells, hair-thin lime strands with
fanned junction webs, and a ring of micro-foam (lime, green, blue, white lace) inside a lobed outline.

## How it's made

The picture is drawn on the GPU, per pixel, so colour and line changes are instant.

- **Outline:** a smooth union of circles you can edit (**Edit shape** or E).
- **Structure:** a density field decides where the foam is calm (large cavities), transitional
  (medium cells) or intricate (foam). A few hundred weighted seeds are placed accordingly and
  relaxed, and they form one shared partition, so neighbouring cells share their walls.
- **Cavities and webs:** wall distances are combined with a smooth minimum, which rounds every
  junction the same way. The fan webs at the junctions are iso-lines of that same field.
- **Foam:** foam cells are filled with a micro partition at two scales, coloured per micro-cell
  by smooth colour fields (lime, green, blue, white lace).
- **Export:** PNG or JPEG, rendered on the GPU at up to 8192 px.

**Keys:** R gives a new seed, E toggles shape editing, ⌘Z / ⇧⌘Z undo and redo. Export to SVG, PNG or JPEG.

## Develop

```
npm install
npm run dev
```

Vite + React + Tailwind v4 + shadcn/ui, with a Canvas 2D renderer that also writes the SVG.
The engine is in `src/lib`: `geometry.ts`, `render.ts`, `engine.ts` and `params.ts`.
