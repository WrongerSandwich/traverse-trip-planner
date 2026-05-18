---
target: settings page
total_score: 21
p0_count: 2
p1_count: 6
timestamp: 2026-05-18T01-41-13Z
slug: src-routes-settings-page-svelte
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | `Saving…` button + Feature health + per-save feedback. Top form lacks dirty tracking. |
| 2 | Match System / Real World | 2 | Leaks implementation (`.env`, `settings.json`, `anthropic-builtin`, "model slots"). Honest for self-hoster, opaque otherwise. |
| 3 | User Control and Freedom | 2 | Destructive actions confirm, but no undo after Save, no "discard changes" on the home form. |
| 4 | Consistency and Standards | 1 | Two confirm patterns (inline vs modal) for the same destructive action class. Two Save buttons with different dirty semantics. `.field-warn` defined twice. Em-dashes pervasive after the home page just removed them. |
| 5 | Error Prevention | 2 | Good: `searchProviderWarning`, vehicle-key regex. Missing: client-side checks on API keys, model names, home_coords ranges. Empty city saves and round-trips. |
| 6 | Recognition Rather Than Recall | 2 | Provider/service dropdowns are typed; model name is a plain text input with no autocomplete. |
| 7 | Flexibility and Efficiency | 2 | No shortcuts, no bulk paste, two Saves create work-loss risk. |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained typography saves the score; the eight-section dump hurts it. |
| 9 | Error Recovery | 2 | Server errors render as raw strings (`saveError = body.error ?? \`Server error ${res.status}\``). No `ERROR_REGISTRY`, no recovery affordance. |
| 10 | Help and Documentation | 2 | Inline hints are good. No links to "Get an Anthropic key," no docs link, no smoke-test. |
| **Total** | | **21/40** | The lowest-scoring surface so far. Structural issues, not polish. |

## Anti-Patterns Verdict

**Mixed.** The aesthetic dodges the SaaS-settings template — no left rail, no sticky-bottom save bar, no card grid. The breadcrumb header and italic-Fraunces section h2s read as deliberate.

**But the IA executes the template anyway.** Eight equal-weight stacked sections in one column. Two near-identical key tables back-to-back ("Model provider keys" / "Service keys" at lines 546-623, sharing 90% markup) — exactly the duplication an LLM emits when it can't decide whether to abstract or copy. Two Save buttons (lines 698-708 and 985-999) with parallel state machines, the kind of split that happens when a section gets bolted on later.

**Absolute bans:**

| Ban | Status |
|-----|--------|
| Side-stripe borders | Pass |
| Gradient text | Pass |
| Default glassmorphism | Pass |
| Hero-metric template | Pass |
| Identical card grids | Pass |
| Modal as first thought | Pass (modal only for vehicle delete, where it's overkill given inline confirm exists nearby) |
| Em-dashes in copy | **HIT, repeated.** 18+ em-dashes across copy: `:333, :499, :557, :565, :587, :596, :604, :627, :640, :663, :669, :712, :783, :810, :816, :902, :952, :956` etc. The home-page em-dash purge has not propagated here. |

**Detector:**
- File scan: 0 hits (suspiciously clean; possibly a detector skip on Svelte+CSS — worth a follow-up).
- Live URL scan: **10 × line-length** (~92-100ch text blocks, no max-width on prose); **7 × tiny-text** at 11px; **1 × overused-font** (Inter at 65%); **1 × flat-type-hierarchy** (8 sizes in 10-18px range, ratio only 1.8:1 — no clear scale).

**Browser overlay:** still no extension connection in this session.

## Overall Impression

The lowest-scoring surface in the project so far, and the gap isn't visual polish — it's that **the page is organized for a self-hoster's config-file inspector, not for a user setting up their travel planner**. The thing first-time users actually need (home base) lives under 7 sections of `.env`-overlay jargon. The thing returning users most touch (theme, assistant name) sits above 290 lines of CRUD they rarely look at. Two Save buttons can lose work if you save the wrong one. The em-dash purge that just hit the home page didn't reach here. The CSS has duplicate rules where the cascade silently picks a winner.

**Biggest opportunity:** restructure the IA. Home base first, infrastructure collapsed behind "Server config / Advanced," one save flow with clear dirty state.

## What's Working

- **Home base pristine tracking** (`+page.svelte:313-326, 989`). Save disabled when nothing changed; snapshot resets on success. Textbook.
- **Feature health section** (`:531-544`). Genuinely product-specific — derives from real config rather than asking the user to know. Should be at the top, not buried second.
- **`searchProviderWarning` inline validation** (`:115-119, 677`). Surfaces the anthropic-builtin/non-anthropic conflict before the user hits Save. Real footgun saved.
- **home.md → form mapping** (`:959-970`). `## Heading → textarea` pairs with the heading rendered as `## Heading` in mono. Honest mapping of file structure to form. Advanced preamble correctly hidden in `<details>`.

## Priority Issues

**[P0] Two Save buttons, two dirty-state behaviors, two paths to lose work.**
`Save settings` at `:700` handles keys/services/slots/search/assistant, is always enabled even with no changes, and POSTs blindly. `Save home base` at `:991` tracks `pristine` and disables when clean. They're visually identical buttons separated by ~290 lines of markup. A user editing the assistant name AND home_city has to hit two saves; nothing indicates the split.
Fix: either (a) collapse to one Save with combined dirty tracking, or (b) keep split but treat the page as two clearly different zones — different background, "Server config" / "Personal context" labels, dirty tracking on the top form too, and a sticky-on-section save bar.
→ `/impeccable shape` (this is structural)

**[P0] Home base is buried at the bottom of a config-file dump.**
For first-time setup, Home base IS the page task. Yet it sits at line 710 of 1593, after seven sections of `.env`-overlay infrastructure. The empty-state for missing home.md (`:333`) is a dead-end string ("home.md not found — create it to enable editing") with no CTA. The whole page reads as "inspect your config file," not "set up your travel planner."
Fix: reorder. Home base first, serif title that matches the page voice. Collapse the seven infra sections into "Server config" — tabs, a single collapsible group, or a "Show advanced" disclosure that hides keys/slots/search behind one click. Feature health becomes a small status strip near the top.
→ `/impeccable shape`

**[P1] Em-dashes pervasive in UI copy.**
18+ em-dashes across section descriptions, badges, and hints. The home page was just purged of these per project policy; the settings page is out of sync. Selected examples: `:333` "home.md not found — create it", `:557` "set — {preview}", `:587` "Non-model integrations — search, photos, maps", `:627` "Changes take effect on the next AI call — no restart needed", `:712` "Everything in `home.md` —", and many more.
Fix: mechanical pass replacing each `—` with a period, semicolon, comma, or restructuring to two sentences.
→ `/impeccable distill`

**[P1] Server errors are raw strings, not routed through `ERROR_REGISTRY`.**
`:151, :179, :242, :475` all do `saveError = body.error ?? \`Server error ${res.status}\``. CLAUDE.md mandates `ERROR_REGISTRY` from `src/lib/errors-registry.js` and forbids "inline catch sentences." The home page was just migrated; settings was not. A user seeing "Server error 500" has no next step.
Fix: route through `failureSentence()` + typed codes. Add `settings_save_failed`, `home_save_failed`, `home_load_failed` codes. Map `home.md not found` to a recovery CTA ("Create from template").
→ `/impeccable harden`

**[P1] Inconsistent destructive confirm patterns.**
Removing an API key (`:558-566`) uses inline "Yes, remove / Cancel" buttons. Removing a vehicle (`:830`, `:1005-1012`) uses `<ConfirmModal>` overlay. Same severity, two completely different UIs sitting on the same page. Inline confirm is also tiny — 10px mono with 1px-6px button padding.
Fix: pick one. Inline is fine for both, bumped to a real touch target.
→ `/impeccable polish`

**[P1] Touch targets fail the 44px floor across the page.**
PRODUCT.md commits to 44px. `.btn-remove` ≈ 22px (`:1253-1264`), `.btn-confirm-yes/-cancel` ≈ 22px (`:1280-1293`), `.btn-icon` ≈ 22px (`:1487-1497`), `.theme-option` / `.radio-option` ≈ 28px (`:1320, :1402`). Mobile persona's only viable settings path has every interactive element below floor.
Fix: bump padding on theme/radio chips to ≥10px y · 14px x at 13px font. Inline confirm buttons to ≥32px tall. Vehicle remove × icon needs a 44px hit area even if the visual glyph stays small.
→ `/impeccable adapt`

**[P1] `.field-warn` defined twice; `.btn-remove:hover` defined twice.**
`:1124-1129` (11px / 10px top margin / `--state-warning`) and again at `:1525-1529` (12px / 4px top margin / fallback to `--text-tertiary`). The second wins by cascade. Same for `.btn-remove:hover` at `:1265` and `:1500`. Real cascade bug — keys-section warnings render differently from home-base warnings.
Fix: de-dupe both selectors; pick the intentional values.
→ `/impeccable polish`

**[P2] Light-mode `--text-tertiary` (`#9A8A6F` on `#FCFAF5`) ≈ 3.1:1 — fails AA body.**
Used pervasively at 11-12px sizes: `.field-hint` (`:1118`), `.section-desc` (`:1080`), `.health-status` (`:1171`), `.badge-unset` (`:1190`), and the LocationPicker's `coords-preview`. The dark-mode counterpart was just lifted from `#7C8A7B` to `#9DAA9C` in this session; light mode needs the same treatment.
Fix: lift `--text-tertiary` in light mode from `#9A8A6F` to ~`#7C6E55` (darker against cream) or similar — must clear 4.5:1 on `--surface-page` (`#FCFAF5`) and `--surface-raised` (`#F6F1E5`).
→ `/impeccable colorize`

**[P2] Mobile: no media queries; tight grids don't collapse.**
The file has ZERO `@media` rules. `.slot-fields` (`:1234`) uses `grid-template-columns: 160px 1fr` and stays that way at 390px — the 160px provider column claims 41% of the viewport, model input squeezes to ~150px. `main { max-width: 600px }` (`:1060`) handles the outer column reasonably, but individual rows don't.
Fix: add a `@media (max-width: 768px)` block that collapses `.slot-fields` to single column, stacks `.vehicle-add` controls, and bumps form-control min-heights.
→ `/impeccable adapt`

## Persona Red Flags

**Sunday-morning owner (desktop, first-time setup):** lands on "Appearance / Theme," then "Feature health" requiring them to understand `lock` / `deepen` before they've configured anything. The thing they actually need — home.md — is at the bottom after seven sections of `.env` jargon. Empty-state for missing home.md is a dead-end string with no "Create from template" CTA.

**Kitchen-phone owner (mobile, mid-task):** opens settings to flip one preference. Theme chips ~28px, eight sections to scroll past, the toggle they want (say, "pets need a sitter" at `:775` or distance unit at `:787`) is buried four screens down inside Home base. Save Home Base is *another* screen below. Round-trip to flip a toggle is plausibly 30+ seconds of scrolling.

**Self-hoster (configuring API keys):** the experience is honest — it tells the truth about `.env` overlay, redaction, `inherit from .env`. Correct register. But too-honest: no link to "Get an Anthropic API key," no smoke-test, no client-side check that `sk-ant-...` looks right. Feature health only updates on page reload — paste a key, save, manual refresh.

## Minor Observations

- `title` attribute as the only explanation of "vehicle key can't be renamed" (`:816, :1456` with `cursor: help`) — inaccessible on touch and keyboard.
- `homeRadius` label "Default radius (mi)" (`:749`) doesn't change when `homeDistanceUnit` is `km`.
- `assistantName` placeholder uses `data.effectiveAssistantName` (`:692`) — nice touch. Same pattern not applied to the model slot input (`:652`) which uses a hardcoded `claude-sonnet-4-6` placeholder.
- Provider/service `<select>` options use lowercase labels (`anthropic`, `openai`, `openrouter`) — `PROVIDER_LABELS` (`:60-64`) exists with sentence-case but isn't used. Inconsistent capitalization with names rendered as "Anthropic" / "OpenAI" elsewhere on the page.
- `:focus-visible` not used anywhere; all focus styling is bare `:focus` with a 1px border-color tint — borderline visible for keyboard users.
- Stray `.field-warn` fallback `color: var(--state-warning, var(--text-tertiary))` at `:1527` — fallback unreachable since `--state-warning` is defined globally.

## Questions to Consider

1. If 95% of users set API keys once via `.env` before they ever open the browser, why do seven of eight sections concern API keys / model slots? Should those collapse behind an "Advanced server config" disclosure that's empty 99% of the time?
2. Home base is two different things mashed into one panel: (a) structured fields the LLM mechanically reads, and (b) prose context the LLM reads as freeform. Should those be "Trip-planning facts" (CRUD form) vs "Tell the planner about you" (single big textarea as a journal entry)?
3. The Feature health checklist is the most product-specific thing here. What if the *entire* page was organized around it — start with "Seed ideas: ✗ unavailable" with the inline path to fix it — instead of listing every config knob upfront?
