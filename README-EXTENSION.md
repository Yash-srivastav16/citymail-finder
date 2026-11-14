# CityMail Finder — extension build and release checklist

## Current behaviour

Manifest V3 Chrome extension. Import locations from CSV/XLSX (`City` column) or enter them manually. It opens Google Search pages in Chrome, extracts email-shaped strings from visible result-page text, deduplicates them in IndexedDB, and exports unique addresses to Excel. Locations run sequentially; 1–50 pages per location (10 default) are navigated in a reused tab. Progress is checkpointed so a paused batch can resume.

The extension uses browser tab automation, not Google Custom Search JSON API or third-party search APIs. It does not crawl linked sites, verify ownership/deliverability/business association, or send email. All matches are unverified.

## Google Search access

Google may display verification challenges or restrict automated queries. The extension requires manual user handling and does not solve CAPTCHA, bypass controls, or evade rate limits. Automated querying may be restricted by Google's terms; confirm permission before use.

## Build and load

1. `npm install`
2. `npm run build`
3. Open `chrome://extensions` and enable Developer mode.
4. Choose Load unpacked and select `dist/`.
5. Test import, sequential location/page processing, pause/resume, manual challenge handling, deduplication and Excel export.

## Permissions

- `tabs`: create, reuse, activate and close the Google Search tab.
- `scripting`: inspect visible result-page text.
- `unlimitedStorage`: store collected results locally.

## Responsible use

Respect Google's terms, privacy and data-protection requirements, and applicable email marketing laws. Do not use collected addresses for unsolicited bulk email. Independently verify addresses before relying on them or contacting anyone.

Support: https://github.com/Yash-srivastav16/citymail-finder/issues
