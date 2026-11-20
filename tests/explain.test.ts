import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  getGeminiApiKey,
  handleExplainHttp,
  MAX_REPORT_CHARS,
  prepareExplainPayload,
  SYSTEM,
} from "../src/lib/explain";
import { resetRateLimit } from "../src/lib/rate-limit";
import { buildReport } from "../src/lib/scoring";
import type { HttpResponse } from "../src/lib/http";
import type { TokenFacts } from "../src/lib/types";

const facts: TokenFacts = {
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  cluster: "mainnet",
  programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  programKind: "spl-token",
  decimals: 6,
  supplyRaw: "1000",
  supplyUi: "0.001",
  mintAuthority: "Auth1111111111111111111111111111111",
  freezeAuthority: null,
  authoritiesKnown: true,
  holders: [{ address: "Hold1111111111111111111111111111111", amount: "1000", percent: 100 }],
  holdersKnown: true,
  extensions: [],
  extensionsKnown: true,
};

const report = buildReport(facts);

afterEach(() => {
  resetRateLimit();
});

function collect() {
  let status = 0;
  let body: unknown;
  const res: HttpResponse = {
    status(code) {
      status = code;
      return res;
    },
    json(value) {
      body = value;
    },
    setHeader() {},
  };
  return { res, read: () => ({ status, body: body as Record<string, unknown> }) };
}

describe("prepareExplainPayload", () => {
  it("accepts a scored report and keeps the cap well below a large dump", () => {
    const prepared = prepareExplainPayload({ report });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.serialized.length).toBeLessThan(MAX_REPORT_CHARS);
    expect(prepared.serialized).toContain("mint_authority");
  });

  it("rejects a missing or incomplete report", () => {
    expect(prepareExplainPayload({}).ok).toBe(false);
    expect(prepareExplainPayload({ report: { mint: "bad" } }).ok).toBe(false);
    expect(prepareExplainPayload({ report: { mint: report.mint, overall: "risk" } }).ok).toBe(false);
  });
});

describe("handleExplainHttp", () => {
  it("returns 503 when no API key is configured and does not mention any key in the error", async () => {
    const box = collect();
    await handleExplainHttp(
      { method: "POST", headers: { "x-forwarded-for": "9.9.9.9" }, body: { report } },
      box.res,
      { env: {} },
    );
    const { status, body } = box.read();
    expect(status).toBe(503);
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/aiza|aq\.|api[_-]?key|gemini_key/);
  });

  it("rate-limits explanation requests", async () => {
    let limited = 0;
    for (let i = 0; i < 8; i += 1) {
      const box = collect();
      await handleExplainHttp(
        { method: "POST", headers: { "x-forwarded-for": "2.2.2.2" }, body: { report } },
        box.res,
        { env: { GOOGLE_GENERATIVE_AI_API_KEY: "test-key" }, generate: async () => "ok" },
      );
      if (box.read().status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it("returns an explanation and the configured model", async () => {
    const box = collect();
    await handleExplainHttp(
      { method: "POST", headers: { "x-forwarded-for": "3.3.3.3" }, body: { report } },
      box.res,
      {
        env: { GOOGLE_GENERATIVE_AI_API_KEY: "test-key", GOOGLE_MODEL: DEFAULT_MODEL },
        generate: async (serialized, model, apiKey) => {
          expect(apiKey).toBe("test-key");
          expect(model).toBe(DEFAULT_MODEL);
          expect(serialized).toContain("risk");
          return "Mint authority is still active. Unknown findings stay unknown.";
        },
      },
    );
    const { status, body } = box.read();
    expect(status).toBe(200);
    expect(body.explanation).toMatch(/Mint authority/);
    expect(body.model).toBe(DEFAULT_MODEL);
  });
});

describe("Gemini helpers", () => {
  it("reads the key from known env names and ignores blanks", () => {
    expect(getGeminiApiKey({})).toBeUndefined();
    expect(getGeminiApiKey({ GEMINI_API_KEY: "  " })).toBeUndefined();
    expect(getGeminiApiKey({ GEMINI_API_KEY: "abc" })).toBe("abc");
  });

  it("instructs the model never to upgrade Unknown to safe and not to give financial advice", () => {
    expect(SYSTEM).toMatch(/not financial advice/i);
    expect(SYSTEM).toMatch(/unknown/i);
    expect(SYSTEM).toMatch(/not the same as safe/i);
  });
});
