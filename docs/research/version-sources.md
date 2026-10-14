# Browser version sources

The seeds below were inherited from the September 25, 2026 prototype. They are offline fallbacks, not a current-version guarantee. Source formats were reviewed again on October 14, 2026. The extension targets the Stable channel.

| Browser | Seed version | Source and selection |
| --- | --- | --- |
| Chrome | 154.0.8037.58 | Google's VersionHistory API, per platform. Prefer a release whose rollout fraction is 1. |
| Edge | 153.0.4234.48 | Microsoft's Edge update feed, Stable product, latest release per platform. |
| Safari | 26.5 | Apple's documentation JSON: highest exact stable release title with a published, non-future release date. |
| Firefox (dormant catalog only) | 156.0.1 | Retained prototype seed; no release-source request or active site rule. |

## Source URLs

- [Chrome VersionHistory API](https://developer.chrome.com/docs/web-platform/versionhistory/reference)
- [Microsoft Edge update feed](https://edgeupdates.microsoft.com/api/products?view=enterprise)
- [Safari release notes](https://developer.apple.com/documentation/safari-release-notes) and [first-party documentation JSON](https://developer.apple.com/tutorials/data/documentation/safari-release-notes.json)

These seeds are fallbacks, not a claim that every platform's release is identical. Daily refresh updates the cache from the vendor sources. A failed fetch or parse leaves the previous cached version in place and records the source error for the popup.

The public release fetches Chrome, Edge, and Safari data only after privacy-notice acceptance. The unused Mozilla permission and daily Firefox fetch were removed because Firefox is not a shipped user-facing switching option. Its dormant catalog profile remains available in source for future justified work.

The Safari JSON contains both stable and beta references. The parser checks exact stable titles and the `Released ...` date in the reference abstract, excluding beta and future entries. Chrome prefers a current release with rollout fraction 1 and falls back to the highest current Stable version if none is fully rolled out. Edge requires an explicit recognized desktop platform; a missing platform preserves that platform's cache and records an error. All incoming versions must be numeric dotted strings.

Each vendor request has a 15-second timeout. Concurrent refresh requests share one fetch batch. Startup checks cache age, and the daily alarm resumes the remaining interval when the cache is fresh. A completed refresh rearms the daily interval, including a manual refresh. Alarm setup is attempted even when initial request-rule installation fails. No visited-site data is sent to these sources.
