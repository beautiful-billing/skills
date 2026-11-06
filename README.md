# Beautiful Host skills

Skills that teach an AI agent to build a website on [beautiful.host](https://beautiful.host),
move an existing one there, and make any site faster, better in search and AI answers,
accessible, clearer and better at converting. The list, with what each one does:
https://beautiful.host/skills.

## Install

- Claude Code: `/plugin marketplace add beautiful-billing/skills`, then
  `/plugin install beautiful-host@beautiful`. This adds Beautiful Host's MCP server too.
- Cursor, Codex and other agents: `npx skills add beautiful-billing/skills`.
- Any agent that can read a URL: tell it to read https://beautiful.host/skill/optimize/SKILL.md.

## Credits

The optimization skills in `skills/` other than the `beautiful-*` ones are adapted from open-source
skills by Addy Osmani, Corey Haines, Cloudflare and Anthropic. Each keeps its own license in its
folder. `skills/beautiful-optimize/NOTICE.md` lists the sources and every change we made.

This repo is generated from Beautiful's own repository. Changes made here are overwritten.
