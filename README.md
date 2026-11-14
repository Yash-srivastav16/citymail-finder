# CityMail Finder

Chrome extension for researching email addresses across locations. Import a CSV/XLSX with a `City` column or enter locations manually. The extension opens Google Search pages in Chrome, extracts email-shaped strings from visible result text, stores matches locally, deduplicates them, and exports to Excel.

## Features

- Sequential multi-location collection from Excel/CSV or manual input.
- Custom query with `{city}` placeholder.
- 1–50 Google result pages per location (10 by default).
- Reuses one Chrome tab while navigating pages and locations.
- Checkpoint, pause/resume, local deduplication, and Excel export.

## Search behaviour and limitations

This is browser-based Google Search automation using Chrome tabs and page scripting. It does not use Google Custom Search JSON API, SearXNG, FreeSea, Tavily, or a server-side search API. Only visible result-page text is inspected; linked websites are not crawled and addresses are not verified for ownership, validity, deliverability, or business association.

Google may display a verification challenge or restrict automated queries. The extension waits for the user to resolve challenges manually; it does not solve CAPTCHA, bypass access controls, or evade rate limits. Automated querying may be restricted by Google's terms. Confirm you have permission before use and respect applicable privacy and email marketing laws. Treat every address as an unverified match.

## Development

Run `npm install` and `npm run build`. Load `dist/` in Chrome at `chrome://extensions` with Developer mode enabled.

## Structure

- `src/`: React/TypeScript interface and sequential batch runner.
- `public/manifest.json`: Manifest V3 permissions and extension configuration.
- `public/background.js`: Opens the extension workspace.
- `docs/`: Marketing website and privacy policy.
- `api/`: Existing Vercel endpoints; the extension collection flow does not call them.

Issues: https://github.com/Yash-srivastav16/citymail-finder/issues
