# Project instructions

- Read `docs/decisions.md` before changing automatic rules or reported identity behavior.
- Add a site rule only when support guidance, a reproducible compatibility issue, or an explicit user preference supports it. Record the rationale in `docs/research/site-browser-support.md`.
- Keep the extension dependency-free unless a browser API cannot cover the need.
- Preserve the actual operating system as the default. Keep user-selected platform changes visible in the popup.
- Version checks should contact vendor release sources only and keep the last valid cached versions when a source fails.
