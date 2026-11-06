# Credits and changes

These skills are copies of open-source skills, edited for sites on beautiful.host. Each folder
keeps its original license as `LICENSE.txt`. Thank you to their authors.

| Skills | Author | Source (commit copied) | License |
| --- | --- | --- | --- |
| web-quality-audit, performance, core-web-vitals, seo, accessibility | Addy Osmani | [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills) (`afa8da94`) | MIT |
| seo-audit, schema, ai-seo, copywriting, copy-editing, cro | Corey Haines | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) (`96798cf3`) | MIT |
| web-perf | Cloudflare | [cloudflare/skills](https://github.com/cloudflare/skills) (`1820a51d`) | Apache 2.0 |
| frontend-design | Anthropic | [anthropics/skills](https://github.com/anthropics/skills) (`ca45fc49`) | Apache 2.0 |

`SKILL.md`, `on-beautiful-host.md` and this file in this folder are ours.

## What we changed

Every copied `SKILL.md` gained an "On Beautiful Host" section at its end, which says so. The
upstream `evals/` folders were left out. Where a skill names a skill of its author's that isn't
in this set, we left the name as it was, and the new section tells the agent to skip that step.
Beyond that:

- **web-perf:** removed the Chrome DevTools MCP setup steps (it now points to the performance
  skill when DevTools isn't there), the "Skill feedback" section and `references/skill-feedback.md`,
  which filed issues on Cloudflare's repo.
- **web-quality-audit:** removed the link to a best-practices skill that isn't in this set.
- **ai-seo:** removed a sponsored platform mention in `references/agent-readiness.md`, the link
  to the upstream tools registry, and the `npx` commands that ran third-party checkers (their
  websites are still linked).

Nothing else in the copied text was changed.
