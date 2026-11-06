---
name: beautiful-site
description: Build and publish a website on beautiful.host in one call, with no signup, and keep improving it. Use when the user asks to build, publish, host or put a website online, or mentions beautiful.host.
---

# Publish a website on beautiful.host

beautiful.host hosts websites for agents. Every new site is an Astro project, built by
beautiful.host on each deploy with no `npm install`, so layouts, Markdown pages, content
collections, Tailwind and React or Preact islands are there when you need them. A site
goes live with one HTTP request and no account. It stays online for 1 hour, then 24 hours once the human
claims it, then permanently at $29/month per site (each site its own subscription).

## Workflow

1. **Ask only what you must.** Name of the business or person, what the site is for,
   and anything they want on it. Otherwise make good choices yourself.
2. **Write the site as an Astro project.**
   - Send `astro.config.mjs` with a new site (`export default {};` is enough): with it, or
     an `.astro` file in `src/`, the site builds as Astro. Without either it builds the older
     Eleventy/Liquid way, which is being retired. Don't add one to an existing Liquid site
     unless you rewrite it as Astro in the same change.
   - `src/pages/index.astro` is required (or a redirect from `/` in `public/_redirects`). Add pages as `src/pages/about.astro` (or
     `about.md`), served at `/about/`: link to `/about/` (`/about` redirects there).
     Add `src/pages/404.astro`. Files starting with `_` aren't pages.
   - Put the shared shell in `src/layouts/Base.astro` (a full page with a `<slot />`,
     taking `title` from `Astro.props`), and wrap each page in `<Base title="…">`.
     Components go in `src/components/`, data in `src/data/*.json`.
   - Static files go in `public/` and are served as they are (`public/favicon.svg` is
     `/favicon.svg`). Nothing may go under `_bty/` or `_assets/`.
   - Blog or news: Markdown posts in a content collection (`src/content/blog/`, declared
     in `src/content.config.ts`), a `src/pages/blog/[id].astro` with `getStaticPaths()`,
     and for a feed an endpoint `src/pages/rss.xml.ts` that returns a `Response` (no
     `@astrojs/rss`; set `site` in the config). `import.meta.glob` takes literal patterns
     only (a string or an array, `!` to exclude).
   - Only these packages, with no install: `react`, `react-dom`, `preact`, `zod` and
     Astro's own modules. Anything else fails the build: write small helpers in `src/lib/`.
     Pages build without network access, so keep data in files. Islands: a React or
     Preact component with `client:load` (Preact if it imports from `preact`, no config).
     Full conventions: https://beautiful.host/llms.txt
   - Tailwind works: a stylesheet starting with `@import "tailwindcss";`, imported by
     the layout, is compiled against the classes you use. Plain CSS works too (no Sass).
   - Make it look designed: a coherent palette, a real type pairing, generous spacing,
     a responsive layout that works at phone width, and real copy written for this
     business.
   - Include `<title>`, a meta description, Open Graph tags, a favicon (inline SVG is
     fine) and alt text.
   - Free sites block third-party resources, so inline or import fonts, images and
     scripts instead of linking to other domains. The exception: a trial (claimed,
     unpaid) loads known newsletter, store and video embeds (MailerLite, Kit,
     Mailchimp, Substack, Stripe and Shopify Buy Buttons, Payhip, Kickstarter, YouTube,
     Vimeo; llms.txt, "Embeds"). Import images with `{ "path", "url" }`
     (`public/photo.jpg` is served at `/photo.jpg`).
   - Paid sites: upload images, video and PDFs with `upload_asset` and link to the
     returned `/_assets/…` path instead of adding them as site files.
   - Contact form, in any page or component: `<form data-bty-form="contact">` with named
     `input`/`textarea` fields (`required`, `type="email"`), optionally
     `data-bty-redirect="/thanks/"`. No `action` and no script: the build wires it up. One name on several pages (a footer
     and a contact page) is one form: put `data-bty-redirect` and `data-bty-notify` on
     the contact page's copy. It takes messages on paid sites only
     (free sites and trials answer that it isn't taking messages yet, and it works once
     the human subscribes); each one is emailed to the owner, `list_form_submissions`
     reads them with the human's account, and `delete_form_submissions` deletes what
     they no longer need (also how a full form storage gets room again). Never ask for
     passwords, card numbers or one-time codes. Details:
     https://beautiful.host/llms.txt ("Forms").
   - Secrets (claimed sites): when the site's code needs a key the human has, call
     `request_secret` and give them its link instead of asking for it in the chat.
     `list_secrets` shows names only. Details: https://beautiful.host/llms.txt ("Secrets").
   - Analytics (a paid add-on, $1 per 100,000 page views): `update_site` with
     `analytics: true` turns it on. `get_analytics` (`site`, `period`, `filters`,
     `breakdowns`) shows visitors, visits, bounce rate, sources, pages, places, devices and
     goals; a `goal` filter shows what brings it. Count signups or sales with `bty("Signup")`
     in the site's code. Read it when the human asks how the site is doing.
     `attribution: true` (same add-on) credits conversions to the campaign or ad that
     brought the visitor, takes them from the site's server too (with the visitor token
     `bty.attribution()` gives), and `set_ad_platform` sends them to Meta and Google Ads.
     Details: https://beautiful.host/llms.txt ("Analytics", "Attribution").
   - Logs: `get_logs` (`site`, `environment`) shows what the site's plugins did: requests,
     `console.log` lines, errors and outbound calls. Read it after calling a route.
     Details: https://beautiful.host/llms.txt ("Logs").
   - Review: when the human wants to fix wording or gather feedback, deploy a preview and
     call `review_link`; give them `review_url`. They edit text in place (written into your
     files as staged changes) and leave comments and sticky notes. When they say "make the
     updates from my comments", call `list_comments`, do what each asks (`read_file` any file
     an applied edit names before you rewrite it; a comment's `replies` say what they want
     now), deploy a preview, and `resolve_comments`. Ask about one that needs a decision with
     `reply_comment`. Details: https://beautiful.host/llms.txt ("Review").
   - Design options: when the human should choose between versions (three landing page
     designs, say), build them in one `preview_options` call and give them `compare_url`: the
     options side by side with screenshots, each with a Choose button. Their pick lands in your
     files as staged changes (`list_options` shows it; `pick_option` when they tell you
     instead), and the rest go offline. Then deploy. Details: https://beautiful.host/llms.txt
     ("Design options").
   - Posts: when the human writes their own posts, give them the post's `editor_url`
     (`list_posts`). Their words are theirs: `read_post`, then `edit_post`, whose changes arrive
     as suggestions they accept or reject, and `comment_on_post`. Write straight in
     (`track_changes: false`) only when they asked you to. Details:
     https://beautiful.host/llms.txt ("Posts").
   - Sharing: to let another team help run a site (an assistant, a designer, an agency), call
     `set_access` with their team's handle and `publisher` or `admin`; `role: null` removes
     it. Free. Details: https://beautiful.host/llms.txt ("Sharing a site with another team").
   - Server code (claimed sites), only when visitors create something or something must
     happen later: if editors or agents change it, it's a file; if visitors create it, it
     goes in the database. A plugin is `src/plugins/<name>.ts` exporting a Hono app, served at
     `/api/<name>/*`, using `db`, `secrets`, `content`, `schedule`, `internal()` and `spam()`
     from `@beautiful/runtime`. `create_database` first (a new site's `publish` with `migrations/` does it for you), then `migrations/0001_<name>.sql`.
     Email to visitors goes through the human's own provider: ask which, `request_secret` its
     key, send each email once (record it under a key). Deploy a preview and run `test_plugin`
     with a sample request; read its timeline and fix what it shows before telling the human
     it works. Details: https://beautiful.host/llms.txt ("Server code"); a complete example:
     https://beautiful.host/templates/webinar.md.
   - An author's site (books, a series, buy links, a newsletter, preorders): read
     https://beautiful.host/recipes/authors.md first. Each of its recipes is a full guide to one
     part of an author's site, from what to ask the author to how to test it; a new site starts
     with https://beautiful.host/recipes/authors/website.md.
3. **Publish in one call:**

   ```sh
   curl -sS https://beautiful.host/api/v1/publish -H 'content-type: application/json' \
     -d @payload.json
   ```

   where `payload.json` is `{ "name": "…", "files": [{ "path": "astro.config.mjs", "content": "export default {};" }, { "path": "src/layouts/Base.astro", "content": "…" }, { "path": "src/pages/index.astro", "content": "…" }, …] }`.
4. **Tell the human, in this order:**
   - the live `url`
   - the `claim_url`, with one sentence: "The free site stays up for an hour. Sign in
     through this link to keep it for 24 hours, and subscribe ($29/month) to keep it
     for good."
5. **Keep the `access_token`** from the response. To change the site, publish again
   with `"site": "<id>"` and `Authorization: Bearer <access_token>`, sending only the
   changed files. It keeps working after the human claims the site, until they revoke
   it on their dashboard (https://host.beautiful.tech). There they can also create an
   API key for you.
6. **Check your work:** open the pages you changed and fix anything that looks off
   before handing over. If you can't browse, call `screenshot` (MCP) or
   `POST /api/v1/sites/{site}/screenshot` (`{ "url": "/about/" }`, images base64 in
   `captures[].image_base64`): desktop and phone images in one call. Only for the pages you
   changed (30 calls per site an hour); a `preview_url` works too.
   After a claim, the site is a 24-hour trial: the human keeps it by subscribing
   ($29/month) at the site's `upgrade_url` (`get_site`), one subscription per site.
   You never handle a card. If the human asks you to put a site live for good and turned on
   "Agents can publish sites" on the dashboard (`whoami`'s `agent_publish`), call
   `publish_site`: it charges the card they saved with us, and they get the receipt.
   Tell them which site you put live. `whoami` counts the account's sites by billing
   state (`sites`: `paid`, `trial`, `past_due`, `lapsed`, …), and says if Beautiful
   comped the account (`account.comped`).
7. **Custom domain (paid sites):** `add_domain` with the human's domain (`www.example.com` or
   `example.com`; the root redirects to www). Give the human the returned `dns_records`
   exactly (a CNAME and a TXT record, the only `bty-verify=` value at its name, plus the
   optional root record in `root_domain`), then
   call `check_domain` once they say they're added, as its `next_step` says (every few
   minutes, not in a loop), until `status` is `active`. A domain added back more than an
   hour after it was removed gets a new TXT value, which replaces the old one.
8. **Drafts and scheduling:** when updating a live site, write unfinished pages with
   `"hold": true`; publishing only ships staged changes. For changes that must go live
   at a set time (a launch, a sale, a post), schedule a release with `publish_at` in
   the owner's timezone. Queue several releases to switch the same page in steps, and
   preview each step.
9. **Moving a site here:** keep every old URL working. Write `public/_redirects` with a
   301 for each old URL whose address changed (`/old-page.html /new-page/ 301`,
   `/ p=12 /blog/my-post 301` for a query string), check them on the preview
   (`deploy` with `production: false`), then publish. The config's `redirects` go first.
   `get_routes` shows the live rules; `set_routes` replaces `public/_redirects` and
   `public/_headers` from a list of rules, or edit them with `write_files`.
   https://beautiful.host/llms.txt has the syntax, `public/_headers` and proxies.

## Making a site better

Faster, better in search and AI answers, accessible, clearer copy, more signups: follow
https://beautiful.host/skill/optimize/SKILL.md, which picks the right guide for the ask.

## Moving an existing site

With a shell and Node, follow the migration skill instead:
https://beautiful.host/skill/migrate/SKILL.md. Its script lists every page, saves their
content and original images, turns posts into Markdown, writes the 301s and checks every
old URL on the new site. By hand:

A free site is online for 1 hour, so get something live in the first few minutes:

1. Rebuild the old homepage, publish it, and give the human the `url` and `claim_url`
   right away so they can claim it while you work.
2. List every page from the old site's `/sitemap.xml` (or the `Sitemap:` lines in its
   `/robots.txt`). If there's none, follow its homepage and menu links. Tell the human
   how many pages you found.
3. Rebuild the rest, menu pages first, on a shared layout, publishing as you go.
4. Add a 301 in `public/_redirects` for each old URL whose address changes
   (`/about-us.html /about/ 301`).

Use the public pages only: never sign in to the old site or get past a bot check.

## If something fails

Every error has `code`, `message` and `hint`. Do what the hint says. Common cases:
- `invalid_path`: use relative paths like `src/pages/about.astro` or `public/logo.svg`, with no `..`.
- `template_error`: the site doesn't build, and nothing was published. The message is
  `file:line: message` (then up to four more problems) and the hint says how to fix the
  first: an import of a package that isn't available, a syntax error, an undefined value
  while rendering, an entry that doesn't match its collection's schema, or `fetch()` at
  build time. Fix it and publish again. Deploys also return `warnings`, each with a hint:
  files outside `src/` and `public/`, `package.json` dependencies (never installed),
  form problems.
- `invalid_route`: a rule in `public/_redirects` or `public/_headers` can't be used (most often a redirect
  without a status code). The message names the file and line; add what the hint says.
- `rate_limited`: too many free sites from this network (ask the human to sign in at
  https://host.beautiful.tech and create an API key for you), or too many screenshots of
  this site in an hour (30): screenshot only what you changed, and try again later.
- `site_expired`: for a temporary site, give the human a fresh claim link (`claim_site`);
  for a trial site, or a paid site whose subscription ended or is paused, the site's
  `upgrade_url` (`get_site`). A temporary or trial site is restored by claiming or paying
  within 7 days of expiry (`get_site` shows `kept_until`); after that it's deleted. A site
  that was paid for is archived for 6 months (`kept_until`): paying again before then
  restores it as it was. After that it's deleted, so to keep a copy, give the human
  `export_site`'s `download_url` (a ZIP of the whole site) before `kept_until`.
- `past_due` status, or a `warning` from `get_site` or `whoami`: a payment failed. The
  site stays online while the card is retried; ask the human to update it at `billing_url`.
- `unauthorized` with a temporary site's `access_token`: the human revoked it after
  claiming the site (ask them for an API key from their dashboard), or the site was
  deleted 7 days after it expired (publish a new one).
- `form_field_forbidden`: a form has a password, card-number or one-time-code field.
  Remove it and publish again; the deploy's `warnings` name the field.
- `form_token_invalid`: a form was sent without forms.js's timing (a forged, expired,
  reused or too-quick `_bty_token`, or one fetched from another network). Let
  `/_bty/forms.js` send the form, or fetch a new token from `/_bty/forms/{name}/token` in
  the visitor's browser for each message and wait `min_wait_ms` before sending.
- `payment_required` from `add_domain`: custom domains are for paid sites. Give the human the
  site's `upgrade_url` (`get_site`), or the `claim_url` for a temporary site.
- `conflict` from `add_domain`: the site already has a domain (remove it first with
  `remove_domain`), or another site has this one. The hint says how to free it, or which TXT
  record makes it the human's if they control its DNS.
- `site_suspended`: the site was taken down for breaking the terms of service and is
  offline. If it's yours you can still read it (`get_site` shows the reason), but not
  change it; nobody can claim it. Tell the human; if they think it's a mistake, they can
  write to support@beautiful.host.

## MCP

Clients with MCP can connect to `https://beautiful.host/mcp` and call `publish` with
the same arguments. The human can add `https://beautiful.host/mcp` as a connector (Claude,
ChatGPT, Cursor): it works without signing in, and signs them in when needed
(`whoami` and `list_sites` ask the client to). In Claude, they add it as a custom connector
and choose **Sign in when needed** (Claude may pre-select "No sign-in": with that the
connector works but can't sign in). Signed in, you manage the sites in their account, and
new sites go there, with no key to copy.
