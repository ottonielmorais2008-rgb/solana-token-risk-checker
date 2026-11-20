import { describe, expect, it } from "vitest";
import { assessExtension, assessExtensions, extensionsRating } from "../src/lib/extensions.js";
import { scoreExtensions, scoreTokenProgram } from "../src/lib/scoring.js";
import type { TokenFacts } from "../src/lib/types.js";

const base: TokenFacts = {
  mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  cluster: "mainnet",
  programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  programKind: "spl-token-2022",
  decimals: 6,
  supplyRaw: "1",
  supplyUi: "1",
  mintAuthority: null,
  freezeAuthority: null,
  authoritiesKnown: true,
  holders: [],
  holdersKnown: true,
  extensions: [],
  extensionsKnown: true,
};

describe("token program and extensions", () => {
  it("passes classic SPL Token and reports no extensions", () => {
    const classic = { ...base, programKind: "spl-token" as const, programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" };
    expect(scoreTokenProgram(classic).rating).toBe("pass");
    expect(scoreExtensions(classic).rating).toBe("pass");
  });

  it("warns on Token-2022 even when extensions are only informational", () => {
    const facts = {
      ...base,
      extensions: [{ name: "metadataPointer", rating: "pass" as const, summary: "Informational extension: metadataPointer." }],
    };
    expect(scoreTokenProgram(facts).rating).toBe("warn");
    expect(scoreExtensions(facts).rating).toBe("pass");
  });

  it("rates a permanent delegate and a transfer hook as Risk", () => {
    expect(assessExtension({ extension: "permanentDelegate", state: { delegate: "Del11111111111111111111111111111111" } }).rating).toBe(
      "risk",
    );
    expect(assessExtension({ extension: "transferHook", state: { programId: "Hook1111111111111111111111111111111" } }).rating).toBe(
      "risk",
    );
  });

  it("rates a frozen default account state as Risk and a transfer fee as Warn", () => {
    expect(assessExtension({ extension: "defaultAccountState", state: { accountState: "frozen" } }).rating).toBe("risk");
    expect(
      assessExtension({
        extension: "transferFeeConfig",
        state: { newerTransferFee: { transferFeeBasisPoints: 150 } },
      }).rating,
    ).toBe("warn");
  });

  it("treats unreadable Token-2022 extensions as Unknown, not safe", () => {
    expect(assessExtensions({ not: "an array" }).known).toBe(false);
    expect(extensionsRating(null, false)).toBe("unknown");
    expect(scoreExtensions({ ...base, extensionsKnown: false, extensions: null }).rating).toBe("unknown");
  });

  it("treats an unknown token program as Unknown", () => {
    expect(scoreTokenProgram({ ...base, programKind: "unknown", programId: "11111111111111111111111111111111" }).rating).toBe(
      "unknown",
    );
  });
});
