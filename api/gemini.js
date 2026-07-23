// Serverless function (Vercel-style). Calls Gemini server-side using a key stored as an
// environment variable — never exposed to the browser.
//
// Security layers, in order of enforcement:
// 1. Shared access code — rejects any request missing the correct X-Access-Code header.
// 2. Server-side daily limit per user-id — via Upstash Redis's REST API (no SDK/package needed,
//    just plain fetch calls). If Upstash isn't configured yet, this step is skipped (fails open)
//    rather than blocking all usage.
//
// Note: an origin check (rejecting requests from other domains) was removed — it caused false-
// positive rejections in practice (Vercel preview URLs, proxy/redirect quirks affecting the Origin
// header) and was the lowest-value layer anyway. The access code + login gate + daily limit are
// what actually matter for this use case.

const ACCESS_CODE = process.env.ACCESS_CODE;
const DAILY_LIMIT_PER_USER = parseInt(process.env.DAILY_LIMIT_PER_USER || "10", 10);
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstashIncr(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const res = await fetch(`${UPSTASH_URL}/incr/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

async function upstashExpire(key, seconds) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  await fetch(`${UPSTASH_URL}/expire/${encodeURIComponent(key)}/${seconds}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "Method not allowed" } });
    return;
  }

  // --- Layer 1: shared access code ---
  const providedCode = req.headers["x-access-code"];
  if (ACCESS_CODE && providedCode !== ACCESS_CODE) {
    res.status(401).json({ error: { message: "Missing or invalid access code." } });
    return;
  }

  // --- Layer 2: server-side daily limit, keyed by the user-id the frontend sends ---
  const userId = (req.headers["x-user-id"] || "unknown").toString().slice(0, 100);
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const usageKey = `usage:${today}:${userId}`;
      const count = await upstashIncr(usageKey);
      if (count === 1) await upstashExpire(usageKey, 60 * 60 * 26); // ~26h TTL, safety margin past midnight
      if (count != null && count > DAILY_LIMIT_PER_USER) {
        res.status(429).json({ error: { message: `Daily limit of ${DAILY_LIMIT_PER_USER} requests reached for "${userId}". Resets at midnight. Contact your admin if you need a higher limit.` } });
        return;
      }
    } catch (upstashErr) {
      console.error("Upstash rate-limit check skipped:", upstashErr.message);
    }
  }

  const apiKey = (req.body && req.body.apiKey) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: "No Gemini API key available. Set GEMINI_API_KEY as an environment variable in your hosting provider's settings." } });
    return;
  }

  try {
    const { contents, systemInstruction, generationConfig, tools, model } = req.body || {};
    if (!contents) {
      res.status(400).json({ error: { message: "Missing 'contents' in request body." } });
      return;
    }

    const geminiModel = model || "gemini-3.1-flash-lite";
    const body = { contents, systemInstruction, generationConfig };
    if (tools) body.tools = tools;

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      }
    );

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: { message: e.message || String(e) } });
  }
}
