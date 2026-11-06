# Forms, signups, stores and embeds

`site.json` lists every form (`forms`, with each one's `purpose`, `provider` and fields) and
every embed (`embeds`, with the pages that use it). Rebuild each one as below, then tell the
human which ones appear once they claim the site and which once it's paid.

What loads from other sites depends on the site:

- **Temporary** (published without an account, not claimed yet): nothing from other sites.
- **Trial** (claimed, not paid yet): the copy-paste embeds of MailerLite, Kit, Mailchimp's
  embedded form, Substack, the Stripe and Shopify Buy Buttons, Payhip, Kickstarter, YouTube
  and Vimeo, and nothing else ("Embeds" in https://beautiful.host/llms.txt has the details).
- **Paid:** anything.

The browser blocks the rest without a warning at deploy. Build each embed as its provider
gives it, and put a plain link to the provider's own page next to anything that loads only on
paid sites: a link works on every site.

## Contact forms

A form that posted to the old builder (Wix, Squarespace, Weebly, WordPress plugins) stops
working when the old site goes. Rebuild it as a Beautiful form: markup only, no `action`,
no script.

```html
<form data-bty-form="contact" data-bty-redirect="/thanks/">
  <label>Name <input name="name" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Message <textarea name="message" required></textarea></label>
  <button>Send</button>
  <p data-bty-status></p>
</form>
```

- Keep the old form's field names, labels and required fields (they're in the capture).
  Drop its CAPTCHA: Beautiful adds its own spam trap.
- Paid sites only: each message is emailed to the site's owners and kept
  (`list_form_submissions`). On free and trial sites the form says it isn't taking messages
  yet. It can't be tested from a preview.
- Never rebuild password, card number or one-time-code fields: the deploy refuses them.
- Past submissions stay in the old builder: ask the human to download them before the old
  plan ends.

## Newsletter signups

Keep the human's newsletter provider: their list lives there, and Beautiful forms can't add
anyone to it. Copy the provider's form exactly (its `action` and field names are what puts
people on the list).

| Provider | How to recognize it | Rebuild it as | Loads on a trial |
|---|---|---|---|
| MailerLite | `assets.mailerlite.com/js/universal.js`, `<div class="ml-embedded" data-form>` | the same script and div | yes (not MailerLite Classic) |
| Kit (ConvertKit) | `<script data-uid src="https://….kit.com/…/index.js">`, `app.kit.com/forms/<id>/subscriptions` | the same script, or the form with its `action` | yes |
| Mailchimp | `<form action="https://….list-manage.com/subscribe/post?u=…&id=…">` | the form, unchanged (field names are the list's merge tags); its validator from `downloads.mailchimp.com/js/mc-validate.js` | yes (not pop-up forms) |
| Substack | its `/embed` iframe | the same iframe | yes |
| Flodesk, beehiiv, AWeber | their script or iframe | the same embed, plus a link to their signup page | no: the link until it's paid |
| A builder's own signup (Wix, Squarespace) | `purpose: "newsletter"`, no provider | ask which provider gets their list; if the builder was the newsletter, they need a new one (MailerLite or Kit have free plans) | as that provider |

## Stores, books and payments

- **Buy links** (`retail` in each page's capture: Amazon, Kobo, Apple Books, Barnes & Noble,
  Bookshop.org, Audible, Books2Read, BookFunnel, Payhip and more): plain links work on every
  site. Copy each `href` byte for byte: affiliate tags (`?tag=…-20`, Bookshop.org's
  `/a/<id>/`) are the author's income. Keep the affiliate disclosure if the old site had one.
  `verify` fails a page that lost one.
- **BookFunnel, Payhip, Gumroad, Ko-fi, Stripe Payment Links:** links work everywhere.
  Payhip's `payhip.js` and Stripe's `<stripe-buy-button>` load on trials too; Gumroad's and
  Ko-fi's scripts on paid sites only.
- **Shopify:** the store stays on Shopify. Link to it, or put the Buy Button
  (`sdks.shopifycdn.com/buy-button`, with the `your-store.myshopify.com` domain in the
  snippet) on the page: it loads on trials and paid sites. Give the store a `shop.` subdomain (a
  CNAME to `shops.myshopify.com`) and redirect the old product paths to it on paid sites
  (`/products/:slug https://shop.example.com/products/:slug 301`).
- **A builder's own store (Wix Stores, Squarespace Commerce):** it can't move. Keep a book
  page per product with its description, cover and buy links, and ask the human where they
  want to sell (Payhip and BookFunnel are common for authors, Shopify for physical goods).

## Video, audio, maps and booking

| Embed | Paid site | Trial |
|---|---|---|
| YouTube, Vimeo | the iframe behind a click: the thumbnail (imported as an image) with a play button that swaps in `youtube-nocookie.com/embed/<id>` (below) | the same |
| Spotify, SoundCloud | the iframe | a link |
| Calendly, Acuity | the inline widget, or a "Book a time" button to the booking page | the button |
| Google Maps | a click-to-load iframe | the address as text, linked to Google Maps |
| Instagram feed | a few recent posts as local images, linked to the profile | the same |
| Goodreads, Bookshop.org widgets | the widget | a link to the book |
| Disqus comments | the script | leave out, with a note to the human |
| Self-hosted video | `upload_asset` (paid) and a `<video>` with a poster | a poster linked to the video on YouTube or Vimeo |

A YouTube video behind a click: the thumbnail is imported (`{ "path":
"public/video/<id>.jpg", "url": "https://img.youtube.com/vi/<id>/hqdefault.jpg" }`), the
script swaps in the player, and the link opens the video on YouTube for a visitor without
JavaScript.

```astro
---
const { id, title } = Astro.props;
---
<a class="video" href={`https://www.youtube.com/watch?v=${id}`} data-id={id}>
  <img src={`/video/${id}.jpg`} alt={`Play: ${title}`} width="480" height="360" loading="lazy" />
</a>
<script>
  for (const a of document.querySelectorAll("a.video")) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const f = document.createElement("iframe");
      f.src = `https://www.youtube-nocookie.com/embed/${a.dataset.id}?autoplay=1`;
      f.title = a.querySelector("img")?.alt ?? "Video";
      f.allow = "autoplay; encrypted-media; picture-in-picture";
      f.allowFullscreen = true;
      f.width = "560";
      f.height = "315";
      a.replaceWith(f);
    });
  }
</script>
```

A temporary site (not claimed yet) blocks the player: there the click shows an empty frame
until the human claims the site.

## Analytics

`site.json`'s `analytics` names what the old site ran (Google Analytics, Meta Pixel, …). On a
paid site add the same tag with the same ID, so the human's history continues; ask first if
they still want it. Keep any `google-site-verification` and similar meta tags from the old
head. Drop dead trackers and accessibility overlays, and say so in your report.

## Anything else

Members areas, courses, booking systems and other apps that need accounts stay where they
are: link to them, and redirect their old paths there on a paid site. Never drop a feature
without telling the human.
