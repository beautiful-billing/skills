# Builders: where the pages are, the original images, and the exports

`bty-migrate.mjs inventory` names the builder (`platform` in `inventory.json`) from the
homepage. Builders render their text on the server, so a plain fetch gets the words, links
and metadata of nearly every page; a browser is needed only to see the design, and for pages
the capture lists under `needs_browser`. `capture` already resolves each image to its
original (`images[].original`) by the rules below.

When the old site blocks the script (a bot check, or robots.txt disallowing everything),
don't work around it: ask the human for the builder's export, listed per builder, or to save
the pages from their own browser.

## WordPress

- Detect: `<meta name="generator" content="WordPress …">`, `/wp-content/` paths.
- Pages: `/wp-sitemap.xml` (core), or `/sitemap_index.xml` (Yoast, Rank Math). `capture` also
  reads `/wp-json/wp/v2/posts` and `/pages` into `wordpress.json` (the post body without the
  theme, date, categories, tags, featured image), and `posts` uses it. Some sites switch the
  API off: then it uses the captured pages.
- URLs: pages `/slug/`, `/parent/child/`; posts as the permalink setting says
  (`/slug/`, `/2023/05/12/slug/`, or `?p=123`); `/category/x/`, `/tag/x/`, `/author/x/`,
  `/page/2/`. They already end in `/`, so Astro serves them at the same address: keep them.
  `?p=` and `?page_id=` links need query redirects in `url-map.json`.
- Images: `name-300x200.jpg` is a resized copy of `name.jpg`; Jetpack's `i0.wp.com/…?w=` is
  a copy of the URL inside it. `-scaled.jpg` is the large version WordPress keeps.
- Quirks: page builders (Elementor, Divi, WPBakery) wrap content in deep markup and may leave
  shortcodes (`[vc_row]`, `[et_pb_section]`) in the API's content: drop the shortcodes, keep
  their text. Contact Form 7, WPForms and Gravity Forms post to the old server and stop
  working when it goes: rebuild them (`embeds-and-forms.md`). Search (`/?s=`) can't be
  redirected value by value: link the menu's search to a page with client-side search, or
  drop it with the human's OK.
- Export: Tools → Export (WXR XML with every post, page and image URL).

## Wix

- Detect: `<meta name="generator" content="Wix.com Website Builder">`, `static.wixstatic.com`.
- Pages: `/sitemap.xml` indexes `pages-sitemap.xml`, `blog-posts-sitemap.xml`,
  `store-products-sitemap.xml` and more. Blog feed: `/blog-feed.xml`.
- URLs: pages `/about` (no slash: Beautiful sends `/about` to `/about/` itself), posts
  `/post/slug`, products `/product-page/slug`, blog lists `/blog`, `/blog/categories/x`,
  `/blog/tags/x`, `/blog/page/2`. Members (`/profile/…`, `/account/…`) and store (`/shop`,
  cart) pages load by script and belong to Wix's apps: rebuild the shop as a page that links
  out (`embeds-and-forms.md`), drop member pages with a redirect to the homepage only if the
  human agrees.
- Images: `static.wixstatic.com/media/<id>~mv2.jpg/v1/fill/w_600,…/name.jpg` is a resized
  crop of `static.wixstatic.com/media/<id>~mv2.jpg`. The original can be far bigger than the
  crop the page shows: show it with the same crop (`object-fit: cover`, the page's aspect
  ratio), and import big ones at the size you show them if you can resize locally. Media ids
  starting `11062b_` are Wix's free media, `nsplsh_` Unsplash: replace or re-source those.
- Quirks: the header and menu are often inside the page's main area, so `nav` may be empty:
  `site.json`'s `menu` then takes the links most pages share. Several `h1`s per page are
  common: give the rebuilt page one. Newsletter popups ("lightboxes") are Wix's: rebuild them
  as an inline signup.
- Terms: Wix's terms forbid "scraping" a site, including your own. Tell the human in one
  sentence (as the skill says) and let them decide. Never use Wix's APIs for this.
- Export: none for pages. Blog posts can be exported from the dashboard; form submissions as
  CSV.

## Squarespace

- Detect: `static1.squarespace.com`, `images.squarespace-cdn.com`.
- Pages: `/sitemap.xml`. Blog RSS: `/blog?format=rss`. Any page with `?format=json` returns
  its content as JSON, which helps when a block's text doesn't come through.
- URLs: `/about`, posts `/blog/slug` (older sites `/blog/2021/3/4/slug`), products
  `/shop/p/slug`, lists `/blog?offset=…`, `/blog?category=…`, `/blog/tag/x`. A
  `name.squarespace.com` address whose canonical is the human's domain: the script lists the
  domain instead (`--keep-host` to override).
- Images: `…/cover.jpg?format=500w` is resized; the script takes `?format=2500w`, the largest
  size that's still web-sized. Images picked from Squarespace's Unsplash and Getty library
  look like the owner's: ask the human which photos they uploaded.
- Quirks: fonts come from Adobe Fonts licensed to Squarespace: substitute them
  (`design.md`). Popups and announcement bars are Squarespace's. Forms post to Squarespace.
- Export: Settings → Export (a WordPress XML of pages and one blog). Form submissions are in
  Squarespace's form storage or a connected Google Sheet: ask the human to download them.

## Shopify

- Detect: `cdn.shopify.com`.
- URLs: `/pages/x`, `/products/x`, `/collections/x`, `/blogs/news/x`. Never rebuild `/cart`,
  `/account` or `/checkouts`: the store stays on Shopify (`embeds-and-forms.md`).
- Images: `book_600x.jpg`, `book_x800@2x.jpg` and `?width=600` are resized copies of
  `book.jpg`.
- Export: products as CSV from the admin.

## Webflow

- Detect: `<html data-wf-site>`, `website-files.com`.
- URLs: `/about`, CMS items `/{collection}/slug`, list pages `?{id}_page=2`.
- Images: `hero-p-500.jpeg` is a resized copy of `hero.jpeg`.
- Quirks: interactions (`data-w-id`) and sliders (`w-slider`) are Webflow's scripts: rebuild
  them (`design.md`).
- Export: the code ZIP (paid workspaces), CMS collections as CSV, redirects as CSV.

## GoDaddy Websites + Marketing

- Detect: `img1.wsimg.com`.
- Images: `…/cover.jpg/:/rs=w:600` is a resized copy of `…/cover.jpg`.
- Quirks: GoDaddy often refuses connections from servers. If it does, ask the human to run
  the script on their own computer, or to save the pages from their browser. Its terms say
  the site's design belongs to GoDaddy: rebuild the look rather than copying its markup.
- Export: none.

## Ghost

- Detect: `<meta name="generator" content="Ghost …">`.
- URLs: `/slug/`, `/tag/x/`, `/author/x/`, `/page/2/`, RSS `/rss/`.
- Images: `/content/images/size/w600/2023/05/x.jpg` is a copy of
  `/content/images/2023/05/x.jpg`.
- Export: Settings → Labs → Export (JSON, plus `redirects.yaml`).

## Substack

- Detect: `substackcdn.com`.
- URLs: posts `/p/slug`, archive `/archive`, feed `/feed`. Paid posts show a preview only:
  never get past the paywall; ask the human for the export.
- Images: `substackcdn.com/image/fetch/<sizes>/https%3A%2F%2F…` is a copy of the URL inside.
- Export: Settings → Exports (posts as HTML, subscribers as CSV: the subscriber list is
  personal data, so it goes to their new newsletter provider, never into the site).

## Weebly, Square Online, Carrd, Framer, Duda, Jimdo, Hostinger

- Weebly: `.html` page URLs need a 301 each (`/about.html` to `/about/`; the default
  `redirects` writes them). Export: Settings → Archive (no blog or store).
- Carrd: usually one page with `#section` links. Hash links can't be redirected: keep the same
  section `id`s.
- Framer: `framerusercontent.com/images/x.png?scale-down-to=512` is a copy of the URL without
  the query.
- Duda: `irp.cdn-website.com/…/opt/name-1920w.webp` is a copy of `…/name.webp`.
- Unknown builders: the capture still works; check the image URLs for size parameters and
  pick the largest from `srcset` (the script does).

## Plain HTML sites

Every `/page.html` gets a 301 to `/page/`, which `redirects` writes without a `url-map.json`
entry. `index.html` in a folder is that folder's page.
