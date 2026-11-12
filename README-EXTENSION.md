# CityMail Finder — extension build and release checklist

## Current product behaviour

CityMail Finder is a Manifest V3 Chrome extension. It accepts a city list (CSV/XLSX with a `City` column or manual entry), builds a configurable Google Search query for each city, opens result pages, extracts email-shaped strings from visible result-page text, deduplicates addresses in local IndexedDB, and exports unique addresses to an Excel workbook.

The extension does **not** crawl linked business websites, verify email deliverability, send email, upload collected results to a CityMail Finder server, or solve/bypass CAPTCHA. If a Google verification challenge appears, the user must complete it manually.

**Important:** this workflow automates Google Search queries and reads Google result pages. Google states that automated queries/scraping without express permission are not allowed. A Chrome Web Store review or listing is not permission from Google and does not establish compliance with Google's terms. Do not publish or distribute this workflow as Google-approved. Obtain express permission or replace the search source with a provider whose terms explicitly allow the intended automated access before commercial operation. Never try to evade rate limits, CAPTCHA, or other access controls.

## Local development

Requirements: a current Node.js LTS release and npm.

```bash
npm install
npm run build
```

The production extension is generated in `dist/`.

## Load unpacked in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the generated `dist` directory.
5. Test importing cities, adding/removing cities, search execution, manual verification pause/resume, deduplication, deletion, and Excel export.

Do not load the repository root; load `dist`.

## Before Chrome Web Store submission

- Confirm the current Google terms/permission issue has been resolved. If not, do not submit or market the automated Google Search workflow as compliant.
- Run `npm ci` (if a lockfile is committed) or `npm install`, then `npm run build`; inspect the generated `dist` directory.
- Test the exact packaged build in a clean Chrome profile.
- Add required PNG extension icons (16×16, 32×32, 48×48 and 128×128) and reference them in `public/manifest.json`.
- Provide accurate store screenshots and a truthful short/long description.
- In the Web Store privacy disclosures, declare the handling of email addresses and city lists accurately. State that processing is local only if verified against the complete shipped build.
- Justify every requested permission: `tabs`, `scripting`, `unlimitedStorage`, and Google Search host access. Remove permissions that are not required.
- Publish the privacy policy at a stable public URL and ensure it exactly matches the shipped extension.
- Do not claim that email addresses are verified, that every business is covered, or that the extension is endorsed/approved by Google.
- Test install, update, uninstall, data deletion, and the extension's behaviour when Google changes its result-page markup.

## Data handling

The current app uses browser IndexedDB for collected results and browser local storage for city/query/page settings and its resume checkpoint. It does not require a CityMail Finder account. Exported spreadsheets are saved by the browser to the user's device. Google receives the search requests directly from the user's browser and handles them under Google's own policies.

## Support

Report bugs through [GitHub Issues](https://github.com/Yash-srivastav16/citymail-finder/issues).
