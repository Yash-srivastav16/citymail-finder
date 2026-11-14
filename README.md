# CityMail Finder

CityMail Finder is a Chrome extension for running business-email research searches across a list of locations. It sends one request per location to the CityMail serverless search API, stores returned email matches locally, deduplicates them, and exports the results to Excel.

**Marketing website:** https://yash-srivastav16.github.io/citymail-finder/  
**Privacy policy:** https://yash-srivastav16.github.io/citymail-finder/privacy.html

## What it does

- Import a CSV or Excel file containing a City column.
- Add locations manually.
- Configure a search query using {city} as the location placeholder.
- Configure the maximum number of search results per location (1–10).
- Automatically submit one search API request for each location, sequentially.
- Prefer a configured SearXNG instance, with optional configured fallback providers.
- Extract email-shaped strings from search result titles, URLs and snippets.
- Save results locally in browser IndexedDB and deduplicate addresses.
- Pause between locations and resume from the saved batch checkpoint.
- Export unique email addresses to an Excel workbook.

## Search API

The extension calls /api/search on the configured CityMail API base URL. The default is https://citymail-finder.vercel.app; override it at build time with VITE_API_BASE_URL if the API is hosted elsewhere.

Configure SEARXNG_URL in Vercel Project Settings to use your SearXNG instance. SearXNG is preferred when configured. Optional fallback providers are controlled by FREESEA_API_KEY and TAVILY_API_KEY. If you want SearXNG only, leave fallback provider variables unset.

The extension requires host access to the API domain. If you change VITE_API_BASE_URL to another domain, update public/manifest.json host_permissions to match and rebuild the extension.

## Result limitations

This version extracts email-shaped strings from search-result titles, URLs and snippets. It does not crawl linked business websites, verify email ownership or deliverability, confirm that an address belongs to a particular business, or send email. Every extracted address is an unverified match. Independently verify the address and its business association before relying on it or contacting anyone.

The extension does not automate Google Search, solve CAPTCHA, bypass provider access controls, or evade rate limits. If a provider returns a rate-limit or verification response, the batch pauses and can be resumed after the provider issue is resolved.

## Project structure

- src/ — React + TypeScript extension interface, sequential batch runner and local result handling.
- public/manifest.json — Manifest V3 extension configuration.
- public/background.js — Opens the extension workspace.
- docs/ — Static marketing website, privacy policy, SEO metadata, sitemap and robots file.
- api/ — Vercel serverless search and health endpoints.

## Development

Install dependencies with npm install, then run npm run build.

Load the generated dist folder in Chrome using Extensions → Developer mode → Load unpacked.

## Marketing website deployment (GitHub Pages)

1. Open the repository's Settings → Pages.
2. Under Build and deployment, choose Deploy from a branch.
3. Select branch main and folder /docs.
4. Save and wait for GitHub Pages to publish.
5. Check the published URL: https://yash-srivastav16.github.io/citymail-finder/

The docs/ directory contains the canonical URLs, Open Graph metadata, structured data, sitemap and robots.txt. If the GitHub Pages username or project URL changes, update canonical URLs, sitemap URLs and social metadata in the HTML and XML files.

## Responsible use and privacy

Only research information you are permitted to access and use. Respect search-provider terms, rate limits, privacy and data-protection requirements, and applicable email marketing laws. Do not use collected addresses for unsolicited bulk email. See the Privacy Policy at https://yash-srivastav16.github.io/citymail-finder/privacy.html.

## Support

Report bugs and request help through https://github.com/Yash-srivastav16/citymail-finder/issues.
