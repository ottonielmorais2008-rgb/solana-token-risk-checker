export function shortAddress(address: string, size = 4): string {
  if (address.length <= size * 2 + 3) return address;
  return `${address.slice(0, size)}…${address.slice(-size)}`;
}

export function formatUiAmount(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) return "unknown";
  if (decimals < 0 || decimals > 18) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  if (decimals === 0) return groupInteger(padded);
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return frac ? `${groupInteger(whole)}.${frac}` : groupInteger(whole);
}

function groupInteger(value: string): string {
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}

export function holderPercent(amount: bigint, supply: bigint): number {
  if (supply <= 0n) return 0;
  const bps = (amount * 10000n) / supply;
  return Number(bps) / 100;
}

export function ratingLabel(rating: "pass" | "warn" | "risk" | "unknown"): string {
  switch (rating) {
    case "pass":
      return "Pass";
    case "warn":
      return "Warn";
    case "risk":
      return "Risk";
    default:
      return "Unknown";
  }
}

export function explorerMintUrl(mint: string, cluster: "mainnet" | "devnet"): string {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://solscan.io/token/${mint}${suffix}`;
}

export function explorerAccountUrl(address: string, cluster: "mainnet" | "devnet"): string {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://solscan.io/account/${address}${suffix}`;
}
