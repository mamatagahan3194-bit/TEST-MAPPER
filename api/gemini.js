// Serverless function (Vercel-style). Calls Gemini server-side using a key stored as an
// environment variable — never exposed to the browser. This exists specifically because a
// browser-based call using a restricted/org-issued key can fail due to browser-context
// restrictions (referrer checks, etc.) that don't apply to server-to-server calls.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "Method not allowed" } });
    return;
  }

  // Priority: a key the client explicitly sent (rare — only if someone wants to override with
  // their own key at runtime) falls back to the shared key configured on the server.
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

    const geminiModel = model || "gemini-2.5-flash";
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
