# v0.1.0 announcement drafts

Status: **draft — not yet published**. Cutting the tag now (May 2026) so the
repo isn't a 0-releases project when people stumble onto it; holding the
actual announcement 1–2 months for stability and polish (mid-to-late summer
2026 target). Channel decision is also pending (see issue #178).

Each section below is a self-contained draft for a different channel. Pick
one (or several, staggered) when ready. Re-time-stamp before publishing.

---

## Show HN draft

**Title** (≤80 chars, HN's limit):

> Show HN: Traverse – a self-hosted road-trip planner where trips are markdown

**Body** (HN's plain-text comment field, no markdown):

I built Traverse for my own use after getting tired of travel apps that treat
trips as rows in their database and your destination history as something to
monetize. It's a SvelteKit app over a directory of markdown files — every
trip is a folder of human-readable files you can read, grep, version-control,
or edit by hand when the app gets it wrong.

The lifecycle is intentionally three states: idea (sketch), planning
(researched, day-by-day), completed (retro). An LLM generates regional ideas
from your taste profile, fleshes them out with web search, and helps you
edit the prose sections — but it's plumbed as a tool inside the workflow,
not the workflow itself.

What's interesting from a building-with-LLMs angle:

- One `chat()` adapter, three providers (Anthropic / OpenAI / OpenRouter), per-feature model overrides. The whole "research a trip" pipeline is one model envelope that returns six XML blocks (overview prose, route, logistics, frontmatter, structured plan YAML, structured candidates YAML), then a deterministic post-LLM merge step writes everything atomically.
- Long-running AI workflows follow one of four UX archetypes — instant inline, in-page stream, ambient background (cancellable from a global pill), or conversational/modal. Each has its own primitives and error registry, so adding a new AI feature is a recipe rather than a redesign.
- Rolling-p50 telemetry on every model call feeds the in-flight ETA tooltips, so the "Researching…" pill on a trip card shows a useful number instead of "still going."

What it's not: production multi-tenant SaaS. No auth, single-user, designed
to sit behind a reverse-proxy on a homelab. Bring your own API keys.

Docker is the canonical deployment: `docker compose up -d --build`, browser
onboarding fills in your `home.md`, you're seeding trip ideas inside of a
minute. Repo, screenshots, deploy walkthrough:

https://github.com/WrongerSandwich/traverse-trip-planner

Happy to answer questions about the design decisions, the LLM plumbing, or
why I bet on markdown-as-storage instead of SQLite.

---

## r/selfhosted draft

**Title:**

> Traverse: self-hosted road-trip planner, trips stored as plain markdown, BYO LLM keys

**Body** (reddit markdown):

I wanted a trip planner that respected the homelab philosophy — your data on
your disk, in a format you can read without the app running, with the LLM
plumbed in as a tool rather than the product. Couldn't find one, so I built
Traverse and have been using it daily for a few months. Cutting it loose now.

**What it does**

- Generates trip ideas from a `home.md` profile (your home base, vehicles,
  taste, seasonal constraints) — single steering prompt, batch of ideas
- Researches an idea into a full planning trip with web-searched details:
  routes, lodging, day-by-day stops, gotchas
- In-browser editing of every section, with a Cmd-K "Field guide" chat that
  can edit any section in place (with inline diff and revert)
- AI-prompted retrospective on completion: highlights, star rating, would-
  do-again
- Print-friendly brochure view derived live from the trip files
- ICS calendar feed for subscribing planned trips into Google/Apple/Outlook
- Interactive home-page map with drive-time routing

**Why you might care**

- Trips are markdown files on disk. Folder per trip. Read, grep, version-
  control, hand-edit, take with you when the app dies.
- BYO API key for Anthropic, OpenAI, or OpenRouter. Per-feature model
  overrides if you want a cheap model for most calls and a smart one for
  research. Search via Anthropic's built-in tool OR Tavily.
- Docker is the canonical deployment. Single bind-mount, all state in one
  directory. `docker compose up -d --build`, browser onboarding does the
  rest, no Node toolchain on the host.
- Settings UI for click-through key management OR `.env`-only mode for
  Vault/sealed-secrets folks. Both are first-class.
- No auth, single-user. Sit it behind a reverse proxy if exposing it
  beyond `localhost`.

**Stack**

SvelteKit + Node + sqlite-free markdown. ~80 test files; full
`svelte-check --fail-on-warnings` + tests + build runs in CI. MIT license.

**Repo:** https://github.com/WrongerSandwich/traverse-trip-planner

Walkthrough docs include a full Docker self-host recipe (`docs/deploy.md`)
and a sample dataset (`npm run seed-sample`) if you want to poke around
before wiring up your own API keys.

Happy to answer config / deployment questions in the comments.

---

## Personal blog post draft

**Title:** Trips as markdown: why I built Traverse

**Hook (1–2 paragraphs):**

There's a moment in every planning thread with an AI assistant where the
useful structure — the day-by-day stops, the lodging shortlist, the gotchas
you noticed three messages back — vanishes into chat scrollback the moment
you close the tab. The model knows what to do; the data has nowhere to live.

Traverse is my answer. Every trip is a folder of markdown files. The LLM is
wired into the workflow as a tool, not as the workflow. Your trips outlive
the app, the chat, and (probably) the model provider you started with.

**Sections to draft:**

1. **The mental model.** Trips as files, not rows. Three lifecycle states
   (idea → planning → completed), one orthogonal archive state. Why this is
   different from putting your trips in Notion. (Hint: grep + git.)

2. **What the LLM is actually for.** Generating regional ideas from a taste
   profile. Researching a destination so the boring logistics (hours,
   prices, lodging, drive times) are pre-filled. Writing the prose sections
   you would have written anyway. Parsing receipts. NOT making decisions —
   the human edits everything.

3. **One adapter, three providers, BYO keys.** Why I built the abstraction
   layer instead of locking to Anthropic, even though that would have been
   easier. The cost: ~200 lines of normalization code. The benefit: I can
   switch from Sonnet to GPT-4o-mini for the cheap calls without rewriting
   anything.

4. **AI workflows have shapes.** The four-archetype rubric: Instant Inline
   (the button is the spinner), In-Page Stream (banner + streaming body),
   Ambient Background (a job pill in the header, cancellable from a
   drawer), Conversational/Modal (multi-step wizard). New features pick an
   archetype. Each has its own primitives. This is the most reusable thing
   in the codebase.

5. **The brochure derivation.** A trip's printable brochure is computed
   from `plan.md` + `candidates.md` on every request. No file cache, no AI
   on the request path, no separate brochure-generation step. The trip
   files are the source of truth; the brochure is a view.

6. **The boring stuff that makes it pleasant.** Atomic writes. Disk-backed
   caches. Rolling-p50 telemetry on every model call so the "Researching…"
   pill on a card shows a real ETA. A stale-sweep on boot so a crash
   mid-job surfaces in the UI instead of hanging.

7. **What I'd do differently.** Notes for the next 0.x. (Receipts redesign.
   Maybe a multi-user mode if anyone asks for it. Better itinerary import
   from email forwards.)

8. **Try it.** Docker recipe, screenshots, the repo URL.

**Tone target:** technical but personal. Closer to a "here's how I think
about this problem" essay than a marketing post. Aim for ~1500 words.

---

## Channel + timing notes

- HN and r/selfhosted are roughly the same audience subset; staggering by
  ~a week is fine if both. Same day is double-spam.
- HN is harshest on Sunday-Monday posts; aim for a Tuesday or Wednesday
  morning US-east post.
- r/selfhosted has a rule against vague titles — the title format above
  passes the smell test but doublecheck the current sub rules first.
- Personal blog post can go up first, then the HN/Reddit posts can link
  back to it as the "why" companion to the README's "what".
- If only picking one channel: r/selfhosted. The audience matches better;
  HN can be brutal to first-time self-hosted-app submissions where the
  "is this scalable?" thread overshadows the "would I use this?" thread.

## What needs to land before the announcement

Open the v0.1.x milestone (or v0.2.0 if scope grows) and gate the
announcement on:

- Audit remediation from #175 (email-only history rewrite) — must run
  before the repo gets meaningful inbound traffic.
- Any showstopper bugs surfaced during the polish-and-soak period.
- A short screencast (10–20 seconds) of seed → research → brochure for the
  HN/Reddit post (static screenshots cover the README; a moving image
  drives clicks).
- A second pair of eyes on the README + screenshots from someone who
  hasn't been inside the codebase.
