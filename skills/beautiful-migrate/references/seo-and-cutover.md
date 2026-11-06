# Search rankings, the domain and email

## Keep the rankings

Search engines rank pages by address. A move keeps its rankings when every old address
still answers, each page keeps its title and description, and nothing important vanishes.
`head` writes the tags (`performance.md`, "The head") and `verify` checks them on every page;
go through the rest yourself.

1. **Every old URL opens a page**: the same address, or one 301 to the page that replaced
   it. No chains of redirects, no 302s for pages that moved for good, and never everything
   to the homepage (search engines treat that as a missing page).
2. **Query-string URLs** (`/?p=12`, `/blog?offset=…`, `/?page_id=7`) each get their own rule
   in `url-map.json`: `_redirects` matches query values exactly.
3. **Titles and meta descriptions** stay as they were, unless the human agrees to better ones.
   Every page has its own.
4. **One canonical URL per page**, absolute, pointing at the page itself on the final domain.
   Set `site` in `astro.config.mjs` to the domain the site will live on.
5. **Social cards**: `og:title`, `og:description`, `og:image` (an absolute URL, at least
   1200×630), `og:url`, and `twitter:card` `summary_large_image`.
6. **Structured data**: keep the JSON-LD types the old pages had (`json_ld` in the capture):
   `Book`, `Person`, `Article`, `Organization`, `Event`. Never invent reviews or ratings.
7. **`lang`** on `<html>`, and `hreflang` links if the old site had languages.
8. **noindex**: keep a page out of search only if the old one was (`noindex` in the capture).
   If the old homepage was noindex by accident, ask the human.
9. **robots.txt** in `public/`, with `Sitemap: https://<domain>/sitemap-index.xml`. Beautiful
   writes the sitemap once `site` is set; `redirects` points the old sitemap addresses at it.
10. **Feeds**: readers' apps and newsletter tools follow the old feed address. A feed at a
    file address keeps it with an endpoint at the same path (Wix's `/blog-feed.xml` is
    `src/pages/blog-feed.xml.ts`); one at a folder address (WordPress's `/feed/`) gets a 301
    to your feed in `url-map.json` (`"/feed/": "/rss.xml"`). Keep each post's link the same.
11. **Verification tags** (`google-site-verification`, `msvalidate.01`,
    `facebook-domain-verification`, `p:domain_verify`) copied into the new head.
12. **Icons**: `favicon.ico` or a PNG, plus a 180-pixel `apple-touch-icon.png`.
13. **Files**: PDFs and downloads (`kind: "file"` in the inventory) keep their old paths:
    import them into `public/` at the same path.

## Moving the domain

Custom domains are for paid sites (one per site). Until the human subscribes, the site lives at
its `*.bty.site` address. Then:

1. **Before anything changes**, ask the human to export from the old builder what they want
   to keep: form submissions, newsletter subscribers if the builder held them, store orders,
   the builder's own redirect list. Note the domain's current DNS records (look them up, or
   ask for a screenshot of the DNS settings).
2. `add_domain` with the domain (`www.example.com`; the bare domain redirects to `www`). Give
   the human the `dns_records` exactly as returned, and where to add them at their DNS host.
   `root_domain` says how to point the bare domain there.
3. **Change only those records.** Never touch MX records (their email), SPF, DKIM or other
   TXT records, and don't move the nameservers. If the domain was bought through Wix or
   Squarespace and its DNS can't be edited enough, they can transfer it to a registrar
   first, but never in the middle of the move (transfers lock for 60 days).
4. Once they say the records are in, `check_domain` every few minutes until `status` is
   `active` (not in a loop: an account gets 20 domain calls in 10 minutes).
5. Run `verify https://www.example.com` against the real domain, and open the main pages.
6. **Only then** tell the human they can cancel the old builder's plan. Before they do: is
   every export done? Some builders delete everything on cancellation.

## After the move

- Keep the redirects for at least a year.
- If they use Google Search Console, submit `https://<domain>/sitemap-index.xml` there.
  Use its Change of Address tool only if the domain itself changed.
- Check for old addresses that now fail (Search Console's "Not found" list, or run
  `inventory --wayback` and `verify` again a week later) and add redirects for them.
