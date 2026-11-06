---
name: beautiful-optimize
description: Make a website faster, rank better in search and AI answers, work for everyone, read better and convert more visitors. Use when asked to audit, speed up, fix SEO, check accessibility, improve copy or raise signups on a site, especially one on beautiful.host.
---

# Optimize a website

Pick the skill that fits the ask, read it, and follow it. Before you change a site on
beautiful.host, read [on-beautiful-host.md](https://beautiful.host/skill/optimize/on-beautiful-host.md):
it says what Beautiful already does for you and how to measure before and after.

| The human asks | Read |
| --- | --- |
| "Audit my site", "check my site", "why is it bad" (don't know where to start) | [web-quality-audit](https://beautiful.host/skill/optimize/web-quality-audit/SKILL.md) |
| "Speed it up", "it's slow", "improve page speed" | [performance](https://beautiful.host/skill/optimize/performance/SKILL.md) |
| "Fix LCP / CLS / INP", "Core Web Vitals" | [core-web-vitals](https://beautiful.host/skill/optimize/core-web-vitals/SKILL.md) |
| Speed, and you have Chrome DevTools MCP | [web-perf](https://beautiful.host/skill/optimize/web-perf/SKILL.md) |
| "Improve SEO", meta tags, sitemap, structured data | [seo](https://beautiful.host/skill/optimize/seo/SKILL.md) |
| "Why am I not ranking", "my traffic dropped", an SEO audit | [seo-audit](https://beautiful.host/skill/optimize/seo-audit/SKILL.md) |
| JSON-LD, rich results, schema markup | [schema](https://beautiful.host/skill/optimize/schema/SKILL.md) |
| Show up in ChatGPT, Perplexity, Claude or Google AI answers | [ai-seo](https://beautiful.host/skill/optimize/ai-seo/SKILL.md) |
| Accessibility, WCAG, screen readers, keyboard use | [accessibility](https://beautiful.host/skill/optimize/accessibility/SKILL.md) |
| Write or rewrite a page's copy | [copywriting](https://beautiful.host/skill/optimize/copywriting/SKILL.md) |
| Tighten or proofread existing copy | [copy-editing](https://beautiful.host/skill/optimize/copy-editing/SKILL.md) |
| More signups, sales or bookings from a page or form | [cro](https://beautiful.host/skill/optimize/cro/SKILL.md) |
| Make it look less generic, a better design | [frontend-design](https://beautiful.host/skill/optimize/frontend-design/SKILL.md) |

Each skill links to its own `references/` files. Fetch one only when the skill says to, from
the same folder as its SKILL.md.

## Every time

1. Measure first (Lighthouse on a phone, or a screenshot when you can't run it).
2. Change the few things that matter most. Ask before changing the human's colors, words or
   layout.
3. Deploy a preview (`deploy` with `production: false`), look at it, measure again.
4. Put it live and tell the human what changed, in numbers.

These skills are adapted from open-source work by Addy Osmani, Corey Haines, Cloudflare and
Anthropic, under their MIT and Apache 2.0 licenses. Credits and what we changed:
[NOTICE.md](https://beautiful.host/skill/optimize/NOTICE.md).
