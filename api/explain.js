// src/lib/address.ts
var BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(input) {
  let value = 0n;
  for (const ch of input) {
    const digit = BASE58.indexOf(ch);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const ch of input) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}
function isSolanaAddress(input) {
  if (input.length < 32 || input.length > 44) return false;
  return base58Decode(input)?.length === 32;
}
function parseMintAddress(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "Paste a Solana token mint address." };
  }
  const mint = raw.trim();
  if (!mint) return { ok: false, error: "Paste a Solana token mint address." };
  if (!isSolanaAddress(mint)) {
    return {
      ok: false,
      error: "That is not a valid Solana address. It should be a 32-byte public key in base58."
    };
  }
  return { ok: true, mint };
}

// src/lib/rate-limit.ts
var hits = /* @__PURE__ */ new Map();
function allow(key, limit = 20, windowMs = 6e4, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5e3) hits.clear();
  return true;
}
function clientIp(headers, fallback = "unknown") {
  const forwarded = headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value && value.trim()) return value.split(",")[0].trim();
  const real = headers["x-real-ip"];
  const realValue = Array.isArray(real) ? real[0] : real;
  if (realValue && realValue.trim()) return realValue.trim();
  return fallback;
}

// src/lib/http.ts
var MAX_BODY_BYTES = 16384;
function methodOf(req) {
  return (req.method ?? "GET").toUpperCase();
}
function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}
function byteLength(value) {
  return new TextEncoder().encode(value).length;
}
function tooLarge(req, max = MAX_BODY_BYTES) {
  const length = header(req, "content-length");
  if (length && Number(length) > max) return true;
  if (typeof req.body === "string" && byteLength(req.body) > max) return true;
  return false;
}
function readJsonBody(req) {
  if (req.body == null || req.body === "") {
    return { ok: false, error: "Invalid JSON body." };
  }
  if (typeof req.body === "string") {
    try {
      return { ok: true, value: JSON.parse(req.body) };
    } catch {
      return { ok: false, error: "Invalid JSON body." };
    }
  }
  return { ok: true, value: req.body };
}
function cors(res) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type");
}

// src/lib/explain.ts
var EXPLAIN_LIMIT = 6;
var EXPLAIN_WINDOW_MS = 6e4;
var MAX_REPORT_CHARS = 8e3;
var DEFAULT_MODEL = "gemini-3.5-flash-lite";
var SYSTEM = `You explain a read-only Solana token risk report in clear English.
Rules:
- This is not financial advice. Do not tell the reader to buy, sell, hold, or trade the token.
- Never upgrade a rating. If a check is Unknown, say it is unknown and that missing information is not the same as safe.
- Do not invent authorities, balances, extensions, or other facts that are not in the report.
- Be concise: 2\u20134 short paragraphs, then up to 5 bullet points of the main findings.
- Mention the overall rating and what still cannot be determined.`;
function getGeminiApiKey(env = process.env) {
  const key = env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key || !key.trim()) return void 0;
  return key.trim();
}
function getModelId(env = process.env) {
  return env.GOOGLE_MODEL?.trim() || DEFAULT_MODEL;
}
function prepareExplainPayload(input) {
  const report = input.report;
  if (!report || typeof report !== "object") {
    return { ok: false, status: 400, error: "A risk report is required." };
  }
  if (!parseMintAddress(report.mint).ok) {
    return { ok: false, status: 400, error: "The report mint address is invalid." };
  }
  if (!Array.isArray(report.checks) || !report.overall) {
    return { ok: false, status: 400, error: "The report is incomplete." };
  }
  const serialized = JSON.stringify({
    mint: report.mint,
    cluster: report.cluster,
    overall: report.overall,
    facts: {
      programKind: report.facts?.programKind,
      programId: report.facts?.programId,
      decimals: report.facts?.decimals,
      supplyUi: report.facts?.supplyUi,
      mintAuthority: report.facts?.mintAuthority ?? null,
      freezeAuthority: report.facts?.freezeAuthority ?? null,
      authoritiesKnown: report.facts?.authoritiesKnown,
      holders: (report.facts?.holders ?? []).slice(0, 10).map((holder) => ({
        address: holder.address,
        percent: holder.percent
      })),
      holdersKnown: report.facts?.holdersKnown,
      extensions: report.facts?.extensions,
      extensionsKnown: report.facts?.extensionsKnown,
      error: report.facts?.error
    },
    checks: report.checks.map((check) => ({
      id: check.id,
      title: check.title,
      rating: check.rating,
      summary: check.summary
    }))
  });
  if (serialized.length > MAX_REPORT_CHARS) {
    return { ok: false, status: 413, error: "The report is too large to explain." };
  }
  return { ok: true, report, serialized };
}
async function callGemini(serialized, model, apiKey, fetchFn = fetch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: `Explain this report:
${serialized}` }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.2 }
    })
  });
  if (!response.ok) {
    throw new Error("The explanation service is unavailable right now.");
  }
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("The explanation service returned an empty response.");
  return text;
}
async function handleExplainHttp(req, res, deps = {}) {
  cors(res);
  if (methodOf(req) === "OPTIONS") {
    res.status(204).json(null);
    return;
  }
  if (methodOf(req) !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (tooLarge(req, MAX_REPORT_CHARS + 1024)) {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }
  const env = deps.env ?? process.env;
  const ip = clientIp(req.headers ?? {}, req.socket?.remoteAddress ?? "unknown");
  if (!allow(`explain:${ip}`, EXPLAIN_LIMIT, EXPLAIN_WINDOW_MS, deps.now ?? Date.now())) {
    res.status(429).json({ error: "Too many explanation requests. Please wait a minute and try again." });
    return;
  }
  const key = getGeminiApiKey(env);
  if (!key) {
    res.status(503).json({ error: "The optional AI explanation is not configured on this deployment." });
    return;
  }
  const body = readJsonBody(req);
  if (!body.ok) {
    res.status(400).json({ error: body.error });
    return;
  }
  const prepared = prepareExplainPayload(body.value ?? {});
  if (!prepared.ok) {
    res.status(prepared.status).json({ error: prepared.error });
    return;
  }
  try {
    const generate = deps.generate ?? callGemini;
    const text = await generate(prepared.serialized, getModelId(env), key);
    res.status(200).json({ explanation: text, model: getModelId(env) });
  } catch {
    res.status(502).json({ error: "The explanation could not be generated. Please try again in a moment." });
  }
}

// server/explain.ts
var maxDuration = 30;
async function handler(req, res) {
  await handleExplainHttp(req, res);
}
export {
  handler as default,
  maxDuration
};
