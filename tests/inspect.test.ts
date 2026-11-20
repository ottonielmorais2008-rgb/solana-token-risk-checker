import { afterEach, describe, expect, it } from "vitest";
import { handleInspectHttp } from "../src/lib/inspect-http";
import { inspectMint } from "../src/lib/inspect";
import { resetRateLimit } from "../src/lib/rate-limit";
import { ENDPOINTS, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "../src/lib/rpc";
import type { HttpResponse } from "../src/lib/http";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

afterEach(() => {
  resetRateLimit();
});

function mockFetch(handler: (url: string, body: { method: string; params: unknown[] }) => Response | Promise<Response>) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method: string; params: unknown[] };
    return handler(url, body);
  };
}

function jsonResult(result: unknown, status = 200): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mintAccount(overrides: Record<string, unknown> = {}) {
  return jsonResult({
    value: {
      owner: TOKEN_PROGRAM,
      data: {
        program: "spl-token",
        parsed: {
          type: "mint",
          info: {
            decimals: 6,
            supply: "1000000000",
            mintAuthority: null,
            freezeAuthority: null,
            isInitialized: true,
            ...overrides,
          },
        },
      },
    },
  });
}

function successfulRpc(overrides: Record<string, unknown> = {}) {
  return mockFetch((_url, body) => {
    if (body.method === "getAccountInfo") return mintAccount(overrides);
    if (body.method === "getTokenSupply") {
      return jsonResult({ value: { amount: "1000000000", decimals: 6, uiAmount: 1000, uiAmountString: "1000" } });
    }
    if (body.method === "getTokenLargestAccounts") {
      return jsonResult({
        value: [
          { address: "Hold1111111111111111111111111111111", amount: "10000000", decimals: 6, uiAmount: 10 },
          { address: "Hold2222222222222222222222222222222", amount: "5000000", decimals: 6, uiAmount: 5 },
        ],
      });
    }
    return jsonResult(null, 500);
  });
}

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
  return {
    res,
    read: () => ({ status, body }),
  };
}

describe("inspectMint", () => {
  it("returns a scored report for a parsed mint", async () => {
    const result = await inspectMint({ mint: USDC, cluster: "mainnet" }, { fetch: successfulRpc(), sleep: async () => {} });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.mint).toBe(USDC);
    expect(result.report.overall).toBe("pass");
    expect(result.report.facts.supplyUi).toBe("1000");
    expect(result.report.facts.holders).toHaveLength(2);
    expect(result.report.checks).toHaveLength(5);
  });

  it("rejects an invalid address and an invalid cluster", async () => {
    const badMint = await inspectMint({ mint: "not-an-address" });
    expect(badMint).toMatchObject({ ok: false, status: 400 });
    const badCluster = await inspectMint({ mint: USDC, cluster: "mainnet-beta" });
    expect(badCluster).toMatchObject({ ok: false, status: 400 });
  });

  it("defaults the cluster to mainnet and uses those endpoints", async () => {
    const seen: string[] = [];
    const fetchFn = mockFetch((url, body) => {
      seen.push(url);
      if (body.method === "getAccountInfo") return mintAccount();
      if (body.method === "getTokenSupply") {
        return jsonResult({ value: { amount: "1", decimals: 0, uiAmount: 1, uiAmountString: "1" } });
      }
      return jsonResult({ value: [] });
    });
    await inspectMint({ mint: USDC }, { fetch: fetchFn, sleep: async () => {} });
    expect(seen.every((url) => url === ENDPOINTS.mainnet[0] || url === ENDPOINTS.mainnet[1])).toBe(true);
  });

  it("marks every check Unknown when the account lookup fails, and never as safe", async () => {
    const fetchFn = mockFetch(() => new Response("nope", { status: 500 }));
    const result = await inspectMint({ mint: USDC }, { fetch: fetchFn, sleep: async () => {}, retries: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.overall).toBe("unknown");
    expect(result.report.checks.every((check) => check.rating === "unknown")).toBe(true);
    expect(result.report.facts.error).toBeTruthy();
  });

  it("keeps authority scores when largest accounts fail and marks concentration Unknown", async () => {
    const fetchFn = mockFetch((_url, body) => {
      if (body.method === "getAccountInfo") return mintAccount({ mintAuthority: "Auth1111111111111111111111111111111" });
      if (body.method === "getTokenSupply") {
        return jsonResult({ value: { amount: "1000", decimals: 6, uiAmount: 0.001, uiAmountString: "0.001" } });
      }
      return new Response("limited", { status: 429 });
    });
    const result = await inspectMint({ mint: USDC }, { fetch: fetchFn, sleep: async () => {}, retries: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = Object.fromEntries(result.report.checks.map((check) => [check.id, check.rating]));
    expect(byId.mint_authority).toBe("risk");
    expect(byId.holder_concentration).toBe("unknown");
    expect(result.report.overall).toBe("risk");
  });

  it("treats a missing account and a non-mint account as unknown, not safe", async () => {
    const missing = await inspectMint(
      { mint: USDC },
      { fetch: mockFetch(() => jsonResult({ value: null })), sleep: async () => {} },
    );
    expect(missing.ok && missing.report.overall).toBe("unknown");

    const notMint = await inspectMint(
      { mint: USDC },
      {
        fetch: mockFetch(() =>
          jsonResult({
            value: { owner: "11111111111111111111111111111111", data: { parsed: { type: "account", info: {} } } },
          }),
        ),
        sleep: async () => {},
      },
    );
    expect(notMint.ok && notMint.report.overall).toBe("unknown");
    expect(notMint.ok && notMint.report.facts.error).toMatch(/not a parsed token mint/i);
  });

  it("retries a 429 and then succeeds on the next attempt", async () => {
    let calls = 0;
    const fetchFn = mockFetch((_url, body) => {
      if (body.method === "getAccountInfo") {
        calls += 1;
        if (calls === 1) return new Response("slow down", { status: 429 });
        return mintAccount();
      }
      if (body.method === "getTokenSupply") {
        return jsonResult({ value: { amount: "1000000000", decimals: 6, uiAmount: 1000, uiAmountString: "1000" } });
      }
      return jsonResult({ value: [] });
    });
    const result = await inspectMint({ mint: USDC }, { fetch: fetchFn, sleep: async () => {} });
    expect(result.ok && result.report.facts.authoritiesKnown).toBe(true);
    expect(calls).toBe(2);
  });

  it("scores a Token-2022 mint with a permanent delegate as Risk", async () => {
    const fetchFn = mockFetch((_url, body) => {
      if (body.method === "getAccountInfo") {
        return jsonResult({
          value: {
            owner: TOKEN_2022_PROGRAM,
            data: {
              program: "spl-token-2022",
              parsed: {
                type: "mint",
                info: {
                  decimals: 6,
                  supply: "10",
                  mintAuthority: null,
                  freezeAuthority: null,
                  extensions: [{ extension: "permanentDelegate", state: { delegate: "Del11111111111111111111111111111111" } }],
                },
              },
            },
          },
        });
      }
      if (body.method === "getTokenSupply") {
        return jsonResult({ value: { amount: "10", decimals: 6, uiAmount: 0.00001, uiAmountString: "0.00001" } });
      }
      return jsonResult({ value: [{ address: "Hold1111111111111111111111111111111", amount: "10", decimals: 6, uiAmount: 0.00001 }] });
    });
    const result = await inspectMint({ mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo" }, { fetch: fetchFn, sleep: async () => {} });
    expect(result.ok && result.report.facts.programKind).toBe("spl-token-2022");
    expect(result.ok && result.report.overall).toBe("risk");
  });
});

describe("handleInspectHttp", () => {
  it("rejects non-POST methods and invalid JSON", async () => {
    const get = collect();
    await handleInspectHttp({ method: "GET", headers: {} }, get.res);
    expect(get.read().status).toBe(405);

    const bad = collect();
    await handleInspectHttp({ method: "POST", headers: { "x-forwarded-for": "1.1.1.1" }, body: "not-json" }, bad.res);
    expect(bad.read().status).toBe(400);
  });

  it("rate-limits repeated inspect requests from the same IP", async () => {
    const fetchFn = successfulRpc();
    let blocked = 0;
    for (let i = 0; i < 32; i += 1) {
      const box = collect();
      await handleInspectHttp(
        { method: "POST", headers: { "x-forwarded-for": "8.8.8.8" }, body: { mint: USDC } },
        box.res,
        { fetch: fetchFn, sleep: async () => {} },
      );
      if (box.read().status === 429) blocked += 1;
    }
    expect(blocked).toBeGreaterThan(0);
  });
});
