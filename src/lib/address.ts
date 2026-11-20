const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Decodes a base58 string to bytes, or returns null if it has invalid characters. */
export function base58Decode(input: string): Uint8Array | null {
  let value = 0n;
  for (const ch of input) {
    const digit = BASE58.indexOf(ch);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
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

/** A Solana public key is 32 bytes encoded in base58 (32–44 characters). */
export function isSolanaAddress(input: string): boolean {
  if (input.length < 32 || input.length > 44) return false;
  return base58Decode(input)?.length === 32;
}

export function parseMintAddress(raw: unknown): { ok: true; mint: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Paste a Solana token mint address." };
  }
  const mint = raw.trim();
  if (!mint) return { ok: false, error: "Paste a Solana token mint address." };
  if (!isSolanaAddress(mint)) {
    return {
      ok: false,
      error: "That is not a valid Solana address. It should be a 32-byte public key in base58.",
    };
  }
  return { ok: true, mint };
}
