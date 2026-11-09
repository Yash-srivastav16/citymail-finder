# Vercel API and extension setup

## Repository contents

- `GET /api/health`: reports service and provider configuration.
- `POST /api/search`: runs one bounded city/query batch, searches up to five results, checks public business pages and contact paths, and returns extracted emails.
- `src/App.tsx`: React extension workspace. It sends one request per city/template pair, saves results in IndexedDB, and exports Excel locally.
- `public/manifest.json`: Manifest V3 extension. Clicking the extension opens a persistent tab so a long search is not tied to a short-lived popup.

## Environment variables

Set in Vercel Project Settings → Environment Variables:
- `SEARXNG_URL`: base URL of a SearXNG instance with JSON output enabled (free-first; public instances may rate-limit or disappear).
- `TAVILY_API_KEY`: optional paid provider fallback; used only when SEARXNG_URL is not set.
- `CITYMAIL_ACCESS_TOKEN`: optional basic API gate. A static token stored in an extension can be extracted; it is not strong authentication.

At least one provider must be configured. Never commit real credentials.

## Deploy steps

1. Import `Yash-srivastav16/citymail-finder` into Vercel.
2. Use the repository root as the project root, Framework Preset **Vite**, Build Command `npm run build`, Output Directory `dist`, Install Command `npm install`.
3. Add the provider environment variable(s), then deploy.
4. Check `https://YOUR-PROJECT.vercel.app/api/health`.
5. Run `npm install` and `npm run build` locally. Load the generated `dist` folder in Chrome using Extensions → Developer mode → Load unpacked.
6. Set the deployed Vercel URL in CityMail Finder and test the connection.

## Current limitations

- The extension calls the serverless `/api/search` endpoint directly; it no longer uses the old Express job polling API.
- Search is synchronous and bounded per city/template pair. Do not queue very large city lists in one browser session without monitoring Vercel function duration.
- The backend checks robots.txt and rejects obvious private/loopback IP destinations, but DNS rebinding/SSRF hardening and production rate limiting still require security review.
- Search-provider uptime and coverage are not guaranteed. SearXNG is not a guarantee of Google results.
- The optional static access token is not secure authentication for a distributed extension.
- Respect website terms and robots.txt. Do not bypass logins, CAPTCHAs, paywalls, or access controls.

## Validation status

Source files and GitHub commits have been created. A complete npm install/build could not be completed in the current environment because the npm registry request timed out. No live search-provider request or full Chrome end-to-end test has passed yet. Treat this as a development build, not a production release.
