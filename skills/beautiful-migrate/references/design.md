# Matching the look

The human wants their site to look like theirs, working better. Aim for the same brand,
layout, colors, type and imagery, with clean code, a layout that works on phones, and fast
pages. Promise "the same site, rebuilt", never pixel-perfect.

## Look first

Open the old homepage and one page of each template at desktop and phone widths (your
browser, `capture --browser`, or a screenshot tool). Note:

- the colors: background, text, accent and button colors (read them from the old page's CSS
  when you can, in the `.html` capture);
- the type: heading and body fonts, sizes, weights, letter spacing;
- the layout of each template: header and menu, hero, sections, footer, spacing;
- what moves: menus that open, carousels, popups, animations.

Write the colors and fonts as CSS custom properties in one stylesheet the layout imports, and
build the rest from them.

## Fonts

`site.json`'s `fonts` lists what the old site loaded.

- **Google Fonts and other open fonts:** self-host them (WOFF2 in `public/fonts/`, an
  `@font-face` per weight you use). Only paid sites load fonts from other domains, and
  loading fonts from Google has cost sites in court in the EU. Two families and a few weights are plenty.
- **Fonts licensed to the builder** (Adobe Fonts on Squarespace, Monotype fonts on Wix such as
  Avenir, Futura or Helvetica Neue, anything "licensed to the old builder"): never copy the
  files. Use the closest open font, and tell the human: Avenir → Nunito Sans or Mulish,
  Futura → Jost, Helvetica Neue → Inter, Proxima Nova → Montserrat or Figtree, Arial and
  Helvetica → Arimo, Times → Tinos. If they have their own license (an Adobe Fonts kit of
  their own), a paid site can load it.

## Images

- Import originals (`images.json`) at the site paths it gives, at full size. On a paid site
  cdn.beautiful.host resizes them: a plain `<img>` with a `width` attribute is served at most
  2,560 pixels wide in a smaller format. A trial serves the original file, so a 4,000-pixel
  photo is heavy until the site is paid; say so if the human asks why it's slow.
- Give every `<img>` its `width` and `height` (the capture has the size it was shown at), and
  `loading="lazy"` on all but the first large image on the page.
- Background images (`where: "background"` in the capture) usually work better as an `<img>`
  with `object-fit: cover` behind the text.
- Replace the builder's stock photos and template artwork (ask the human which photos are
  theirs), and their logo stays theirs: import it as is, SVG where they have one.
- Icons from an icon font: inline SVG. Font Awesome Free is fine with its attribution;
  Pro icons aren't.

## Menus, carousels and things that move

Use the platform before a script:

- A menu that opens on phones: a `<button aria-expanded>` that shows the menu, or
  `<details>`. Keyboard and screen readers must work.
- Carousels: a row with `overflow-x: auto` and `scroll-snap-type: x mandatory`, with buttons;
  anything that moves by itself gets a pause button.
- Accordions: `<details>` / `<summary>`. Popups: `<dialog>`.
- Fade-ins on scroll: content must be visible without JavaScript; animate only `opacity` and
  `transform`, and turn it off under `prefers-reduced-motion`.
- A script you need goes in the `.astro` file's `<script>`, or a Preact island
  (`client:visible`). No npm packages beyond Beautiful's list: write it yourself.

## Snapshot fallback

When a section is too intricate to rebuild well (a designed table, a complex layout from a
page builder), you can keep the old markup for that section:

1. Copy the section's HTML from `migration/pages/<key>.html` into
   `src/snapshots/<name>.html`.
2. Remove every `<script>`, every `on…=` attribute, trackers and the builder's `data-`
   attributes, and point its image URLs at the imported images.
3. Render it: `import snap from "../snapshots/<name>.html?raw";` then
   `<Fragment set:html={snap} />`, with the CSS it needs in a stylesheet.

Use it for sections, not whole pages, and list those sections in your report as ones to
rebuild properly later. It still has to pass `verify`.

## Before you hand over

Check each template at 390 and 1440 pixels wide: no sideways scrolling, readable type, menu
works, images sharp, nothing overlapping. Compare with the old pages side by side.
