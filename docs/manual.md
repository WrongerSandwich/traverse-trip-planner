# Traverse

## The Owner's Manual

*A personal road-trip filing cabinet, for one or two travelers, kept on your own server, written to plain markdown, and accompanied by a quietly competent AI.*

---

## Foreword

Welcome to Traverse.

If you remember the kind of manual that came shrink-wrapped with a piece of software — a stapled booklet, a few diagrams, a foldout map at the back — that's roughly the spirit of this document. Traverse is small enough and personal enough to deserve one. Not a help center. Not a knowledge base. A booklet.

The premise is simple: most travel apps treat your trips as rows in their database, your destinations as advertising inventory, and your enthusiasm as something to monetize. Traverse takes the opposite bet. Your trips are markdown files. Your taste lives in plain English. The AI is wired into the workflow as a useful tool, not as the workflow itself. Nothing is shared, nothing is synced upstream, and the data is yours in a format you can read and grep without the app running.

You may keep this booklet open as you go. Or you may close it and explore. Both are encouraged.

---

## Table of Contents

1. [Before You Begin](#1-before-you-begin)
2. [The Main Screen](#2-the-main-screen)
3. [The Lifecycle of a Trip](#3-the-lifecycle-of-a-trip)
4. [Seeding Ideas](#4-seeding-ideas)
5. [Adding a Specific Destination](#5-adding-a-specific-destination)
6. [Researching an Idea](#6-researching-an-idea)
7. [The Planning View](#7-the-planning-view) — including [7a. The Field Guide](#7a-the-field-guide)
8. [The Plan and the Candidates](#8-the-plan-and-the-candidates)
9. [The Brochure](#9-the-brochure)
10. [Marking a Trip Completed](#10-marking-a-trip-completed)
11. [The Retrospective and Receipts](#11-the-retrospective-and-receipts)
12. [Archiving](#12-archiving)
13. [The Map](#13-the-map)
14. [Filters, Bookmarks, and Browsing](#14-filters-bookmarks-and-browsing)
15. [The Calendar Feed](#15-the-calendar-feed)
16. [Configuring Your Console: home.md and Settings](#16-configuring-your-console-homemd-and-settings)
17. [When Things Get Weird](#17-when-things-get-weird)
18. [Closing Notes](#18-closing-notes)

---

## 1. Before You Begin

Traverse runs on your own machine. The recommended way to start it is Docker — `docker compose up -d` from the project folder. The app then lives at `http://<your-server>:3456`. On a laptop on the same network, that is where you point your browser.

The first thing the app will want is for you to tell it about yourself. You will be guided through an onboarding flow that creates `home.md` — your home base, your vehicle, your travelers, what you like, what you don't, when you can't travel, who feeds the cat. Take a minute with this. Everything Traverse does, from the first generated idea to the last printed brochure, is filtered through `home.md`. It is the closest thing this software has to a personality dial, and it is yours.

You will also need an AI provider key (Anthropic, OpenAI, or OpenRouter), a free Pexels key for the trip card photos, and, optionally, a Tavily key if you are using a non-Anthropic research model. Paste them into the Settings page. From here on, the rest of the manual assumes the app is up and the keys are in place.

---

## 2. The Main Screen

The home page is the room you will spend the most time in. It is built around three things:

- **The card grid.** Each trip — idea, planning, or completed — gets a card. The card has a photo, a title, the destination, the vibe, and a few badges where they apply (national park, EV-friendly, bookmarked, weekend-viable). Cards are the primary browsing surface.
- **The map.** All of your trips appear on a single Leaflet map, with drive-time route lines drawing in as you scroll. The map is not decoration. It is the interface for the spatial relationship between your home base and everywhere you have considered going.
- **The filters.** Across the top: stage (ideas, planning, completed), drive-time range, cost tier, national parks, bookmarks. Browsing is meant to be a small, satisfying act, not a search query.

Two important buttons live on the home page:

- **`+` (Seed).** Generates five new idea cards in one shot, drawn from `home.md` and any optional steering prompt you give it. This is the "show me something I haven't thought of" button.
- **Pin (Add destination).** Generates one idea card for a specific place you name. This is the "I just read about a town in Wyoming, get it in here" button.

Across the header, two ambient indicators appear when they have reason to. A small pill shows any background AI job in progress (research, mostly), and a per-trip badge appears on cards whose trip currently has work running. You can always click through to the jobs drawer to see what is happening, or to cancel it.

---

## 3. The Lifecycle of a Trip

Every trip moves through three stages. The stages are not arbitrary — each corresponds to a different mood and a different set of files on disk.

**Idea.** A single markdown file with a title, a destination, a one-line pitch, a vibe, and a creation date. Nothing more. Ideas should take you less than thirty seconds to create — which is why the Seed and Add buttons exist. They are a thought you wanted to remember, not a commitment.

**Planning.** Once an idea earns a closer look, you press `Research →` and it becomes a folder. The folder contains an `overview.md` with expanded frontmatter (driving hours, best seasons, travelers, lodging, route waypoints, and so on), plus sibling files for `route`, `logistics`, `plan`, and `candidates`. This is where the trip becomes real. You can edit any section by hand or via the chat assistant.

**Completed.** When the trip is in the rearview mirror, you mark it completed. It moves to the `completed/` folder. You can optionally walk through an AI-prompted retrospective that writes a `notes.md` — five trip-specific questions, a star rating, a "would do again" toggle, and a Highlights section that surfaces back into the file's frontmatter.

Earlier-stage fields are never removed. Structure accrues. An idea that becomes a planning trip and then a completed trip keeps its original pitch and its original vibe along the way.

A fourth state, **Archive**, exists orthogonally. Any trip at any stage can be archived. Archived trips disappear from the UI but stay on disk, so the AI doesn't suggest them again the next time you press Seed.

---

## 4. Seeding Ideas

Press the `+` button on the home page. A small panel appears with an optional text field — a steering prompt — and a Generate button.

You can leave the prompt empty and let Traverse pick. Or you can be specific: *"fall colors within four hours,"* *"scenic byways with quirky small towns,"* *"someplace flat and warm for February."* The model reads `home.md`, looks at what you already have on disk, and produces five new ideas that don't duplicate anything you've already considered or rejected.

Seeding is what is called an **Instant Inline** workflow — the button becomes a spinner, the result lands in well under a minute, and the new cards appear in the grid. If a request fails, you'll see why; if it succeeds, you'll see five new cards drop in with photos already attached.

A note on the photos: each idea includes a small `image_query` field that the model authored as part of generating the trip. That field — not the trip title — is what gets sent to Pexels. Two or three concrete visual nouns ("Glacier mountains," "Chicago skyline downtown") pull a far better photo than a poetic title.

---

## 5. Adding a Specific Destination

The pin button next to Seed is for the other mode — you already know where you want to go, and you want a card for it. Type the place name, press Generate, and Traverse produces a single idea, complete with pitch, vibe, and a photo. It also runs a semantic duplicate check against your existing trips, so if you accidentally try to add "Mackinac Island" twice, it will tell you.

This is the right button to use when you have just read a magazine article, or a friend mentioned a town, or you saw a billboard from the highway.

---

## 6. Researching an Idea

Every idea card has a `Research →` button. Pressing it is the point at which Traverse starts doing real work for you.

Research is an **Ambient Background** workflow. It takes a minute or two — sometimes a little longer — and during that time you can navigate away, browse other trips, do something else entirely. Progress is reflected in the header pill and the per-trip badge. If you want to cancel, the jobs drawer has a button for that.

Behind the scenes, two things happen in sequence as one job:

1. The model promotes the idea into a planning folder, fleshes out `overview.md` with the structured fields (driving hours, duration, best seasons, lodging hints, waypoints along the route), and writes companion files for the route and logistics. The web is searched as needed for hours, prices, current conditions.
2. Then the same job runs an extraction pass that writes `plan.md` and `candidates.md` — a starter day-by-day skeleton plus a candidate pool of stops and lodging options.

When the job completes, the card moves from the ideas row to the planning row, and clicking through takes you to the planning view.

---

## 7. The Planning View

The detail page for a planning trip is laid out as a stack of canonical sections: **Overview, Route, Logistics, Plan, Candidates**. They are always all present, even before the research has touched some of them. Empty sections render a placeholder with a `Research →` button of their own.

Each section has its own `Edit` button. There is no global edit mode. You click `Edit` on the section you want to change, a textarea opens with Save and Cancel buttons, and you edit just that file. This is meant to feel like opening one drawer of a filing cabinet — not reorganizing the entire room.

A `⋯` menu in the header collects the lifecycle actions: Mark as completed, Add retro (later), Archive, View full brochure. These are grouped so the heavy actions sit apart from the light ones.

The map is always present on the planning view. If `waypoints` is set on the trip, a solid road-following route line draws from your home base through the named cities to the destination. If it isn't, you'll see a straight line — and that's the cue to either fix the waypoints or let Research fill them in.

### 7a. The Field Guide

The **Field Guide** is a chat assistant built into the planning view. Open it with **Cmd-K** (or **Ctrl-K** on Windows/Linux), or press the small **`↳ Ask`** button that appears beneath each section heading. When you open it via the section button, a scope chip in the palette shows which section it is focused on; you can click that chip to widen the scope to the whole trip if your request spans more than one section.

#### What the Field Guide is good at

Think of it as a skilled editor who has read the entire trip file, knows where you live, and remembers your preferences from `home.md`. Good requests are ones where you are asking it to refine existing prose with some specific intent.

A few concrete examples:

- **Refine a section with a new constraint.** "Rewrite Logistics to assume we're bringing the dog — adjust the lodging notes and any attraction suggestions that don't allow pets." The Field Guide reads the current Logistics text, applies the constraint, and proposes a replacement.
- **Expand a sparse section.** "The Route section only has one paragraph. Add detail about the stretch through the Smokies — road conditions, any scenic pull-offs worth noting." It draws on what research already wrote and your home context to fill it out.
- **Add a new consideration.** "Add a note to Overview about the best shoulder-season windows and why August is probably too crowded." It appends the note in the right place rather than rewriting the whole section.
- **Ask for alternatives.** "The Logistics section lists one lodging option. Give me two more that are closer to the trailhead." It proposes a revised section with the added options.
- **Tighten the prose.** "The Route section is repetitive. Consolidate it without losing the key details." It edits for concision.

The Field Guide also handles purely conversational questions — "what's the typical road condition on this stretch in March?" — and will answer in the palette itself without proposing any edits. Esc out when you have what you need.

#### What the Field Guide cannot do

- **Cross-trip queries.** It only has access to the trip you are currently viewing. It cannot compare this trip to another, or aggregate information across trips.
- **Structured edits to Plan or Candidates.** The Plan and Candidates sections are driven by structured YAML in `plan.md` and `candidates.md`. The Field Guide edits prose sections (Overview, Route, Logistics); it does not add or reorder days, promote candidates, or restructure the YAML. Use the Plan and Candidates UI controls for that (see §8).
- **Live web search.** The Field Guide works from what is already on disk — the research the Research action ran, plus your `home.md`. It cannot browse the web. If you need up-to-date hours, prices, or road conditions, use the `Research →` button on the relevant section, which does run a live web search.
- **Structural changes to the trip folder.** It cannot rename files, delete sections, or move the trip to a different lifecycle stage. Those operations are in the `⋯` menu.

#### The Field Guide and home.md

The Field Guide always reads `home.md` alongside the trip. That means constraints you have written there — your vehicle, number of travelers, pet situation, weekly commitments, travel preferences — are automatically in scope. You do not need to repeat them in your prompt.

The question of where a constraint belongs is answered by how long it will be true. If the answer is "for the foreseeable future," write it in `home.md` once and forget about it (see §16 on that norm). If it's specific to this trip — "on this trip we're adding my parents, who need accessible lodging" — say it inline in your Field Guide prompt. The Field Guide will use it for this response but not encode it anywhere permanent.

If you notice yourself restating the same constraint in Field Guide prompts trip after trip, that's a signal it belongs in `home.md`.

#### The diff and revert flow

When the Field Guide proposes a change to a section, two things happen at once:

1. The new content is **written to disk immediately** on the server.
2. The section on the page switches from its normal rendered view to an **inline diff overlay** — a banner carrying the assistant's explanation, followed by the section body with added paragraphs lightly highlighted and removed paragraphs shown at reduced opacity with strikethrough.

The diff is paragraph-level, not line-level. Unchanged paragraphs that fall between changed ones stay visible for context; long runs of unchanged content collapse into a "+N unchanged paragraphs" stub you can expand inline.

The banner has two buttons:

- **Keep changes** — dismisses the overlay. The disk already has the new content; this just clears the review UI.
- **Revert** — sends a request to the server to restore the section to its pre-edit state, then clears the overlay. This is a real disk write, not just a UI reset.

If you **navigate away** before resolving the diff, the overlay is gone. The disk already has the new content (from step 1 above), so the section will render the updated version when you return. If you wanted the old content back, you can edit the section by hand or open the file directly. There is no "undo" after navigating away.

#### No log of past AI edits

There is no edit log, no "last AI edit" affordance, and no history of what the Field Guide has changed. Once you accept or navigate away, the previous version is gone unless you have it in a git commit or a local backup. If you want to preserve a version before a major Field Guide edit, copy the section text somewhere or commit the file before you begin.

---

## 8. The Plan and the Candidates

These two sections are worth their own chapter, because they are the most structured part of Traverse and the most useful once a trip is real.

**The Plan section** is the day-by-day. Each day is a card with a title, an optional date, a notes field, and a list of stops in order. You can:

- Press `+ Add day` to append a new empty day to the trip.
- Press `+ Add stop` on a day to open a picker over the Candidates pool — choose a stop, and it moves into the day at the bottom.
- Use the `↑ ↓` arrows on a stop to reorder it within the day.
- Click into the day's metadata to set its lodging, a date, or notes.

**The Candidates section** is the pool — a tabbed Stops / Lodging browse with cards showing category, name, and a short description of each option. These are the candidates the research pass surfaced. From a candidate card you can:

- **Promote to day…** — pick a target day, and the candidate moves into the Plan as a stop on that day.
- **Un-promote** — on a stop already in the Plan, removes it from its day and returns it to the candidate pool.

The mental model is exactly the metaphor name suggests. Candidates is the wide pool of things you might do. The Plan is the narrowed sequence of things you actually intend to do. Moving an item between them is supposed to feel like sliding a card from one stack to another.

On a completed trip, both sections become read-only — a frozen record of what you actually decided to bring with you.

---

## 9. The Brochure

Once a planning trip has a populated `plan.md`, a `View brochure` link appears. (Two ways in: the `⋯` menu has it under Output, and a small `↗ View brochure (for print)` link appears above the section stack.)

The brochure is a print-optimized layout, derived freshly from the current Plan and Candidates every time you open it. No file is cached. No AI is run when you view it — it is a deterministic rendering of what is on disk.

The page shows:

- A cover photo with the hero stats — date, distance, drive time, duration.
- A paper-map-style inset showing the route from home.
- A destination map with numbered pins corresponding to your stops. (Pins that fall off the visible map get an edge indicator pointing toward them. Stops whose pins we couldn't geocode get tagged "unmapped" rather than silently dropped.)
- The Plan, day by day, with stops, lodging, field-guide notes, and gotchas.

Pressing **Print / Save PDF** in your browser (or via the print affordance on the trip detail page) gives you a clean printable copy with no app chrome. This is the page you fold and put in the glove compartment.

---

## 10. Marking a Trip Completed

When a trip is behind you, open its detail page, press `⋯`, and choose **Mark as completed** from the Lifecycle group.

This opens a **Conversational/Modal** workflow — a small wizard. The model asks five trip-specific questions, drawing on what was actually in the trip's planning files. You provide a star rating, decide whether you'd do it again, and answer in your own words. If you close the wizard halfway through with answers entered, Traverse will ask whether you want to discard them.

When you finish, two things happen:

1. The trip moves to the `completed/` folder.
2. A `notes.md` is written with your answers as prose, plus a `## Highlights` section. The server lifts the highlight bullets up into the file's frontmatter alongside `rating`, `would_repeat`, and `date_completed`.

The retro is fully skippable. You can mark a trip completed, dismiss the modal, and add the retro later from the `⋯` menu (an `Add retro` option appears whenever `notes.md` is missing).

A safety note: if `notes.md` already exists and you try to write a new one, the server returns a 409. To redo it, delete the file by hand and reload.

---

## 11. The Retrospective and Receipts

**Add retro.** Same modal as above; available any time the trip has no `notes.md`. Useful if you skipped it at completion and want to do it months later.

**Add receipts** is currently disabled. An earlier version parsed receipt photos into prose lines under `## Receipts` in `notes.md`, but it offered no exit — no totals, no comparison against a trip's cost estimate. It will return after a redesign as a real ledger rather than a log.

---

## 12. Archiving

Sometimes a trip is wrong. The vibe doesn't match, the timing won't work, the place lost its appeal, you've gone there and don't need a card for it. You can archive any trip from the `⋯` menu, under Lifecycle (it has danger styling and a confirmation dialog — archiving is hard to un-do casually).

The archived trip moves to `archived/<source-stage>/<slug>/` with its frontmatter intact. The UI never shows it again. But the Seed action still scans archived destinations, which means previously-rejected places do not get re-suggested in your next batch of ideas.

If you genuinely want a trip back, you can move the folder by hand from `archived/` back to `ideas/`, `planning/`, or `completed/` — the app will pick it up on the next page load.

---

## 13. The Map

The map is everywhere. It is on the home page. It is on every trip detail page. It is on the brochure.

A few things to know about it:

- Routes are road-following, generated by OSRM and cached on disk. They do not appear unless the trip has `waypoints` set. A trip with only a destination shows a straight line until you (or Research) provide intermediate cities. If a planning trip is missing waypoints, the map shows a small hint at the bottom with **Run Research →** and **Edit overview** buttons — you don't need to consult this manual to know what to do.
- Route geometries are not bundled into the initial page load. They are fetched lazily as you hover or scroll cards into focus. This keeps the home page light.
- Map animations respect `prefers-reduced-motion`. If you have that set at the OS level, the map will hold still where it would otherwise fly.

On mobile, the map is still present but does not dominate. The cards are the primary surface. The map is something you swipe to.

---

## 14. Filters, Bookmarks, and Browsing

Across the top of the home page:

- **Stage** — show ideas, planning, completed, or all.
- **Drive time** — a range slider. Hide everything more than four hours away on a busy weekend.
- **Cost tier** — budget, mid, splurge.
- **National parks** — show only trips with `national_park: true`.
- **Bookmarks** — show only starred trips.

Bookmarking lives on every card as a star icon. Pressing it toggles `starred: true|false` in the trip's frontmatter — so the bookmark survives even if you nuke the cache, and is visible to anything reading the file.

Active filters are saved to your browser's local storage and restored on reload, so your preferred view survives closing the tab or hard-refreshing. "Clear all" removes both the runtime state and the saved state. If local storage is unavailable (private-browsing mode, blocked by browser policy), filters default to their unfiltered state on each load.

---

## 15. The Calendar Feed

Traverse exposes an iCalendar feed at `/api/cal.ics`. Subscribe to it from Google Calendar, Apple Calendar, Outlook, or any other client that speaks ICS, and your planning-stage trips with a `target_date` will appear on your calendar.

If you only want one trip on your calendar — say, the big one you're actively negotiating dates around — there is a per-trip feed at `/api/cal/<slug>.ics`. Subscribe to that instead.

The feed updates whenever the underlying markdown files do. There is no "publish" step.

---

## 16. Configuring Your Console: home.md and Settings

The single most important file in Traverse is `home.md`. It is created during onboarding and lives at the root of the trip directory. It has two parts:

- **Frontmatter.** Structured values — `home_coords`, default radius, vehicle specs, travelers, pet sitter, EV info. The AI reads these as facts.
- **Prose.** A free-form description of your taste, your constraints, your weekly commitments, what kind of trip you want and what kind you don't. The AI reads this as voice.

The Settings page — accessible from the header — lets you edit all of this without opening a text editor. There is also a separate Configuration page where you set provider keys, the default model, and feature flags (like whether the receipts feature is available based on your model's vision support).

Two principles for editing `home.md`:

1. **It is the source of truth.** When you find yourself wanting to give the AI a constraint in a prompt ("oh, and we have a dog"), consider whether the constraint belongs in `home.md` instead. If it's something true about you for the next year, write it down once. This applies to Field Guide prompts too — see §7a for the full reasoning on when a constraint belongs in `home.md` versus inline in a prompt.
2. **Omit rather than guess.** If you're not sure about a value, leave it out. The model handles missing fields well; it does not handle wrong fields well.

---

## 17. When Things Get Weird

A short list of failure modes and what to do about them.

**A card has the wrong photo.** Open the trip's markdown and change `image_query` to a more concrete visual phrase. The next page load picks it up. (Note: Pexels rewards visual nouns — "Glacier mountains" — and punishes atmospheric phrases like "the feeling of autumn.")

**The route line isn't drawing.** The trip is probably missing `waypoints`. The map itself will tell you — planning trips without waypoints show a "No route line — missing waypoints" hint with two options: **Run Research →** (lets the AI fill them in from web search) or **Edit overview** (opens the frontmatter editor so you can add an inline array of cities yourself, e.g. `[Cleveland OH, Sandusky OH, Toledo OH]`).

**A background research job is stuck.** Open the jobs drawer from the header pill and cancel it. The trip will remain in whatever state it was in. You can retry the research from the empty section's `Research →` button.

**The retro modal won't open.** If `notes.md` already exists on the trip, the server returns 409 by design — to redo, delete `notes.md` from the trip's folder and reload.

**Trips you don't want keep getting suggested.** Archive them. Archived trips stay in the seed-avoidance list, so the AI won't suggest them again.

**The Field Guide proposed something wrong.** Press **Revert** in the section banner to restore the previous content, then edit the section by hand. If you navigated away before reverting and the disk now has the bad content, open the file directly — it is plain markdown, and the app picks up your edits on the next page load. There is no automatic undo after navigating away.

**The Field Guide is making changes you didn't ask for.** Be more specific in your prompt about which section and what aspect you want changed. If the scope chip shows "Trip" and you only wanted to touch Logistics, close the palette, use the `↳ Ask` button on the Logistics section directly to scope the request.

**The Field Guide keeps saying it can't search the web.** That's correct — it only knows what is already in the trip files and `home.md`. For up-to-date hours, prices, or road conditions, use the `Research →` button on the relevant section instead.

**Something deeper is wrong with a file.** Edit it. The whole point of Traverse is that trips are plain markdown. Open the file in your editor of choice, fix what's wrong, save, reload. The app re-reads on every page load.

**Provider errors.** Check the Settings page for the configured provider and model. The `npm run smoke` command does a one-token round-trip across every configured provider — useful after rotating keys.

---

## 18. Closing Notes

A few things to keep in mind as you live with this software.

Traverse is built to be lived in, not sold. It is stable enough for daily personal use and rough enough that you will, occasionally, want to be the kind of person who is comfortable opening a markdown file when something gets weird. That is a feature. The data is yours. The format is yours. The app is a viewport, not a vault.

The AI is fast at things that would take you a half-hour of browsing — generating regional ideas, fleshing out a logistics section, surfacing a candidate restaurant in a town you've never been to. It is not fast at knowing what you want. That is what `home.md` is for, and it is what you bring to the table. The division of labor is intentional.

Success looks like one thing only: you actually going somewhere you found in this tool, and coming back to log that you did. Everything else — the maps, the brochures, the candidates, the retros — is in service of that one outcome.

Have a good drive.

---

*Traverse is open source under the MIT license. The latest version of this manual lives at `docs/manual.md` in the repository.*
