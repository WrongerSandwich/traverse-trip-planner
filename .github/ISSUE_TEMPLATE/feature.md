---
name: Feature / fix ticket
about: Well-defined work item suitable for async agent handoff
title: ""
labels: ""
assignees: ""
---

<!-- Read AGENTS.md first if you're an agent picking this up. -->

## Goal

<!-- One paragraph. What user-visible behavior changes after this ticket
ships? Don't describe the implementation — describe the outcome. -->

## Deliverables

<!-- Concrete artifacts. Use a checklist so progress is trackable. Each
item should be either a code change, a test, or a doc update. -->

- [ ]
- [ ]

## Files likely touched

<!-- Best-effort list of paths. Not binding — the agent may discover more,
but a wildly different file set should be flagged in the PR description. -->

-

## Success criteria

<!-- How will we know it works? Be specific:
     - "Pin #4 is no longer hidden behind pin #2 when both project to
        the same pixel within 4px"
     - "GET /api/foo/bar returns 404 (not 500) when slug doesn't exist"
     - "/trips/[slug]/brochure renders without the route-inset section
        when the trip has no waypoints"
     Avoid "looks good" or "feels better" — those can't be verified. -->

-

## Verification

```
npm run verify
```

<!-- If additional verification is needed (smoke test, manual click-through,
specific test command), list it here. -->

## Out of scope

<!-- Anything related the agent might be tempted to also fix. Explicitly
listing keeps the diff focused. -->

-

## Context / references

<!-- Links to: prior PRs that introduced the behavior being changed,
upstream docs (Svelte 5, SvelteKit, Anthropic API), screenshots if a UI
change. -->

-
