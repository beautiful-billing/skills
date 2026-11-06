# Optimizing a site on Beautiful Host

The optimization skills here are general. This page is what's different when the site lives on
beautiful.host. Read it once before you change anything, and prefer it where a skill says
otherwise.

## The site is Astro, built for you

- Every site is an Astro project that beautiful.host builds on each deploy. There's no
  `npm install` and no build step on your side, and no Next.js, Vercel or WordPress settings to
  change. When a skill names one of those, do the Astro equivalent.
- Only these imports work: `react`, `react-dom`, `preact`, `preact/hooks`, `preact/compat`,
  `zod` and Astro's own modules (`astro:assets`, `astro:content` and the rest). A skill that says
  "install a package" means: write the code yourself, or skip it.
- Pages build without network access. Anything a page shows comes from its files.
- The full rules are in https://beautiful.host/llms.txt.

## What Beautiful already does

Don't spend time on these. They're done for every site:

- HTTPS, HTTP/2 and HTTP/3, and compression.
- On paid sites, images, fonts and stylesheets are served from cdn.beautiful.host and cached for
  a year. Free and trial sites aren't cached, so Lighthouse's "efficient cache policy" warning
  there goes away once the site is paid. Don't add cache headers to pages, and don't link to
  the CDN yourself.
- On paid sites, images are resized and converted to AVIF or WebP: `<Image>` and `<Picture>`
  from `astro:assets` serve the `width` and `widths` you give, and a plain `<img>` with a
  `width` is served at most 2,560 px wide. Upload photos at full size. A trial serves the
  original file, so import photos at the size you show them when you can resize locally.
- With `site` set in `astro.config.mjs`, `sitemap-index.xml` is written for you. Point
  `public/robots.txt` at `/sitemap-index.xml`.

## Where things go

- Head tags (title, description, canonical, Open Graph, JSON-LD): in the layout, in
  `src/layouts/`. Set `site` in `astro.config.mjs` so canonical and social links are absolute.
- Redirects and headers: `public/_redirects` and `public/_headers` (Cloudflare's syntax), or
  `set_routes`. Old URLs that change get a 301.
- Fonts: self-hosted WOFF2 in `public/fonts/`, with `font-display: swap`.
- Scripts: none by default. An island (`client:visible` or `client:idle`) only where something
  must run.
- Forms: `<form data-bty-form="contact">` with named fields. Beautiful handles the posting and
  spam checks, and the owner gets an email per message. Paid sites only.
- The not-found page: `src/pages/404.astro`.

## Measure, change, measure again

1. **Before:** run Lighthouse on the homepage and one page of each kind, on a phone. With a
   shell and Chrome: `npx lighthouse <url> --output=json --output-path=before.json` (it tests as a phone by default). The migration
   script does it for an old and new site side by side:
   `node bty-migrate.mjs lighthouse <url>` (https://beautiful.host/skill/migrate/bty-migrate.mjs).
   Without a shell, use PageSpeed Insights in a browser, or skip to step 3.
2. **Change** the top few items, then deploy a preview: `deploy` with `production: false`. Its
   `preview_url` is a real copy of the site with your change.
3. **Look** at what you changed: open the pages, or call `screenshot` (desktop and mobile in
   one call) on the pages you touched.
4. **Measure again** on the preview, then `promote` it (or `deploy` to production) and tell the
   human what moved, in numbers: "LCP 3.1 s to 1.4 s, accessibility 82 to 100."

A temporary or trial site measures slower than it will once paid (no CDN, no image resizing).
Say so when you report its numbers. Previews tell search engines not to index them, so
Lighthouse's SEO score on a `preview_url` is lower than it will be live: measure SEO on the
live site.

## Ask the human first

- Changing colors to fix contrast, rewriting their words, removing a section, or changing
  their headlines. Show them the options: `preview_options` builds 2 to 4 versions side by side
  for them to pick from.
- Turning on analytics: it's a paid add-on (`update_site` with `analytics: true`). Once it's on,
  `get_analytics` shows visitors, sources, pages and goals, and `bty("Signup")` in the site's
  code counts a goal. That's how you prove a conversion change worked.
- Anything that costs money or signs them up for a service (a search console, an ad account,
  an SEO tool). Every skill here works without one.
- Installing a tool on their computer (`npm install -g`, a browser extension). Lighthouse through
  `npx` needs nothing installed; any other checker is optional.

## Search consoles and AI search

Google Search Console and Bing Webmaster Tools need the human to sign in and verify the site.
Ask them to, and add the verification `<meta>` tag they give you to the homepage's head. Don't
create accounts for them.
