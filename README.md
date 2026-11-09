# CityMail Finder

Chrome extension for discovering publicly published business contact emails from business websites.

## Status

Repository initialized. The application source has not yet been pushed. The Vercel serverless backend adaptation, security hardening, and end-to-end tests are still pending.

## Planned architecture

- Chrome Manifest V3 extension using React and TypeScript
- Chrome local storage for settings and IndexedDB for collected results
- Vercel serverless API for bounded search and crawling batches
- Search-provider abstraction, with free-first provider support
- Local Excel export

## Security and responsible use

Only process publicly accessible business websites. Respect robots.txt, website terms, and rate limits. Do not bypass logins, CAPTCHAs, paywalls, or other access controls. Protect backend routes against SSRF and abuse. Never commit API keys or secrets.
