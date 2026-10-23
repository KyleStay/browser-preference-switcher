# Browser Preference Switcher Privacy Policy

Effective October 15, 2026. This policy describes Browser Preference Switcher version 0.1.2 and the source code in this repository.

Browser Preference Switcher changes the `User-Agent` and selected User-Agent Client Hint request headers for a small, curated set of HTTPS destinations. It keeps the host browser's rendering engine and page JavaScript identity unchanged. On first use, and for a legacy installation that has not recorded consent, the popup shows a data-use notice. Before the user clicks **Agree and enable**, the extension does not inspect the active-tab address or device operating system, activate identity-changing header rules, or request vendor release data. After that consent, automatic switching starts enabled, can be turned off in the popup, and uses the device's actual operating system unless the user selects another visible setting.

The consent notice is versioned. Version 1 is stored as `privacyConsentVersion` in the extension's local settings after the user accepts. A missing or older value shows the notice again before feature handling resumes.

## Data the extension handles

### Active tab URL and hostname

After the user has accepted the current consent notice, opening the extension popup temporarily reads the active tab URL to determine whether a curated HTTPS rule matches and to show the current hostname and configured identity. The popup displays the hostname rather than the full URL. It also displays the configured User-Agent header built from the selected OS and cached browser versions; displaying this header requires no additional user data or network request. The full URL is not written to extension storage, sent to the developer, or used to build a browsing history. Page content, cookies, form data, passwords, authentication tokens, downloads, and browser history are not read by the extension.

Before consent is accepted, the extension does not read the active-tab URL or query the device operating system for feature handling, activate identity-changing header rules, or make automatic or manual vendor-version requests. It may read local extension storage to determine whether consent is current and to preserve legacy settings; that local read does not inspect the active tab or contact a vendor.

Chrome's [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) treats domains and URLs as web browsing activity, including when they are processed only on the user's device. Accordingly, this policy describes the temporary active-tab URL handling rather than claiming that the extension handles no user data.

### Local settings and cached release data

The extension stores the following in the browser's `chrome.storage.local` area:

- whether automatic switching is enabled;
- the selected operating-system mode (`auto`, macOS, Windows, or Linux);
- the accepted privacy-notice version (`privacyConsentVersion`);
- cached stable browser versions used by the active Chrome, Edge, and Safari rules;
- the time of the last version check; and
- per-source version-check errors.

These values stay on the device until the extension storage is cleared or the extension is removed. The consent version gates feature handling; the other values configure the popup and request rules after consent. Turning automatic switching off retains consent and allows version checks to continue. The extension does not sync these values, upload them, or send them to the developer.

### Requests to curated sites

For matching HTTPS destinations, the browser sends the configured request headers to the destination site. A Chrome, Edge, or Safari-looking request header does not change the rendering engine, page JavaScript, or the browser's other behavior. The destination site and ordinary network providers may receive standard request metadata, such as an IP address, timestamps, and request headers, under their own privacy policies. The extension does not collect those responses or send page content to the developer.

The rules cover only the curated domains in the manifest and their HTTPS subdomains. Requests to unlisted CDN, API, or other domains retain their normal browser headers.

### Official version-source requests

The extension periodically requests public stable-release data from official vendor sources:

- [Google VersionHistory](https://versionhistory.googleapis.com/);
- [Microsoft Edge updates](https://edgeupdates.microsoft.com/);
- [Apple Safari release documentation](https://developer.apple.com/tutorials/data/documentation/safari-release-notes.json).

These requests use HTTPS, omit browser credentials (`credentials: "omit"`), and request release data only. The extension does not include the active tab URL, page content, account information, extension settings, or cached browsing activity in these requests. The vendor and ordinary network infrastructure may still record standard network metadata such as the requester's IP address, time, and user agent according to their own policies. If a source fails or returns invalid data, the last valid local version remains in use.

## How the data is used

The extension uses the information above only to provide its single purpose and closely related operation: show the effective configured identity, apply the user's curated request-header preferences, and refresh browser-version values used to construct those headers. It does not use browsing activity or settings for advertising, profiling, unrelated analytics, or account decisions.

## Sharing and sale

There is no developer-operated collection server, analytics service, telemetry endpoint, advertising SDK, account system, or sale or rental of user data. The developer does not receive active-tab URLs, page content, local settings, version-cache contents, or request/response bodies.

After consent, the browser sends modified headers to a matched destination as part of the user's request, and the extension sends the separate version-source requests described above to the three listed official endpoints. Those recipients process ordinary network traffic under their own policies. If the user follows the privacy-policy or support links, the browser visits GitHub directly under GitHub's policies; the extension does not receive those page contents. No other transfer is part of this version.

## User controls

Before the first accepted use, the popup presents the data-use notice and an **Agree and enable** action. The popup also provides a permanent link to this public privacy policy. After acceptance, it lets the user turn automatic switching off and back on. The popup then shows the active hostname, the configured browser identity, the reason for a curated rule, the reported operating-system setting, and version-source status. The `auto` operating-system mode is the default and reports the actual device operating system; an explicit macOS, Windows, or Linux choice remains visible in the popup.

Turning automatic switching off pauses the curated header rules but retains consent and does not stop scheduled or manual version checks. To stop all extension handling, the user can disable or remove the extension through the browser's extension controls. Removing or uninstalling the extension stops its dynamic request rules and version checks; uninstalling removes its local storage, including consent and cached version data. The developer never receives a copy.

## Security and scope limits

Vendor version requests use HTTPS and omit credentials. Local settings use the browser-provided extension storage; this policy does not promise that the browser's local storage is encrypted, so the user's browser and device controls remain relevant. The extension does not attach a debugger, inject scripts, read page contents, or alter the rendering engine. It cannot promise that a site will accept the configured identity, prevent fingerprinting, bypass authentication or access controls, unblock content, improve security, or provide compatibility with every browser feature. Sites and other extensions can affect the final request.

## Chrome Web Store Limited Use statement

Browser Preference Switcher uses information received from Chrome and the browser only after the user has affirmatively accepted the in-product notice, and only to provide and operate its single purpose as described in this policy, its Chrome Web Store listing, and its popup. It complies with the Chrome Web Store User Data Policy and Limited Use requirements. It does not sell user data, use it for personalized advertising, or transfer it for an unrelated purpose.

## Support and policy changes

Public support is available through the [repository issue tracker](https://github.com/KyleStay/browser-preference-switcher/issues). This policy is hosted at the public repository URL used for the Chrome Web Store privacy-policy field:

<https://github.com/KyleStay/browser-preference-switcher/blob/main/PRIVACY.md>

If the extension's data practices change, this policy and the Chrome Web Store privacy disclosures must be updated before the changed version is distributed. This project is not affiliated with or endorsed by Google, Microsoft, Apple, Brave, or any site named in the curated rules.
