export default function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    service: "citymail-finder-api",
    mode: "serverless-batch",
    configured: {
      searxng: Boolean(process.env.SEARXNG_URL),
      tavilyFallback: Boolean(process.env.TAVILY_API_KEY)
    }
  });
}
