import { describe, expect, it } from "vitest";
import { formatUiAmount, holderPercent, ratingLabel, shortAddress } from "../src/lib/format";

describe("format helpers", () => {
  it("shortens long addresses and leaves short ones alone", () => {
    expect(shortAddress("abcd")).toBe("abcd");
    expect(shortAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 4)).toBe("EPjF…Dt1v");
  });

  it("formats token amounts with decimals and grouping", () => {
    expect(formatUiAmount("1000000", 6)).toBe("1");
    expect(formatUiAmount("123456789", 6)).toBe("123.456789");
    expect(formatUiAmount("1000", 0)).toBe("1,000");
    expect(formatUiAmount("nope", 6)).toBe("unknown");
  });

  it("computes holder share with integer math", () => {
    expect(holderPercent(50n, 100n)).toBe(50);
    expect(holderPercent(1n, 3n)).toBe(33.33);
    expect(holderPercent(1n, 0n)).toBe(0);
  });

  it("labels ratings for the report UI", () => {
    expect(ratingLabel("pass")).toBe("Pass");
    expect(ratingLabel("warn")).toBe("Warn");
    expect(ratingLabel("risk")).toBe("Risk");
    expect(ratingLabel("unknown")).toBe("Unknown");
  });
});
