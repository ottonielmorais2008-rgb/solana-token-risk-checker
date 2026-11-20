import type { Cluster } from "./types.js";

export interface ExampleMint {
  symbol: string;
  name: string;
  mint: string;
  cluster: Cluster;
  note: string;
}

export const EXAMPLE_MINTS: ExampleMint[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    cluster: "mainnet",
    note: "Classic SPL token. Mint and freeze authorities are typically still active on a regulated stablecoin.",
  },
  {
    symbol: "BONK",
    name: "Bonk",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    cluster: "mainnet",
    note: "Classic SPL memecoin often used to inspect revoked authorities and holder spread.",
  },
  {
    symbol: "PYUSD",
    name: "PayPal USD",
    mint: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
    cluster: "mainnet",
    note: "Token-2022 stablecoin, useful for inspecting extensions.",
  },
];
