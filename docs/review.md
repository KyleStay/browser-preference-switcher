# Review and continuation notes

Reviewed October 14, 2026. Current extension version: 0.1.1.

## Project import

The original clean local repository was imported from the September 25 project output into the current project workspace.
The original commit `c8864b983764a38dd5a107488795ed319bcf3df6` and product decisions are preserved. The working branch is `codex/review-and-fix`, with origin `https://github.com/KyleStay/browser-preference-switcher.git`. The original checkout was not changed.

## Review findings fixed

- Concurrent popup, startup, and alarm activity could race while replacing rules. Rule mutations now run in order; concurrent refresh requests share one vendor fetch batch.
- A failed rule update could leave saved settings or refreshed version data disagreeing with active rules. Both changes now restore the prior saved state when Chrome rejects the update.
- Chrome and Edge profiles left native high-entropy request hints in place. Those hints are removed; low-entropy browser/platform hints match the selected profile. JavaScript identity remains unchanged by design.
- The Safari HTML parser depended on rendered documentation text. It now reads Apple's first-party documentation JSON, accepts published stable references, and excludes beta, undated, and future entries.
- Invalid vendor versions and unknown Edge platform values could contaminate the cache. Versions are validated, Edge platforms must match explicitly, and missing platform results preserve their previous cache with an error.
- Fetches had no timeout, and startup refreshed even a fresh cache. Fetches now have a 15-second limit; startup respects the daily interval. Invalid cache timestamps are repaired through a fresh check.
- Automatic platform detection silently mapped unsupported devices to Linux. Unsupported automatic platforms now retain native headers; explicit supported OS choices remain available.
- The popup could silently refuse a global setting change without a tab, show stale identity, erase refresh feedback, or stay busy after messaging failure. It now handles each path and distinguishes a successful save from a failed page reload.
- Popup matching included HTTP URLs despite HTTPS-only host access. Rules and popup reporting now explicitly use HTTPS. The popup calls the result a configured identity, since browser site access and other extensions can affect actual headers.
- The existing `youtu.be` rule included subdomains but its host permission did not. The permission now covers the same subdomains as that rule.

## Verification and limits

`npm run ci:checks` passes 65 dependency-free regression checks covering service-worker rules, permission coverage, version parsing/caching, concurrency, rollback, daily freshness, consent-before-handling, popup error/success flows, offline vendor fixtures, local CI itself, and deterministic store packaging. JavaScript syntax checks and diff validation for tracked, staged, and untracked files pass.

Live browser verification is **blocked**, not passed. Both the shell and Node REPL reject localhost socket binding; the supplied isolated Chrome runner fails before launch. No browser was launched, no screenshot was generated, and all task-owned probe directories were removed. Zero task-owned Chrome processes or disposable profiles remain.

The full `npm run ci` pipeline now runs all verification locally, including the browser stage. `npm run ci:checks` explicitly omits browser verification; `npm run ci:browser` repeats only that stage. There is no hosted CI workflow. See [local CI instructions](local-ci.md).

Browser checks require an environment that permits localhost binding and has Chrome for Testing, Playwright, and the isolated Chrome runner. They use temporary extension copies with deterministic local vendor responses: one retains the production manifest, then another adds localhost permission for an owned header-echo fixture. The fixture rule changes destination/scheme but retains production header actions. The shipped extension is unchanged. Production rule matching, popup interactions, refresh parsing, and fixture headers are separate assertions. Cleanup closes Chrome through CDP, verifies its owned processes exited, stops the fixture server, and removes the profiles. Startup-failure and cleanup paths were exercised here; the successful browser path has not been executed.

Brave remains the intended host browser. Runtime behavior in Brave and signed-in Google, Microsoft, and iCloud sessions still require verification. Synthetic Safari headers do not provide WebKit; request destinations outside the curated domain list remain native.

## Luna adversarial review

Five GPT-5.6 Luna xhigh workstreams reviewed background lifecycle, identities/version sources, popup behavior, browser verification, and local CI. Findings were verified and repairs reviewed in the primary chat.

Additional fixes from this pass:

- Initial rule-update failure no longer prevents daily alarm setup. Completed refreshes rearm the daily interval; fresh startup preserves the remaining interval. Alarm failures are logged without falsely rolling back an already applied version refresh.
- Integer Safari release titles now produce canonical dotted UA versions, such as `Version/27.0`; dotted release versions are preserved.
- Settings and refresh actions sample the active tab again and reload HTTPS pages only. Failed follow-up state reads and ambiguous save responses invalidate stale controls until state recovery. Older async responses cannot replace newer popup state.
- Browser checks preserve the original failure if cleanup also fails, track runner lifetime and exact owned process identity, refuse premature profile deletion, and avoid replaying mutations after worker failures. Fixture request evidence survives worker restarts.
- Header-removal checks require a native high-entropy hint baseline, then require native hints to return after removing the test rule. They cannot pass simply because no hints were present.
- Local CI now discovers nested sources/tests and checks staged and untracked whitespace. Partial modes accurately report omitted stages; signals, missing prerequisites, and child failures cannot produce a full-pass result. CI regression fixtures use owned fake tools and never need the real browser packages.
- A test-only vendor fixture bug introduced during this pass was caught and fixed before integration; direct fixture tests now exercise all six release requests and rejection of unknown endpoints.

Concurrent tab reloads intentionally use the latest global settings. A reload is not a snapshot of a previous global setting: subsequent requests always use the currently installed rules.

The browser harness's successful runtime path remains unexecuted in this environment. The expanded checks do not imply a Chrome, Brave, or authenticated-site runtime pass.

## Recommended next work

1. Complete runtime checks in Chrome for Testing, then manually exercise the intended Brave workflows, including authenticated iCloud, Microsoft 365, and Google sign-in. Record compatibility gains and any regressions before expanding the rule catalog.
2. Add per-site exceptions and manual browser selection. A site that works better with native headers needs an easy override; manual selection would also make the existing Firefox profile useful.
3. Add a diagnostics view showing effective configured headers, cached versions, source-specific errors, and host-access status. This would explain most compatibility and refresh failures without opening DevTools.
4. Prepare extension icons and a clean distribution folder or ZIP with versioned release notes. Keep the extension dependency-free and omit tests/development notes from the distributable.
