# Browser version sources

Checked September 25, 2026. The extension targets the Stable channel.

| Browser | Seed version | Source and selection |
| --- | --- | --- |
| Chrome | 154.0.8037.58 | Google's VersionHistory API, per platform. Prefer a release whose rollout fraction is 1. |
| Edge | 153.0.4234.48 | Microsoft's Edge update feed, Stable product, latest release per platform. |
| Safari | 26.5 | Apple's Safari release notes, latest stable heading matched by the parser. |
| Firefox | 156.0.1 | Mozilla Product Details JSON, `LATEST_FIREFOX_VERSION`. |

## Source URLs

- [Chrome VersionHistory API](https://developer.chrome.com/docs/web-platform/versionhistory/reference)
- [Microsoft Edge update feed](https://edgeupdates.microsoft.com/api/products?view=enterprise)
- [Safari release notes](https://developer.apple.com/documentation/safari-release-notes)
- [Mozilla Firefox versions JSON](https://product-details.mozilla.org/1.0/firefox_versions.json)

These seeds are fallbacks, not a claim that every platform's release is identical. Daily refresh updates the cache from the vendor sources. A failed fetch or parse leaves the previous cached version in place and records the source error for the popup.
