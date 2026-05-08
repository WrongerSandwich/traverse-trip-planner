# Security policy

Atlas is a self-hosted personal tool — there is no central server holding user data, and most deployments are single-user behind a home network. That said, the codebase touches API keys and parses LLM-generated content, both of which are worth treating carefully.

## Reporting a vulnerability

For anything that could leak credentials, allow code execution, or otherwise cause harm to a self-hoster, please **do not file a public GitHub issue**. Instead, use [GitHub's private security advisories](https://github.com/WrongerSandwich/atlas-trip-planner/security/advisories/new) so the issue can be triaged before disclosure.

For lower-severity concerns (suspicious dependency, stale recommendation, misleading docs), a regular GitHub issue is fine.

## What's in scope

- Anything that exposes API keys (Anthropic, OpenAI, Pexels, Tavily) beyond the local `.env`.
- LLM-content injection paths that escape into file-system writes outside `ideas/`, `exploring/`, `planning/`, `completed/`, or `archived/`.
- Authentication bypass on the planning chat or lock endpoints (currently single-user; the assumption is the deployment has its own network-level access control).
- Server-side request forgery via configured search backends.

## What's out of scope

- Issues that require an attacker to already control the host's `.env`, `home.md`, or trip files — at that point they have full file-system access anyway.
- Cosmetic prompt-injection (an LLM writing rude pitches into a trip file) that doesn't escape the trip directory.
- DoS via malicious config (e.g. setting `max_tokens` to a huge value and burning through your own API quota).

## Secret hygiene reminders

- `.env` and `home.md` are gitignored. If you publish a fork, double-check `git ls-files | grep -E "\.env|home\.md"` returns nothing.
- Never paste the contents of `.env` into GitHub issues, screenshots, or chat threads when reporting bugs. The only key Atlas needs from you to reproduce most issues is the *provider* and *model*, not the API key itself.
- The startup banner (`Atlas — provider configuration`) prints to logs and is safe to share — it shows providers/models but never key material.
