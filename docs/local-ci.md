> Current 0.1.3 landing validation: source/package checks pass; live browser checks are UNRUN at the denied runner boundary. Earlier browser results below are historical evidence, not validation of this candidate.

# Local CI

Run the entire pipeline from this project folder:

```sh
npm run ci
```

The pipeline validates extension resources and version consistency, checks JavaScript syntax, runs regression tests (including nested files), checks unstaged/staged/untracked diffs, and exercises the extension in isolated Chrome for Testing profiles. It exits with a failure if any required stage fails or is unavailable. It does not use GitHub Actions, a hosted runner, or an upload service.

For a smaller local check, use `npm run ci:checks`. This explicitly omits browser verification and does not establish a full CI pass. To repeat only the browser stage, use `npm run ci:browser`. `npm test` remains available for regression tests alone.

## Requirements

Code checks need Node.js 18 or newer, Git, and Python 3 for the archive regression tests. They have no npm dependencies and do not download anything.

Browser checks additionally need Python 3, an installed Chrome for Testing, Playwright, and the isolated extension runner. The defaults use Kyle's installed tools:

- Runner: `~/.codex/skills/chrome-extension-test-runner/scripts/launch_test_chrome.py`
- Playwright: `~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`
- Chrome for Testing: selected by the runner from `/Applications` or the local Playwright cache.

Set `BPS_CHROME_RUNNER` and `BPS_PLAYWRIGHT_MODULE` to existing local paths if those tools live elsewhere. There is no automatic install or download step.

## Browser scope

Vendor release responses are deterministic local test fixtures. The checks load temporary extension copies with a test-only fetch stub; the production extension and its vendor-refresh behavior are unchanged. One copy retains the production manifest and site rules. Another adds only localhost access to verify production header actions at an owned local server. Representative site HTML is supplied by local fixtures, rather than navigating a signed-in browser session.

Every browser run uses a disposable profile. Cleanup closes Chrome, verifies owned processes exited, stops the local server, and removes disposable profiles. The user's browser profile is never used.

These checks validate extension behavior against Chrome's APIs and request handling. They do not replace manual Brave compatibility testing on authenticated vendor sites.

## Current result

Full `npm run ci` passed on October 15, 2026: 77 code checks and isolated Chrome runtime checks, including consent visibility, request-rule matching, Windows Apple identities, popup interactions, vendor fixtures, and actual request headers. Two real 1280 × 800 popup screenshots are in `store/screenshots/`. Cleanup verified zero owned Chrome processes and disposable profiles. The restricted shell initially denied localhost binding; running the authorized test outside that restriction exposed and resolved macOS temporary-path alias handling and consent-panel visibility bugs. Brave and authenticated vendor-site compatibility remain manual checks.
