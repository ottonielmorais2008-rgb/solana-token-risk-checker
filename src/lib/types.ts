export type Rating = "pass" | "warn" | "risk" | "unknown";

export type Cluster = "mainnet" | "devnet";

export type CheckId =
  | "mint_authority"
  | "freeze_authority"
  | "holder_concentration"
  | "token_program"
  | "extensions";

export interface CheckResult {
  id: CheckId;
  title: string;
  rating: Rating;
  summary: string;
  detail?: string;
}

export interface Holder {
  address: string;
  amount: string;
  percent: number;
}

export interface ExtensionFinding {
  name: string;
  rating: Rating;
  summary: string;
}

export interface TokenFacts {
  mint: string;
  cluster: Cluster;
  programId: string | null;
  programKind: "spl-token" | "spl-token-2022" | "unknown";
  decimals: number | null;
  supplyRaw: string | null;
  supplyUi: string | null;
  mintAuthority: string | null | undefined;
  freezeAuthority: string | null | undefined;
  authoritiesKnown: boolean;
  holders: Holder[] | null;
  holdersKnown: boolean;
  extensions: ExtensionFinding[] | null;
  extensionsKnown: boolean;
  error?: string;
}

export interface RiskReport {
  mint: string;
  cluster: Cluster;
  overall: Rating;
  facts: TokenFacts;
  checks: CheckResult[];
  fetchedAt: string;
}

export const RATING_RANK: Record<Rating, number> = {
  pass: 0,
  unknown: 1,
  warn: 2,
  risk: 3,
};
