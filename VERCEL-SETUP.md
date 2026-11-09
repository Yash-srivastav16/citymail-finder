# Vercel API setup (initial serverless endpoints)

The repository now includes:
- `GET /api/health`
- `POST /api/search` with one city/query batch, a maximum of five search results, public-site crawling, robots.txt checks, and email deduplication.

## Environment variables

Configure the variables from `.env.example` in Vercel Project Settings. At least one search provider is required:
- `SEARXNG_URL` (free-first; availability depends on the instance)
- `TAVILY_API_KEY` (optional paid fallback)

`CITYMAIL_ACCESS_TOKEN` is optional. A static token shipped inside a Chrome extension can be extracted, so it is not strong authentication.

## Important integration status

The current React extension in the earlier development archive still calls the legacy Express job API (`/api/jobs`, polling, stop). The new serverless API is a bounded request/response endpoint (`/api/search`). The extension client still needs to be migrated to submit city/template batches to this endpoint, merge results into IndexedDB, and handle per-batch progress. Do not distribute this as a finished extension yet.

## Deploy

1. Import this repository into Vercel.
2. Set the environment variables above.
3. Deploy and verify `/api/health`.
4. Test `POST /api/search` with a small query before connecting the extension.

## Limitations and safety

- SearXNG instances are not guaranteed to be available or to return Google results.
- The endpoint is deliberately bounded and does not run a long-lived background job.
- It rejects localhost/private IP targets and does not follow redirects.
- Continue to harden DNS rebinding/SSRF protections and apply rate limits before public use.
- Respect website terms and robots.txt; do not bypass logins, CAPTCHAs, paywalls, or access controls.
