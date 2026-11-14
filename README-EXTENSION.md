# CityMail Finder — extension build and release checklist

## Current product behaviour

CityMail Finder is a Manifest V3 Chrome extension. It accepts a city list (CSV/XLSX with a City column or manual entry), submits one request per location to the CityMail serverless search API, extracts email-shaped strings from search-result titles, snippets and URLs, deduplicates addresses in local IndexedDB, and exports unique addresses to Excel.

The extension processes locations sequentially. It records per-location status and result counts, saves a versioned checkpoint after each location transition, supports pause between locations, and resumes pending or paused work after the extension is reopened. A failed location can be retried with Start / Resume.

The extension does not crawl linked business websites, verify email ownership or deliverability, confirm that an address belongs to a particular business, send email, or solve/bypass CAPTCHA. Every extracted email-shaped string is an unverified match. Users must independently verify the address and its business association before relying on it or contacting anyone.

## Search provider

The extension calls /api/search on the configured API base URL. The default is https://citymail-finder.vercel.app; override it at build time with VITE_API_BASE_URL if the API is hosted elsewhere.

Configure SEARXNG_URL in Vercel Project Settings to use a SearXNG instance. SearXNG is preferred when configured. FREESEA_API_KEY and TAVILY_API_KEY are optional fallback providers. Leave the fallback variables unset if you want SearXNG only.

If the API base URL changes, update public/manifest.json host_permissions to include that exact host, then rebuild the extension. The API must allow requests from the installed extension origin.

## Local development

Requirements: a current Node.js LTS release and npm.

Install dependencies with npm install, then run npm run build.

The production extension is generated in dist/.

## Load unpacked in Chrome

1. Run npm run build.
2. Open chrome://extensions.
3. Enable Developer mode.
4. Select Load unpacked and choose the generated dist directory.
5. Test importing locations, adding/removing locations, one API request per location, sequential processing, pause/resume, provider errors, deduplication, deletion, and Excel export.

Do not load the repository root; load dist.

## Before Chrome Web Store submission

- Confirm the configured search provider's terms permit the intended automated access.
- Run the production build and inspect the generated dist directory.
- Test the exact packaged build in a clean Chrome profile.
- Add required PNG extension icons (16×16, 32×32, 48×48 and 128×128) and reference them in public/manifest.json.
- Provide accurate store screenshots and a truthful short/long description.
- In the Web Store privacy disclosures, declare the handling of email addresses and city lists accurately.
- Justify every requested permission. Remove permissions that are not required.
- Publish the privacy policy at a stable public URL and ensure it exactly matches the shipped extension.
- Do not claim that email addresses are verified, that every business is covered, or that the extension is endorsed by a search provider.
- Test install, update, uninstall, data deletion, and the extension's behaviour when the search provider changes its response format.

## Data handling

The app uses browser IndexedDB for collected results and browser local storage for city/query/result-limit settings and its resume checkpoint. The search query and city are sent to the configured CityMail API, which forwards the request to its configured search provider. Exported spreadsheets are saved by the browser to the user's device. Review the API and provider privacy policies before using it with personal or sensitive data.

## Support

Report bugs through https://github.com/Yash-srivastav16/citymail-finder/issues.
