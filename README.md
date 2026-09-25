# Browser Preference Switcher

A Manifest V3 Chromium extension intended for Brave. It changes request headers on selected sites while keeping Brave's rendering engine.

## Current behavior

- Uses a Chrome identity on `google.com` and its subdomains, `youtube.com`, and `youtu.be`, at your request.
- Uses an Edge identity on Microsoft web properties, including Microsoft 365, Outlook, Teams, SharePoint, OneDrive, Bing, MSN, Azure, Xbox, and Windows domains, at your request.
- Uses a Safari identity on `apple.com` and `icloud.com` and their subdomains at your request. This includes `maps.apple.com`.
- Defines Chrome, Edge, Safari, and Firefox identity profiles. Chrome, Edge, and Safari are assigned to automatic rules.
- Defaults to the user's actual operating system. The popup lets the user choose macOS, Windows, or Linux instead.
- Refreshes stable browser version data daily from official vendor sources and keeps the last known values if a source is unavailable.
- Uses declarative request rules to change the User-Agent and selected User-Agent Client Hint request headers.

The extension no longer requests the `debugger` permission or attaches to tabs, so the “debugging” notification should stop after you reload the extension. The page's JavaScript-visible identity remains Brave's Chromium identity.

## Load locally

1. Open `brave://extensions` in Brave, or `chrome://extensions` in Chrome.
2. Turn on Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Visit a Google, Microsoft, or Apple site, then reload after enabling or changing the reported OS setting.

## Version sources

- Chrome: Google's VersionHistory API, latest fully rolled out Stable release by platform.
- Edge: Microsoft's official Edge update feed, Stable channel.
- Safari: Apple's Safari release notes page, latest non-beta release.
- Firefox: Mozilla's Product Details JSON, `LATEST_FIREFOX_VERSION`.

Seed versions were checked on September 25, 2026. The Chrome seed uses the latest fully rolled-out Stable release in Google's feed, rather than a newer version still in staged rollout. The service worker refreshes these sources daily and preserves a cached version when a fetch or parse fails. See [version source notes](docs/research/version-sources.md).

## Known limits

- The default rules cover the requested Google, Microsoft, and Apple domains. Other vendor sites remain on Brave's normal identity.
- Reporting Safari or Firefox does not replace Blink with WebKit or Gecko. Browser-only APIs, rendering, and engine-specific behavior remain Chrome's.
- Safari and Firefox do not use User-Agent Client Hints; the extension removes Chrome's `Sec-CH-UA-*` request headers for those profiles. Page JavaScript can still identify Brave.
- Sites that inspect JavaScript browser properties or high-entropy User-Agent Client Hints may still identify Brave or see values that do not match the selected profile.
- Apple publishes Safari versions in release notes rather than a dedicated version JSON API, so that parser can need adjustment if Apple changes the page.
- Brave's [extension documentation](https://brave.com/learn/using-chrome-extensions-in-brave/) says Manifest V3 extensions work in Brave, but this extension has not been loaded there yet. Request-header changes still need a runtime check in Brave.
- The extension has not been tested against a signed-in iCloud session.
