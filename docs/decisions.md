# Product Decisions

## Confirmed

### D1 — Change request headers without attaching a debugger

The extension changes the User-Agent and selected User-Agent Client Hint request headers on matched sites. After the user saw Chrome's “debugging” notice, the design dropped the `debugger` permission. Page JavaScript continues to see Brave's Chromium identity. This favors a smaller permission footprint over a fully aligned browser identity; it does not change Brave's rendering engine.

See [ADR 0001](./adr/0001-consistent-reported-browser-identity.md) for the revised tradeoff.

### D2 — Switch only on curated, justified site rules

Automatic switching will use specific site rules when a browser preference is documented, a compatibility benefit has been verified, or the user explicitly requests a mapping. Sites without a matching rule keep the host browser's normal identity; company affiliation alone is not enough to trigger a switch.

### D3 — Refresh browser versions from official sources

The extension should automatically check official vendor release sources for current public browser versions and cache the last valid values. Version checks should request version data only; they do not need to send visited-site information.

### D4 — Preserve the actual operating system by default

The user can choose which operating system to report alongside a browser identity. The default is the user's actual operating system to avoid an unintended platform change.

### D5 — Support Chrome, Edge, Safari, and Firefox profiles

The initial profile catalog will include Chrome, Edge, Safari, and Firefox. Having a profile available does not by itself create an automatic site rule; switching still requires a documented preference, verified compatibility benefit, or explicit user request under D2.

### D6 — Use Chrome identity on Google sites

At the user's request, report Chrome on `google.com` and its subdomains, `youtube.com`, and `youtu.be`, regardless of the actual browser. This records a personal preference, not a claim that Google requires Chrome. The selected operating-system setting still applies.

### D7 — Target Brave as the host browser

The user plans to use Brave. Build against Chromium's Manifest V3 extension APIs and make Brave the primary runtime target. Chrome remains useful as a compatibility reference, and request-header changes still need testing in Brave.

### D8 — Use Edge identity on Microsoft sites

At the user's request, report Edge on Microsoft's main web and product domains, including Microsoft 365, Outlook, Teams, SharePoint, OneDrive, Bing, MSN, Azure, Xbox, and Windows. This is a user preference, not a claim that Microsoft requires Edge. The domains are `microsoft.com`, `cloud.microsoft`, `microsoft365.com`, `office.com`, `office365.com`, `outlook.com`, `live.com`, `onedrive.com`, `sharepoint.com`, `bing.com`, `msn.com`, `azure.com`, `xbox.com`, `windows.com`, and `microsoftonline.com`, including their subdomains.

### D9 — Use Safari identity on Apple sites

At the user's request, report Safari on `apple.com` and `icloud.com` and their subdomains. The `apple.com` rule includes Apple Maps at `maps.apple.com`. The selected operating-system setting still applies.

## Current mapping summary

The default rules use Google and YouTube domains → Chrome, Microsoft web domains → Edge, and Apple and iCloud domains → Safari at the user's request. The selected operating-system setting applies to all of them.

## Working assumptions

- “Latest public version” means the current Stable release, not a beta, dev, or nightly build.
- The first release uses vendor-published, first-party release sources and a locally cached fallback.
- The automatic rule catalog can expand later as additional site preferences or compatibility benefits are verified.
