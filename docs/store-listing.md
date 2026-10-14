# Chrome Web Store listing — Browser Preference Switcher 0.1.1

This is copy and asset guidance for a public Chrome Web Store listing. It is prepared for the public repository `KyleStay/browser-preference-switcher`; it has not been entered into or submitted through the Chrome Web Store dashboard.

## Listing fields

| Field | Prepared value |
| --- | --- |
| Name | Browser Preference Switcher |
| Version | 0.1.1 |
| Summary | Set curated browser request identities for Google, Microsoft, and Apple sites while keeping your real browser engine. |
| Language | English |
| Suggested category | Productivity |
| Homepage URL | `https://github.com/KyleStay/browser-preference-switcher` |
| Support URL | `https://github.com/KyleStay/browser-preference-switcher/issues` |
| Privacy policy URL | `https://github.com/KyleStay/browser-preference-switcher/blob/main/PRIVACY.md` |

The homepage, support URL, and privacy URL are public-repository links. The listing must not imply that Google, Microsoft, Apple, Brave, or any matched site sponsors, endorses, or requires this extension.

## Short description

Use the following as the Store Listing summary:

> Set curated browser request identities for Google, Microsoft, and Apple sites while keeping your real browser engine.

## Detailed description

Use the following as the English detailed description:

> Browser Preference Switcher applies a configured browser identity to requests sent to a small, curated set of HTTPS destinations. It is intended for Brave and other Chromium browsers that support Manifest V3 request rules.
>
> The default rules follow a user preference:
>
> - Google and YouTube destinations use a Chrome request identity.
> - Microsoft web properties use a Microsoft Edge request identity.
> - Apple and iCloud destinations use a Safari request identity.
>
> Before first use, and after an older installation that has not recorded the current consent, the popup shows a data-use notice with a permanent link to the public privacy policy. Until the user clicks **Agree and enable**, the extension does not inspect the active-tab address or device operating system, activate identity-changing request rules, or contact a release source. The acceptance is stored locally as consent version 1. After acceptance, the popup shows the current hostname, the configured identity, the reason for the matching rule, and the reported operating system. Automatic switching starts enabled, can be turned off at any time, and reports the device's actual operating system by default. An explicit macOS, Windows, or Linux selection remains visible in the popup.
>
> Stable browser versions are refreshed from official Google, Microsoft, and Apple release sources. The last valid local values remain in use when a source is unavailable. Rules apply to the listed HTTPS destinations and their subdomains; other sites and unlisted CDN or API domains keep their normal browser headers.
>
> Only request headers change. The extension does not replace the rendering engine, page JavaScript identity, browser APIs, or site authentication. It cannot promise site compatibility, prevent fingerprinting, provide security, bypass access controls, or unblock content. A configured identity is a user preference and is not a claim that a site requires that browser.
>
> After consent, the extension reads the active tab URL temporarily while its popup is open so it can display the hostname and effective rule. It keeps consent, settings, and version status in local browser storage. Turning automatic switching off retains consent and version checks; disabling or removing the extension stops all handling, and uninstalling removes its local storage. It has no developer analytics server, telemetry, advertising, account system, or sale of user data. See the [privacy policy](https://github.com/KyleStay/browser-preference-switcher/blob/main/PRIVACY.md) for the complete data-handling description.

## Release notes

> Version 0.1.1: first-use data-use notice with versioned local consent; curated HTTPS request-header rules for Google, Microsoft, and Apple destinations; visible operating-system selection; official stable-version refresh with a local cached fallback; and a popup that reports the effective configured identity.

## Graphic assets

Chrome's current [listing guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) requires a store icon and at least one current product screenshot. The small promo tile is 440×280 pixels; screenshots may be 1280×800 or 640×400 pixels. A marquee tile is optional.

| Asset | Status for 0.1.1 |
| --- | --- |
| Store icon | `icons/icon-128.png`; 16/32/48/128 px icons are included in the validated runtime ZIP and manifest. |
| 440×280 small promo tile | `store/promo-small-440x280.png`; upload separately in the listing dashboard. It is promotional artwork, not a product screenshot. |
| Product screenshot | Pending a real runtime capture. Do not create a mock screenshot or claim that a screenshot shows a tested workflow. |
| Optional 1400×560 marquee tile | Not required for this preparation. |
| Promotional video | Not planned. |

The screenshot should show the real popup on a real supported runtime, with the first-use notice or accepted-state hostname, configured identity, visible OS choice, permanent privacy link, and version status readable. The isolated browser runner currently cannot start because localhost binding is denied; authenticated Google, Microsoft 365, and iCloud workflows also still need manual runtime checks. See [publishing notes](publishing.md).

## Policy and copy checks

Before entering this copy into the dashboard, verify the current [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies), [listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements), and [listing guidance](https://developer.chrome.com/docs/webstore/best-listing). Keep the copy accurate to version 0.1.1, avoid repetitive keyword lists, and keep all privacy-field answers consistent with [PRIVACY.md](../PRIVACY.md) and the shipped behavior.
