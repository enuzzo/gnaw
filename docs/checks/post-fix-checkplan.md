# Gnaw — post-fix verification check plan

Purpose: mechanically re-verify the fixes made in the 2026-07-21 capture-integrity
session and guard against regressions. Designed to be run start-to-finish by a
fast model or CI. Every check is a command + an expected result + a PASS/FAIL rule.

- Repo root: run all commands from the gnaw repo root.
- Node: v20+ (dev machine used v24).
- Reference haul (no network needed): `output/lampmaker-fixed/haul-lampmaker.app-20260721-202402`
- Report format: a table `check id → PASS / FAIL / EXPECTED-FAIL → evidence`.
  On any FAIL, capture the first error line and stop or continue per runner policy.

---

## C0 — Toolchain sanity
```bash
node -v
```
PASS: prints v20 or higher. If a build/test step later errors with
`Cannot find module @rollup/rollup-*`, run `npm install` once (platform-native
optional dep) and retry.

## C1 — Build
```bash
npm run build
```
PASS: exit 0; `dist/engine/src/stack/stacks.json` exists (postbuild copy ran).

## C2 — Unit suite
```bash
npx vitest run engine/test/unit harness/test/unit
```
PASS: all files pass, 0 failures. Baseline: 28 files / 110 unit tests
(full suite across all projects is 31 files / 136 tests).

## C3 — Integration suite (includes contract-schema validation + whole-haul redaction)
```bash
npx vitest run engine/test/integration harness/test/integration --passWithNoTests --testTimeout=30000
```
PASS: all pass. Baseline: 3 files / 26 tests. Must include
"uses an auth profile while keeping planted secrets out of the entire haul"
(whole-haul planted-secret redaction), "continues the crawl and stays partial when
a sub-page fails to load" (F8), and the golden-snapshot + schema tests.
(The `--testTimeout=30000` guards the real-browser capture tests against flaking
under machine load.)

## C4 — Redaction regression tests (corruption + leak classes)
```bash
npx vitest run engine/test/unit/redaction.test.ts
```
PASS: 9/9. Corruption guards:
- "does not corrupt localStorage comparison expressions in captured source"
- "does not reach across statements to redact an unrelated later assignment"
- "still redacts a real storage assignment while leaving surrounding code intact"
Leak guards (F5/F6/F7):
- "redacts common OAuth/API secret keys in JSON without touching benign keys"
- "redacts quoted and unquoted password values"
- "redacts non-Bearer Authorization headers without corrupting mid-line code"

## C5 — writeAsset capture-race guard
```bash
npx vitest run engine/test/unit/writeAsset.test.ts
```
PASS: 5/5, incl. "does not let a smaller/empty body clobber a larger existing
capture of the same asset".

## C6 — Redaction behaves correctly on a real snippet (no capture needed)
Run the built redactor over a snippet that reproduces the original bug plus a
secret in a format the redactor DOES handle (a Bearer auth header). Assert the
comparison is preserved, there is no fatal corruption, and the secret is gone.
Run inline:
```bash
node --input-type=module -e '
import { redactText } from "./dist/engine/src/redaction/redact.js";
const src = `const a=()=>{try{return localStorage.getItem(KEY)===\x271\x27;}catch(e){return false;}};\nAuthorization: Bearer REALSECRET_1234567890`;
const out = redactText(src);
const ok =
  out.includes("localStorage.getItem(KEY)===\x271\x27;}catch(e){return false;") &&
  !out.includes("getItem(KEY)=[REDACTED]") &&
  !out.includes("REALSECRET_1234567890") &&
  out.includes("[REDACTED]");
console.log(ok ? "C6 PASS" : "C6 FAIL\n"+out);
process.exit(ok?0:1);
'
```
PASS: prints `C6 PASS` (comparison preserved, no fatal corruption, secret redacted).
NOTE: the secret uses a Bearer header on purpose. A bare `session=<value>` or
other free-text secret formats are NOT redacted by the shipped code — that is a
known open leak (audit findings R1–R3), not a regression of this session's fix.

## C7 — Captured haul integrity (uses the reference haul; no network)
Let `H=output/lampmaker-fixed/haul-lampmaker.app-20260721-202402`.
- C7.1 no fatal corruption: `grep -c 'getItem(KEY)=\[REDACTED\]' "$H/study/raw/lampmaker.app/index.html"` == `0`
- C7.2 inline JS valid: extract inline `<script>` blocks (those without `src=`) and `node --check` them → exit 0
- C7.3 fonts non-zero: every `"$H"/study/raw/fonts.gstatic.com/**/*.ttf` has size > 0
- C7.4 presets present: count of `"$H"/study/raw/lampmaker.app/presets/*.webp` == `8`
- C7.5 no empty-body duplicate in manifest: there is NO asset record with `bytes==0`
  whose `url` also appears on a record with `bytes>0` (parse `$H/MANIFEST.json`)
- C7.6 navigable present: `"$H/navigable/index.html"` exists and is > 100 KB
PASS: all sub-checks hold.

## C8 — Offline navigable smoke (headless; documents known gaps)
Serve `"$H/navigable"` on a localhost port, load `index.html` in a headless
Chromium, collect console errors.
- PASS condition (the fix under test): **no `Uncaught SyntaxError`** in console;
  `_assets/.../three.min.js` returns 200.
- EXPECTED-FAIL (known, tracked in the audit — NOT this session's fix):
  runtime `/presets/*.webp` and `manifest.webmanifest` return 404 in the navigable
  layout, and the Google-Fonts stylesheet stays remote. The .webp/.ttf BYTES are
  present under `study/raw` — this is a navigable link-rewriting gap, not missing
  data. Flip these to PASS only after the navigable-rewrite fixes land.

## C9 — Optional live re-capture (network; hits lampmaker.app)
Only if explicitly authorized. Requires a Chromium-family browser (`node dist/engine/src/cli.js browser check` → exit 0).
```bash
node dist/engine/src/cli.js capture https://lampmaker.app/ --mode study,navigable --depth 1 --max-pages 20 --out output/lampmaker-recheck
```
Then run C7 against the new haul path. PASS: `result:"complete"`, C7.1–C7.6 hold on the fresh haul.

---

### Regression map (which check guards which fix)
| Fix (2026-07-21) | Guarded by |
|---|---|
| Redaction: comparison mistaken for assignment, greedy eat corrupts JS | C4, C6, C7.1, C7.2, C8 (no SyntaxError) |
| Redaction: assignment rule reaches across statements (over-redaction) | C4 |
| Capture: failed body fetch synthesized an empty 0-byte asset | C5, C7.3, C7.5 |
| Capture: empty body clobbered a larger existing file (race) | C5, C7.3 |
| Redaction leaks: OAuth JSON keys / quoted password / non-Bearer auth (F5–F7) | C4, C6 |
| Crawl: one failed sub-page aborted the whole crawl (F8) | C3 ("continues the crawl…") |
