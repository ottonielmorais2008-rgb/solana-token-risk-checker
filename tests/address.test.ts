import { describe, expect, it } from "vitest";
import { base58Decode, isSolanaAddress, parseMintAddress } from "../src/lib/address";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

describe("isSolanaAddress", () => {
  it("accepts well-known 32-byte mint addresses", () => {
    expect(isSolanaAddress(USDC)).toBe(true);
    expect(isSolanaAddress(BONK)).toBe(true);
  });

  it("rejects empty, short, long, and invalid base58 strings", () => {
    expect(isSolanaAddress("")).toBe(false);
    expect(isSolanaAddress("short")).toBe(false);
    expect(isSolanaAddress("1".repeat(45))).toBe(false);
    expect(isSolanaAddress("0".repeat(44))).toBe(false);
    expect(isSolanaAddress("O".repeat(44))).toBe(false);
    expect(isSolanaAddress("I".repeat(44))).toBe(false);
    expect(isSolanaAddress("l".repeat(44))).toBe(false);
  });

  it("rejects valid base58 that does not decode to 32 bytes", () => {
    const thirtyOneOnes = "1".repeat(31);
    expect(isSolanaAddress(thirtyOneOnes)).toBe(false);
    expect(base58Decode(thirtyOneOnes)?.length).toBe(31);
  });
});

describe("parseMintAddress", () => {
  it("trims whitespace and returns the mint", () => {
    expect(parseMintAddress(`  ${USDC}  `)).toEqual({ ok: true, mint: USDC });
  });

  it("rejects non-strings and blank input", () => {
    expect(parseMintAddress(null).ok).toBe(false);
    expect(parseMintAddress(123).ok).toBe(false);
    expect(parseMintAddress("   ").ok).toBe(false);
  });
});
