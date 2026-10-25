# Cozy Room — first-person 3D bedroom

A single room, rebuilt in JavaScript from the isometric reference art: cyan walls,
staggered plank floor, a tall window behind the bed, the little side window with
curtains and a split air-conditioner, three posters, a quilted bed with a mint
throw, a nightstand with a cactus, a snake plant, and a desk with a lamp and
drawer unit.

It runs in the browser with three.js and no build step — every texture is painted
procedurally at load, so there are no asset files.

## Run it

ES modules need to be served over HTTP:

```bash
node serve.js            # → http://localhost:5173
```

Then open <http://localhost:5173>. (Any static server works: `npx serve`,
`python -m http.server`, etc.)

## Controls

| key | action |
| --- | --- |
| `W A S D` | walk |
| mouse | look (click to lock the pointer, `Esc` to release) |
| `Shift` | run |
| `C` | crouch |
| `E` | interact with whatever you are looking at |
| `L` | desk lamp on / off |
| `T` | switch style — cute cel shading ⇄ realistic PBR |
| `N` | switch light — golden hour ⇄ daylight |
| `M` | mute |
| `R` | reset to the starting spot |

## What is in the room

Everything from the reference render, matched in placement and colour:

- **Shell** — ice-blue walls (`#C7E4F2`), pale plaster ceiling, wood plank floor
  (planks running along Z with staggered butt joints, in the reference's four
  beige tones), real window openings cut through the wall slabs.
- **Window wall** — the tall white grid window with pale glass, pleated white
  curtains on a rod with rings, and the wall-mounted split AC with its grille,
  indicator light, drain pipe and cable.
- **Back wall** — pink / blue / green posters, the fine-grid closet panel, the two
  little yellow diamonds, and the floor-to-nearly-ceiling window with a 2×4 pane
  grid, a sill and a slim exterior ledge + railing outside.
- **Bed** — grey-blue headboard with the shelf slot and two timber cubbies, white
  mattress, blue striped duvet, turned-back sheet, floral + pink + striped
  pillows, and the mint throw folded over the foot and onto the floor.
- **Nightstand** — drawers, knob, terracotta pot with a flowering cactus, tissue
  box, and the little yellow gift cube with a pink ribbon.
- **Plants** — the snake plant in the mauve glazed pot, and the desk sprig.
- **Desk** — light top on timber legs, side panel, two-drawer unit with knobs, the
  open book, the book stack, the green pen cup with pencils, the gooseneck lamp
  that actually lights the room, and the cable running down the wall.
- **Stool**, **yellow rug**, the two dropped books on the floor near the desk.

The door sits on the front wall — the one wall the cutaway reference never showed.

## How the look is made

`src/postfx.js` is a hand-written render pipeline:

1. render view-space normals + depth (`layer 0`) into a target
2. render the beauty pass into a half-float target
3. bright pass → two levels of separable blur → soft bloom
4. composite: 2×2 supersampled downsample, screen-space ambient occlusion
   (9 taps), cel shading (banded luminance with soft edges and pastel
   shadow/highlight tints), Robert's-cross depth + normal outline, bloom, ACES
   tone map, vignette, grain, sRGB encode

Pressing `T` bypasses the pipeline and renders straight to the screen with ACES
tone mapping and PCF shadows — the plain "realistic" render of the same room.

Other bits worth a look:

- `src/textures.js` — canvas-painted wood, plaster, fabric, knit, rug, posters,
  cactus skin, leaves, and the sky, plus normal maps derived from height fields.
- `src/fx.js` — per-pane light shafts that fade against the scene depth so they
  dissolve where they land, and drifting dust motes.
- `src/materials.js` — the palette sampled off the reference, plus a seamless
  banded-fabric shader used for the duvet stripes (no UV seams).
- Shadow maps are static: they re-render only when the curtains or the light
  preset change.
