# Speed, and the code nobody sees

The rebuilt site should be faster than the old one, and say more to search engines. Builders
ship megabytes of scripts on every page; an Astro page needs almost none. Aim for 90 or more
in each Lighthouse category on a phone, on every template, and a largest paint under 2.5 s.

Measure, don't guess:

```sh
node bty-migrate.mjs lighthouse https://<slug>.bty.site
```

It runs Lighthouse (through `npx`, with the Chrome on this computer: `--chrome <path>` if it
can't find one) on the old and new homepage and one page of each kind, and writes
`migration/lighthouse.md`: the scores side by side, and per page the fixes that save the most.
Without Chrome, pass `--key` with a PageSpeed Insights API key (free, from Google Cloud) once
the site is paid. Fix the top items, publish, and run it again. On a free or trial site the
numbers are rougher: files aren't on the CDN yet, so ignore "efficient cache policy" there.

## The head

`node bty-migrate.mjs head --site site` writes `src/data/seo.json` (each page's title,
description, social image, type, date, `noindex`, `hreflang` and structured data, from the old
pages, at their new addresses) and `src/components/Seo.astro`, which writes them all:

```astro
---
import Seo from "../components/Seo.astro";
const { title, description, lcp } = Astro.props;
---
<html lang="en">
<head>
  <Seo title={title} description={description} lcp={lcp} />
  <!-- fonts preloads, then nothing else that blocks -->
</head>
```

It gives every page: charset, viewport, title, description, an absolute canonical,
`og:*` and `twitter:*` tags with an absolute image, the old structured data with its links
moved to the new site, `hreflang`, the search consoles' verification tags (homepage), icons,
`theme-color` and the feed link. Props override the data, so a page you rewrote passes its
own. Set `site` in `astro.config.mjs` first: canonical and social links are built from it.
Don't write these tags again in the layout. Run `head` again after you change `url-map.json`.

`verify` checks every page for them (and fails a page with no viewport, a canonical to another
page, or a `noindex` the old page didn't have).

## The largest paint

The largest element in the first screen (usually the hero image or a cover) decides the
score more than anything else.

- Load it eagerly: no `loading="lazy"` on it, and `fetchpriority="high"`. Pass its URL as
  `lcp` to `<Seo>`, which preloads it.
- Give it `width` and `height` (or an `aspect-ratio`), like every image.
- Keep it in the HTML: not a CSS background, not inserted by a script, not behind a fade-in.
- Size it for the screen: on a paid site, `<Image src={hero} width={1200} widths={[600, 900,
  1200]} sizes="100vw" />` from `astro:assets` (with the image imported from `src/`), or a
  plain `<img width>`, which the CDN serves resized as AVIF or WebP. A trial serves the file as
  it is: import originals at the size you show them when you can resize locally.

## Images

- `width` and `height` on every `<img>`, so nothing jumps as they load (layout shift).
- `loading="lazy" decoding="async"` on every image below the first screen.
- `sizes` with every `srcset`, matching the layout (`(min-width: 900px) 33vw, 100vw`).
- Real `alt` on content images, `alt=""` on decorative ones.
- Inline SVG for icons and logos; no icon fonts.
- No text in images: it can't be read, searched or translated.

## Fonts

- Self-host WOFF2 files in `public/fonts/` (`design.md` says which). Two families, four files
  at most, Latin subset unless the site needs more.
- `font-display: swap` in each `@font-face`.
- Preload the one or two files the first screen uses:
  `<link rel="preload" href="/fonts/x.woff2" as="font" type="font/woff2" crossorigin>`.
- Match the fallback's size to stop the swap moving text: a fallback `@font-face` on a local
  font with `size-adjust`, `ascent-override` and `descent-override`.

## CSS

- One stylesheet of your own (tokens, base, layout) plus Astro's scoped component styles,
  which Astro bundles and minifies.
- Never copy the builder's CSS: it's hundreds of KB for a few rules.
- No `@import` chains, no CSS frameworks beyond Tailwind (compiled, so only what you use).
- Animate only `opacity` and `transform`.

## Scripts

- None by default. Menus, accordions, carousels and popups are HTML and CSS (`design.md`).
- An island only where something must run, with `client:visible` or `client:idle`, not
  `client:load`.
- Third-party scripts (newsletter, analytics, store) at the end of `<body>` with `async`, on
  the pages that use them only; never in `<head>` without `async` or `defer`.
- Heavy embeds behind a click: YouTube, maps, chat widgets (`embeds-and-forms.md`). Give each
  embed's box its size (`aspect-ratio: 16 / 9`) so the page doesn't shift.
- One analytics tag, not three. Drop trackers the human no longer uses.

## Lighthouse's other categories

- **Accessibility:** text contrast at least 4.5:1 (3:1 for large text), one `h1` and headings
  in order, every link and button with a name, labels on form fields, `lang` on `<html>`, tap
  targets 24 px or more apart, a visible focus outline. Fix contrast with the human: it changes
  their colors.
- **Best practices:** everything over `https://`, no console errors, images at their aspect
  ratio, no deprecated APIs.
- **SEO:** the head above, descriptive link text (not "click here"), `robots.txt` with the
  sitemap, a real 404 page (`src/pages/404.astro`).

## What Beautiful does for you

HTTPS, HTTP/2 and 3, and compression. A paid site's images, fonts and stylesheets are served
from cdn.beautiful.host and cached for a year; free and trial sites aren't cached, so
Lighthouse's cache warnings there go away once the site is paid. Don't add cache headers to
pages, and don't link to the CDN yourself.
