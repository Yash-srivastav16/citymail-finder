# CityMail Finder

CityMail Finder is a browser-based business email research extension. It searches Google result pages using city-based queries, extracts email addresses visible in the result-page text, removes duplicates and exports the unique addresses to Excel.

**Marketing website:** https://yash-srivastav16.github.io/citymail-finder/  
**Privacy policy:** https://yash-srivastav16.github.io/citymail-finder/privacy.html

## What it does

- Import a CSV or Excel file containing a `City` column.
- Add cities manually.
- Configure a search query using `{city}` as the location placeholder.
- Review Google search results page by page.
- Extract email addresses visible in Google result-page text only.
- Save results locally in browser IndexedDB and deduplicate by email address.
- Resume a search from its saved city/page checkpoint after an interruption.
- Export unique email addresses to an Excel workbook.

The current extension does **not** crawl linked business websites, verify whether an address is deliverable, enrich contacts, or send email.

## Manual verification

Google may display a CAPTCHA or other verification challenge. CityMail Finder pauses the workflow and leaves the Google tab available for the user to complete the challenge manually. It does not solve, hide or bypass CAPTCHA challenges. Manual completion does not override Google's terms, automated-query restrictions or rate limits. Use the extension only in ways permitted by the search provider and applicable law.

## Project structure

- `src/` — React + TypeScript extension interface and local result handling.
- `public/manifest.json` — Manifest V3 extension configuration.
- `public/background.js` — Opens the extension workspace.
- `docs/` — Static marketing website, privacy policy, SEO metadata, sitemap and robots file.
- `api/` — Serverless search API code retained from earlier development; it is not the active Google-results extraction path in the current extension interface.

## Development

```bash
npm install
npm run build
```

Load the generated `dist` folder in Chrome using Extensions → Developer mode → Load unpacked.

## Marketing website deployment (GitHub Pages)

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/docs**.
4. Save and wait for GitHub Pages to publish.
5. Check the published URL: https://yash-srivastav16.github.io/citymail-finder/

The `docs/` directory contains the canonical URLs, Open Graph metadata, structured data, sitemap and robots.txt. If the GitHub Pages username or project URL changes, update canonical URLs, sitemap URLs and social metadata in the HTML and XML files.

## Launch status

The marketing website files have been added, but GitHub Pages still needs to be enabled in repository settings. The extension build, live browser workflow, store submission requirements and production security checks must be validated before calling the extension production-ready.

## Responsible use and privacy

Only research information you are permitted to access and use. Respect search-provider terms, rate limits, privacy and data-protection requirements, and applicable email marketing laws. Do not use collected addresses for unsolicited bulk email. See the [Privacy Policy](https://yash-srivastav16.github.io/citymail-finder/privacy.html).

## Support

Report bugs and request help through [GitHub Issues](https://github.com/Yash-srivastav16/citymail-finder/issues).
