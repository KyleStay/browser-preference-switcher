# Chrome Web Store publishing notes — Browser Preference Switcher 0.1.1

This document prepares a public Chrome Web Store submission for the `KyleStay/browser-preference-switcher` repository. It does not upload a package, change a publisher account, submit an item for review, or publish anything. The release owner must recheck the live dashboard and current policies immediately before submission.

## Policy basis

The preparation below follows the current official guidance available on October 14, 2026:

- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies) — accurate metadata, narrow permissions, privacy policy, Limited Use, and disclosure requirements.
- [Chrome Web Store User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) — domains and URLs count as web browsing activity even when handled locally; the policy requires disclosure of local handling as well as remote handling.
- [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish) — Package, Store Listing, Privacy, Distribution, and Test instructions tabs.
- [Complete your listing information](https://developer.chrome.com/docs/webstore/cws-dashboard-listing) — listing fields, screenshots, promo assets, homepage, and support URL.
- [Listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements) — metadata must be accurate, complete, current, and consistent with the privacy fields and behavior.
- [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions), [the `activeTab` permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), and the [permissions reference](https://developer.chrome.com/docs/extensions/reference/permissions-list) — least-privilege explanations and permission behavior.

## Prepared listing and privacy fields

Use the copy in [store-listing.md](store-listing.md). The public privacy-policy field should point to:

<https://github.com/KyleStay/browser-preference-switcher/blob/main/PRIVACY.md>

The support field should point to:

<https://github.com/KyleStay/browser-preference-switcher/issues>

The single-purpose text should be:

> Change the User-Agent and selected User-Agent Client Hint request headers on a small, curated set of HTTPS destinations according to visible user settings, while showing the effective configured identity in the extension popup.

The listing and privacy fields should describe the same behavior. Include the first-use notice and consent gate in the user-data description: before the user clicks **Agree and enable**, the extension does not inspect the active-tab address or device operating system, activate identity-changing request rules, or make automatic or manual vendor-version requests. The popup includes a permanent public privacy-policy link. In particular, do not call this a browser engine switch, a security tool, an anti-fingerprinting tool, an unblocker, or a guarantee of site compatibility. The Chrome, Edge, and Safari mappings are user preferences; they are not claims that Google, Microsoft, Apple, or any other site requires or endorses the selected browser.

### Privacy practices dashboard answers

The Chrome Web Store FAQ says that “handle” includes collecting, transmitting, using, or sharing data and specifically includes domains and URLs. Local-only processing still needs to be disclosed. For this extension, use the following interpretation when the dashboard presents the data categories:

| Dashboard category | Prepared answer | What the extension actually does |
| --- | --- | --- |
| Web browsing activity | **Yes — handled locally for the user-facing popup and matching feature after consent; not sent to the developer.** | After the user accepts consent, the active tab URL is read temporarily while the popup is open; the hostname is displayed and used to select the curated HTTPS rule. Before acceptance, it is not read. The full URL is not persisted or uploaded. |
| Website content and resources | No | No page text, DOM, response body, cookies, or browser storage is read. |
| Form data | No | No forms, typed values, passwords, or submitted fields are read. |
| Personally identifiable information | No | No name, address, email, username, account number, or identifier is requested. |
| Authentication information | No | No sign-in, password, token, or authentication cookie is requested. |
| Financial or payment information | No | No payment or financial information is requested. |
| Health information | No | No health information is requested. |
| Personal communications | No | No email, message, or communication content is read. |
| User-generated content | No | No page or user-created content is collected. |

If the dashboard separates “handled,” “collected,” “stored,” and “transmitted,” record web browsing activity as local handling after consent, list the local consent/settings/version cache as browser-local operation where the form asks about storage, and state that the developer does not collect or receive it. Do not choose a blanket “no data” answer merely because the active-tab URL is processed on-device. If a field asks whether data is sent to any third party, disclose the feature-required destinations accurately: after consent, matched sites receive the browser's request with the configured headers, and the three official release-source origins receive separate version-data requests. Before consent, neither class of request is initiated by the extension. The extension's developer does not operate or receive either service.

The privacy policy URL above, the Limited Use certification, and the fields describing sale, advertising, and unrelated transfer must all agree with [PRIVACY.md](../PRIVACY.md). The extension has no developer analytics, telemetry, advertising, account system, data sale, or unrelated transfer. The Limited Use certification should be accepted only after reviewing the dashboard's current wording.

### Permission justifications

The manifest is version 0.1.1 and currently requests these runtime permissions:

| Manifest permission | Reviewer-facing justification |
| --- | --- |
| `activeTab` | After the user clicks **Agree and enable**, temporarily access the active tab URL so the popup can show the hostname and effective rule. Before consent, the URL is not read. The extension does not inject scripts or read page content. The permission is temporary and user-initiated. |
| `alarms` | After consent, schedule one daily refresh of public stable browser-version data. No alarm-driven vendor request runs before consent. |
| `declarativeNetRequestWithHostAccess` | After consent, install dynamic declarative rules that set the User-Agent and selected User-Agent Client Hint request headers on the explicitly listed HTTPS host permissions. Before consent, no dynamic header rules are installed. The rules do not read response bodies or attach a debugger. |
| `storage` | Store the consent version (`privacyConsentVersion`), enabled state, visible reported-OS choice, cached browser versions, version-check timestamp, and source errors in `chrome.storage.local` so consent, settings, and the cached fallback survive popup and service-worker restarts. |

The host permissions are narrow HTTPS patterns for the curated destinations and vendor release sources:

- Google and YouTube: `google.com`, `youtube.com`, and `youtu.be` (including subdomains).
- Microsoft web properties: `microsoft.com`, `cloud.microsoft`, `microsoft365.com`, `office.com`, `office365.com`, `outlook.com`, `live.com`, `onedrive.com`, `sharepoint.com`, `bing.com`, `msn.com`, `azure.com`, `xbox.com`, `windows.com`, and `microsoftonline.com` (including subdomains).
- Apple: `apple.com` and `icloud.com` (including subdomains).
- Official release sources: `versionhistory.googleapis.com`, `edgeupdates.microsoft.com`, and `developer.apple.com`.

The host patterns are HTTPS-only. After consent, they are used to modify requests to the curated destinations and to fetch official release data; before consent they remain dormant. They do not grant a general `<all_urls>` capability. Chrome may display a host-access warning for the listed sites; the dashboard's generated wording is authoritative and must be checked before publication.

The extension deliberately does not request `debugger`, `tabs`, `webRequest`, `scripting`, `cookies`, `history`, `webNavigation`, `identity`, or broad `<all_urls>` access. It uses `declarativeNetRequestWithHostAccess` instead of a debugger, so the page's JavaScript-visible browser identity and rendering engine remain unchanged.

## Reviewer test instructions

Paste the following into the Chrome Web Store **Test instructions** field. No account credentials are needed for the public-page checks.

> **Browser Preference Switcher 0.1.1 — reviewer steps**
>
> 1. Install the submitted package in a Chromium browser and pin or open the extension action. The extension is intended for Brave and other Chromium browsers supporting Manifest V3.
> 2. Start from a fresh install, or remove and reinstall the extension to clear its local storage. A legacy installation with no current consent version follows the same first-use path.
> 3. Open the extension popup before accepting. Confirm that it shows the data-use notice, the **Agree and enable** action, and a permanent link to the public privacy policy. Before acceptance, the extension must not inspect the active-tab address or device operating system, activate identity-changing request rules, or make automatic or manual vendor-version requests. It may read local extension storage to determine whether consent is current.
> 4. Click **Agree and enable** once. Confirm that consent version 1 is stored locally, the rules become active, and the initial release-source check begins. The popup should then show the current state and version status.
> 5. Visit these HTTPS pages, reload once, and open the extension popup on each page:
>    - `https://www.google.com/` — expected configured identity: Chrome.
>    - `https://www.youtube.com/` — expected configured identity: Chrome.
>    - `https://www.microsoft.com/` — expected configured identity: Microsoft Edge.
>    - `https://www.office.com/` — expected configured identity: Microsoft Edge.
>    - `https://www.apple.com/` — expected configured identity: Safari.
>    - `https://www.icloud.com/` — expected configured identity: Safari. A signed-in iCloud session is optional and is not required for the rule check.
>    - `https://example.com/` — expected configured identity: Native browser; no automatic rule matches.
> 6. In the popup, confirm that the hostname, configured identity, matching-rule reason, and reported operating system are visible. The default `auto` setting reports the test device's actual OS.
> 7. Turn **Automatic switching** off. Reload a curated page and reopen the popup; it should report **Native browser**. Consent remains stored and version checks remain available. Turn switching on again and confirm the curated identity returns after reload.
> 8. Change **Reported operating system** to macOS, Windows, or Linux. The selected value remains visible in the popup and the identity label updates after the page reload. Return to **Keep this device's OS (default)** when finished.
> 9. Use **Refresh** beside the version status to request current stable release data. The popup reports source errors while retaining the last valid cached values if a source is unavailable. This manual refresh is available only after consent.
> 10. To stop all extension handling, use the browser's **Disable** or **Remove** control. Uninstalling should remove the local consent, settings, cached versions, and errors.
>
> **Header inspection (optional):** Open DevTools, select Network, reload a matched HTTPS page, and inspect a document request to the matched destination. Actual browser-version values are refreshed and may differ from the examples below. With a Chrome rule, expect a Chrome-style `User-Agent`, `Sec-CH-UA` brands containing `Google Chrome`, `Chromium`, and `Not_A Brand`, `Sec-CH-UA-Mobile: ?0`, and `Sec-CH-UA-Platform: "macOS"`, `"Windows"`, or `"Linux"` according to the visible selection. With an Edge rule, expect `Edg/<full-version>` and a `Microsoft Edge` brand. With a Safari rule, expect `Version/<version> Safari/605.1.15` and no `Sec-CH-UA*` headers. High-entropy `Sec-CH-UA-*` headers are removed when they would contradict the configured profile.
>
> Rules match HTTPS destinations only. A redirect, site-specific request, browser site-access setting, or another header-modifying extension can affect the final request. Page JavaScript continues to report the host browser's identity. The extension changes request headers; it does not replace the rendering engine or page behavior.

### Header examples for a reviewer

These are generic shape examples, not fixed release values:

```http
GET / HTTP/1.1
Host: www.google.com
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Safari/537.36
Sec-CH-UA: "Google Chrome";v="<major>", "Chromium";v="<major>", "Not_A Brand";v="99"
Sec-CH-UA-Mobile: ?0
Sec-CH-UA-Platform: "macOS"
```

```http
GET / HTTP/1.1
Host: www.microsoft.com
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Safari/537.36 Edg/<full-version>
Sec-CH-UA: "Microsoft Edge";v="<major>", "Chromium";v="<major>", "Not_A Brand";v="99"
Sec-CH-UA-Mobile: ?0
Sec-CH-UA-Platform: "Windows"
```

```http
GET / HTTP/1.1
Host: www.apple.com
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/<safari-version> Safari/605.1.15
```

Do not treat these examples as a promise that a site will accept, expose, or consistently echo every header. A request to an unlisted generic host such as `https://example.org/` is a useful native-identity comparison, but it will not exercise a curated rule.

## Package and asset readiness

The release package is expected at:

`dist/browser-preference-switcher-0.1.1.zip`

Run `npm run package` to build the archive with Python's standard library. The allowlist packages only the five runtime files and four PNG icons; tests, fixtures, local CI scripts, repository documentation, and listing artwork are excluded. The consent-gated version 0.1.1 package has been built and inspected, with the manifest at the ZIP root and no parent directory wrapper. Promotional images and screenshots are uploaded separately to the listing dashboard.

The GitHub repository has been made public. The Chrome Web Store package has not been uploaded or submitted; publisher-account state is untouched.

## Ready, pending, and blocked items

### Ready in this worktree

- Public-facing copy, policy URL, support URL, release notes, permission explanations, privacy-practice interpretation, and reviewer steps are prepared.
- [PRIVACY.md](../PRIVACY.md) describes temporary active-tab URL handling, local settings/version cache, HTTPS vendor requests with omitted credentials, ordinary vendor/network metadata, and the absence of developer analytics, sale, advertising, or unrelated transfer.
- The copy preserves the actual OS as the default and says that explicit platform changes remain visible.
- The deterministic ZIP, original 16/32/48/128 px PNG icons, manifest icon entries, and separate 440×280 promotional image are prepared and validated.
- First-use consent is implemented, and the unused Mozilla permission and release request have been removed. The current release fetches only data used by its active profiles.

### Public source and privacy policy

The release source, privacy policy, and listing preparation are published in the public repository. The privacy-policy URL must remain accessible when entering it in the dashboard.

### Runtime and account blockers

- The supplied isolated Chrome runner is blocked in this environment before launch because localhost socket binding is denied. No real store screenshot can be generated here; do not invent one.
- Brave has not yet been exercised with the extension, and authenticated Google, Microsoft 365, and iCloud sessions still need manual compatibility checks. The local checks documented in `docs/review.md` are not a Brave or authenticated-site pass.
- A Chrome Web Store publisher account with dashboard access, current developer contact details, and any account verification or payment step shown by Google is required for a real submission. The dashboard's publisher identity and any verified Official URL are account state and remain untouched.
- Before submission, recheck that the current dashboard's privacy fields, privacy URL, listing copy, permissions, package contents, icon, and real screenshot all describe the same 0.1.1 behavior.

### Consent-flow runtime verification

- Verify the fresh-install and legacy-install notice, the permanent privacy-policy link, and the **Agree and enable** action in the real popup.
- Verify that no active-tab address or device-OS inspection, identity-changing header activation, or automatic/manual vendor request occurs before consent, and that acceptance stores `privacyConsentVersion: 1` before enabling the initial rule and release check. Local consent/settings storage access may occur before acceptance.
- Verify that turning automatic switching off retains consent and version checks, while browser-level Disable or Remove stops all handling and uninstall clears local storage.
- These are implementation/runtime tests still pending in this environment. This is a test-status item; the consent behavior is the defined user-facing disclosure path.

## Submission boundary

Preparation is complete when the text and assets are reviewable locally. The actual ZIP upload, dashboard data entry, publisher-account changes, review submission, and publication are separate external actions and are not authorized by this document.
