# Site browser support evidence

Research checked on September 25, 2026, against vendor support pages.

## Findings

- **Apple iCloud.com:** Apple says iCloud.com works best in current Safari on recent Apple operating systems. It also documents support for recent Chrome, Firefox, Edge, and Opera on Windows. The user requests Chrome identity across iCloud and Apple domains when the reported OS is Windows, and Safari otherwise. This October 14, 2026 update is an explicit preference; the existing vendor research below was checked on September 25.
- **Google Account sign-in:** Google lists Chrome, Safari, Firefox, Opera, and Edge as supported browsers. The guidance does not identify Chrome as the only supported browser.
- **Microsoft 365 for the web:** Microsoft's compatibility guidance varies by OS and lists several supported current browsers for desktop systems. The user requests Edge identity on Microsoft web properties, so this is recorded as a preference rather than an official browser requirement.
- **Apple web-only iCloud access:** Apple's guidance also lists the latest Safari, Firefox, Chrome, Edge, and Opera as supported.

## Inference for the rule catalog

Apple's `icloud.com` guidance says Safari works best on Apple platforms. The user requests Chrome on `apple.com` and `icloud.com` for Windows, and Safari otherwise; the `apple.com` rule includes Maps at `maps.apple.com`. The effective reported OS follows the device in automatic mode and the selected value in manual mode. This is a user preference, not a claim that Apple requires a particular browser.

Google lists several supported browsers, so Chrome is not a requirement. The project applies Chrome to Google and YouTube domains because the user explicitly requested that preference.

Microsoft's published service-domain guidance identifies web properties used by Microsoft 365, Teams, Outlook, SharePoint, and related services. The project applies Edge to those domains plus Microsoft's OneDrive, Bing, MSN, Azure, Xbox, and Windows sites at the user's request. These rules are not claims that the sites require Edge.

## Sources

- [Apple: iCloud.com browser feature availability](https://support.apple.com/en-sg/105119)
- [Apple: Web-only access to iCloud](https://support.apple.com/en-ie/102447)
- [Google: Sign in with a supported browser](https://support.google.com/accounts/answer/7675428?co=GENIE.Platform%3DDesktop&hl=en)
- [Microsoft: Browser compatibility with Microsoft 365 for the web](https://support.microsoft.com/it-it/office/browser-compatibili-con-microsoft-365-per-il-web-e-componenti-aggiuntivi-di-microsoft-365-ad1303e0-a318-47aa-b409-d3a5eb44e452)
- [Microsoft 365 URLs and IP address ranges](https://learn.microsoft.com/en-us/microsoft-365/enterprise/urls-and-ip-address-ranges)
- [Unified cloud.microsoft domain for Microsoft 365 apps](https://learn.microsoft.com/en-us/microsoft-365/enterprise/cloud-microsoft-domain)
