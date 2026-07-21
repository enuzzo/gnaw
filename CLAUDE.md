# Gnaw — working agreements

## Release routine (ALWAYS, after completing something significant)

Whenever a meaningful piece of work is finished (a bug fixed, a feature landed, a
capability changed) — not for trivial edits — do BOTH of these before considering
the work done:

1. **Update the changelog.** Add/extend the top entry in `CHANGELOG.md` describing
   what changed and the verification done. Keep it newest-first and progressive.
2. **Rebuild the shippable DMG**, ready for the user to drag into `/Applications`:
   ```bash
   ./script/package_dmg.sh --verify
   ```
   Then confirm `dist/Gnaw.dmg` embeds the freshly-built engine and passes the
   self-containment smoke check. Record the DMG state (built date/host, or
   **pending**) in the `CHANGELOG.md` entry's **DMG** line.

**Build constraint:** `package_dmg.sh` runs `xcodebuild`, which needs **full
Xcode** — a machine with only Command Line Tools (`xcode-select -p` →
`/Library/Developer/CommandLineTools`) CANNOT build the DMG. On such a machine:
still update the changelog, mark the DMG **PENDING** with the reason, and tell the
user it must be rebuilt where Xcode is installed. Never report the DMG as shipped
when it wasn't actually rebuilt.

## Orientation
- `SPEC.md` — authoritative product/engineering spec.
- `CONTRACT.md` + `contract/*.schema.json` — the engine↔UI boundary (NDJSON events,
  manifest, waterfall). The Swift app consumes only these.
- `SESSION-NOTES.md` — running build log. `docs/reviews/` — audits & known issues.
- `docs/checks/` — executable verification check plans.

## Engineering norms
- TDD: write the failing test first, watch it fail, then implement (see the
  redaction and capture tests for the pattern).
- After engine changes: `npm run build` then `npx vitest run` (use
  `--testTimeout=30000`; real-browser integration tests flake under load otherwise).
- Redaction has two separately-tested contracts: never corrupt captured
  HTML/CSS/JS, and never leak a known credential. Guard both when touching
  `engine/src/redaction/redact.ts`.
