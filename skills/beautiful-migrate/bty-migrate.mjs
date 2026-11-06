#!/usr/bin/env node
// bty-migrate: capture an existing website so an agent can rebuild it as an Astro site on
// beautiful.host, keep every old URL working, and prove it. One file, no dependencies, Node 18+.
// The skill that drives it: https://beautiful.host/skill/migrate/SKILL.md
//
//   node bty-migrate.mjs inventory https://www.example.com   every page, post and file the old site has
//   node bty-migrate.mjs capture                             each page's text, images, links, menus, forms and embeds
//   node bty-migrate.mjs images                              original-size image URLs and the paths to import them at
//   node bty-migrate.mjs posts --site ./site                 blog posts as Markdown in an Astro content collection
//   node bty-migrate.mjs redirects --site ./site             a 301 for every old URL whose address changed
//   node bty-migrate.mjs head --site ./site                  every page's <head> tags, from the old site, as a component
//   node bty-migrate.mjs publish --site ./site --name "…"     the site's changed files and images as publish requests
//   node bty-migrate.mjs verify https://my-site.bty.site     every old URL on the new site, with a report
//   node bty-migrate.mjs lighthouse https://my-site.bty.site speed, accessibility and SEO scores, old and new
//
// Everything is written under ./migration (--dir). Each step can be run again: capture skips the
// pages it already has (--force fetches them again) and --limit caps one run.
// It reads public pages only, one request at a time, honoring robots.txt, and stops at a bot check.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

export const VERSION = "1.1.0";
export const USER_AGENT = `Mozilla/5.0 (compatible; BeautifulMigrate/${VERSION}; +https://beautiful.host/skill/migrate/SKILL.md)`;

// ---------------------------------------------------------------------------------------------
// HTML: a small, forgiving parser. Enough for real builder markup, not a spec implementation.

const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "plaintext"]);
const CLOSES_P = new Set(
  "address article aside blockquote details dialog div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre section table ul".split(" "),
);
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„", bull: "•",
  middot: "·", laquo: "«", raquo: "»", times: "×", divide: "÷", deg: "°", euro: "€", pound: "£", yen: "¥", cent: "¢",
  sect: "§", para: "¶", iexcl: "¡", iquest: "¿", shy: "­", zwj: "‍", zwnj: "‌", thinsp: " ",
  ensp: " ", emsp: " ", prime: "′", Prime: "″", larr: "←", rarr: "→", uarr: "↑", darr: "↓", hearts: "♥", star: "☆",
  aacute: "á", Aacute: "Á", agrave: "à", Agrave: "À", acirc: "â", auml: "ä", Auml: "Ä", atilde: "ã", aring: "å", aelig: "æ",
  ccedil: "ç", Ccedil: "Ç", eacute: "é", Eacute: "É", egrave: "è", Egrave: "È", ecirc: "ê", euml: "ë", iacute: "í",
  igrave: "ì", icirc: "î", iuml: "ï", ntilde: "ñ", Ntilde: "Ñ", oacute: "ó", Oacute: "Ó", ograve: "ò", ocirc: "ô",
  ouml: "ö", Ouml: "Ö", otilde: "õ", oslash: "ø", uacute: "ú", Uacute: "Ú", ugrave: "ù", ucirc: "û", uuml: "ü",
  Uuml: "Ü", szlig: "ß", yuml: "ÿ", oelig: "œ",
};

/** Decode HTML character references. */
export function decodeEntities(s) {
  if (!s || !s.includes("&")) return s ?? "";
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

function el(tag, attrs, parent) {
  return { tag, attrs, children: [], parent };
}

/** Parse HTML into { tag, attrs, children, parent } nodes; text nodes are { text, parent }. */
export function parseHtml(html) {
  const root = el("#root", {}, null);
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const popTo = (i) => stack.splice(i);
  const openIndex = (tag, stopAt = []) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].tag === tag) return i;
      if (stopAt.includes(stack[i].tag)) return -1;
    }
    return -1;
  };
  const addText = (text) => {
    if (!text) return;
    const parent = top();
    const last = parent.children[parent.children.length - 1];
    if (last && "text" in last) last.text += decodeEntities(text);
    else parent.children.push({ text: decodeEntities(text), parent });
  };
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      addText(html.slice(i));
      break;
    }
    if (lt > i) addText(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const close = html[lt + 1] === "/";
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(lt + (close ? 2 : 1), lt + 80));
    if (!nameMatch) {
      addText("<");
      i = lt + 1;
      continue;
    }
    const tag = nameMatch[0].toLowerCase();
    // The tag ends at the first > outside quotes.
    let j = lt + (close ? 2 : 1) + nameMatch[0].length;
    let quote = null;
    for (; j < n; j++) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    const inner = html.slice(lt + (close ? 2 : 1) + nameMatch[0].length, j);
    i = j + 1;
    if (close) {
      const at = openIndex(tag);
      if (at > 0) popTo(at);
      continue;
    }
    const attrs = {};
    for (const m of inner.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const name = m[1].toLowerCase();
      if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    }
    // Implied end tags.
    if (CLOSES_P.has(tag) || tag === "li" || tag === "dt" || tag === "dd") {
      const p = openIndex("p", ["div", "section", "article", "main", "td", "th", "li", "blockquote", "body"]);
      if (p > 0) popTo(p);
    }
    if (tag === "li") {
      const li = openIndex("li", ["ul", "ol", "menu"]);
      if (li > 0) popTo(li);
    }
    if (tag === "dt" || tag === "dd") {
      const d = Math.max(openIndex("dt", ["dl"]), openIndex("dd", ["dl"]));
      if (d > 0) popTo(d);
    }
    if (tag === "tr") {
      const tr = openIndex("tr", ["table", "tbody", "thead", "tfoot"]);
      if (tr > 0) popTo(tr);
    }
    if (tag === "td" || tag === "th") {
      const c = Math.max(openIndex("td", ["tr", "table"]), openIndex("th", ["tr", "table"]));
      if (c > 0) popTo(c);
    }
    if (tag === "option") {
      const o = openIndex("option", ["select", "datalist"]);
      if (o > 0) popTo(o);
    }
    const node = el(tag, attrs, top());
    top().children.push(node);
    if (VOID.has(tag) || inner.trimEnd().endsWith("/") && (tag === "svg" || tag.includes(":") || tag === "path")) continue;
    if (RAW_TEXT.has(tag)) {
      const endRe = new RegExp(`</${tag}\\s*>`, "i");
      const rest = html.slice(i);
      const m = endRe.exec(rest);
      const raw = m ? rest.slice(0, m.index) : rest;
      if (raw) node.children.push({ text: tag === "title" || tag === "textarea" ? decodeEntities(raw) : raw, parent: node });
      i += m ? m.index + m[0].length : rest.length;
      continue;
    }
    stack.push(node);
  }
  return root;
}

/** Every element under `node` (depth first) for which `pred` is true. */
export function findAll(node, pred, out = []) {
  for (const c of node.children ?? []) {
    if (!c.tag) continue;
    if (pred(c)) out.push(c);
    findAll(c, pred, out);
  }
  return out;
}

export function find(node, pred) {
  for (const c of node.children ?? []) {
    if (!c.tag) continue;
    if (pred(c)) return c;
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
}

const classesOf = (n) => (n.attrs?.class ?? "").split(/\s+/).filter(Boolean);
const hasClass = (n, c) => classesOf(n).includes(c);
const isTag = (...tags) => (n) => tags.includes(n.tag);
const ancestors = function* (n) {
  for (let p = n.parent; p; p = p.parent) yield p;
};
const inside = (n, pred) => {
  for (const a of ancestors(n)) if (a.tag && pred(a)) return true;
  return false;
};

const SKIP_TEXT = new Set(["script", "style", "noscript", "template", "svg", "iframe", "head", "select", "button"]);
const BLOCK = new Set([...CLOSES_P, "li", "dd", "dt", "tr", "td", "th", "br", "body", "html", "img", "picture", "video", "audio"]);

/** The readable text of a node: whitespace collapsed, blocks on their own lines. */
export function textOf(node) {
  const parts = [];
  const walk = (n) => {
    if ("text" in n) {
      parts.push(n.text);
      return;
    }
    if (SKIP_TEXT.has(n.tag) || isHidden(n)) return;
    const block = BLOCK.has(n.tag);
    if (block) parts.push("\n");
    for (const c of n.children) walk(c);
    if (block) parts.push("\n");
  };
  walk(node);
  return parts
    .join("")
    .replace(/[ \t\r\f ]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

function isHidden(n) {
  const a = n.attrs ?? {};
  if ("hidden" in a || a["aria-hidden"] === "true" && n.tag !== "a") return true;
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.style ?? "");
}

// ---------------------------------------------------------------------------------------------
// URLs

const ASSET_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|json|xml|txt|woff2?|ttf|otf|eot|mp4|webm|mov|m4v|mp3|wav|m4a|ogg|zip|gz|rar|7z|dmg|exe)$/i;
const FILE_EXT = /\.(?:pdf|epub|mobi|docx?|xlsx?|pptx?|csv|zip|mp3|m4a|mp4|mov)$/i;
const SKIP_PATH = /^\/(?:wp-admin|wp-login|wp-json|cart|checkout|account|my-account|login|signin|sign-in|logout|search|cdn-cgi|_api|_partials|xmlrpc\.php|feed\/?$|comments\/feed)/i;
const TRACKING = /^(?:utm_\w+|fbclid|gclid|mc_cid|mc_eid|_ga|ref|share|amp|format|replytocom|preview|preview_id|_hs\w+|hsCtaTracking)$/i;

/** The www and bare forms of a host are one site. */
export const siteHost = (host) => host.toLowerCase().replace(/^www\./, "");

/** A same-site URL in the form the inventory keys it by: no hash, no tracking parameters, sorted query. */
export function canonicalUrl(href, base) {
  let u;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = "";
  const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = params.length ? `?${new URLSearchParams(params)}` : "";
  return u.toString();
}

/** The local file name a page's capture is saved under. */
export function pageKey(url) {
  const u = new URL(url);
  const exact = u.pathname + u.search;
  if (exact === "/") return "index";
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {}
  let key = path.replace(/^\/+|\/+$/g, "").replace(/[^\p{L}\p{N}._-]+/gu, "_").toLowerCase() || "index";
  if (u.search) key += `__${u.search.slice(1).replace(/[^\p{L}\p{N}]+/gu, "_")}`;
  // The readable part can be the same for two paths (/a-b/c and /a-b_c, /About and /about on a
  // case-insensitive disk): a short hash of the exact path keeps them apart.
  return `${key.slice(0, 160)}.${fnv(exact)}`;
}

/** An 8-hex-digit FNV-1a hash. */
function fnv(s) {
  let h = 0x811c9dc5;
  for (const c of new TextEncoder().encode(s)) h = Math.imul(h ^ c, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** What kind of URL this is on the old site, from its path alone. */
export function classifyPath(pathAndQuery, platform = "") {
  // A folder's index file is the folder: /blog/index.html is the blog's list.
  const p = pathAndQuery.toLowerCase().replace(/\/index\.(?:html?|php|aspx?)(?=$|\?)/, "/");
  if (FILE_EXT.test(p.split("?")[0])) return "file";
  if (/\/(?:feed|rss)(?:\/|\.xml)?$|blog-feed\.xml|[?&]format=rss/.test(p)) return "feed";
  if (/\/(?:page\/\d+\/?$)|[?&](?:page|offset|paged)=/.test(p)) return "pagination";
  if (/\/(?:tag|tags|category|categories|topics?|label)\/|[?&](?:tag|category|cat)=|\/blog\/(?:categories|tags|hashtags)\//.test(p)) return "taxonomy";
  if (/\/(?:author|authors)\/[^/]+\/?$/.test(p) && platform !== "squarespace") return "author";
  if (/\/(?:product-page|products?|shop\/p|store\/p|item)\/[^/]+/.test(p)) return "product";
  if (/^\/post\/[^/]+/.test(p) && platform === "wix") return "post";
  if (/^\/\d{4}\/\d{1,2}(?:\/\d{1,2})?\/[^/]+/.test(p)) return "post";
  if (/^\/(?:blog|news|journal|posts?|articles?|updates|diary|musings)\/(?!$)[^?]+/.test(p)) return "post";
  if (/[?&]p=\d+/.test(p)) return "post";
  if (/[?&]page_id=\d+/.test(p)) return "page";
  return "page";
}

// ---------------------------------------------------------------------------------------------
// Platforms

/** Which builder made the site, from its homepage HTML and response headers. */
export function detectPlatform(html, headers = {}) {
  const h = (k) => String(headers[k] ?? headers[k.toLowerCase()] ?? "");
  const gen = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i.exec(html)?.[1] ?? "";
  if (/wix\.com/i.test(gen) || /static\.wixstatic\.com|static\.parastorage\.com/.test(html) || h("x-wix-request-id")) return "wix";
  if (/squarespace/i.test(gen) || /static1\.squarespace\.com|images\.squarespace-cdn\.com|Static\.SQUARESPACE_CONTEXT/.test(html)) return "squarespace";
  if (/shopify/i.test(gen) || /cdn\.shopify\.com|Shopify\.theme/.test(html) || h("x-shopid") || h("x-shopify-stage")) return "shopify";
  if (/webflow/i.test(gen) || /data-wf-page|data-wf-site|website-files\.com|uploads-ssl\.webflow\.com/.test(html)) return "webflow";
  if (/^ghost/i.test(gen) || /ghost-(?:portal|sdk)|content\/images\/size\//.test(html)) return "ghost";
  if (/substack/i.test(gen) || /substackcdn\.com/.test(html)) return "substack";
  if (/wordpress/i.test(gen) || /\/wp-content\/|\/wp-includes\/|wp-json/.test(html)) return "wordpress";
  if (/weebly/i.test(gen) || /editmysite\.com|weebly\.com/.test(html)) return "weebly";
  if (/godaddy|websites\.godaddy|starfield/i.test(gen) || /img1\.wsimg\.com|wsimg\.com\/isteam/.test(html)) return "godaddy";
  if (/carrd/i.test(gen) || /carrd\.co/.test(html)) return "carrd";
  if (/hostinger|zyro/i.test(gen) || /zyrosite|userapp\.zyrosite/.test(html)) return "hostinger";
  if (/jimdo/i.test(gen) || /jimdo|jimstatic/.test(html)) return "jimdo";
  if (/framer/i.test(gen) || /framerusercontent\.com/.test(html)) return "framer";
  if (/hugo|jekyll|eleventy|gatsby|next\.js|astro/i.test(gen)) return gen.split(/\s/)[0].toLowerCase();
  return "unknown";
}

/** Sitemaps each platform publishes besides the one robots.txt names. */
const PLATFORM_SITEMAPS = {
  wordpress: ["/wp-sitemap.xml", "/sitemap_index.xml", "/sitemap.xml"],
  default: ["/sitemap.xml", "/sitemap_index.xml"],
};

/**
 * The original, full-size URL of an image a builder serves resized. Builders put the size in the
 * URL; dropping it gets the file the owner uploaded.
 */
export function originalImageUrl(src) {
  let u;
  try {
    u = new URL(src);
  } catch {
    return src;
  }
  const host = u.hostname;
  // Cloudflare's image resizing, on any host: /cdn-cgi/image/width=600,format=auto/<path or URL>
  // -> the source. The resized address may not answer a server's fetch.
  const cf = /^\/cdn-cgi\/image\/[^/]+\/(.+)$/.exec(u.pathname);
  if (cf) {
    let source = /^https?%3A/i.test(cf[1]) ? decodeURIComponent(cf[1]) : cf[1];
    if (!/^https?:\/\//i.test(source)) source = `${u.origin}/${source.replace(/^\/+/, "")}`;
    return originalImageUrl(`${source}${u.search}`);
  }
  // Wix: /media/<id>~mv2.jpg/v1/fill/w_600,h_400,.../name.jpg -> /media/<id>~mv2.jpg
  if (host === "static.wixstatic.com") {
    const m = /^(\/media\/[^/]+)/.exec(u.pathname);
    if (m) return `https://static.wixstatic.com${m[1]}`;
  }
  // Squarespace: ?format=500w -> the original (no format). 2500w keeps it web-sized.
  if (host === "images.squarespace-cdn.com" || host.endsWith(".squarespace.com")) {
    u.search = "";
    u.searchParams.set("format", "2500w");
    return u.toString();
  }
  // Shopify: name_600x400.jpg, name_600x.jpg, name_x600@2x.jpg, ?width=600
  if (host === "cdn.shopify.com" || u.pathname.includes("/cdn/shop/")) {
    u.pathname = u.pathname.replace(/_(?:\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?:_crop_\w+)?(?:@\d+x)?(\.\w+)$/i, "$1");
    for (const k of ["width", "height", "crop"]) u.searchParams.delete(k);
    return u.toString();
  }
  // Webflow: name-p-500.jpeg -> name.jpeg
  if (/webflow\.com$|website-files\.com$/.test(host)) {
    u.pathname = u.pathname.replace(/-p-\d+(\.\w+)$/, "$1");
    return u.toString();
  }
  // GoDaddy: .../file.jpg/:/rs=w:600,h:400 -> .../file.jpg
  if (host.endsWith("wsimg.com")) {
    u.pathname = u.pathname.replace(/\/:\/.*$/, "");
    u.search = "";
    return u.toString();
  }
  // Substack: /image/fetch/w_1456,c_limit,.../https%3A%2F%2F... -> the inner URL
  if (host === "substackcdn.com") {
    const m = /\/image\/fetch\/[^/]+\/(https?%3A.*)$/.exec(u.pathname);
    if (m) return decodeURIComponent(m[1]);
  }
  // Ghost: /content/images/size/w600/2023/05/x.jpg -> /content/images/2023/05/x.jpg
  if (/\/content\/images\/(?:size|format)\//.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/content\/images\/size\/[^/]+\//, "/content/images/").replace(/\/content\/images\/format\/[^/]+\//, "/content/images/");
    return u.toString();
  }
  // Framer: ?scale-down-to=512 -> the original.
  if (host === "framerusercontent.com") {
    u.search = "";
    return u.toString();
  }
  // Duda: /dms3rep/multi/opt/name-1920w.webp -> /dms3rep/multi/name.webp
  if (host.endsWith("cdn-website.com")) {
    u.pathname = u.pathname.replace(/\/opt\//, "/").replace(/-\d+w(\.\w+)$/, "$1");
    return u.toString();
  }
  // Jetpack's image CDN: i0.wp.com/example.com/path?w=1000 -> https://example.com/path
  if (/^i\d\.wp\.com$/.test(host)) return originalImageUrl(`https://${u.pathname.slice(1)}`);
  // WordPress: name-300x200.jpg -> name.jpg, drop resize params.
  if (/\/wp-content\/uploads\/|\/files\/\d{4}\/\d{2}\//.test(u.pathname)) {
    u.pathname = u.pathname.replace(/-\d+x\d+(\.\w+)$/, "$1");
    for (const k of ["resize", "fit", "w", "h", "ssl", "quality", "strip"]) u.searchParams.delete(k);
    return u.toString();
  }
  return u.toString();
}

/** The largest candidate in a srcset. */
export function largestFromSrcset(srcset, base) {
  let best = null;
  let bestW = -1;
  // As browsers read it: a URL runs to whitespace (it may hold commas, as Wix's do), then a descriptor to the next comma.
  const parts = [];
  const str = srcset ?? "";
  for (let i = 0; i < str.length; ) {
    while (i < str.length && /[\s,]/.test(str[i])) i++;
    let j = i;
    while (j < str.length && !/\s/.test(str[j])) j++;
    let url = str.slice(i, j);
    let size = "";
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else {
      const k = str.indexOf(",", j);
      size = str.slice(j, k < 0 ? str.length : k).trim();
      j = k < 0 ? str.length : k + 1;
    }
    if (url) parts.push([url, size || "1x"]);
    i = j;
  }
  for (const [url, size] of parts) {
    const w = parseFloat(size) * (size.endsWith("x") ? 1000 : 1);
    if (w > bestW) {
      bestW = w;
      best = url;
    }
  }
  return best ? absolute(best, base) : null;
}

const absolute = (href, base) => {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------------------------
// What a page holds

const SOCIAL = [
  ["instagram", /instagram\.com/], ["facebook", /facebook\.com|fb\.me/], ["tiktok", /tiktok\.com/],
  ["x", /(?:^|\.)(?:twitter|x)\.com/], ["threads", /threads\.net/], ["bluesky", /bsky\.app/],
  ["youtube", /youtube\.com|youtu\.be/], ["pinterest", /pinterest\./], ["linkedin", /linkedin\.com/],
  ["goodreads", /goodreads\.com/], ["bookbub", /bookbub\.com/], ["amazon-author", /amazon\.[a-z.]+\/(?:stores\/|-\/e\/|.*\/e\/B0)/],
  ["patreon", /patreon\.com/], ["substack", /substack\.com/], ["mastodon", /mastodon\.|mstdn\./], ["spotify", /spotify\.com/],
];
const RETAILERS = [
  ["amazon", /(?:^|\.)amazon\.[a-z.]+$|^a\.co$|^amzn\.(?:to|eu)$/], ["audible", /audible\./], ["kobo", /kobo\.com$/],
  ["barnes-noble", /barnesandnoble\.com$/], ["apple-books", /books\.apple\.com$|itunes\.apple\.com$/],
  ["google-play", /play\.google\.com$/], ["bookshop", /bookshop\.org$/], ["books2read", /books2read\.com$/],
  ["indiebound", /indiebound\.org$/], ["waterstones", /waterstones\.com$/], ["booksamillion", /booksamillion\.com$/],
  ["smashwords", /smashwords\.com$/], ["draft2digital", /draft2digital\.com$/], ["bookfunnel", /bookfunnel\.com$/],
  ["payhip", /payhip\.com$/], ["gumroad", /gumroad\.com$/], ["ko-fi", /ko-fi\.com$/], ["kickstarter", /kickstarter\.com$/],
  ["target", /target\.com$/], ["walmart", /walmart\.com$/], ["libro-fm", /libro\.fm$/], ["chirp", /chirpbooks\.com$/],
  ["scribd", /scribd\.com|everand\.com/], ["storygraph", /thestorygraph\.com$/], ["universal-book-link", /^(?:mybook\.to|getbook\.at|viewbook\.at|geni\.us)$/],
];
const EMBEDS = [
  ["youtube", "video", /youtube(?:-nocookie)?\.com\/(?:embed|watch)|youtu\.be\//],
  ["vimeo", "video", /player\.vimeo\.com|vimeo\.com\/\d+/],
  ["wistia", "video", /wistia\.(?:com|net)/],
  ["spotify", "audio", /open\.spotify\.com\/embed/],
  ["soundcloud", "audio", /soundcloud\.com/],
  ["google-maps", "map", /google\.[a-z.]+\/maps|maps\.google\.|maps\.googleapis\.com/],
  ["calendly", "booking", /calendly\.com/],
  ["acuity", "booking", /acuityscheduling\.com|squarespacescheduling\.com/],
  ["mailerlite", "newsletter", /mailerlite\.com|mlcdn\.com|ml-attr|groot\.mailerlite/],
  ["kit", "newsletter", /convertkit\.com|ck\.page|kit\.com|kit-mail/],
  ["mailchimp", "newsletter", /list-manage\.com|chimpstatic\.com|mailchi\.mp|mc\.us\d+/],
  ["flodesk", "newsletter", /flodesk\.com/],
  ["beehiiv", "newsletter", /beehiiv\.com/],
  ["substack", "newsletter", /substack\.com\/embed|\.substack\.com\/embed/],
  ["aweber", "newsletter", /aweber\.com/],
  ["mailerpoet", "newsletter", /mailpoet/],
  ["bookfunnel", "store", /bookfunnel\.com/],
  ["payhip", "store", /payhip\.com/],
  ["shopify-buy-button", "store", /sdks\.shopifycdn\.com\/buy-button|ShopifyBuy/],
  ["gumroad", "store", /gumroad\.com/],
  ["stripe", "store", /js\.stripe\.com\/v3\/buy-button|buy\.stripe\.com/],
  ["ko-fi", "store", /ko-fi\.com/],
  ["bookshop", "store", /bookshop\.org\/(?:widgets|a\/)/],
  ["goodreads-widget", "widget", /goodreads\.com\/(?:widgets|review\/grid_widget)/],
  ["instagram-embed", "social", /instagram\.com\/(?:p|reel)\/|instagram\.com\/embed/],
  ["twitter-embed", "social", /platform\.twitter\.com|twitter-tweet/],
  ["tiktok-embed", "social", /tiktok\.com\/embed/],
  ["facebook-embed", "social", /facebook\.com\/plugins/],
  ["typeform", "form", /typeform\.com/],
  ["formspree", "form", /formspree\.io/],
  ["getform", "form", /getform\.io/],
  ["basin", "form", /usebasin\.com/],
  ["hubspot-forms", "form", /hsforms\.(?:com|net)|forms\.hubspot\.com/],
  ["netlify-forms", "form", /data-netlify/],
  ["google-forms", "form", /docs\.google\.com\/forms/],
  ["jotform", "form", /jotform\.com/],
  ["tally", "form", /tally\.so/],
  ["google-docs", "document", /docs\.google\.com\/(?:document|presentation|spreadsheets)/],
  ["pdf-viewer", "document", /\.pdf(?:$|\?)/],
  ["disqus", "comments", /disqus\.com/],
];
const ANALYTICS = /googletagmanager\.com|google-analytics\.com|gtag\(|fbevents\.js|connect\.facebook\.net|plausible\.io|hotjar|clarity\.ms|segment\.com|matomo|pinimg\.com\/ct|static\.ads-twitter/;

const hostOf = (href) => {
  try {
    return new URL(href).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const matchHost = (list, href) => list.find((row) => row[row.length - 1].test(hostOf(href)) || row[row.length - 1].test(href))?.[0] ?? null;

/** The element that holds a page's own content, not its header, menus and footer. */
export function mainContent(doc) {
  const body = find(doc, isTag("body")) ?? doc;
  const tries = [
    (n) => hasClass(n, "entry-content") || hasClass(n, "post-content") || hasClass(n, "article-content") || hasClass(n, "blog-item-content"),
    (n) => n.tag === "article" && !inside(n, (a) => a.tag === "article"),
    (n) => n.tag === "main" || n.attrs.role === "main",
    (n) => n.attrs.id === "PAGES_CONTAINER" || n.attrs.id === "page" || n.attrs.id === "content" || n.attrs.id === "main" || n.attrs.id === "primary",
  ];
  for (const t of tries) {
    const hits = findAll(body, t);
    const best = hits.sort((a, b) => textOf(b).length - textOf(a).length)[0];
    if (best && textOf(best).length >= 120) return best;
  }
  return body;
}

const isChrome = (n) => n.tag === "header" || n.tag === "nav" || n.tag === "footer" || n.attrs.role === "navigation" || n.attrs.role === "banner" || n.attrs.role === "contentinfo" || n.attrs.id === "SITE_HEADER" || n.attrs.id === "SITE_FOOTER";

/** Alt text, unless a builder filled it with the file's name. */
const realAlt = (alt) => {
  const t = (alt ?? "").trim();
  return /\.(?:png|jpe?g|gif|webp|avif|svg|heic)$/i.test(t) || /^(?:img|image|dsc|photo)?[_-]?[0-9a-f-]{6,}$/i.test(t) ? "" : t;
};

/** The image a node shows, at its original size, with lazy-loading attributes resolved. */
function imageOf(n, base) {
  const a = n.attrs;
  const srcset = a["data-srcset"] || a["data-lazy-srcset"] || a.srcset;
  const fromSet = srcset ? largestFromSrcset(srcset, base) : null;
  const raw = a["data-image"] || a["data-src"] || a["data-lazy-src"] || a["data-original"] || a["data-pin-media"] || a.src;
  const src = fromSet || (raw && !raw.startsWith("data:") ? absolute(raw, base) : null);
  if (!src) return null;
  return {
    src,
    original: originalImageUrl(src),
    alt: realAlt(a.alt),
    width: Number(a.width) || Number(a["data-image-dimensions"]?.split("x")[0]) || null,
    height: Number(a.height) || Number(a["data-image-dimensions"]?.split("x")[1]) || null,
  };
}

function linkList(nodes, base, siteHostname) {
  const out = [];
  const seen = new Set();
  for (const a of nodes) {
    const href = absolute(a.attrs.href ?? "", base);
    if (!href || /^(?:javascript|mailto|tel):/i.test(a.attrs.href ?? "")) {
      if (/^(?:mailto|tel):/i.test(a.attrs.href ?? "") && !seen.has(a.attrs.href)) {
        seen.add(a.attrs.href);
        out.push({ text: textOf(a).replace(/\n/g, " "), href: a.attrs.href });
      }
      continue;
    }
    const text = textOf(a).replace(/\n/g, " ") || a.attrs["aria-label"] || a.attrs.title || find(a, isTag("img"))?.attrs.alt || "";
    const key = `${href}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const internal = siteHost(hostOf(href)) === siteHostname;
    out.push({ text, href: internal ? pathOf(href) : href, ...(internal ? { internal: true } : {}) });
  }
  return out;
}

const pathOf = (href) => {
  const u = new URL(href);
  return u.pathname + u.search + u.hash;
};

/** Everything worth keeping from one page of the old site. */
export function extractPage(html, url) {
  const doc = parseHtml(html);
  const head = find(doc, isTag("head")) ?? doc;
  const body = find(doc, isTag("body")) ?? doc;
  const siteHostname = siteHost(new URL(url).hostname);
  const baseHref = find(head, isTag("base"))?.attrs.href;
  const base = baseHref ? absolute(baseHref, url) : url;
  const meta = (key) => {
    const m = find(head, (n) => n.tag === "meta" && ((n.attrs.name ?? "").toLowerCase() === key || (n.attrs.property ?? "").toLowerCase() === key));
    return m?.attrs.content?.trim() || null;
  };
  const og = {};
  for (const m of findAll(head, (n) => n.tag === "meta" && /^(?:og|twitter|article|book):/i.test(n.attrs.property ?? n.attrs.name ?? ""))) {
    const k = (m.attrs.property ?? m.attrs.name).toLowerCase();
    if (!(k in og)) og[k] = m.attrs.content ?? "";
  }
  const main = mainContent(doc);
  const content = main === body ? body : main;
  const contentText = (() => {
    if (content !== body) return textOf(content);
    // No main element: the body without its header, menus and footer.
    const clone = { ...body, children: body.children.filter((c) => !c.tag || !isChrome(c)) };
    return textOf(clone);
  })();

  const headings = findAll(content, isTag("h1", "h2", "h3", "h4"))
    .map((h) => ({ level: Number(h.tag[1]), text: textOf(h).replace(/\n/g, " ") }))
    .filter((h) => h.text);
  const h1 = findAll(body, isTag("h1")).map((h) => textOf(h).replace(/\n/g, " ")).filter(Boolean);

  const images = [];
  const seenImg = new Set();
  const addImage = (img, where) => {
    if (!img || seenImg.has(img.original) || /\.svg(?:$|\?)/i.test(img.original) && where === "content" && !img.alt) return;
    if (/pixel|spacer|blank\.gif|transparent\.png|facebook\.com\/tr/.test(img.original)) return;
    seenImg.add(img.original);
    images.push({ ...img, where });
  };
  for (const n of findAll(body, (x) => x.tag === "img" || x.tag === "source" && x.parent?.tag === "picture")) {
    if (n.tag === "source" && find(n.parent, isTag("img"))) continue;
    addImage(imageOf(n, base), inside(n, isChrome) ? "chrome" : "content");
  }
  for (const n of findAll(body, (x) => /background(?:-image)?\s*:[^;]*url\(/i.test(x.attrs.style ?? "") || x.attrs["data-bg"] || x.attrs["data-background-image"])) {
    const m = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(n.attrs.style ?? "");
    const src = absolute(m?.[1] ?? n.attrs["data-bg"] ?? n.attrs["data-background-image"], base);
    if (src && !src.startsWith("data:")) addImage({ src, original: originalImageUrl(src), alt: "", width: null, height: null }, "background");
  }
  const ogImage = og["og:image"] ? absolute(og["og:image"], base) : null;

  const allLinks = findAll(body, (n) => n.tag === "a" && n.attrs.href);
  const navNodes = findAll(body, (n) => n.tag === "nav" || n.attrs.role === "navigation" || n.tag === "header" || n.attrs.id === "SITE_HEADER");
  const topNav = navNodes.filter((n) => !navNodes.some((o) => o !== n && inside(n, (a) => a === o)));
  const footer = find(body, (n) => n.tag === "footer" || n.attrs.role === "contentinfo" || n.attrs.id === "SITE_FOOTER");
  const links = linkList(allLinks.filter((a) => !inside(a, isChrome)), base, siteHostname);
  const nav = linkList(topNav.flatMap((n) => findAll(n, (x) => x.tag === "a" && x.attrs.href)), base, siteHostname);
  const footerLinks = footer ? linkList(findAll(footer, (x) => x.tag === "a" && x.attrs.href), base, siteHostname) : [];
  const everyLink = linkList(allLinks, base, siteHostname);
  const social = [];
  const retail = [];
  for (const l of everyLink) {
    if (l.internal || !/^https?:/.test(l.href)) continue;
    const r = matchHost(RETAILERS, l.href);
    const s = r ? null : matchHost(SOCIAL, l.href);
    if (r) retail.push({ retailer: r, text: l.text, href: l.href });
    else if (s && !social.some((x) => x.href === l.href)) social.push({ network: s, href: l.href });
  }

  const embeds = [];
  for (const f of findAll(body, isTag("iframe", "embed", "object", "video", "audio"))) {
    const src = absolute(f.attrs.src || f.attrs["data-src"] || f.attrs.data || find(f, isTag("source"))?.attrs.src || "", base);
    if (!src || ANALYTICS.test(src)) continue;
    const provider = matchHost(EMBEDS, src) ?? (f.tag === "video" || f.tag === "audio" ? `self-hosted-${f.tag}` : hostOf(src));
    const kind = EMBEDS.find(([p]) => p === provider)?.[1] ?? (f.tag === "video" || f.tag === "audio" ? f.tag : "iframe");
    embeds.push({ provider, kind, tag: f.tag, src, title: f.attrs.title ?? null });
  }
  const scripts = [];
  for (const s of findAll(doc, isTag("script"))) {
    const src = s.attrs.src ? absolute(s.attrs.src, base) : null;
    const code = s.children[0]?.text ?? "";
    const probe = src ?? code.slice(0, 4000);
    if (ANALYTICS.test(probe)) {
      const name = /googletagmanager|google-analytics|gtag/.test(probe) ? "google-analytics" : /facebook|fbevents/.test(probe) ? "meta-pixel" : (/(plausible|hotjar|clarity|segment|matomo|pinimg|twitter)/.exec(probe)?.[1] ?? "analytics");
      if (!scripts.some((x) => x.provider === name)) scripts.push({ provider: name, kind: "analytics", src });
      continue;
    }
    const provider = matchHost(EMBEDS, probe);
    if (provider && !embeds.some((e) => e.provider === provider) && !scripts.some((x) => x.provider === provider)) {
      scripts.push({ provider, kind: EMBEDS.find(([p]) => p === provider)[1], src });
    }
  }
  for (const s of scripts) if (s.kind !== "analytics") embeds.push({ provider: s.provider, kind: s.kind, tag: "script", src: s.src });

  const forms = findAll(body, isTag("form")).map((f) => {
    const action = f.attrs.action ? absolute(f.attrs.action, base) : null;
    const fields = findAll(f, isTag("input", "textarea", "select"))
      .filter((x) => !["hidden", "submit", "button", "image", "reset"].includes((x.attrs.type ?? "").toLowerCase()))
      .map((x) => {
        const id = x.attrs.id;
        const label = (id && find(f, (l) => l.tag === "label" && l.attrs.for === id)) || [...ancestors(x)].find((a) => a.tag === "label");
        return {
          name: x.attrs.name ?? id ?? null,
          type: x.tag === "input" ? (x.attrs.type ?? "text").toLowerCase() : x.tag,
          label: (label ? textOf(label).replace(/\n/g, " ") : "") || x.attrs.placeholder || x.attrs["aria-label"] || null,
          required: "required" in x.attrs || x.attrs["aria-required"] === "true",
        };
      });
    const cls = `${f.attrs.class ?? ""} ${f.attrs.id ?? ""} ${f.parent?.attrs?.class ?? ""}`;
    const provider = (action && matchHost(EMBEDS, action)) || (/wpcf7/.test(cls) ? "contact-form-7" : /wpforms/.test(cls) ? "wpforms" : /gform/.test(cls) ? "gravity-forms" : /elementor/.test(cls) ? "elementor" : /sqs|newsletter-form|form-wrapper/.test(cls) ? "squarespace" : null);
    const emails = fields.filter((x) => x.type === "email" || /e-?mail/i.test(`${x.name} ${x.label}`)).length;
    const purpose = /search/i.test(`${f.attrs.role ?? ""} ${cls} ${action ?? ""}`) || fields.some((x) => x.type === "search" || x.name === "s" || x.name === "q") ? "search"
      : fields.length <= 3 && emails === 1 && !fields.some((x) => x.type === "textarea") ? "newsletter"
      : fields.some((x) => x.type === "password") ? "login"
      : "contact";
    return { purpose, provider, action, method: (f.attrs.method ?? "get").toLowerCase(), fields };
  });

  const jsonLd = [];
  for (const s of findAll(doc, (n) => n.tag === "script" && /ld\+json/i.test(n.attrs.type ?? ""))) {
    try {
      jsonLd.push(JSON.parse(s.children[0]?.text ?? ""));
    } catch {
      /* builders sometimes ship broken JSON-LD; skip it */
    }
  }
  const ldTypes = jsonLd.flatMap((j) => (Array.isArray(j) ? j : j["@graph"] ?? [j])).flatMap((j) => [].concat(j?.["@type"] ?? []));

  const fonts = new Set();
  for (const l of findAll(doc, (n) => n.tag === "link" && /fonts\.googleapis\.com|use\.typekit\.net|fonts\.bunny\.net|fast\.fonts\.net/.test(n.attrs.href ?? ""))) {
    const href = l.attrs.href;
    if (/typekit/.test(href)) fonts.add("Adobe Fonts (Typekit): licensed to the old builder");
    for (const fam of href.matchAll(/family=([^&:]+)/g)) fonts.add(`${decodeURIComponent(fam[1]).replace(/\+/g, " ")} (Google Fonts)`);
  }
  for (const s of findAll(doc, isTag("style"))) {
    for (const m of (s.children[0]?.text ?? "").matchAll(/@font-face\s*{[^}]*font-family\s*:\s*['"]?([^;'"}]+)/gi)) fonts.add(m[1].trim());
  }

  const robots = (meta("robots") ?? "").toLowerCase();
  const canonical = find(head, (n) => n.tag === "link" && (n.attrs.rel ?? "").toLowerCase() === "canonical")?.attrs.href ?? null;
  const feeds = findAll(head, (n) => n.tag === "link" && /alternate/i.test(n.attrs.rel ?? "") && /rss|atom/i.test(n.attrs.type ?? "")).map((n) => absolute(n.attrs.href, base)).filter(Boolean);
  const hreflang = findAll(head, (n) => n.tag === "link" && n.attrs.hreflang && n.attrs.href).map((n) => ({ lang: n.attrs.hreflang, href: n.attrs.href }));
  const published = og["article:published_time"] || jsonLd.map((j) => j.datePublished).find(Boolean) || find(body, (n) => n.tag === "time" && n.attrs.datetime)?.attrs.datetime || null;

  const scriptCount = findAll(doc, isTag("script")).length;

  // What a visitor never sees but search engines and speed depend on.
  const verification = {};
  for (const m of findAll(head, (n) => n.tag === "meta" && VERIFY_META.test(n.attrs.name ?? ""))) verification[m.attrs.name.toLowerCase()] = m.attrs.content ?? "";
  const ownHost = (u) => {
    const h = hostOf(u);
    return !h || siteHost(h) === siteHostname || /(?:^|\.)beautiful\.host$|(?:^|\.)bty\.site$/.test(h);
  };
  const scriptSrcs = findAll(doc, (n) => n.tag === "script" && n.attrs.src).map((n) => ({ n, src: absolute(n.attrs.src, base) })).filter((x) => x.src);
  const blocking = scriptSrcs
    .filter(({ n }) => inside(n, isTag("head")) && !("async" in n.attrs) && !("defer" in n.attrs) && (n.attrs.type ?? "").toLowerCase() !== "module")
    .map((x) => x.src);
  const imgNodes = findAll(body, isTag("img")).filter((n) => !isHidden(n));
  const sized = (n) => (n.attrs.width && n.attrs.height) || /aspect-ratio|(?:^|;)\s*height\s*:/i.test(n.attrs.style ?? "");
  // The first big picture is usually the page's largest paint: it must not wait for lazy loading.
  const hero = imgNodes.find((n) => !(Number(n.attrs.width) > 0 && Number(n.attrs.width) < 200));
  const tech = {
    html_bytes: Buffer.byteLength(html),
    viewport: meta("viewport"),
    charset: !!find(head, (n) => n.tag === "meta" && ("charset" in n.attrs || /content-type/i.test(n.attrs["http-equiv"] ?? ""))),
    verification,
    twitter_card: og["twitter:card"] ?? null,
    site_name: og["og:site_name"] ?? null,
    favicon_declared: !!find(head, (n) => n.tag === "link" && /(?:^|\s)icon(?:\s|$)/i.test(n.attrs.rel ?? "") && n.attrs.href),
    apple_touch_icon: (() => {
      const href = find(head, (n) => n.tag === "link" && /apple-touch-icon/i.test(n.attrs.rel ?? ""))?.attrs.href;
      return href ? absolute(href, base) : null;
    })(),
    theme_color: meta("theme-color"),
    blocking_scripts: blocking,
    third_party_scripts: [...new Set(scriptSrcs.map((x) => x.src).filter((u) => !ownHost(u)).map(hostOf))],
    stylesheets: findAll(doc, (n) => n.tag === "link" && /stylesheet/i.test(n.attrs.rel ?? "")).length,
    preloads: findAll(head, (n) => n.tag === "link" && /preload/i.test(n.attrs.rel ?? "")).map((n) => ({ href: n.attrs.href ?? n.attrs.imagesrcset ?? "", as: n.attrs.as ?? null })),
    images: imgNodes.length,
    images_unsized: imgNodes.filter((n) => !sized(n)).length,
    images_no_alt: imgNodes.filter((n) => !("alt" in n.attrs)).length,
    hero_lazy: hero ? (hero.attrs.loading ?? "").toLowerCase() === "lazy" : false,
    insecure: findAll(doc, (n) => /^http:\/\//i.test(n.attrs.src ?? "") || n.tag === "link" && /stylesheet|icon|preload/i.test(n.attrs.rel ?? "") && /^http:\/\//i.test(n.attrs.href ?? "")).length,
  };
  return {
    url,
    title: textOf(find(head, isTag("title")) ?? { tag: "x", attrs: {}, children: [] }).replace(/\n/g, " ") || null,
    description: meta("description"),
    canonical: canonical ? absolute(canonical, base) : null,
    lang: find(doc, isTag("html"))?.attrs.lang ?? null,
    noindex: /noindex/.test(robots),
    og,
    og_image: ogImage ? originalImageUrl(ogImage) : null,
    favicon: absolute((find(head, (n) => n.tag === "link" && /(?:^|\s)icon(?:\s|$)/i.test(n.attrs.rel ?? "") && n.attrs.href) ?? find(head, (n) => n.tag === "link" && /icon/i.test(n.attrs.rel ?? "") && n.attrs.href))?.attrs.href ?? "/favicon.ico", base),
    published,
    types: [...new Set([og["og:type"], ...ldTypes].filter(Boolean))],
    h1,
    headings,
    text: contentText,
    words: contentText.split(/\s+/).filter(Boolean).length,
    markdown: toMarkdown(content, base),
    images,
    links,
    nav,
    footer: footer ? { text: textOf(footer), links: footerLinks } : null,
    social,
    retail,
    embeds,
    forms,
    analytics: scripts.filter((s) => s.kind === "analytics").map((s) => s.provider),
    json_ld: jsonLd,
    fonts: [...fonts],
    feeds,
    hreflang,
    tech,
    // A page whose text is nearly all in scripts needs a real browser to see.
    needs_browser: contentText.split(/\s+/).length < 40 && scriptCount > 8,
  };
}

// ---------------------------------------------------------------------------------------------
// HTML to Markdown, for posts and simple pages

const MD_SKIP = new Set(["script", "style", "noscript", "template", "svg", "form", "button", "select", "input", "textarea", "nav", "iframe", "head"]);

/** Markdown for a content node: headings, paragraphs, links, images, lists, quotes, code, tables. */
export function toMarkdown(node, base) {
  const out = [];
  const inline = (n) => {
    // Markdown would read a literal < as HTML: the old page showed it as text.
    if ("text" in n) return n.text.replace(/\s+/g, " ").replace(/([\\`*_[\]])/g, "\\$1").replace(/&(?=#?[a-z0-9]+;)/gi, "&amp;").replace(/</g, "&lt;");
    if (MD_SKIP.has(n.tag) || isHidden(n)) return "";
    const kids = () => n.children.map(inline).join("");
    switch (n.tag) {
      case "br":
        return "  \n";
      case "strong":
      case "b": {
        const t = kids().trim();
        return t ? `**${t}**` : "";
      }
      case "em":
      case "i": {
        const t = kids().trim();
        return t ? `*${t}*` : "";
      }
      case "code":
        return `\`${textOf(n)}\``;
      case "a": {
        const t = kids().trim();
        const href = n.attrs.href ? absolute(n.attrs.href, base) ?? n.attrs.href : null;
        if (!href || /^javascript:/i.test(href)) return t;
        return t ? `[${t}](${mdUrl(href, base)})` : "";
      }
      case "img": {
        const img = imageOf(n, base);
        return img ? `![${(img.alt || "").replace(/[[\]]/g, "")}](${img.original})` : "";
      }
      default:
        // A block inside an inline element (a card's <div> inside its <a>): its text stays inline.
        if (BLOCK.has(n.tag)) return ` ${kids()} `;
        return kids();
    }
  };
  const mdUrl = (href, b) => {
    const h = hostOf(href);
    return h && siteHost(h) === siteHost(hostOf(b)) ? pathOf(href) : href;
  };
  const para = (s) => {
    // Two spaces before a newline are a line break (from <br>); other runs of spaces go.
    const t = s.replace(/(?<! ) \n|\t+\n/g, "\n").replace(/ {3,}\n/g, "  \n").replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "");
    if (t) out.push(t);
  };
  const block = (n, nested = false) => {
    if ("text" in n) {
      if (n.text.trim()) para(inline(n));
      return "";
    }
    if (MD_SKIP.has(n.tag) || isHidden(n)) return "";
    if (/^h[1-6]$/.test(n.tag)) {
      const t = n.children.map(inline).join("").trim();
      if (t) out.push(`${"#".repeat(Number(n.tag[1]))} ${t.replace(/\n+/g, " ")}`);
      return "";
    }
    switch (n.tag) {
      case "p":
        para(n.children.map(inline).join(""));
        return "";
      case "hr":
        out.push("---");
        return "";
      case "pre":
        out.push(`\`\`\`\n${textOfPre(n)}\n\`\`\``);
        return "";
      case "blockquote": {
        const inner = toMarkdown({ tag: "div", attrs: {}, children: n.children, parent: n.parent }, base);
        if (inner) out.push(inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"));
        return "";
      }
      case "ul":
      case "ol": {
        const items = n.children.filter((c) => c.tag === "li");
        const lines = items.map((li, idx) => {
          const md = toMarkdown(li, base).replace(/\n\n+/g, "\n");
          const marker = n.tag === "ol" ? `${idx + 1}.` : "-";
          return md ? `${marker} ${md.split("\n").join(`\n${" ".repeat(marker.length + 1)}`)}` : null;
        }).filter(Boolean);
        if (lines.length) out.push(lines.join("\n"));
        return "";
      }
      case "figure": {
        const img = find(n, isTag("img"));
        const cap = find(n, isTag("figcaption"));
        if (img) para(inline(img));
        const caption = cap ? textOf(cap).replace(/\n/g, " ").trim() : "";
        if (caption) para(`*${caption}*`);
        if (!img) for (const c of n.children) if (c.tag !== "figcaption") block(c);
        return "";
      }
      case "img":
      case "picture": {
        const img = n.tag === "img" ? n : find(n, isTag("img"));
        if (img) para(inline(img));
        return "";
      }
      case "table": {
        const rows = findAll(n, isTag("tr")).map((r) => r.children.filter((c) => c.tag === "td" || c.tag === "th").map((c) => c.children.map(inline).join("").trim().replace(/\|/g, "\\|").replace(/\n/g, " ")));
        if (rows.length) {
          const w = Math.max(...rows.map((r) => r.length));
          const line = (r) => `| ${Array.from({ length: w }, (_, k) => r[k] ?? "").join(" | ")} |`;
          out.push([line(rows[0]), `|${" --- |".repeat(w)}`, ...rows.slice(1).map(line)].join("\n"));
        }
        return "";
      }
      default: {
        // A container: blocks go out on their own; runs of inline content become paragraphs.
        let run = "";
        const flush = () => {
          if (run.trim()) para(run);
          run = "";
        };
        for (const c of n.children) {
          if (c.tag && (BLOCK.has(c.tag) || /^h[1-6]$/.test(c.tag) || hasBlockInside(c)) && c.tag !== "br") {
            flush();
            block(c);
          } else run += inline(c);
        }
        flush();
        return nested ? "" : "";
      }
    }
  };
  block(node);
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function hasBlockInside(n) {
  return n.tag && !["a", "span", "strong", "em", "b", "i", "u", "small", "sup", "sub", "mark", "code", "label"].includes(n.tag) && n.children.some((c) => c.tag && (BLOCK.has(c.tag) || /^h[1-6]$/.test(c.tag) || hasBlockInside(c)));
}

function textOfPre(n) {
  const parts = [];
  const walk = (x) => ("text" in x ? parts.push(x.text) : x.tag === "br" ? parts.push("\n") : x.children.forEach(walk));
  walk(n);
  return parts.join("").replace(/\n$/, "");
}

// ---------------------------------------------------------------------------------------------
// robots.txt and sitemaps

/** The rules robots.txt gives us (our own group, else `*`), its sitemaps and crawl delay. */
export function parseRobots(txt) {
  const groups = [];
  let current = null;
  const sitemaps = [];
  for (const raw of (txt ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!current || current.rules.length || current.delay != null) groups.push((current = { agents: [], rules: [], delay: null }));
      current.agents.push(value.toLowerCase());
    } else if (current && (key === "allow" || key === "disallow")) current.rules.push({ allow: key === "allow", path: value });
    else if (current && key === "crawl-delay") current.delay = Number(value) || null;
  }
  const ours = groups.find((g) => g.agents.some((a) => a !== "*" && "beautifulmigrate".includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  return { rules: ours?.rules ?? [], delay: ours?.delay ?? null, sitemaps };
}

/** Whether robots.txt lets us fetch a path: the longest matching rule wins, Allow on a tie. */
export function robotsAllows(robots, pathAndQuery) {
  let best = null;
  for (const r of robots.rules) {
    if (!r.path) continue;
    const re = new RegExp(`^${r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
    if (re.test(pathAndQuery) && (!best || r.path.length > best.path.length || r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

/** A sitemap's page URLs (with lastmod and images) and the child sitemaps of an index. */
export function parseSitemap(xml) {
  const pages = [];
  const children = [];
  const tag = (s, name) => decodeEntities(new RegExp(`<(?:\\w+:)?${name}>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</(?:\\w+:)?${name}>`, "i").exec(s)?.[1]?.trim() ?? "");
  for (const m of xml.matchAll(/<(?:\w+:)?sitemap>([\s\S]*?)<\/(?:\w+:)?sitemap>/gi)) {
    const loc = tag(m[1], "loc");
    if (loc) children.push(loc);
  }
  for (const m of xml.matchAll(/<(?:\w+:)?url>([\s\S]*?)<\/(?:\w+:)?url>/gi)) {
    const loc = tag(m[1], "loc");
    if (!loc) continue;
    const images = [...m[1].matchAll(/<image:loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/image:loc>/gi)].map((x) => decodeEntities(x[1].trim()));
    pages.push({ url: loc, lastmod: tag(m[1], "lastmod") || null, ...(images.length ? { images } : {}) });
  }
  return { pages, children };
}

// ---------------------------------------------------------------------------------------------
// Redirects

/** Where an old path lives on the new site when the agent kept it: Astro's directory URLs. */
export function defaultNewPath(oldPath) {
  const [path, query] = oldPath.split("?");
  if (query) return null; // a query-string URL needs a page the agent chose
  // A file (a PDF, a feed, an image) keeps its address: import it at the same path.
  if (/\.\w{1,5}$/.test(path) && !/\.(?:html?|php|aspx?|cfm|shtml)$/i.test(path)) return path;
  let p = path.replace(/\/index\.(?:html?|php|aspx?)$/i, "/").replace(/\.(?:html?|php|aspx?|cfm|shtml)$/i, "");
  if (!p.endsWith("/")) p += "/";
  return p;
}

const slashless = (p) => p.replace(/\/+$/, "") || "/";

/**
 * The _redirects lines for old URLs whose address changed. `pages` are the inventory's
 * { path } entries (path with any query); `map` is the agent's { oldPath: newPath } for pages
 * it moved. Returns { lines, unmapped, kept }.
 */
export function redirectLines(pages, map = {}) {
  const lines = [];
  const unmapped = [];
  let kept = 0;
  const seen = new Set();
  const all = new Set(pages.map((p) => p.path));
  for (const { path } of pages) {
    if (seen.has(path)) continue;
    seen.add(path);
    const target = map[path] ?? map[slashless(path)] ?? map[`${slashless(path)}/`] ?? defaultNewPath(path);
    if (!target) {
      unmapped.push(path);
      continue;
    }
    if (target === "-") continue; // the agent dropped it on purpose
    const [p, q] = path.split("?");
    // Host redirects /about to /about/ by itself, so only a real change needs a rule.
    if (!q && (target === p || slashless(p) === slashless(target.split("?")[0]) && !/\.\w+$/.test(p))) {
      kept++;
      continue;
    }
    const enc = (s) => s.replace(/\s/g, "%20");
    if (q) {
      const conds = [...new URLSearchParams(q)].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join(" ");
      lines.push(`${enc(p)} ${conds} ${enc(target)} 301`);
    } else {
      lines.push(`${enc(p)} ${enc(target)} 301`);
      // Host adds the slash only to a page that exists, so /old without it needs its own rule.
      const bare = slashless(p);
      if (p !== "/" && p.endsWith("/") && !all.has(bare) && !seen.has(bare)) {
        seen.add(bare);
        lines.push(`${enc(bare)} ${enc(target)} 301`);
      }
    }
  }
  return { lines, unmapped, kept };
}

const BEGIN = "# bty-migrate: old URLs (start)";
const END = "# bty-migrate: old URLs (end)";

/** `existing` _redirects with our block replaced by `lines`, the agent's own rules kept. */
export function mergeRedirects(existing, lines) {
  const block = [BEGIN, ...lines, END].join("\n");
  if (existing.includes(BEGIN) && existing.includes(END)) {
    return existing.slice(0, existing.indexOf(BEGIN)) + block + existing.slice(existing.indexOf(END) + END.length);
  }
  return `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}\n`;
}

// ---------------------------------------------------------------------------------------------
// Verify

const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}']+/gu, " ").trim();

/** How much of the old page's text the new page has: the share of its sentences found. */
export function textCoverage(oldText, newText) {
  const have = ` ${norm(newText)} `;
  const sentences = (oldText ?? "")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map(norm)
    .filter((s) => s.split(" ").length >= 5);
  if (!sentences.length) return { coverage: 1, missing: [] };
  const missing = sentences.filter((s) => !have.includes(` ${s} `) && !have.includes(s));
  return { coverage: 1 - missing.length / sentences.length, missing };
}

/** One old page against the page the new site served for its URL. */
const VERIFY_META = /^(?:google-site-verification|msvalidate\.01|yandex-verification|facebook-domain-verification|p:domain_verify|baidu-site-verification|norton-safeweb-site-verification|ahrefs-site-verification)$/i;

/**
 * Search and speed checks of a new page: the tags nobody sees. `old` is the old page's capture,
 * `finalUrl` where the new page was served, `hosts` the hostnames its canonical may name (the
 * new site's and the old domain's, which the site moves to). Each issue has group "tech".
 */
export function checkTech(now, old, finalUrl, hosts = []) {
  const t = now.tech ?? {};
  const out = [];
  const add = (level, check, extra = {}) => out.push({ group: "tech", level, check, ...extra });
  if (!t.viewport) add("fail", "viewport", { note: "no <meta name=\"viewport\">: phones show the desktop layout, and search ranks it lower" });
  if (now.noindex && !old?.noindex) add("fail", "noindex", { note: "asks search engines not to index a page the old site let them index" });
  const page = new URL(finalUrl);
  let c = null;
  try {
    c = now.canonical ? new URL(now.canonical, finalUrl) : null;
  } catch {
    add("fail", "canonical-invalid", { note: "the canonical link isn't a URL" });
  }
  if (!now.canonical) add("warn", "canonical", { note: "no canonical link" });
  else if (c) {
    const okHost = [page.hostname, ...hosts].some((h) => siteHost(h) === siteHost(c.hostname));
    if (slashless(c.pathname) !== slashless(page.pathname)) add("fail", "canonical-target", { note: "the canonical link points at another page, so search engines drop this one" });
    else if (!okHost) add("info", `canonical-domain ${c.hostname}`, { note: `canonical links on ${c.hostname}: right only if that's the domain the site moves to (site in astro.config.mjs)` });
  }
  if (!now.lang) add("warn", "lang", { note: "no lang on <html>" });
  if (!now.og["og:title"]) add("info", "og:title", { note: "no og:title" });
  if (!now.og_image && old?.og_image) add("warn", "og:image", { note: "lost its social image (og:image)" });
  if (!t.twitter_card) add("info", "twitter:card", { note: "no twitter:card" });
  const types = new Set(now.types ?? []);
  const lostTypes = (old?.types ?? []).filter((x) => !types.has(x) && !/^(?:website|WebPage|WebSite|BreadcrumbList|ImageObject|SiteNavigationElement|WPHeader|WPFooter)$/i.test(x));
  if (lostTypes.length) add("warn", "structured-data", { note: `lost structured data: ${lostTypes.join(", ")}` });
  const lostVerify = Object.keys(old?.tech?.verification ?? {}).filter((k) => !(k in (t.verification ?? {})));
  if (lostVerify.length && slashless(page.pathname) === "/") add("warn", "verification", { note: `lost ${lostVerify.join(", ")}: search consoles stop trusting the site` });
  if ((old?.hreflang?.length ?? 0) > (now.hreflang?.length ?? 0)) add("warn", "hreflang", { note: "lost hreflang links" });
  if ((now.h1?.length ?? 0) !== 1) add("info", "h1", { note: "not exactly one h1: give each page one" });
  if (t.images_unsized) add("warn", "image-size", { note: "images without width and height: the page jumps as they load" });
  if (t.images_no_alt) add("warn", "alt", { note: "images without alt" });
  if (t.hero_lazy) add("warn", "lcp-lazy", { note: "the first large image is loading=\"lazy\": it's usually the largest paint, so load it eagerly with fetchpriority=\"high\"" });
  if (t.blocking_scripts?.length) add("warn", "blocking-scripts", { note: "scripts in <head> without async or defer hold up the page" });
  if (t.html_bytes > 150_000) add("warn", "html-weight", { note: "HTML over 150 KB: inline styles, SVG or data URIs to move out" });
  if (t.insecure) add("warn", "insecure", { note: "http:// resources: browsers block them on an https page" });
  for (const h of t.third_party_scripts ?? []) add("info", `third-party ${h}`, { note: `scripts from ${h}` });
  if (!t.charset) add("info", "charset", { note: "no <meta charset>" });
  return out;
}

export function comparePage(old, now) {
  const issues = [];
  // The page's own title, without a site-name suffix ("About | Mara Vale").
  const strip = (t) => norm(String(t).replace(/\s+(?:\||-|–|—|·)\s+(?:(?!\s(?:\||-|–|—|·)\s).)*$/, ""));
  if (old.title && now.title && norm(old.title) !== norm(now.title)) {
    issues.push({ level: strip(old.title) === strip(now.title) ? "info" : "warn", check: "title", old: old.title, new: now.title });
  }
  if (old.title && !now.title) issues.push({ level: "fail", check: "title", old: old.title, new: null });
  if (old.description && !now.description) issues.push({ level: "warn", check: "description", old: old.description, new: null });
  if (old.h1?.[0] && !now.h1?.some((h) => norm(h) === norm(old.h1[0]))) issues.push({ level: "warn", check: "h1", old: old.h1[0], new: now.h1?.[0] ?? null });
  const { coverage, missing } = textCoverage(old.text, now.text);
  if (coverage < 0.95) issues.push({ level: coverage < 0.8 ? "fail" : "warn", check: "text", coverage: Math.round(coverage * 100), missing: missing.slice(0, 5) });
  const oldImgs = old.images.filter((i) => i.where === "content").length;
  const newImgs = now.images.filter((i) => i.where === "content").length;
  if (newImgs < oldImgs) issues.push({ level: "warn", check: "images", old: oldImgs, new: newImgs });
  const newHrefs = new Set(now.retail.map((r) => r.href.replace(/\/$/, "")));
  const lostBuy = old.retail.filter((r) => !newHrefs.has(r.href.replace(/\/$/, "")));
  if (lostBuy.length) issues.push({ level: "fail", check: "buy-links", missing: lostBuy.map((r) => r.href) });
  const oldForms = old.forms.filter((f) => f.purpose !== "search").length;
  const newForms = now.forms.filter((f) => f.purpose !== "search").length + now.embeds.filter((e) => ["newsletter", "form"].includes(e.kind)).length;
  if (newForms < oldForms) issues.push({ level: "warn", check: "forms", old: oldForms, new: newForms });
  // A link to the same provider counts: a click-to-load video or a free site's link in place of the player.
  const linked = new Set([...now.links, ...now.retail].map((l) => /^https?:/.test(l.href) && matchHost(EMBEDS, l.href)).filter(Boolean));
  const lostEmbeds = old.embeds.filter((e) => ["video", "audio", "map", "booking"].includes(e.kind) && !now.embeds.some((n) => n.provider === e.provider) && !linked.has(e.provider));
  if (lostEmbeds.length) issues.push({ level: "warn", check: "embeds", missing: lostEmbeds.map((e) => `${e.provider} ${e.src ?? ""}`.trim()) });
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Network

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thrown when the old site answers with a bot check: we stop, never get past it. */
export class BotCheck extends Error {}

export function looksLikeBotCheck(status, body) {
  if (![403, 429, 503, 202].includes(status)) return false;
  return /cf-chl|challenge-platform|Just a moment\.\.\.|Attention Required|captcha|px-captcha|_Incapsula_|perimeterx|ddos-guard|sucuri_cloudproxy|Checking your browser/i.test(body.slice(0, 20000));
}

function makeFetcher({ delay = 1000, robots = null, quiet = false } = {}) {
  let last = 0;
  let wait = delay;
  const get = async (url, { redirect = "follow", accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", polite = true } = {}) => {
    if (polite) {
      const gap = Date.now() - last;
      if (gap < wait) await sleep(wait - gap);
    }
    last = Date.now();
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, { redirect, headers: { "user-agent": USER_AGENT, accept, "accept-language": "en;q=0.9,*;q=0.5" }, signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        if (attempt < 2) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        const cause = e.cause?.code ?? e.cause?.message ?? e.message;
        throw new Error(`${url}: ${cause}${/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|UND_ERR_CONNECT/.test(String(cause)) && process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY ? " (behind a proxy? run with NODE_USE_ENV_PROXY=1)" : ""}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const bytes = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
      const body = bytes.toString("utf8");
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        const retry = Number(res.headers.get("retry-after")) || 10 * (attempt + 1);
        wait = Math.min(Math.max(wait * 2, 2000), 30_000); // slow down for the rest of the run
        if (!quiet) console.error(`  ${res.status} from ${new URL(url).host}: waiting ${retry}s, then one request every ${wait / 1000}s`);
        await sleep(retry * 1000);
        continue;
      }
      if (looksLikeBotCheck(res.status, body)) throw new BotCheck(`${url} answered with a bot check (HTTP ${res.status}).`);
      return { status: res.status, url: res.url || url, headers: Object.fromEntries(res.headers), body, bytes, location: res.headers.get("location") };
    }
  };
  get.allowed = (url) => !robots || robotsAllows(robots, pathOf(url).replace(/#.*$/, ""));
  return get;
}

// ---------------------------------------------------------------------------------------------
// Files

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);
const writeJson = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
};
const writeText = (p, s) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
};

// A path built from the old site's data, refused unless it stays inside base: a hostile site
// must never make the script write anywhere else on this computer.
export function within(base, rel) {
  const root = resolve(base);
  const full = resolve(root, rel);
  if (!full.startsWith(root + sep)) throw new Error(`Refused to write ${rel}: it would land outside ${base}.`);
  return full;
}

// A URL path as safe folder and file names: each segment decoded, or null when one is empty,
// a dot segment, or holds a separator or control character once decoded.
export function safeSegments(pathname) {
  const parts = pathname.replace(/^\/+/, "").split("/");
  const out = [];
  for (const raw of parts) {
    let seg;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!seg || seg === "." || seg === ".." || /[\/\\\0-\x1f:]/.test(seg)) return null;
    out.push(seg);
  }
  return out.join("/");
}

function need(dir, file, step) {
  const p = join(dir, file);
  if (!existsSync(p)) {
    console.error(`No ${p} yet. Run \`node bty-migrate.mjs ${step}\` first.`);
    process.exit(1);
  }
  return readJson(p);
}

// ---------------------------------------------------------------------------------------------
// Commands

const PAGE_KINDS = new Set(["page", "post", "product", "author", "taxonomy", "pagination"]);

async function inventory(start, opts) {
  const dir = opts.dir;
  const max = Number(opts.max ?? 5000);
  let origin = new URL(/^https?:\/\//.test(start) ? start : `https://${start}`);
  const plain = makeFetcher({ delay: Number(opts.delay ?? 1000) });
  let home = await plain(origin.toString());
  if (home.status >= 400) throw new Error(`${origin} answered HTTP ${home.status}.`);
  origin = new URL(home.url);
  // A builder address (name.wixsite.com, name.squarespace.com) whose canonical is the site's own domain: use that.
  const canon = /<link[^>]+rel=["']canonical["'][^>]*>/i.exec(home.body)?.[0];
  const canonHref = canon && /href=["']([^"']+)/i.exec(canon)?.[1];
  if (canonHref && !opts["keep-host"]) {
    const c = new URL(decodeEntities(canonHref), origin);
    if (siteHost(c.hostname) !== siteHost(origin.hostname)) {
      console.log(`${origin.host}'s main address is ${c.host}: listing that (--keep-host to list ${origin.host} instead).`);
      const again = await plain(c.origin + origin.pathname).catch(() => null);
      if (again && again.status < 400) {
        home = again;
        origin = new URL(again.url);
      }
    }
  }
  const host = siteHost(origin.hostname);
  // A site in a folder (example.com/news/) is that folder only.
  const scope = origin.pathname.replace(/[^/]*$/, "");
  const platform = detectPlatform(home.body, home.headers);
  console.log(`${origin.origin}${scope}: ${platform === "unknown" ? "builder not recognized" : platform}`);

  const robotsRes = await plain(new URL("/robots.txt", origin).toString(), { accept: "text/plain,*/*" }).catch(() => null);
  if (robotsRes && robotsRes.status >= 500) throw new Error(`${origin.origin}/robots.txt answered HTTP ${robotsRes.status}: robots.txt rules say to crawl nothing then. Try again later.`);
  const robots = robotsRes?.status === 200 && !/<html/i.test(robotsRes.body.slice(0, 500)) ? parseRobots(robotsRes.body) : { rules: [], delay: null, sitemaps: [] };
  const delay = Math.max(Number(opts.delay ?? 1000), (robots.delay ?? 0) * 1000);
  const get = makeFetcher({ delay, robots });

  const pages = new Map();
  const add = (url, via, extra = {}, kind = null) => {
    const c = canonicalUrl(url, origin);
    if (!c) return;
    const u = new URL(c);
    if (siteHost(u.hostname) !== host) return;
    const path = u.pathname + u.search;
    if (!u.pathname.startsWith(scope) && !extra.legacy) return;
    if (!kind && (SKIP_PATH.test(u.pathname) || ASSET_EXT.test(u.pathname) && !FILE_EXT.test(u.pathname))) return;
    if (pages.has(path)) {
      const p = pages.get(path);
      if (!p.found_via.includes(via)) p.found_via.push(via);
      Object.assign(p, Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null)));
      return;
    }
    if (pages.size >= max) return;
    pages.set(path, { path, url: `${origin.origin}${path}`, kind: kind ?? classifyPath(path, platform), found_via: [via], ...extra });
  };

  // The homepage and its links first: they're the menu, and must never fall past --max.
  add(origin.toString(), "homepage");
  const linksOf = (html, base) => [...html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"'#][^"']*)["']/gi)].map((m) => decodeEntities(m[1])).map((h) => absolute(h, base)).filter(Boolean);
  for (const l of linksOf(home.body, origin)) add(l, "homepage-links");
  // Its feeds: readers' apps follow them, so they keep their address too.
  for (const m of home.body.matchAll(/<link\b[^>]*rel=["']alternate["'][^>]*>/gi)) {
    const href = /type=["']application\/(?:rss|atom)\+xml["']/i.test(m[0]) && /href=["']([^"']+)/i.exec(m[0])?.[1];
    if (href && !/comments/.test(href)) add(absolute(decodeEntities(href), origin), "feed-link", {}, "feed");
  }

  // Sitemaps: robots.txt's, then the usual places.
  const ownMaps = (PLATFORM_SITEMAPS[platform] ?? PLATFORM_SITEMAPS.default).map((p) => new URL(p.slice(1), `${origin.origin}${scope}`).toString());
  const robotsMaps = robots.sitemaps.filter((m) => scope === "/" || (hostOf(m) === origin.hostname && new URL(m).pathname.startsWith(scope)));
  const queue = [...new Set([...robotsMaps, ...ownMaps])];
  const seenMaps = new Set();
  const foundMaps = [];
  let sitemapPages = 0;
  while (queue.length && seenMaps.size < 200 && pages.size < max) {
    const sm = queue.shift();
    if (seenMaps.has(sm)) continue;
    seenMaps.add(sm);
    const res = await get(sm, { accept: "application/xml,text/xml,*/*" }).catch((e) => (e instanceof BotCheck ? Promise.reject(e) : null));
    if (!res || res.status !== 200 || !/<(?:\w+:)?(?:urlset|sitemapindex)/i.test(res.body)) continue;
    foundMaps.push(sm);
    const { pages: urls, children } = parseSitemap(res.body);
    queue.push(...children);
    for (const p of urls) add(p.url, "sitemap", { lastmod: p.lastmod, sitemap_images: p.images });
    sitemapPages += urls.length;
    if (urls.length || children.length) console.log(`  ${sm}: ${urls.length} URLs${children.length ? `, ${children.length} sitemaps` : ""}`);
  }

  // Without a sitemap, a crawl of the site's own links.
  if (!sitemapPages || opts.crawl) {
    console.log(sitemapPages ? "  crawling links as well (--crawl)" : "  no sitemap: following the site's links");
    const done = new Set([pathOf(origin.toString())]);
    const crawlMax = Math.min(max, Number(opts["crawl-max"] ?? 500));
    let fetched = 0;
    for (const p of pages.values()) {
      if (fetched >= crawlMax) break;
      if (done.has(p.path) || p.kind === "file" || !get.allowed(p.url)) continue;
      done.add(p.path);
      const res = await get(p.url).catch((e) => (e instanceof BotCheck ? Promise.reject(e) : null));
      fetched++;
      if (!res || res.status !== 200 || !/html/i.test(res.headers["content-type"] ?? "")) continue;
      for (const l of linksOf(res.body, res.url)) add(l, "links");
    }
  }

  // Old URLs search engines and other sites still link to, from the Wayback Machine.
  if (opts.wayback) {
    const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(host)}/*&output=json&fl=original,statuscode,mimetype&filter=statuscode:200&filter=mimetype:text/html&collapse=urlkey&limit=20000`;
    const res = await plain(cdx, { accept: "application/json" }).catch(() => null);
    let n = 0;
    if (res?.status === 200) {
      for (const [orig] of JSON.parse(res.body || "[]").slice(1)) {
        const c = canonicalUrl(orig.replace(/^http:/, "https:"), origin);
        if (!c) continue;
        const path = new URL(c).pathname + new URL(c).search;
        if (!pages.has(path)) {
          add(c, "wayback", { legacy: true });
          n++;
        }
      }
      console.log(`  Wayback Machine: ${n} older URLs the site doesn't list any more`);
    } else console.log("  Wayback Machine: no answer, skipped");
  }

  const list = [...pages.values()].filter((p) => p.legacy || get.allowed(p.url) || (p.blocked_by_robots = true));
  const inv = {
    tool: `bty-migrate ${VERSION}`,
    source: origin.origin,
    scope,
    platform,
    taken_at: new Date().toISOString(),
    robots: { delay_s: robots.delay, disallow: robots.rules.filter((r) => !r.allow).map((r) => r.path) },
    sitemaps: foundMaps.filter((m) => siteHost(hostOf(m)) === host).map((m) => pathOf(m)),
    pages: list.sort((a, b) => a.path.localeCompare(b.path)),
  };
  writeJson(join(dir, "inventory.json"), inv);
  const counts = {};
  for (const p of inv.pages) counts[p.legacy ? "legacy" : p.kind] = (counts[p.legacy ? "legacy" : p.kind] ?? 0) + 1;
  console.log(`\n${inv.pages.length} URLs: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  const blocked = inv.pages.filter((p) => p.blocked_by_robots).length;
  if (blocked) console.log(`${blocked} are disallowed by robots.txt: capture skips them.`);
  if (pages.size >= max) console.log(`Stopped at --max ${max}.`);
  console.log(`Wrote ${join(dir, "inventory.json")}. Next: node bty-migrate.mjs capture`);
}

async function capture(opts) {
  const dir = opts.dir;
  const inv = need(dir, "inventory.json", "inventory <url>");
  const robotsRes = await fetch(new URL("/robots.txt", inv.source), { headers: { "user-agent": USER_AGENT } }).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  const robots = parseRobots(robotsRes);
  const get = makeFetcher({ delay: Math.max(Number(opts.delay ?? 1000), (robots.delay ?? 0) * 1000), robots });
  const only = opts.only ? new Set(String(opts.only).split(",")) : null;
  const todo = inv.pages.filter((p) => PAGE_KINDS.has(p.kind) && !p.legacy && !p.blocked_by_robots && (!only || only.has(p.path)));
  const limit = Number(opts.limit ?? Infinity);
  let done = 0;
  let skipped = 0;
  const failures = [];
  const browser = opts.browser ? await openBrowser() : null;
  try {
    for (const p of todo) {
      const key = pageKey(p.url);
      const jsonPath = join(dir, "pages", `${key}.json`);
      if (!opts.force && existsSync(jsonPath)) {
        skipped++;
        continue;
      }
      if (done >= limit) break;
      let res;
      try {
        if (browser && done > 0) await sleep(Math.max(Number(opts.delay ?? 1000), (robots.delay ?? 0) * 1000));
        res = browser ? await browser.get(p.url, join(dir, "screenshots", `${key}.png`)) : await get(p.url);
      } catch (e) {
        if (e instanceof BotCheck) throw e;
        failures.push({ path: p.path, error: e.message });
        continue;
      }
      done++;
      if (res.status >= 400) {
        failures.push({ path: p.path, status: res.status });
        writeJson(jsonPath, { url: p.url, path: p.path, status: res.status });
        continue;
      }
      if (!/html/i.test(res.headers["content-type"] ?? "text/html")) {
        // Not a page (a feed, a file): recorded so later runs don't fetch it again.
        writeJson(jsonPath, { url: p.url, path: p.path, status: res.status, content_type: res.headers["content-type"] ?? null });
        continue;
      }
      writeText(join(dir, "pages", `${key}.html`), res.body);
      const page = extractPage(res.body, res.url);
      const finalPath = pathOf(res.url).replace(/#.*$/, "");
      const record = { path: p.path, status: res.status, ...(finalPath !== p.path ? { redirected_to: finalPath } : {}), kind: refineKind(p.kind, page), ...page };
      writeJson(jsonPath, record);
      if (done % 10 === 0 || done === 1) console.log(`  ${done}/${Math.min(todo.length - skipped, limit)} ${p.path}`);
    }
  } catch (e) {
    if (e instanceof BotCheck) {
      console.error(`\nStopped: ${e.message}\nThe old site checks for bots. Don't try to get past it: ask the human to export their content from the builder (see the skill's references/platforms.md), or to open each page in their own browser.`);
      process.exitCode = 2;
    } else throw e;
  } finally {
    await browser?.close();
  }
  if (inv.platform === "wordpress" && !opts.only && process.exitCode !== 2 && (opts.force || !existsSync(join(dir, "wordpress.json")))) await wordpressApi(inv, dir, get);
  const summary = summarize(dir, inv);
  writeJson(join(dir, "site.json"), summary);
  console.log(`\nCaptured ${done} pages${skipped ? ` (${skipped} already captured; --force to fetch again)` : ""}.${failures.length ? ` ${failures.length} failed: ${failures.slice(0, 5).map((f) => `${f.path} ${f.status ?? f.error}`).join("; ")}` : ""}`);
  const left = todo.length - skipped - done;
  if (left > 0) console.log(`${left} pages left: run capture again to continue.`);
  printSummary(summary);
  console.log(`Wrote ${join(dir, "pages/")} and ${join(dir, "site.json")}. Next: node bty-migrate.mjs images`);
}

function refineKind(kind, page) {
  if (page.types.some((t) => /^(?:article|BlogPosting|NewsArticle|Article)$/i.test(t)) && (kind === "page" || kind === "post")) return "post";
  if (page.types.some((t) => /^(?:product|Product|Book|book)$/.test(t)) && kind === "page") return "product";
  return kind;
}

/** WordPress's own API gives posts and pages without the theme around them. */
async function wordpressApi(inv, dir, get) {
  const out = { posts: [], pages: [] };
  for (const type of ["posts", "pages"]) {
    for (let page = 1; page <= 100; page++) {
      const url = `${inv.source}${inv.scope ?? "/"}wp-json/wp/v2/${type}?per_page=100&page=${page}&_embed=wp:featuredmedia,wp:term`;
      const res = await get(url, { accept: "application/json" }).catch(() => null);
      if (!res || res.status !== 200) break;
      let items;
      try {
        items = JSON.parse(res.body);
      } catch {
        break;
      }
      if (!Array.isArray(items) || !items.length) break;
      for (const it of items) {
        out[type].push({
          id: it.id,
          path: pathOf(it.link),
          slug: it.slug,
          date: it.date,
          modified: it.modified,
          title: decodeEntities(it.title?.rendered ?? "").replace(/<[^>]+>/g, ""),
          excerpt: textOf(parseHtml(it.excerpt?.rendered ?? "")),
          content_html: it.content?.rendered ?? "",
          featured_image: it._embedded?.["wp:featuredmedia"]?.[0]?.source_url ?? null,
          terms: (it._embedded?.["wp:term"] ?? []).flat().map((t) => ({ taxonomy: t.taxonomy, name: decodeEntities(t.name), slug: t.slug })),
        });
      }
      if (items.length < 100) break;
    }
  }
  if (out.posts.length || out.pages.length) {
    writeJson(join(dir, "wordpress.json"), out);
    console.log(`  WordPress API: ${out.posts.length} posts, ${out.pages.length} pages (wordpress.json)`);
  }
}

function loadPages(dir, inv) {
  return inv.pages
    .map((p) => readJson(join(dir, "pages", `${pageKey(p.url)}.json`), null))
    .filter((p) => p && p.status === 200 && p.text != null);
}

/** What the whole site uses: its menu, footer, social profiles, embeds, forms, fonts and analytics. */
function summarize(dir, inv) {
  const pages = loadPages(dir, inv);
  const home = pages.find((p) => p.path === "/") ?? pages[0];
  const count = (items) => {
    const m = new Map();
    for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const byKind = {};
  for (const p of pages) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  const embeds = new Map();
  for (const p of pages) for (const e of p.embeds) {
    const k = `${e.provider}|${e.kind}`;
    if (!embeds.has(k)) embeds.set(k, { provider: e.provider, kind: e.kind, pages: [] });
    embeds.get(k).pages.push(p.path);
  }
  const forms = [];
  for (const p of pages) for (const f of p.forms) if (f.purpose !== "search") forms.push({ page: p.path, ...f });
  const retail = new Map();
  for (const p of pages) for (const r of p.retail) {
    if (!retail.has(r.retailer)) retail.set(r.retailer, 0);
    retail.set(r.retailer, retail.get(r.retailer) + 1);
  }
  return {
    source: inv.source,
    platform: inv.platform,
    pages: pages.length,
    by_kind: byKind,
    title: home?.og?.["og:site_name"] ?? home?.title ?? null,
    lang: home?.lang ?? null,
    favicon: home?.favicon ?? null,
    menu: menuOf(home, pages),
    footer: home?.footer ?? null,
    social: [...new Map(pages.flatMap((p) => p.social).map((s) => [s.href, s])).values()],
    buy_links: Object.fromEntries(retail),
    embeds: [...embeds.values()].map((e) => ({ ...e, pages: e.pages.length > 10 ? [...e.pages.slice(0, 10), `…${e.pages.length - 10} more`] : e.pages })),
    forms,
    fonts: count(pages.flatMap((p) => p.fonts)).map(([f]) => f),
    analytics: [...new Set(pages.flatMap((p) => p.analytics))],
    feeds: [...new Set(pages.flatMap((p) => p.feeds))],
    languages: [...new Set(pages.flatMap((p) => p.hreflang.map((h) => h.lang)))],
    needs_browser: pages.filter((p) => p.needs_browser).map((p) => p.path),
    thin_pages: pages.filter((p) => p.words < 30 && !p.needs_browser).map((p) => p.path),
    noindex: pages.filter((p) => p.noindex).map((p) => p.path),
    redirected: pages.filter((p) => p.redirected_to).map((p) => `${p.path} -> ${p.redirected_to}`),
  };
}

/** The site's menu: the homepage's <nav> or header, else the internal links most pages share. */
function menuOf(home, pages) {
  if (home?.nav?.length) return home.nav;
  const counts = new Map();
  for (const p of pages) for (const l of new Map([...p.links, ...p.nav].filter((l) => l.internal).map((l) => [l.href, l])).values()) {
    const c = counts.get(l.href) ?? { ...l, n: 0 };
    c.n++;
    counts.set(l.href, c);
  }
  const shared = [...counts.values()].filter((c) => pages.length >= 3 && c.n >= pages.length * 0.6);
  if (shared.length) return shared.map(({ n, ...l }) => l);
  return (home?.links ?? []).filter((l) => l.internal && l.text).slice(0, 10);
}

function printSummary(s) {
  console.log(`\n${s.title ?? s.source} (${s.platform}): ${Object.entries(s.by_kind).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  if (s.menu.length) console.log(`Menu: ${s.menu.map((m) => m.text).filter(Boolean).slice(0, 12).join(" · ")}`);
  if (s.embeds.length) console.log(`Embeds: ${s.embeds.map((e) => `${e.provider} (${e.kind}, ${e.pages.length} pages)`).join(", ")}`);
  if (s.forms.length) console.log(`Forms: ${s.forms.map((f) => `${f.purpose}${f.provider ? ` via ${f.provider}` : ""} on ${f.page}`).slice(0, 8).join(", ")}`);
  if (Object.keys(s.buy_links).length) console.log(`Buy links: ${Object.entries(s.buy_links).map(([k, v]) => `${k} ×${v}`).join(", ")}`);
  if (s.fonts.length) console.log(`Fonts: ${s.fonts.slice(0, 6).join(", ")}`);
  if (s.analytics.length) console.log(`Analytics: ${s.analytics.join(", ")}`);
  if (s.needs_browser.length) console.log(`Look at these in a browser (their text loads by script): ${s.needs_browser.slice(0, 8).join(", ")}`);
}

/** Optional: render pages in Playwright's Chromium, for sites whose text loads by script. */
async function openBrowser() {
  let pw;
  try {
    pw = await import("playwright");
  } catch {
    console.error("--browser needs Playwright (npm i -D playwright, then npx playwright install chromium). Without it, open the pages listed under needs_browser in your own browser tool.");
    process.exit(1);
  }
  const browser = await pw.chromium.launch();
  const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 900 } });
  return {
    async get(url, shot) {
      const page = await context.newPage();
      try {
        const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
        // Scroll through so lazy images load.
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 800) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 120));
          }
          window.scrollTo(0, 0);
        });
        const body = await page.content();
        if (looksLikeBotCheck(res?.status() ?? 200, body)) throw new BotCheck(`${url} answered with a bot check.`);
        mkdirSync(dirname(shot), { recursive: true });
        await page.screenshot({ path: shot, fullPage: true });
        return { status: res?.status() ?? 200, url: page.url(), headers: { "content-type": "text/html" }, body };
      } finally {
        await page.close();
      }
    },
    close: () => browser.close(),
  };
}

/** A file name for an image, from its URL: readable, without the builder's ids where possible. */
export function imageFileName(original, src = original, alt = "") {
  const u = new URL(original);
  let name = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "image");
  if (u.hostname === "static.wixstatic.com") {
    // Wix keeps the uploaded file's name at the end of the resized URL; the media id is hex.
    const shown = decodeURIComponent(new URL(src).pathname.split("/").pop() ?? "");
    const ext = /\.\w+$/.exec(name)?.[0] ?? ".jpg";
    const readable = (t) => t && !/^[0-9a-f]{6}_[0-9a-f]{20,}/i.test(t) && !/^[0-9a-f-]{20,}/i.test(t);
    name = readable(shown) ? shown.replace(/\.\w+$/, "") + ext : alt ? alt.slice(0, 50) + ext : `image-${name.replace(/^[0-9a-f]{6}_/i, "").slice(0, 10)}${ext}`;
  }
  name = name.replace(/\.[0-9a-f]{8,}(\.\w+)$/i, "$1"); // a build's content hash: name.00f658157296.jpg
  name = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+\./g, ".");
  if (!/\.(?:jpe?g|png|gif|webp|avif|svg)$/.test(name)) {
    const ext = /format=(jpe?g|png|webp)/.exec(u.search)?.[1] ?? "jpg";
    name = `${name.replace(/\.\w+$/, "") || "image"}.${ext}`;
  }
  return name.slice(-80).replace(/^-+/, "");
}

async function images(opts) {
  const dir = opts.dir;
  const inv = need(dir, "inventory.json", "inventory <url>");
  const pages = loadPages(dir, inv);
  const wp = readJson(join(dir, "wordpress.json"), { posts: [], pages: [] });
  const byOriginal = new Map();
  const use = (original, page, alt, where, src) => {
    if (!original || original.startsWith("data:")) return;
    if (!byOriginal.has(original)) byOriginal.set(original, { original, shown: src || original, alt: alt || "", where, pages: [] });
    const e = byOriginal.get(original);
    if (!e.alt && alt) e.alt = alt;
    if (where === "content") e.where = "content";
    if (page && !e.pages.includes(page)) e.pages.push(page);
  };
  for (const p of pages) {
    for (const i of p.images) use(i.original, p.path, i.alt, i.where, i.src);
    if (p.og_image) use(p.og_image, p.path, "", "social");
  }
  for (const p of [...wp.posts, ...wp.pages]) {
    if (p.featured_image) use(originalImageUrl(p.featured_image), p.path, "", "content");
    for (const i of extractPage(`<body><main>${p.content_html}</main></body>`, new URL(p.path, inv.source).toString()).images) use(i.original, p.path, i.alt, "content");
  }
  const sitePath = (original) => {
    if (siteHost(hostOf(original)) === siteHost(new URL(inv.source).hostname)) {
      // The site's own uploads keep their path, so old image URLs keep working too.
      const p = safeSegments(new URL(original).pathname);
      if (p && /\.(?:jpe?g|png|gif|webp|avif|svg)$/i.test(p)) return `public/${p}`;
    }
    return null;
  };
  const byPath = new Map();
  const add = (e, path) => {
    const { shown, ...rest } = e;
    byPath.set(path, { ...rest, path, src: path.replace(/^public/, "") });
  };
  // The site's own uploads first, at their own paths; then the rest under public/images/.
  const entries = [...byOriginal.values()];
  for (const e of entries) {
    const path = sitePath(e.original);
    if (path) add(e, path);
  }
  for (const e of entries) {
    if (sitePath(e.original)) continue;
    const name = imageFileName(e.original, e.shown, e.alt);
    let path = `public/images/${name}`;
    const same = byPath.get(path);
    // Only a CDN mirror of the same file (its path ends with the upload's path) is a copy.
    if (same && sitePath(same.original) && new URL(e.original).pathname.endsWith(new URL(same.original).pathname)) {
      // A copy of one of the site's own uploads (from its CDN): one file, used by both pages.
      for (const pg of e.pages) if (!same.pages.includes(pg)) same.pages.push(pg);
      if (!same.alt && e.alt) same.alt = e.alt;
      if (e.where === "content") same.where = "content";
      (same.copies ??= []).push(e.original);
      continue;
    }
    for (let n = 2; byPath.has(path); n++) path = `public/images/${name.replace(/(\.\w+)$/, `-${n}$1`)}`;
    add(e, path);
  }
  const list = [...byPath.values()];
  writeJson(join(dir, "images.json"), list);
  // Ready-made publish/write_files entries: Beautiful imports each image from its URL.
  const files = list.map((i) => ({ path: i.path, url: i.original }));
  const chunks = [];
  for (let k = 0; k < files.length; k += 100) chunks.push(files.slice(k, k + 100));
  chunks.forEach((c, k) => writeJson(join(dir, `image-files-${k + 1}.json`), c));
  if (opts.download) {
    const get = makeFetcher({ delay: Number(opts.delay ?? 1000), quiet: true });
    let ok = 0;
    for (const i of list) {
      const local = within(join(dir, "images"), i.path.replace(/^public\//, ""));
      if (existsSync(local)) continue;
      // An image type in Accept: some CDNs answer a generic one with WebP instead of the original.
      const res = await get(i.original, { accept: "image/jpeg,image/png,image/gif,image/svg+xml,image/*;q=0.8" }).catch((e) => (e instanceof BotCheck ? Promise.reject(e) : null));
      if (res?.status === 200) {
        mkdirSync(dirname(local), { recursive: true });
        writeFileSync(local, res.bytes);
        ok++;
      }
    }
    console.log(`Downloaded ${ok} images to ${join(dir, "images/")}`);
  }
  const content = list.filter((i) => i.where === "content").length;
  const noAlt = list.filter((i) => i.where === "content" && !i.alt).length;
  console.log(`${list.length} images (${content} in page content${noAlt ? `, ${noAlt} without alt text: write it` : ""}).`);
  console.log(`Wrote ${join(dir, "images.json")} (original URL -> site path) and ${chunks.length} image-files-N.json (send each as files in one write_files or publish call).`);
}

/** Front matter for a post: YAML with quoted strings. */
function frontMatter(data) {
  const q = (v) => JSON.stringify(String(v));
  const lines = ["---"];
  for (const [k, v] of Object.entries(data)) {
    if (v == null || v === "" || Array.isArray(v) && !v.length) continue;
    if (Array.isArray(v)) lines.push(`${k}: [${v.map(q).join(", ")}]`);
    else if (v instanceof Date) lines.push(`${k}: ${v.toISOString().slice(0, 10)}`);
    else lines.push(`${k}: ${q(v)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/** Image URLs in Markdown or HTML pointed at the site paths images.json gives them. */
export function rewriteImages(text, list) {
  let out = text;
  for (const i of list) {
    for (const url of [i.original, ...(i.copies ?? [])]) if (url) out = out.split(url).join(i.src);
  }
  return out;
}

async function posts(opts) {
  const dir = opts.dir;
  const site = opts.site ?? "site";
  const collection = opts.collection ?? "blog";
  const inv = need(dir, "inventory.json", "inventory <url>");
  const imgs = readJson(join(dir, "images.json"), []);
  if (!imgs.length) console.log("No images.json: run `images` first so posts link to images on the new site.");
  const wp = readJson(join(dir, "wordpress.json"), null);
  const out = [];
  const base = inv.source;
  if (wp?.posts?.length) {
    for (const p of wp.posts) {
      const md = toMarkdown(parseHtml(`<div>${p.content_html}</div>`), new URL(p.path, base).toString());
      out.push({
        id: p.slug,
        data: {
          title: p.title,
          description: p.excerpt.slice(0, 300),
          date: p.date?.slice(0, 10),
          updated: p.modified?.slice(0, 10),
          image: p.featured_image ? originalImageUrl(p.featured_image) : null,
          tags: p.terms.filter((t) => t.taxonomy === "post_tag").map((t) => t.name),
          categories: p.terms.filter((t) => t.taxonomy === "category" && t.slug !== "uncategorized").map((t) => t.name),
          path: defaultNewPath(p.path) ?? `/${collection}/${p.slug}/`,
        },
        body: md,
      });
    }
  } else {
    const captured = loadPages(dir, inv);
    // An og:image most pages share is the site's default, not the post's own picture.
    const ogCount = new Map();
    for (const p of captured) if (p.og_image) ogCount.set(p.og_image, (ogCount.get(p.og_image) ?? 0) + 1);
    const siteDefault = (img) => captured.length >= 3 && (ogCount.get(img) ?? 0) > captured.length / 2;
    for (const p of captured.filter((x) => x.kind === "post")) {
      const slug = p.path.split("?")[0].replace(/\/+$/, "").split("/").pop().replace(/\.(?:html?|php|aspx?)$/i, "") || "post";
      let body = p.markdown;
      // The post's own title is the page's h1: the layout shows it, so drop it from the body.
      if (p.h1[0]) body = body.replace(new RegExp(`^# ${p.h1[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\n+`), "");
      // So is its date, which goes in the front matter: drop a first line that is only the date.
      body = body.replace(/^(?:\*{0,2})(?:\d{4}-\d{2}-\d{2}|(?:[A-Z][a-z]+ \d{1,2}, \d{4})|(?:\d{1,2} [A-Z][a-z]+ \d{4}))(?:\*{0,2})\s*\n+/, "");
      out.push({
        id: slug,
        data: {
          title: p.h1[0] ?? p.og["og:title"] ?? p.title,
          // The old <title>, often the post's title with the site's name: the page keeps it.
          seo_title: p.title && p.title !== p.h1[0] ? p.title : null,
          description: p.description,
          date: p.published?.slice(0, 10) ?? null,
          image: p.og_image && !siteDefault(p.og_image) ? p.og_image : null,
          path: defaultNewPath(p.path) ?? `/${collection}/${slug}/`,
        },
        body,
      });
    }
  }
  if (!out.length) {
    console.log("No posts captured (none of the inventory's URLs looked like posts). Rebuild the pages by hand.");
    return;
  }
  const ids = new Set();
  for (const p of out) {
    let id = p.id.replace(/[^\p{L}\p{N}-]+/gu, "-").toLowerCase() || "post";
    const base = id;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    const data = { ...p.data, image: p.data.image ? imgs.find((i) => i.original === p.data.image || i.copies?.includes(p.data.image))?.src ?? p.data.image : null };
    writeText(within(join(site, "src", "content", collection), `${id}.md`), `${frontMatter(data)}\n\n${rewriteImages(p.body, imgs)}\n`);
  }
  const config = join(site, "src", "content.config.ts");
  if (!existsSync(config)) {
    writeText(
      config,
      `import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// Posts moved from ${base}. path is each post's old address, kept so its links and search rankings keep working.
const ${collection} = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/${collection}" }),
  schema: z.object({
    title: z.string(),
    seo_title: z.string().optional(),
    description: z.string().optional(),
    date: z.coerce.date().optional(),
    updated: z.coerce.date().optional(),
    image: z.string().optional(),
    tags: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    path: z.string(),
  }),
});

export const collections = { ${collection} };
`,
    );
  }
  const route = join(site, "src", "pages", "[...path].astro");
  if (!existsSync(route)) {
    writeText(
      route,
      `---
// Every moved post at its old address (the path in its front matter).
import { getCollection, render } from "astro:content";
import Base from "../layouts/Base.astro";

export async function getStaticPaths() {
  const posts = await getCollection("${collection}");
  return posts.map((post) => ({ params: { path: post.data.path.replace(/^\\/+|\\/+$/g, "") }, props: { post } }));
}

const { post } = Astro.props;
const { Content } = await render(post);
---
<Base title={post.data.seo_title ?? post.data.title} description={post.data.description}>
  <article class="post">
    <h1>{post.data.title}</h1>
    {post.data.date && <time datetime={post.data.date.toISOString()}>{post.data.date.toLocaleDateString("en-US", { dateStyle: "long" })}</time>}
    <Content />
  </article>
</Base>
`,
    );
  }
  const prefixes = count2(out.map((p) => p.data.path.split("/").filter(Boolean).slice(0, -1).join("/")));
  console.log(`Wrote ${out.length} posts to ${join(site, "src/content", collection)}/ (from ${wp?.posts?.length ? "the WordPress API" : "the captured pages"}).`);
  console.log(`Their old addresses: ${prefixes.map(([k, v]) => `/${k}${k ? "/" : ""}… ×${v}`).join(", ")}. ${route} serves each at its old path; ${config} declares the collection. Both are only written when missing: adapt them to your layout.`);
  console.log("Read a few posts against the old pages: the conversion drops builder widgets. Next: build the pages, then node bty-migrate.mjs redirects");
}

const count2 = (items) => {
  const m = new Map();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

async function redirects(opts) {
  const dir = opts.dir;
  const inv = need(dir, "inventory.json", "inventory <url>");
  const map = readJson(opts.map ?? join(dir, "url-map.json"), {});
  // Pages that redirected on the old site already: send their old path where the target went.
  const captured = new Map(loadPages(dir, inv).map((p) => [p.path, p]));
  const merged = { ...map };
  for (const p of captured.values()) if (p.redirected_to && !(p.path in merged) && map[p.redirected_to]) merged[p.path] = map[p.redirected_to];
  const pages = inv.pages.filter((p) => p.kind !== "feed" || p.path in merged);
  const { lines, unmapped, kept } = redirectLines(pages, merged);
  // Beautiful writes the new sitemap at /sitemap-index.xml: the old sitemap addresses point there.
  for (const sm of inv.sitemaps ?? []) if (sm !== "/sitemap-index.xml" && !(sm in merged)) lines.push(`${sm} /sitemap-index.xml 301`);
  const feeds = inv.pages.filter((p) => p.kind === "feed" && !(p.path in merged));
  if (feeds.length) console.log(`Old feeds: ${feeds.map((f) => f.path).join(", ")}. Serve each at the same path (an endpoint like src/pages/blog-feed.xml.ts) or map it in url-map.json to your feed: readers' apps follow it.`);
  const exact = lines.filter((l) => !/[*:]/.test(l.split(" ")[0])).length;
  console.log(`${kept} old URLs keep their address (no rule needed), ${lines.length} need a 301.`);
  if (exact > 2000) console.log(`That's over Beautiful's 2,000 exact redirects: replace families of them with patterns (/:year/:month/:slug/ /blog/:slug/ 301), at most 100.`);
  if (unmapped.length) {
    console.log(`${unmapped.length} old URLs have query strings and no page chosen yet. Add them to ${join(dir, "url-map.json")} as { "${unmapped[0]}": "/new-path/" } (or "-" to drop one):`);
    for (const u of unmapped.slice(0, 15)) console.log(`  ${u}`);
  }
  const file = opts.site ? join(opts.site, "public", "_redirects") : join(dir, "_redirects");
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeText(file, mergeRedirects(before, lines));
  console.log(`Wrote ${file}${opts.site ? "" : " (copy it to your site's public/_redirects, or pass --site)"}. Next: deploy a preview, then node bty-migrate.mjs verify <its URL>`);
}

// The <head> of every page, from the old site: src/data/seo.json (regenerated each run) and
// src/components/Seo.astro (written once), which the layout puts first in <head>.
const BUILDER_ICON = /(?:^|\.)(?:wix|squarespace|weebly|godaddy|wsimg|webflow|shopify|wordpress|jimdo|carrd)\.com$/i;
const SEO_COMPONENT = `---
// Every tag a page needs in <head>, from the old site's pages (src/data/seo.json, written by
// bty-migrate.mjs head). Put <Seo /> first in the layout's <head>; props override the data.
import seo from "../data/seo.json";

const props = Astro.props; // title, description, image, type, noindex, lcp (the hero image's URL, preloaded)
const raw = Astro.url.pathname;
const path = raw.endsWith("/") || /\\.\\w+$/.test(raw) ? raw : raw + "/";
const page = seo.pages[path] ?? {};
const site = (Astro.site ?? Astro.url).origin;
const abs = (u) => (u ? new URL(u, site).href : null);
const title = props.title ?? page.title ?? seo.site.name;
const description = props.description ?? page.description;
const image = abs(props.image ?? page.image ?? seo.site.image);
const canonical = new URL(path, site).href;
const noindex = props.noindex ?? page.noindex ?? false;
// The old pages' structured data with its links moved here; "<" escaped so it can't close the script.
const moved = (j) => JSON.stringify(j).replaceAll(seo.site.origin, site).replace(/</g, "\\\\u003c");
const ld = (page.json_ld ?? []).map(moved);
---
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title}</title>
{description && <meta name="description" content={description} />}
<link rel="canonical" href={canonical} />
{noindex && <meta name="robots" content="noindex" />}
{props.lcp && <link rel="preload" as="image" href={props.lcp} fetchpriority="high" />}
<meta property="og:type" content={props.type ?? page.type ?? (path === "/" ? "website" : "article")} />
<meta property="og:title" content={page.og_title ?? title} />
{description && <meta property="og:description" content={page.og_description ?? description} />}
<meta property="og:url" content={canonical} />
{seo.site.name && <meta property="og:site_name" content={seo.site.name} />}
{image && <meta property="og:image" content={image} />}
<meta name="twitter:card" content={image ? "summary_large_image" : "summary"} />
{seo.site.twitter && <meta name="twitter:site" content={seo.site.twitter} />}
{page.published && <meta property="article:published_time" content={page.published} />}
{(page.hreflang ?? []).map((h) => <link rel="alternate" hreflang={h.lang} href={abs(h.href.replaceAll(seo.site.origin, site))} />)}
{path === "/" && Object.entries(seo.site.verification).map(([name, content]) => <meta name={name} content={content} />)}
<link rel="icon" href={seo.site.favicon} />
{seo.site.apple_touch_icon && <link rel="apple-touch-icon" href={seo.site.apple_touch_icon} />}
{seo.site.theme_color && <meta name="theme-color" content={seo.site.theme_color} />}
{seo.site.feed && <link rel="alternate" type="application/rss+xml" title={seo.site.name} href={seo.site.feed} />}
{ld.map((j) => <script type="application/ld+json" set:html={j} />)}
`;

/** The site's name: og:site_name, else the title suffix most pages share, else the homepage's title. */
export function siteName(pages) {
  const home = pages.find((p) => p.path === "/") ?? pages[0];
  if (home?.tech?.site_name) return home.tech.site_name;
  const SEP = /\s(?:\||-|–|—|·)\s/;
  const counts = new Map();
  for (const p of pages) {
    const parts = (p.title ?? "").split(SEP);
    if (parts.length < 2) continue;
    for (const end of new Set([parts[0], parts.at(-1)].map((x) => x.trim()))) counts.set(end, (counts.get(end) ?? 0) + 1);
  }
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (best && n >= 2) return best;
  return (home?.title ?? "").split(SEP)[0].trim() || null;
}

/** Where an old page lives on the new site: url-map.json, the old site's own redirect, or its address. */
export function newPathOf(p, map) {
  const look = (path) => map[path] ?? map[slashless(path)] ?? map[`${slashless(path)}/`];
  const mapped = look(p.path) ?? (p.redirected_to ? look(p.redirected_to) : undefined);
  if (mapped === "-") return null;
  const to = mapped ?? (p.redirected_to ? defaultNewPath(p.redirected_to) : defaultNewPath(p.path));
  if (!to) return null;
  const [path] = to.split("?");
  return path.endsWith("/") || /\.\w{1,5}$/.test(path) ? path : `${path}/`;
}

async function head(opts) {
  const dir = opts.dir;
  const site = opts.site ?? "site";
  const inv = need(dir, "inventory.json", "inventory <url>");
  const pages = loadPages(dir, inv).filter((p) => p.status === 200 && p.title !== undefined);
  if (!pages.length) throw new Error("No captured pages: run capture first.");
  const map = readJson(opts.map ?? join(dir, "url-map.json"), {});
  const imgs = readJson(join(dir, "images.json"), []);
  const local = (url) => (url ? imgs.find((i) => i.original === url || i.copies?.includes(url))?.src ?? url : null);
  const origin = new URL(inv.source).origin;
  const home = pages.find((p) => p.path === "/") ?? pages[0];
  const icons = [];
  const icon = (url, name) => {
    if (!url) return null;
    const host = hostOf(url);
    if (host && BUILDER_ICON.test(host)) return null; // the builder's own logo, not theirs
    const ext = (/\.(ico|png|svg|jpe?g|webp|gif)(?:$|\?)/i.exec(new URL(url).pathname)?.[1] ?? "png").toLowerCase();
    const path = `/${name}.${ext}`;
    icons.push({ path: `public${path}`, url: originalImageUrl(url) });
    return path;
  };
  const favicon = home.tech?.favicon_declared ? icon(home.favicon, "favicon") : null;
  const feed = home.feeds?.find((f) => hostOf(f) && siteHost(hostOf(f)) === siteHost(new URL(origin).hostname));
  const out = {
    site: {
      origin,
      name: siteName(pages),
      lang: home.lang,
      image: local(home.og_image),
      twitter: home.og?.["twitter:site"] ?? null,
      verification: home.tech?.verification ?? {},
      favicon: favicon ?? "/favicon.svg",
      apple_touch_icon: icon(home.tech?.apple_touch_icon, "apple-touch-icon"),
      theme_color: home.tech?.theme_color ?? null,
      feed: feed ? pathOf(feed) : null,
    },
    pages: {},
  };
  const siteImage = out.site.image;
  for (const p of pages) {
    const key = newPathOf(p, map);
    if (!key || /\.\w{1,5}$/.test(key)) continue;
    if (out.pages[key] && p.path.includes("?")) continue; // the page's own address wins over a query alias
    const image = local(p.og_image);
    const entry = {
      title: p.title ?? undefined,
      description: p.description ?? undefined,
      image: image && image !== siteImage ? image : undefined,
      type: p.og?.["og:type"] ?? undefined,
      og_title: p.og?.["og:title"] && p.og["og:title"] !== p.title ? p.og["og:title"] : undefined,
      og_description: p.og?.["og:description"] && p.og["og:description"] !== p.description ? p.og["og:description"] : undefined,
      noindex: p.noindex || undefined,
      published: p.published ?? undefined,
      hreflang: p.hreflang?.length ? p.hreflang : undefined,
      json_ld: p.json_ld?.length ? p.json_ld : undefined,
    };
    out.pages[key] = JSON.parse(JSON.stringify(entry));
  }
  writeJson(join(site, "src", "data", "seo.json"), out);
  writeJson(join(dir, "icon-files.json"), icons);
  const component = join(site, "src", "components", "Seo.astro");
  if (!existsSync(component)) writeText(component, SEO_COMPONENT);
  console.log(`Wrote ${join(site, "src/data/seo.json")} (${Object.keys(out.pages).length} pages) and ${component}.`);
  console.log(`In the layout: import Seo from "../components/Seo.astro"; then <head><Seo /> …</head>, passing lcp="/images/hero.jpg" on pages with a large first image. Set site in astro.config.mjs so the links are absolute.`);
  if (icons.length) console.log(`The old ${icons.map((i) => i.path.replace("public/", "")).join(" and ")}: imported by the next publish (${join(dir, "icon-files.json")}).`);
  else console.log("The old site has no icon of its own: make public/favicon.svg.");
}

// The site folder as publish requests: text files as content, binary ones as content_base64,
// and the image imports, at most 200 files (and about 20 MB) a request. Only what changed since
// the last run, unless --all: the hashes of what it bundled are in published.json.
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|pdf|zip|mp3|m4a|wav|ogg|mp4|webm|mov)$/i;
const SKIP_DIR = new Set(["node_modules", "dist", ".astro", ".git"]);

// Text unless it has a NUL byte or isn't valid UTF-8 (the common binary extensions skip the check).
export function isText(rel, buf) {
  if (BINARY.test(rel) || buf.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

export function siteFiles(root) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name) && (!e.name.startsWith(".") || e.name === ".well-known")) walk(r);
      } else if (e.isFile() && !e.name.startsWith(".") && e.name !== "package.json" && !e.name.endsWith(".lock")) out.push(r);
    }
  };
  walk("");
  return out.sort();
}

export function bundle(entries, { max = 200, maxBytes = 20e6 } = {}) {
  const out = [];
  let cur = [];
  let bytes = 0;
  for (const e of entries) {
    const size = Buffer.byteLength(JSON.stringify(e));
    if (cur.length && (cur.length >= max || bytes + size > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(e);
    bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function publishFiles(opts) {
  const dir = opts.dir;
  const root = opts.site ?? "site";
  if (!existsSync(root)) throw new Error(`No site folder at ${root}: build the Astro project there, or pass --site <folder>.`);
  mkdirSync(dir, { recursive: true });
  const statePath = join(dir, "published.json");
  // A publish without a site makes a new one: once this folder has been bundled for a site, the
  // next bundle must name it, or the agent ends up with two sites.
  if (!opts.to && !opts.new && Object.keys(readJson(statePath, {})).length) {
    throw new Error(`This folder was bundled for publishing before (${statePath}). Bundle for that site with --to <its slug>: a request without a site makes a second one. If that first request never went through, run publish --all --new --name "…".`);
  }
  const sent = opts.all || opts.new ? {} : readJson(statePath, {});
  const next = { ...sent };
  const entries = [];
  const have = new Set(siteFiles(root));
  for (const rel of have) {
    const buf = readFileSync(join(root, rel));
    const hash = createHash("sha256").update(buf).digest("hex");
    if (sent[rel] === hash) continue;
    next[rel] = hash;
    entries.push(isText(rel, buf) ? { path: rel, content: buf.toString("utf8") } : { path: rel, content_base64: buf.toString("base64") });
  }
  // The originals images found, imported by URL, unless the folder has the file itself.
  const imports = [...readJson(join(dir, "images.json"), []), ...readJson(join(dir, "icon-files.json"), []).map((i) => ({ path: i.path, original: i.url }))];
  const queued = new Set(entries.map((e) => e.path));
  for (const img of imports) {
    const key = `url:${img.original}`;
    if (have.has(img.path) || sent[img.path] === key || queued.has(img.path)) continue;
    queued.add(img.path);
    next[img.path] = key;
    entries.push({ path: img.path, url: img.original });
  }
  // Files bundled before and gone from the folder now: publish can't delete, so say which.
  const images = new Set(imports.map((i) => i.path));
  // Removed files stay listed, every run, until the agent says they're deleted on the site.
  const state = readJson(statePath, {});
  const gone = Object.keys(state).filter((rel) => !have.has(rel) && !images.has(rel));
  for (const rel of gone) {
    if (opts["deleted-done"]) delete next[rel];
    else next[rel] = state[rel];
  }
  rmSync(join(dir, "deleted.json"), { force: true });
  for (const old of readdirSync(dir)) if (/^publish-\d+\.json$/.test(old)) unlinkSync(join(dir, old));
  if (gone.length && !opts["deleted-done"]) {
    writeJson(join(dir, "deleted.json"), gone);
    console.log(`${gone.length} files were removed from ${root}: delete them on the site with delete_files (or write_files' delete) and deploy, then run publish once with --deleted-done. They are listed in ${join(dir, "deleted.json")}.`);
  }
  if (!entries.length) {
    writeJson(statePath, next);
    return console.log(`Nothing changed in ${root} since the last bundle (--all bundles everything).`);
  }
  // The config and src/ first, so the first request builds a whole site; images by URL last.
  const rank = (e) => (e.path === "astro.config.mjs" ? 0 : e.path.startsWith("src/") ? 1 : e.url ? 4 : e.path.startsWith("public/") ? 3 : 2);
  entries.sort((a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : 1));
  let chunks = bundle(entries);
  if (!opts.to && chunks.length > 1) {
    // A publish without a site makes a new one each time: send one now, the rest with --to.
    for (const e of chunks.slice(1).flat()) {
      if (e.path in sent) next[e.path] = sent[e.path];
      else delete next[e.path];
    }
    console.log(`The first request holds ${chunks[0].length} of ${entries.length} files. Publish it, then run publish --to <the new site's slug> for the rest.`);
    chunks = chunks.slice(0, 1);
  }
  const target = opts.to ? { site: String(opts.to) } : opts.name ? { name: String(opts.name) } : {};
  chunks.forEach((files, k) => writeJson(join(dir, `publish-${k + 1}.json`), { ...target, files }));
  writeJson(statePath, next);
  console.log(`${entries.length} files in ${chunks.length} request${chunks.length === 1 ? "" : "s"}: ${chunks.map((_, k) => join(dir, `publish-${k + 1}.json`)).join(", ")}.`);
  console.log(`Send each as publish's arguments (MCP), or: curl -sS https://beautiful.host/api/v1/publish -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" -d @${join(dir, "publish-1.json")}`);
  if (!opts.to) console.log("After the first publish, bundle with --to <the site's slug> so later requests update that site.");
  console.log(opts.to ? "If a request fails, fix it and bundle again with --all." : 'If this request fails before it makes the site, fix it and bundle again with --new --name "…".');
}

/** A free or trial site shows visitors a notice first; its Continue link sets a cookie, as for any visitor. */
async function noticeCookie(origin) {
  const probe = await fetch(origin.origin + "/", { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!probe || !/\/_bty\/continue/.test(await probe.text())) return "";
  const ack = await fetch(`${origin.origin}/_bty/continue?to=/`, { redirect: "manual", headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
  return (ack?.headers.get("set-cookie") ?? "").split(";")[0];
}

// Lighthouse, before and after: the old and new homepage and one page of each kind, on a phone.
export const LIGHTHOUSE_VERSION = "12.8.2";
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

/** The numbers and the fixes worth making first, from a Lighthouse report (lhr). */
export function summarizeLighthouse(lhr) {
  const a = lhr.audits ?? {};
  const scores = Object.fromEntries(CATEGORIES.map((c) => [c, lhr.categories?.[c]?.score == null ? null : Math.round(lhr.categories[c].score * 100)]));
  const ms = (id) => (a[id]?.numericValue == null ? null : Math.round(a[id].numericValue));
  const fixes = Object.values(a)
    .filter((x) => x.score !== null && x.score < 0.9 && ["numeric", "binary", "metricSavings"].includes(x.scoreDisplayMode) && !/^(?:largest-contentful-paint|largest-contentful-paint-element|lcp-breakdown-insight|first-contentful-paint|speed-index|total-blocking-time|cumulative-layout-shift|interactive|max-potential-fid|layout-shift-elements)$/.test(x.id))
    .map((x) => ({ id: x.id, title: x.title, saves_ms: Math.round(x.metricSavings?.LCP ?? x.details?.overallSavingsMs ?? 0), value: x.displayValue ?? null }))
    .sort((x, y) => y.saves_ms - x.saves_ms)
    .slice(0, 8);
  return { scores, lcp_ms: ms("largest-contentful-paint"), fcp_ms: ms("first-contentful-paint"), tbt_ms: ms("total-blocking-time"), cls: a["cumulative-layout-shift"]?.numericValue ?? null, bytes: ms("total-byte-weight"), fixes };
}

function runLighthouse(url, file, { cookie, chrome, key }) {
  if (key) {
    const q = new URLSearchParams({ url, strategy: "mobile", key });
    for (const c of CATEGORIES) q.append("category", c);
    return fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(180_000) }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(`PageSpeed Insights: ${j.error?.message ?? r.status}`);
      writeJson(file, j.lighthouseResult);
      return j.lighthouseResult;
    });
  }
  if (process.platform === "win32") throw new Error("On Windows, pass --key <a PageSpeed Insights API key>, or run Lighthouse in Chrome's DevTools.");
  const args = ["--yes", `lighthouse@${LIGHTHOUSE_VERSION}`, url, "--quiet", "--output=json", `--output-path=${file}`, `--only-categories=${CATEGORIES.join(",")}`,
    `--chrome-flags=--headless=new${process.getuid?.() === 0 ? " --no-sandbox" : ""}`];
  if (cookie) args.push(`--extra-headers=${JSON.stringify({ Cookie: cookie })}`);
  return new Promise((resolve, reject) => {
    execFile("npx", args, { env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) }, timeout: 240_000, maxBuffer: 8e6 }, (err, _out, stderr) => {
      if (err) return reject(new Error(`Lighthouse on ${url} failed: ${(stderr || err.message).trim().split("\n").slice(-3).join(" ")}${/chrome|chromium/i.test(stderr) ? " (no Chrome found? pass --chrome <path to Chrome>, or --key for PageSpeed Insights)" : ""}`));
      try {
        resolve(JSON.parse(readFileSync(file, "utf8")));
      } catch (e) {
        reject(new Error(`Lighthouse on ${url} wrote no report: ${e.message}`));
      }
    });
  });
}

async function lighthouse(target, opts) {
  const dir = opts.dir;
  const inv = need(dir, "inventory.json", "inventory <url>");
  if (!target) throw new Error("Usage: node bty-migrate.mjs lighthouse <the new site's URL>");
  const newOrigin = new URL(/^https?:\/\//.test(target) ? target : `https://${target}`);
  const map = readJson(opts.map ?? join(dir, "url-map.json"), {});
  const finals = Object.fromEntries((readJson(join(dir, "verify.json"), { results: [] }).results ?? []).filter((r) => r.ok).map((r) => [r.path, r.final]));
  const pages = loadPages(dir, inv).filter((p) => p.status === 200 && p.title !== undefined && !p.path.includes("?"));
  const sample = [];
  for (const p of [...pages.filter((x) => x.path === "/"), ...pages]) {
    if (sample.length >= Number(opts.pages ?? 4)) break;
    if (!sample.some((x) => x.path === p.path || x.path !== "/" && x.kind === p.kind)) sample.push(p);
  }
  const cookie = await noticeCookie(newOrigin);
  if (cookie) console.log(`${newOrigin.host} is a free or trial site: each run loads the page and what it uses, which count as views. Scores there include the notice's cookie; check again once it's paid.`);
  const key = opts.key ?? process.env.PSI_API_KEY;
  if (key && cookie) throw new Error("PageSpeed Insights can't get past a free or trial site's notice: run without --key (local Lighthouse), or once the site is paid.");
  const out = [];
  mkdirSync(join(dir, "lighthouse"), { recursive: true });
  for (const p of sample) {
    const to = finals[p.path] ?? newPathOf(p, map) ?? p.path;
    const row = { path: p.path, kind: p.kind, new_path: to };
    const k = pageKey(new URL(p.path, inv.source).toString());
    try {
      if (!opts["skip-old"]) {
        console.log(`  ${p.path} on the old site…`);
        row.old = summarizeLighthouse(await runLighthouse(new URL(p.path, inv.source).toString(), join(dir, "lighthouse", `${k}-old.json`), { chrome: opts.chrome, key }));
      }
      console.log(`  ${to} on the new site…`);
      row.new = summarizeLighthouse(await runLighthouse(new URL(to, newOrigin).toString(), join(dir, "lighthouse", `${k}-new.json`), { cookie, chrome: opts.chrome, key }));
    } catch (e) {
      row.error = e.message;
      console.error(`  ${e.message}`);
    }
    out.push(row);
  }
  writeJson(join(dir, "lighthouse.json"), { target: newOrigin.origin, checked_at: new Date().toISOString(), pages: out });
  const sc = (r, c) => (r?.scores?.[c] == null ? "–" : r.scores[c]);
  const sec = (v) => (v == null ? "–" : `${(v / 1000).toFixed(1)} s`);
  const lines = [`# Lighthouse: ${inv.source} → ${newOrigin.origin}`, "", "On a phone (Lighthouse's mobile setting). Scores move by a few points between runs.", ""];
  lines.push("| Page | Performance | Accessibility | Best practices | SEO | Largest paint |", "|---|---|---|---|---|---|");
  for (const r of out) {
    const pair = (c) => (r.old ? `${sc(r.old, c)} → **${sc(r.new, c)}**` : `**${sc(r.new, c)}**`);
    lines.push(`| \`${r.new_path}\` | ${CATEGORIES.map(pair).join(" | ")} | ${r.old ? `${sec(r.old.lcp_ms)} → ` : ""}**${sec(r.new?.lcp_ms)}** |`);
  }
  for (const r of out) {
    if (r.error) lines.push("", `## \`${r.new_path}\``, "", `Not measured: ${r.error}`);
    else if (r.new?.fixes.length) lines.push("", `## Fix first on \`${r.new_path}\``, "", ...r.new.fixes.map((f) => `- ${f.title}${f.value ? ` (${f.value})` : ""}${f.saves_ms ? `: about ${sec(f.saves_ms)} faster` : ""}`));
  }
  writeText(join(dir, "lighthouse.md"), lines.join("\n") + "\n");
  console.log(lines.slice(4, 6 + out.length).join("\n"));
  console.log(`Full report: ${join(dir, "lighthouse.md")}. Aim for 90 or more in each column on every page; references/performance.md says how.`);
}

async function verify(target, opts) {
  const dir = opts.dir;
  const inv = need(dir, "inventory.json", "inventory <url>");
  if (!target) throw new Error("Usage: node bty-migrate.mjs verify <the new site's URL or a preview URL>");
  const newOrigin = new URL(/^https?:\/\//.test(target) ? target : `https://${target}`);
  const captured = new Map(loadPages(dir, inv).map((p) => [p.path, p]));
  const map = readJson(opts.map ?? join(dir, "url-map.json"), {});
  let check = inv.pages.filter((p) => !p.blocked_by_robots && map[p.path] !== "-");
  if (opts.limit) check = check.slice(0, Number(opts.limit));
  const results = [];
  const concurrency = Number(opts.concurrency ?? 4);
  // A free or trial site shows visitors a notice first; its Continue link sets a cookie, as for any visitor.
  const cookie = await noticeCookie(newOrigin);
  if (cookie) console.log(`${newOrigin.host} is a free or trial site: each page checked counts as a view (100 on a free site, 1,000 on a trial). Use --limit there, or verify once it's paid.`);
  const one = async (p) => {
    const chain = [];
    let url = new URL(p.path, newOrigin).toString();
    let res;
    for (let hop = 0; hop < 6; hop++) {
      try {
        res = await fetch(url, { redirect: "manual", headers: { "user-agent": USER_AGENT, ...(cookie ? { cookie } : {}) }, signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        return { path: p.path, ok: false, error: e.cause?.code ?? e.message, chain };
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        chain.push(`${res.status} ${pathOf(url)}`);
        url = new URL(res.headers.get("location"), url).toString();
        await res.arrayBuffer().catch(() => {});
        continue;
      }
      break;
    }
    const body = await res.text();
    const finalPath = siteHost(new URL(url).hostname) === siteHost(newOrigin.hostname) ? pathOf(url) : url;
    const r = { path: p.path, kind: p.legacy ? "legacy" : p.kind, status: res.status, final: finalPath, hops: chain.length, chain, ok: res.status === 200 };
    if (chain.some((c) => c.startsWith("302") || c.startsWith("307"))) r.temporary = true;
    const expected = map[p.path];
    if (r.ok && expected && expected !== "-" && slashless(finalPath.split("?")[0]) !== slashless(expected)) r.wrong_target = expected;
    const old = captured.get(p.path);
    if (r.ok && /visitor limit|has expired/i.test(body) && /_bty/.test(body)) return { ...r, ok: false, error: "the site's visitor limit or time ran out" };
    if (r.ok && /html/i.test(res.headers.get("content-type") ?? "")) {
      const now = extractPage(body, url);
      const page = !["feed", "file"].includes(p.kind);
      r.issues = [...(old ? comparePage(old, now) : []), ...(page ? checkTech(now, old, url, [new URL(inv.source).hostname]) : [])];
    }
    return r;
  };
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < check.length) {
      const p = check[next++];
      results.push(await one(p));
      if (results.length % 25 === 0) console.log(`  ${results.length}/${check.length}`);
    }
  }));
  results.sort((a, b) => a.path.localeCompare(b.path));
  const broken = results.filter((r) => !r.ok);
  const wrong = results.filter((r) => r.wrong_target);
  const content = (r) => (r.issues ?? []).filter((i) => i.group !== "tech");
  const failing = results.filter((r) => content(r).some((i) => i.level === "fail"));
  const warned = results.filter((r) => content(r).some((i) => i.level === "warn") && !failing.includes(r));
  // Search and speed: each check once, with the pages it's on.
  const tech = new Map();
  for (const r of results) for (const i of r.issues ?? []) {
    if (i.group !== "tech") continue;
    const t = tech.get(i.check) ?? { level: i.level, check: i.check.split(" ")[0], note: i.note, paths: [] };
    // Several old URLs can land on one page: count it once.
    const at = r.final ?? r.path;
    if (!t.paths.includes(at)) t.paths.push(at);
    tech.set(i.check, t);
  }
  const rank = { fail: 0, warn: 1, info: 2 };
  const techRows = [...tech.values()].sort((a, b) => rank[a.level] - rank[b.level] || b.paths.length - a.paths.length);
  const techFails = techRows.filter((t) => t.level === "fail");
  const longChains = results.filter((r) => r.hops > 2);
  writeJson(join(dir, "verify.json"), { target: newOrigin.origin, checked_at: new Date().toISOString(), results });

  const lines = [];
  lines.push(`# Moving ${inv.source} to ${newOrigin.origin}`, "");
  lines.push(`Checked ${results.length} old URLs on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`, "");
  lines.push(`- **${results.length - broken.length} of ${results.length}** old URLs open a page on the new site${broken.length ? `; **${broken.length} don't**` : ""}.`);
  lines.push(`- ${results.filter((r) => r.ok && r.hops === 0).length} answer directly, ${results.filter((r) => r.ok && r.hops > 0).length} through a redirect.`);
  if (wrong.length) lines.push(`- ${wrong.length} redirect somewhere other than url-map.json says.`);
  if (failing.length) lines.push(`- ${failing.length} pages lost content (missing text, a title or buy links).`);
  if (warned.length) lines.push(`- ${warned.length} pages differ in smaller ways.`);
  if (techFails.length) lines.push(`- ${techFails.length} search checks fail: ${[...new Set(techFails.map((t) => t.check))].join(", ")}.`);
  else if (techRows.some((t) => t.level === "warn")) lines.push(`- Search and speed: ${[...new Set(techRows.filter((t) => t.level === "warn").map((t) => t.check))].join(", ")} to fix.`);
  if (results.some((r) => r.temporary)) lines.push(`- Some redirects are temporary (302/307): moved pages need 301.`);
  if (longChains.length) lines.push(`- ${longChains.length} take more than two redirects: point them straight at the page.`);
  const section = (title, rows, fmt) => {
    if (!rows.length) return;
    lines.push("", `## ${title}`, "");
    for (const r of rows.slice(0, 200)) lines.push(`- ${fmt(r)}`);
    if (rows.length > 200) lines.push(`- …and ${rows.length - 200} more (verify.json)`);
  };
  section("Old URLs that don't work", broken, (r) => `\`${r.path}\`: ${r.error ?? `HTTP ${r.status}`}${r.chain.length ? ` after ${r.chain.join(" → ")}` : ""}`);
  section("Redirected to the wrong page", wrong, (r) => `\`${r.path}\` → \`${r.final}\`, expected \`${r.wrong_target}\``);
  const describe = (i) =>
    i.check === "text" ? `${i.coverage}% of the old text${i.missing?.[0] ? ` (missing e.g. "${i.missing[0].slice(0, 90)}")` : ""}`
    : i.check === "buy-links" ? `buy links missing: ${i.missing.slice(0, 3).join(", ")}`
    : i.check === "images" ? `${i.new} of ${i.old} content images`
    : i.check === "forms" ? `${i.new} of ${i.old} forms`
    : i.check === "embeds" ? `missing embeds: ${i.missing.slice(0, 3).join(", ")}`
    : `${i.check}: "${i.old ?? ""}" → "${i.new ?? "(none)"}"`;
  section("Pages that lost content", failing, (r) => `\`${r.path}\`: ${content(r).filter((i) => i.level !== "info").map(describe).join("; ")}`);
  section("Smaller differences", warned, (r) => `\`${r.path}\`: ${content(r).filter((i) => i.level === "warn").map(describe).join("; ")}`);
  section("Search and speed", techRows, (t) => `**${t.level}** ${t.check}: ${t.note}, on ${t.paths.length} page${t.paths.length === 1 ? "" : "s"} (${t.paths.slice(0, 4).map((x) => `\`${x}\``).join(", ")}${t.paths.length > 4 ? ", …" : ""})`);
  const report = lines.join("\n") + "\n";
  writeText(join(dir, "report.md"), report);
  console.log(report.split("\n").slice(0, 14).join("\n"));
  console.log(`Full report: ${join(dir, "report.md")} (details in verify.json).`);
  if (broken.length || failing.length || techFails.length) process.exitCode = 1;
}

// ---------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) opts[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) opts[k] = argv[++i];
      else opts[k] = true;
    } else opts._.push(a);
  }
  opts.dir ??= "migration";
  return opts;
}

const HELP = `bty-migrate ${VERSION}: move a website to beautiful.host, keeping every old URL.

  inventory <url> [--max 5000] [--crawl] [--wayback]   list every page, post and file of the old site
  capture [--limit N] [--only /a,/b] [--force] [--browser]  save each page's content (resumable)
  images [--download]                                  original images and the site paths to import them at
  posts [--site ./site] [--collection blog]            blog posts as Markdown in an Astro content collection
  redirects [--site ./site] [--map url-map.json]       a 301 for every old URL whose address changed
  head [--site ./site]                                 src/data/seo.json and Seo.astro: every page's <head> from the old site
  publish [--site ./site] [--name N | --to slug] [--all] [--new] [--deleted-done]  changed files and images as publish requests (--new: bundle everything for a new site again, when the first request never made one)
  verify <new site URL> [--limit N]                    check every old URL on the new site; writes report.md
  lighthouse <new site URL> [--pages 4] [--key K]      Lighthouse scores, old site and new, and what to fix first

Options for all: --dir migration (where files go), --delay 1000 (ms between requests to the old site).
Guide: https://beautiful.host/skill/migrate/SKILL.md`;

async function main(argv) {
  const opts = parseArgs(argv);
  const [cmd, arg] = opts._;
  switch (cmd) {
    case "inventory":
      if (!arg) throw new Error("Usage: node bty-migrate.mjs inventory <the old site's URL>");
      return inventory(arg, opts);
    case "capture":
      return capture(opts);
    case "images":
      return images(opts);
    case "posts":
      return posts(opts);
    case "redirects":
      return redirects(opts);
    case "head":
      return head(opts);
    case "publish":
      return publishFiles(opts);
    case "verify":
      return verify(arg, opts);
    case "lighthouse":
      return lighthouse(arg, opts);
    case "version":
    case "--version":
      return console.log(VERSION);
    default:
      console.log(HELP);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    if (e instanceof BotCheck) console.error(`Stopped: ${e.message} Don't try to get past it; see the skill's references/platforms.md.`);
    else console.error(e.message ?? e);
    process.exit(e instanceof BotCheck ? 2 : 1);
  });
}
