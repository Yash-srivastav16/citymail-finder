# CityMail Finder

Manifest V3 Chrome extension for finding publicly published business contact emails from public business websites.

## Stack

- React + TypeScript + Vite
- Vercel serverless API routes
- SearXNG free-first search provider; optional Tavily fallback
- Chrome local browser storage for settings and IndexedDB for result records
- XLSX export generated locally in the browser

## Development

```bash
npm install
npm run build
```

Load the generated `dist` folder in Chrome using Extensions → Developer mode → Load unpacked. Click the extension icon to open its workspace in a tab.

Configure the deployed API URL in the app. Vercel environment variables are documented in `.env.example` and `VERCEL-SETUP.md`.

## Status

Development implementation is committed. Build installation timed out in the current environment; live provider, Chrome end-to-end, and production security checks remain pending. Do not treat this repository as a production-ready release yet.

## Responsible use

Only process publicly accessible business contact information. Respect robots.txt, website terms, and rate limits. Never bypass logins, CAPTCHAs, paywalls, or access controls. Do not commit secrets or collected contact lists.
