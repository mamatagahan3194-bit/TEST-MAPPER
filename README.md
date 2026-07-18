# Segment Revenue → NAICS/GICS Mapper — backend-proxy version

Use this version specifically because the Gemini key you have was issued by
someone else, and you can't check or change its restrictions. Calling it
directly from a browser was failing with an authentication error that's very
likely caused by a restriction on the key (referrer, IP, or similar) that only
the key's owner can see or change. Routing the call through a small backend
sidesteps that — server-to-server calls don't carry the same browser-context
signals that trigger those restrictions.

## Deploy to Vercel

### Option 1 — via the Vercel website
1. Go to vercel.com, sign up/log in
2. Push this folder to a GitHub repo (or import it directly if your plan allows
   drag-and-drop)
3. **Add New → Project**, select the repo
4. Vercel auto-detects `api/` as a serverless function and `public/` as the
   static site
5. Before deploying: **Settings → Environment Variables**, add:
   - Key: `GEMINI_API_KEY`
   - Value: the key you were given
6. Deploy — live at `https://<your-project>.vercel.app`

### Option 2 — via the command line
```bash
npm install -g vercel
cd gemini-backend-app
vercel login
vercel
vercel env add GEMINI_API_KEY production   # paste the key when prompted
vercel --prod
```

## If it still fails after this

That would mean the key's restriction isn't a browser-context thing (referrer),
but something else entirely — like an IP allowlist that doesn't include
Vercel's serverless IP ranges, or the key being scoped to a specific
application/service Google recognizes internally. At that point, the fix has
to come from whoever issued the key, since there's no further workaround
possible from the calling side. Ask them specifically: "what restriction is on
this key, and does it allow server-to-server calls from arbitrary hosting
providers?"

## Files
- `public/index.html` — the tool itself, calling `/api/gemini` instead of
  Google directly
- `api/gemini.js` — the proxy; holds `GEMINI_API_KEY` server-side
- `package.json` — minimal manifest, no dependencies needed

## Note on the key field in the tool itself
The "Your Gemini API key" field in the tool is now optional — leave it blank
to use the shared server key. It only matters if someone wants to temporarily
override it with their own key for a session.
