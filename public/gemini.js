// Serverless function (Vercel-style). Calls Gemini server-side using a key stored as an
// environment variable — never exposed to the browser.
//
// Security layers, in order of enforcement:
// 1. Origin check — rejects requests from browser pages on other domains (doesn't stop
//    non-browser tools with a spoofed Origin header, but blocks casual cross-site embedding).
// 2. Shared access code — rejects any request missing the correct X-Access-Code header.
//    This is the main defense: it's baked into the frontend's own JS, so a random person who
//    stumbles on this URL (search engine, leaked link) without the actual app can't call it.
// 3. Server-side daily limit per user-id — enforced here, not just in the browser, so it can't
//    be bypassed by clearing localStorage. Requires a Vercel KV database to be linked to this
//    project (see README) — if KV isn't configured, this step is skipped (fails open) rather
//    than blocking all usage, so the app still works before you've set up KV.

let kv = null;
try {
  // Loaded dynamically so the function still works even if @vercel/kv isn't installed/configured yet.
  kv = require("@vercel/kv").kv;
} catch (e) {
  kv = null;
}

const ACCESS_CODE = process.env.ACCESS_CODE;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN; // e.g. https://your-site.vercel.app
const DAILY_LIMIT_PER_USER = parseInt(process.env.DAILY_LIMIT_PER_USER || "10", 10);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "Method not allowed" } });
    return;
  }

  // --- Layer 1: Origin check ---
  const origin = req.headers.origin || req.headers.referer || "";
  if (ALLOWED_ORIGIN && origin && !origin.startsWith(ALLOWED_ORIGIN)) {
    res.status(403).json({ error: { message: "Requests from this origin are not allowed." } });
    return;
  }

  // --- Layer 2: shared access code ---
  const providedCode = req.headers["x-access-code"];
  if (ACCESS_CODE && providedCode !== ACCESS_CODE) {
    res.status(401).json({ error: { message: "Missing or invalid access code." } });
    return;
  }

  // --- Layer 3: server-side daily limit, keyed by the user-id the frontend sends ---
  const userId = (req.headers["x-user-id"] || "unknown").toString().slice(0, 100);
  if (kv) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const usageKey = `usage:${today}:${userId}`;
      const count = await kv.incr(usageKey);
      if (count === 1) await kv.expire(usageKey, 60 * 60 * 26); // ~26h TTL, safety margin past midnight
      if (count > DAILY_LIMIT_PER_USER) {
        res.status(429).json({ error: { message: `Daily limit of ${DAILY_LIMIT_PER_USER} requests reached for "${userId}". Resets at midnight. Contact your admin if you need a higher limit.` } });
        return;
      }
    } catch (kvErr) {
      // KV not configured yet, or a transient error — don't block usage, just skip enforcement.
      console.error("KV rate-limit check skipped:", kvErr.message);
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
