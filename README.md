# CityMail Finder

CityMail Finder is a Manifest V3 Chrome extension for city-based business contact research. It reviews Google Search result pages, collects email-shaped text that is visible on those pages, removes duplicate matches, and exports the unique addresses to Excel.

**Current extension version:** 1.1.3  
**Chrome Web Store:** https://chromewebstore.google.com/detail/citymail-finder/bnmmknajlfeohmhfhcckjjglbemejnmk  
**Marketing website:** https://yash-srivastav16.github.io/citymail-finder/  
**Privacy policy:** https://yash-srivastav16.github.io/citymail-finder/privacy.html

## Features

- Import a CSV or Excel file containing a `City` column, or add cities manually.
- Configure a Google Search query using `{city}` as the location placeholder.
- Choose how many result pages to review for each city (up to 50).
- Open and navigate Google Search result pages from the extension.
- Extract email-shaped text visible in Google Search result-page text only.
- Deduplicate collected matches and store them locally in browser IndexedDB.
- Resume an interrupted run from its saved city/page checkpoint.
- Export unique email addresses to an Excel workbook.
- Show a respectful rating reminder after three successfully completed collection sessions, with options to rate, snooze for 48 hours, or dismiss future reminders.

## Important limitations

- **Matches are unverified.** The extension does not verify mailbox existence, ownership, deliverability, or whether an address belongs to a particular business.
- **No website crawling.** It does not visit or crawl the business websites linked from Google results.
- **No email sending.** It does not send messages or run outreach campaigns.
- **Manual verification only.** If Google shows a CAPTCHA or other challenge, the user must complete it manually. The extension does not solve, hide, bypass, or circumvent challenges.
- **Search-provider terms apply.** This workflow sends automated search requests to Google and reads Google result pages. Google restricts automated queries/scraping without express permission. A Chrome Web Store listing or review is not permission from Google. Do not use or commercially operate this Google Search workflow unless you have the required express permission or have replaced it with a source whose terms permit the intended access. Never attempt to evade rate limits or access controls.

## Permissions

The extension requests these permissions in `public/manifest.json`:

| Permission | Why it is used |
| --- | --- |
| `storage` | Saves the rating-reminder state (completed-session count, last reminder time, and the user's reminder/dismissal choices) in Chrome local extension storage. |
| `unlimitedStorage` | Supports the locally stored collection data in the extension origin's IndexedDB without the standard storage quota restriction. |
| `tabs` | Opens, monitors, navigates, activates when manual verification is needed, and closes the Google Search tab used by a collection run. |
| `scripting` | Reads visible text from the active Google Search result page to identify email-shaped matches. |
| `https://www.google.com/search*` host access | Limits page access to Google Search result URLs used by the workflow. |

Collected email matches, city settings, query settings, and search progress are stored in the browser. The current extension does not upload the collected email list or city list to a CityMail Finder server. Google receives the search requests directly from the user's browser and handles them under Google's own policies. See the [Privacy Policy](https://yash-srivastav16.github.io/citymail-finder/privacy.html) for details.

## Project structure

- `src/` — React + TypeScript extension interface and local result handling.
- `public/manifest.json` — Manifest V3 configuration and requested permissions.
- `public/background.js` — Opens the extension workspace.
- `docs/` — Static marketing website, privacy policy, SEO metadata, sitemap, and robots file.
- `api/` — Serverless API code retained from earlier development; it is not the active Google-results extraction path in the current extension interface.

## Development

Requirements: Node.js and npm.

```bash
npm install
npm run build
```

The production extension is generated in `dist/`. To test it locally:

1. Run `npm run build`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the generated `dist` directory.

## Releases

See [README-EXTENSION.md](README-EXTENSION.md) for the build, QA, permission, and Chrome Web Store submission checklist. See [docs/releasing.md](docs/releasing.md) for versioning and release packaging.

GitHub Releases provide the direct extension ZIP. The Chrome Web Store submission is a separate manual step; creating a GitHub Release does not publish an update to the store.

## Marketing website deployment

The static marketing site is in `docs/`. GitHub Pages should be configured under **Settings → Pages → Deploy from a branch**, using branch `main` and folder `/docs`.

## Responsible use and support

Only research information you are permitted to access and use. Respect search-provider terms, rate limits, privacy and data-protection requirements, and applicable email marketing laws. Do not use collected addresses for unsolicited bulk email.

Report bugs and request support through [GitHub Issues](https://github.com/Yash-srivastav16/citymail-finder/issues).
