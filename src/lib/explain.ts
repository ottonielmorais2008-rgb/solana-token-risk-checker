import { parseMintAddress } from "./address.js";
import { clientIp, allow } from "./rate-limit.js";
import { cors, methodOf, readJsonBody, tooLarge, type HttpRequest, type HttpResponse } from "./http.js";
import type { RiskReport } from "./types.js";

export type EnvMap = Record<string, string | undefined>;

export const EXPLAIN_LIMIT = 6;
export const EXPLAIN_WINDOW_MS = 60_000;
export const MAX_REPORT_CHARS = 8_000;
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export const SYSTEM = `You explain a read-only Solana token risk report in clear English.
Rules:
- This is not financial advice. Do not tell the reader to buy, sell, hold, or trade the token.
- Never upgrade a rating. If a check is Unknown, say it is unknown and that missing information is not the same as safe.
- Do not invent authorities, balances, extensions, or other facts that are not in the report.
- Be concise: 2–4 short paragraphs, then up to 5 bullet points of the main findings.
- Mention the overall rating and what still cannot be determined.`;

export interface ExplainInput {
  report?: unknown;
}

export function getGeminiApiKey(env: EnvMap = process.env): string | undefined {
  const key = env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key || !key.trim()) return undefined;
  return key.trim();
}

export function getModelId(env: EnvMap = process.env): string {
  return env.GOOGLE_MODEL?.trim() || DEFAULT_MODEL;
}

export function prepareExplainPayload(
  input: ExplainInput,
): { ok: true; report: RiskReport; serialized: string } | { ok: false; status: number; error: string } {
  const report = input.report as RiskReport | undefined;
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
        percent: holder.percent,
      })),
      holdersKnown: report.facts?.holdersKnown,
      extensions: report.facts?.extensions,
      extensionsKnown: report.facts?.extensionsKnown,
      error: report.facts?.error,
    },
    checks: report.checks.map((check) => ({
      id: check.id,
      title: check.title,
      rating: check.rating,
      summary: check.summary,
    })),
  });
  if (serialized.length > MAX_REPORT_CHARS) {
    return { ok: false, status: 413, error: "The report is too large to explain." };
  }
  return { ok: true, report, serialized };
}

export interface GeminiClient {
  generate(serialized: string, model: string, apiKey: string): Promise<string>;
}

export async function callGemini(
  serialized: string,
  model: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: `Explain this report:\n${serialized}` }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.2 },
    }),
  });
  if (!response.ok) {
    throw new Error("The explanation service is unavailable right now.");
  }
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error("The explanation service returned an empty response.");
  return text;
}

export async function handleExplainHttp(
  req: HttpRequest,
  res: HttpResponse,
  deps: { env?: EnvMap; generate?: typeof callGemini; now?: number } = {},
): Promise<void> {
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
  const prepared = prepareExplainPayload((body.value ?? {}) as ExplainInput);
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
