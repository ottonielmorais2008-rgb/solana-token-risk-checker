import { parseMintAddress } from "./address.js";
import { isCluster, loadMintFacts, type LoadMintDeps } from "./rpc.js";
import { buildReport } from "./scoring.js";
import type { Cluster, RiskReport } from "./types.js";

export interface InspectRequest {
  mint?: unknown;
  cluster?: unknown;
}

export type InspectOutcome =
  | { ok: true; report: RiskReport }
  | { ok: false; status: number; error: string };

export async function inspectMint(
  input: InspectRequest,
  deps: LoadMintDeps = {},
): Promise<InspectOutcome> {
  const parsed = parseMintAddress(input.mint);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  const cluster: Cluster = input.cluster == null ? "mainnet" : (input.cluster as Cluster);
  if (!isCluster(cluster)) {
    return { ok: false, status: 400, error: "Cluster must be mainnet or devnet." };
  }

  const facts = await loadMintFacts(parsed.mint, cluster, deps);
  return { ok: true, report: buildReport(facts) };
}
