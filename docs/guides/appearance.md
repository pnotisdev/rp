# Looks and appearance

Settings, Appearance changes how Hakoniwa looks, from one click to every detail. All of it is stored in your browser and works offline.

## Looks

A **Look** is a whole design: colours (light and dark), typefaces, corner roundness, backdrop, glass and chat style. Click one and everything switches, including light or dark mode if the look was designed for one. Anything you change afterwards sticks, and the gallery stops marking the look as active.

| Look | Feel |
| --- | --- |
| Ember | The default. Warm dark, one orange flame. |
| Hanami | Cherry-blossom light, rounded type, soft aurora, bubbles. |
| Shibuya Night | Neon on midnight, sharp edges, a faint grid. |
| Phosphor | Green-screen terminal: all monospace, scanlines. |
| Scriptorium | Parchment and ink, book serif, document layout, paper grain. |
| Aurora Glass | Frosted translucent panels over a polar sky. |
| Velvet Curtain | Burgundy and gold, elegant serif, grain. |
| Moss Garden | Quiet greens and rounded type. |

Press Ctrl/Cmd-K and type `look` (or a look's name) to switch from anywhere, or `dark` / `light` to flip the mode.

## Fine controls

- **Type:** one typeface each for the interface, story text and names. Choices are bundled or system fonts (Inter, System, Rounded, Book serif, Elegant serif, Typewriter, Monospace). Story text size scales from 85% to 140%.
- **Shape and atmosphere:** Roundness (0 to 20px, applies to every card, button and field), Backdrop (None, Aurora, Grid, Grain, Scanlines) and Glass panels, which make surfaces translucent so the backdrop shows through.
- **Colour palettes:** colours only, leaving type and shape alone. Pick a palette, or **make your own from one colour**: choose a hue and how colourful it should be, or press **Surprise me**. Generated palettes keep text readable in both modes.
- **Colors:** every individual colour, per mode. **Chat style**, **Avatar style** and **Layout** (width, font scale, blur) are below it.
- **Custom CSS** is still there for anything else.

## Saving and sharing

**Save / share theme** exports your colours, type, shape, atmosphere, chat style and CSS as JSON (or keeps them in the library). Importing applies everything, ignoring values it does not understand.

## For extension and theme authors

The interface reads CSS variables you can use in custom CSS: `--c-bg`, `--c-accent` and the other `--c-*` colour triplets, `--radius`, `--font-ui`, `--font-read`, `--font-display` and `--read-scale`. The root element carries `data-backdrop` and `data-glass`. Extension panels receive the same colour variables and follow light and dark mode live.

## The name

Hakoniwa (箱庭) is a miniature garden in a tray: a small world you build, tend and watch. The name lives in one file, `src/lib/brand.json`; change it there and the app, its prompts and its messages follow (the docs are plain text and need a find and replace).
