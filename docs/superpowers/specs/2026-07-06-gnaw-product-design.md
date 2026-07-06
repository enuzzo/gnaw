# Gnaw Product Design

Date: 2026-07-06
Status: Approved direction, pending implementation plan

## Purpose

Gnaw is a macOS-first website capture tool for studying real sites in depth. It should capture what a modern browser actually downloads after JavaScript runs, then package the result in two useful forms:

- A navigable offline mirror for visual inspection.
- A study bundle that can be read by humans and fed to an LLM.

The CLI exists because it is the fastest way to build, test, and stabilize the engine contract. The GUI is the primary product surface. Every CLI capability should map cleanly to a future SwiftUI control, progress view, or action.

## Product Principles

- Capture reality, not guesses. Gnaw observes Chromium's network traffic instead of trying to infer assets from static HTML.
- Keep the engine contract stable. The GUI, the Playwright reference engine, the Rust production engine, and the parity harness all speak through the same files and NDJSON events.
- Make authenticated captures normal. Login-gated sites are a first-class use case, not an edge case.
- Preserve user control. Gnaw should not submit forms, mutate accounts, bypass access controls, or store passwords.
- Produce study-ready output. A haul should explain what was captured, how it was captured, and where the important files are.

## Selected Approach

Build the Node/Playwright reference engine first, then the Rust engine and macOS app against the same contract.

This gives the project a working capture tool early, while still protecting the long-term architecture. Playwright becomes the teacher: it proves what a correct haul looks like. Rust becomes the shippable engine. The SwiftUI app becomes the face of the product and should eventually hide almost all CLI details from normal users.

The initial CLI should be treated as an internal and power-user interface, not the final experience.

## Core Architecture

```
SwiftUI app
  launches an engine process
  reads NDJSON events from stdout
  renders progress and output actions

Engine process
  drives Chromium
  records network responses
  writes haul folders
  emits clean NDJSON events

Haul folder
  navigable offline mirror
  study bundle
  manifest
  waterfall log
  context prompt
```

The GUI never performs capture logic. It selects options, starts/stops jobs, reads events, and opens finished output.

## Auth Profiles

Authenticated sites are handled through local browser session profiles.

The first engine exposes:

```bash
gnaw auth login https://example.com --profile client-a
gnaw capture https://example.com/dashboard --profile client-a --mode study,navigable
gnaw auth list
gnaw auth delete client-a
```

`gnaw auth login` opens a visible Chromium session. The user logs in manually, including SSO, 2FA, consent screens, or CAPTCHA. Gnaw stores the resulting browser state in a named local profile. It does not ask for, save, or replay passwords.

The GUI version should present this as a profile manager:

- Add login profile.
- Open login window.
- Show last verified URL and timestamp.
- Use profile for a capture.
- Delete profile.

Sensitive values must not appear in `MANIFEST.json`, `context.md`, or logs. The manifest may state that a named auth profile was used, but cookie names, token values, authorization headers, and localStorage contents must be redacted.

## Capture Behaviour

For each page, Gnaw should:

1. Create or reuse a browser context.
2. Apply viewport, user agent, rate limit, scope rules, and optional auth profile.
3. Attach network listeners before navigation.
4. Navigate to the URL and wait for load plus network quiet.
5. Auto-scroll to trigger lazy loading.
6. Record every response body the browser downloads.
7. Snapshot the rendered DOM.
8. Extract links from the rendered DOM.
9. Enqueue in-scope links by depth and domain rules.
10. Write manifest, waterfall log, rendered pages, raw assets, beautified assets, and context file.

For v1, Gnaw does not click arbitrary controls during crawl. That avoids accidental mutations. Later, user-approved interaction recipes can add controlled clicks, scrolls, waits, and route-specific capture steps.

## Safety Rules

Default blocklist patterns:

- `/logout`
- `/signout`
- `/delete`
- `/remove`
- `/checkout`
- `/cart`
- `/billing`
- `/account/delete`
- HTTP methods other than browser-driven safe navigations, unless the user explicitly records an interaction recipe later.

Gnaw should show these skipped URLs in logs and manifest metadata so users understand what was avoided.

Respecting robots.txt is available as a toggle, off by default for local study workflows. The UI copy should make clear that the user is responsible for respecting target terms, copyright, and access rights.

## Output Contract Additions

`CONTRACT.md` should include:

- Folder layout for `navigable/`, `study/raw/`, `study/beautified/`, `study/rendered/`, `sourcemaps/`, `MANIFEST.json`, `context.md`, `waterfall.ndjson`, and `gnaw.log`.
- Manifest schema.
- Event protocol.
- Auth profile metadata with redaction rules.
- Safety skip records.
- Stack detection format.
- Stable path normalization rules.

Auth-related manifest shape:

```json
{
  "auth": {
    "mode": "profile",
    "profileName": "client-a",
    "storageStateUsed": true,
    "redacted": true
  },
  "safety": {
    "skippedUrls": [
      { "url": "https://example.com/logout", "reason": "blocked_pattern" }
    ]
  }
}
```

## GUI Direction

The first mature GUI should be a single-window macOS app with:

- URL field and capture button.
- Mode selector: Navigable, Study, or both.
- Auth profile selector and manage profiles button.
- Scope controls: depth, same domain, include subdomains, robots toggle, rate limit.
- Live waterfall with asset kind, bytes, status, and source page.
- Stack badge with confidence and signals.
- Job summary with pages, assets, bytes, skipped URLs, and errors.
- Output actions: open navigable mirror, reveal haul, copy context, open manifest.

The GUI should feel like a focused studio tool, not a consumer marketing app. It should prioritize clarity, scanability, and confidence during long captures.

## Milestones

### M0: Contract and Project Skeleton

- Initialize the repo.
- Write `CONTRACT.md`.
- Add package metadata and basic CLI command structure.
- Add fixture strategy, including a local authenticated fixture.

### M1: Playwright Reference Engine

- Implement `gnaw capture`.
- Implement study mode output.
- Implement navigable mirror output.
- Emit NDJSON events.
- Write manifest and waterfall logs.
- Add stack detection.

### M2: Auth Profiles

- Implement `gnaw auth login`.
- Implement profile list and delete.
- Use profiles during capture.
- Redact sensitive values in all outputs.
- Add authenticated fixture coverage.

### M3: Parity Harness

- Snapshot hauls.
- Compare file trees.
- Compare manifests structurally.
- Allow deterministic byte equality where possible and structural equality where content drifts.

### M4: Rust Production Engine

- Implement raw CDP capture first.
- Add navigable rewriting.
- Add study extras.
- Validate each slice against Playwright fixtures.

### M5: SwiftUI App

- Launch engine as a child process.
- Decode NDJSON events.
- Render live waterfall and summary.
- Manage auth profiles.
- Provide output actions.

### M6: Polish and Distribution

- Package the Rust engine inside the app.
- Add notarization and release artifacts.
- Publish GitHub release.
- Consider Homebrew cask after the app is stable.

## Testing Strategy

- Unit tests for URL normalization, kind classification, stack detection, manifest building, and redaction.
- Integration tests against local fixture sites.
- A local fixture with login, cookies, localStorage, protected routes, lazy assets, and blocked safety routes.
- Golden haul snapshots generated by Playwright.
- Parity tests for Rust once it exists.
- Manual GUI verification with a small public site, a JS-heavy site, and the local authenticated fixture.

## Open Product Decisions

The selected defaults are:

- CLI first for engine confidence.
- GUI as the primary product.
- Auth through user-managed browser profiles.
- No automatic form submission in v1.
- Interaction recipes deferred until the base crawler is reliable.

These choices keep the first implementation powerful without letting it become reckless.
