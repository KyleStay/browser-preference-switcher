> Current 0.1.3 landing validation: source/package checks pass; live browser checks are UNRUN at the denied runner boundary. Earlier browser results below are historical evidence, not validation of this candidate.

# Update the existing Chrome Web Store item

- Item: Browser Preference Switcher
- Item ID: `eakhhmacdkemcanhfnfjhfimimjecifa`
- [Public listing](https://chromewebstore.google.com/detail/browser-preference-switch/eakhhmacdkemcanhfnfjhfimimjecifa)
- Public version checked October 15, 2026: **0.1.1**.
- Prepared update: **0.1.3**. 77 current source checks passed; live browser checks are UNRUN.

## Upload

Open the existing item in the developer dashboard. Under **Package → Upload new package**, upload `dist/browser-preference-switcher-0.1.3.zip`. Confirm the draft reports 0.1.3 without errors. The new version must exceed the previous upload; check the dashboard for any newer draft or published package.

## Changed listing content

Append the supplied update summary to the current description, replace the popup screenshot with `store/screenshots/accepted-1280x800.png`, and refresh reviewer test instructions. The update adds the full configured User-Agent display and fixes consent dismissal, keyboard focus, settings retry, and version-source error messages.

This local update adds no permissions or user-data categories. Keep accurate existing privacy declarations; reconfirm them if the dashboard requests it. Current name, icons, promotional tile, support links, and distribution can remain as configured.

## Submit

Save changes, resolve any dashboard errors, and submit the update for review. Choose automatic publication after approval or deferred publication. Check that the public listing shows 0.1.3 after publication.

The offline HTML guide has the extension ZIP, current popup screenshot, and copy-ready update text embedded. It does not access your account or upload/submit anything.

[Official Chrome Web Store update instructions](https://developer.chrome.com/docs/webstore/update)
