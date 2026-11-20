import { describe, expect, it } from "vitest";
import {
  buildChecks,
  buildReport,
  overallRating,
  scoreConcentration,
  scoreFreezeAuthority,
  scoreMintAuthority,
  TOP10_RISK_PERCENT,
  TOP1_RISK_PERCENT,
  TOP1_WARN_PERCENT,
} from "../src/lib/scoring.js";
import type { Holder, TokenFacts } from "../src/lib/types.js";

const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function facts(overrides: Partial<TokenFacts> = {}): TokenFacts {
  return {
    mint,
    cluster: "mainnet",
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    programKind: "spl-token",
    decimals: 6,
    supplyRaw: "1000000",
    supplyUi: "1",
    mintAuthority: null,
    freezeAuthority: null,
    authoritiesKnown: true,
    holders: [{ address: "11111111111111111111111111111111", amount: "10000", percent: 1 }],
    holdersKnown: true,
    extensions: [],
    extensionsKnown: true,
    ...overrides,
  };
}

function holders(percents: number[]): Holder[] {
  return percents.map((percent, index) => ({
    address: `holder-${index}`,
    amount: "1",
    percent,
  }));
}

describe("mint and freeze authority scoring", () => {
  it("rates an active mint authority as Risk and a revoked one as Pass", () => {
    expect(scoreMintAuthority(facts({ mintAuthority: "Auth1111111111111111111111111111111" })).rating).toBe("risk");
    expect(scoreMintAuthority(facts({ mintAuthority: null })).rating).toBe("pass");
  });

  it("rates a missing mint authority as Unknown, never as safe", () => {
    const result = scoreMintAuthority(facts({ authoritiesKnown: false, mintAuthority: undefined }));
    expect(result.rating).toBe("unknown");
    expect(result.summary.toLowerCase()).toContain("unknown");
    expect(result.rating).not.toBe("pass");
  });

  it("rates an active freeze authority as Warn and a revoked one as Pass", () => {
    expect(scoreFreezeAuthority(facts({ freezeAuthority: "Frz11111111111111111111111111111111" })).rating).toBe("warn");
    expect(scoreFreezeAuthority(facts({ freezeAuthority: null })).rating).toBe("pass");
  });

  it("rates a missing freeze authority as Unknown", () => {
    expect(scoreFreezeAuthority(facts({ authoritiesKnown: false })).rating).toBe("unknown");
  });
});

describe("holder concentration scoring", () => {
  it("rates a dominant top holder as Risk", () => {
    const result = scoreConcentration(facts({ holders: holders([TOP1_RISK_PERCENT]), supplyRaw: "100" }));
    expect(result.rating).toBe("risk");
  });

  it("rates a moderately large top holder as Warn", () => {
    const result = scoreConcentration(facts({ holders: holders([TOP1_WARN_PERCENT]), supplyRaw: "100" }));
    expect(result.rating).toBe("warn");
  });

  it("rates a highly concentrated top 10 as Risk even when no single wallet is dominant", () => {
    const result = scoreConcentration(facts({ holders: holders(Array(10).fill(9)), supplyRaw: "100" }));
    expect(result.rating).toBe("risk");
    expect(TOP10_RISK_PERCENT).toBe(90);
  });

  it("rates a distributed set of holders as Pass", () => {
    const result = scoreConcentration(facts({ holders: holders([5, 4, 3, 2, 1]), supplyRaw: "100" }));
    expect(result.rating).toBe("pass");
  });

  it("rates missing accounts, missing supply, or zero supply as Unknown", () => {
    expect(scoreConcentration(facts({ holdersKnown: false, holders: null })).rating).toBe("unknown");
    expect(scoreConcentration(facts({ supplyRaw: null })).rating).toBe("unknown");
    expect(scoreConcentration(facts({ supplyRaw: "0" })).rating).toBe("unknown");
  });
});

describe("overall rating", () => {
  it("is Risk if any check is Risk", () => {
    const checks = buildChecks(facts({ mintAuthority: "Auth1111111111111111111111111111111" }));
    expect(overallRating(checks)).toBe("risk");
  });

  it("is Warn when there is a warning and no risk", () => {
    const checks = buildChecks(facts({ freezeAuthority: "Frz11111111111111111111111111111111" }));
    expect(overallRating(checks)).toBe("warn");
  });

  it("is Unknown when remaining checks passed but something could not be read", () => {
    const checks = buildChecks(facts({ holdersKnown: false, holders: null }));
    expect(overallRating(checks)).toBe("unknown");
    expect(overallRating(checks)).not.toBe("pass");
  });

  it("is Pass only when every check passed", () => {
    expect(buildReport(facts()).overall).toBe("pass");
  });
});
