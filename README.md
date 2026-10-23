# Browser Preference Switcher

A Manifest V3 Chromium extension intended for Brave. It changes request headers on selected sites while keeping Brave's rendering engine.

## Current behavior

- Uses a Chrome identity on `google.com` and its subdomains, `youtube.com`, and `youtu.be`, at your request.
- Uses an Edge identity on Microsoft web properties, including Microsoft 365, Outlook, Teams, SharePoint, OneDrive, Bing, MSN, Azure, Xbox, and Windows domains, at your request.
- Uses Chrome identity on `apple.com` and `icloud.com` and their subdomains when the reported OS is Windows; uses Safari otherwise. This includes `maps.apple.com`. The default OS setting detects the device, and an explicit OS selection also controls this mapping.
- Displays the full configured User-Agent request header alongside the friendly browser and operating-system label. Unmatched or disabled rules use native browser headers.
- Uses Chrome, Edge, and Safari identity profiles for the automatic rules. A dormant Firefox profile remains in the source catalog; it is not a user-selectable feature and makes no release-source requests.
- Waits for **Agree and enable** in the first-use privacy notice before reading the active tab, changing headers, or fetching release data. Upgrades from the prototype also require this acceptance.
- Defaults to the user's actual operating system on macOS, Windows, and Linux. Other device platforms keep native headers in automatic mode. The popup lets the user choose macOS, Windows, or Linux explicitly.
- Refreshes stable browser version data daily from official vendor sources and keeps the last known values if a source is unavailable.
- Uses declarative request rules to change the User-Agent and selected User-Agent Client Hint request headers.

Rules apply to HTTPS request destinations in the listed domains, including their subdomains. Unlisted CDN and API domains keep their normal headers, even when loaded by a matched page. The popup displays the configured identity; browser site-access settings and other extensions can affect whether it reaches a server.

The extension no longer requests the `debugger` permission or attaches to tabs, so the “debugging” notification should stop after you reload the extension. The page's JavaScript-visible identity remains Brave's Chromium identity.

## Load locally

1. Open `brave://extensions` in Brave, or `chrome://extensions` in Chrome.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Visit a Google, Microsoft, or Apple site, then reload after enabling or changing the reported OS setting.

## Version sources

- Chrome: Google's VersionHistory API, latest fully rolled out Stable release by platform.
- Edge: Microsoft's official Edge update feed, Stable channel.
- Safari: Apple's first-party documentation JSON, highest stable release with a published release date.

Fallback seed versions are inherited from the September 25 prototype. The service worker refreshes them on first install and then daily, preferring fully rolled-out Chrome releases when available. Starting the browser again does not trigger an extra refresh while the cache is fresh. A request times out after 15 seconds; failed or invalid results preserve the last valid cache for that browser/platform. See [version source notes](docs/research/version-sources.md).

Settings and header-rule changes are serialized. If Chrome rejects a rule update, the previous settings or version cache are restored. Changing a setting affects subsequent requests in all tabs; the popup reloads only the current HTTPS page, so reload other open pages as needed.

## Development and verification

No build step or runtime dependencies are required. Load the folder containing `manifest.json` directly.

All CI runs locally; there is no hosted CI workflow or upload step. Use Node.js 18 or newer:

```sh
npm run ci         # Full local pipeline, including Chrome for Testing
npm run ci:checks  # Manifest, syntax, regression tests, and diff checks only
npm run ci:browser # Browser checks only
```

The full command fails if browser verification cannot run; checks-only mode explicitly reports that browser verification was omitted. No dependency download is required for the code checks. Browser checks use the already installed Chrome for Testing, Playwright, and isolated Chrome runner, with temporary profiles and local vendor/page fixtures. See [local CI instructions](docs/local-ci.md) and [review notes](docs/review.md) for requirements and verification status.

## Chrome Web Store preparation

Run `npm run package` with Python 3 to build the clean upload archive at `dist/browser-preference-switcher-0.1.3.zip`. It contains only the extension runtime and original PNG icons. Tests, fixtures, development scripts, and store artwork stay outside the ZIP. The build validates the assets and produces a repeatable archive.

The [privacy policy](PRIVACY.md), [listing copy and permission explanations](docs/store-listing.md), and [publishing instructions](docs/publishing.md) are included in the public repository. Promotional artwork is at `store/promo-small-440x280.png`. Actual 1280×800 screenshots are in `store/screenshots/`, and full local CI including isolated Chrome runtime checks passes. The offline publishing guide embeds the screenshots and upload assets. Brave and authenticated-site compatibility still need manual checks; no store submission or approval is claimed.

## Known limits

- The default rules cover the requested Google, Microsoft, and Apple domains. Other vendor sites remain on Brave's normal identity.
- Reporting Safari or Firefox does not replace Blink with WebKit or Gecko. Browser-only APIs, rendering, and engine-specific behavior remain Chrome's.
- Safari and Firefox do not use User-Agent Client Hints; the extension removes Chrome's `Sec-CH-UA-*` request headers for those profiles. Page JavaScript can still identify Brave.
- Chrome and Edge profiles remove high-entropy request hints that would contradict the selected identity. JavaScript can still expose the real browser and platform.
- Safari on Linux is a synthetic header identity; modern Safari is an Apple-platform browser. Apple-site rules use Chrome when the reported OS is Windows.
- Apple's documentation JSON is a first-party document format rather than a guaranteed release API; its parser may need adjustment if Apple changes the format.
- Host permissions must remain enabled for the selected domains. Another header-modifying extension can take precedence over these rules.
- Brave's [extension documentation](https://brave.com/learn/using-chrome-extensions-in-brave/) says Manifest V3 extensions work in Brave, but this extension has not been loaded there yet. Request-header changes still need a runtime check in Brave.
- The extension has not been tested against a signed-in iCloud session.

Current 0.1.3 landing: source and package checks passed; live browser verification is UNRUN. Earlier browser reports are historical.
