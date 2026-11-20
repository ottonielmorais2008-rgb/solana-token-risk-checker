import { PublicKey } from "@solana/web3.js";
import type { Cluster, ExtensionFinding, Holder, TokenFacts } from "./types.js";
import { assessExtensions } from "./extensions.js";
import { formatUiAmount, holderPercent } from "./format.js";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const ENDPOINTS: Record<Cluster, readonly string[]> = {
  mainnet: ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"],
  devnet: ["https://api.devnet.solana.com"],
};

export function isCluster(value: unknown): value is Cluster {
  return value === "mainnet" || value === "devnet";
}

export interface RpcFailure {
  kind: "rpc";
  status?: number;
  message: string;
}

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcFailure };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface JsonRpcResponse<T> {
  result?: T;
  error?: { code?: number; message?: string };
}

interface ParsedMintInfo {
  decimals?: number;
  supply?: string;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  isInitialized?: boolean;
  extensions?: unknown;
}

interface ParsedAccount {
  program?: string;
  parsed?: { type?: string; info?: ParsedMintInfo };
}

interface AccountInfoResult {
  value: {
    owner: string;
    data: ParsedAccount | unknown;
  } | null;
}

interface TokenAmount {
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString?: string;
}

interface LargestAccountsResult {
  value: { address: string; amount: string; decimals: number; uiAmount: number | null }[];
}

interface TokenSupplyResult {
  value: TokenAmount;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function rpcRequest<T>(
  endpoints: readonly string[],
  method: string,
  params: unknown[],
  options: { fetch?: FetchLike; retries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RpcResult<T>> {
  const fetchFn = options.fetch ?? fetch;
  const retries = options.retries ?? 2;
  const pause = options.sleep ?? sleep;
  let lastMessage = "The Solana RPC request failed.";
  let lastStatus: number | undefined;

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetchFn(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "solana-token-risk-checker/1.0",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        lastStatus = response.status;
        if (RETRYABLE.has(response.status)) {
          lastMessage =
            response.status === 429
              ? "The public RPC is rate-limited. Please wait a moment and try again."
              : `The public RPC returned HTTP ${response.status}.`;
          await pause(200 * 2 ** attempt);
          continue;
        }
        if (!response.ok) {
          lastMessage = `The public RPC returned HTTP ${response.status}.`;
          break;
        }
        const payload = (await response.json()) as JsonRpcResponse<T>;
        if (payload.error) {
          lastMessage = payload.error.message ?? "The public RPC returned an error.";
          break;
        }
        if (payload.result === undefined) {
          lastMessage = "The public RPC returned an empty result.";
          break;
        }
        return { ok: true, value: payload.result };
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : "The public RPC request failed.";
        await pause(200 * 2 ** attempt);
      }
    }
  }

  return { ok: false, error: { kind: "rpc", status: lastStatus, message: lastMessage } };
}

export function programKindFromOwner(owner: string | null | undefined): TokenFacts["programKind"] {
  if (owner === TOKEN_PROGRAM) return "spl-token";
  if (owner === TOKEN_2022_PROGRAM) return "spl-token-2022";
  return "unknown";
}

export function holdersFromLargest(
  accounts: LargestAccountsResult["value"] | null | undefined,
  supplyRaw: string | null,
): { holders: Holder[]; known: boolean } {
  if (!accounts || supplyRaw == null || !/^\d+$/.test(supplyRaw)) {
    return { holders: [], known: false };
  }
  const supply = BigInt(supplyRaw);
  const holders = accounts.slice(0, 10).map((account) => ({
    address: account.address,
    amount: account.amount,
    percent: holderPercent(BigInt(account.amount), supply),
  }));
  return { holders, known: true };
}

export function factsFromParsedAccount(
  mint: string,
  cluster: Cluster,
  owner: string,
  parsed: ParsedAccount | unknown,
  largest: LargestAccountsResult["value"] | null,
  largestKnown: boolean,
  supplyOverride: TokenAmount | null,
): TokenFacts {
  const data = isParsedAccount(parsed) ? parsed : null;
  const info = data?.parsed?.type === "mint" ? data.parsed.info : undefined;
  const programKind = programKindFromOwner(owner);
  const decimals = supplyOverride?.decimals ?? info?.decimals ?? null;
  const supplyRaw = supplyOverride?.amount ?? info?.supply ?? null;
  const extensionsSource = info?.extensions;
  let extensions: ExtensionFinding[] | null = null;
  let extensionsKnown = false;
  if (programKind === "spl-token") {
    extensions = [];
    extensionsKnown = true;
  } else if (programKind === "spl-token-2022") {
    const assessed = assessExtensions(extensionsSource ?? []);
    extensions = assessed.findings;
    extensionsKnown = assessed.known;
  }

  const holdersResult = largestKnown ? holdersFromLargest(largest, supplyRaw) : { holders: [], known: false };

  return {
    mint,
    cluster,
    programId: owner,
    programKind,
    decimals,
    supplyRaw,
    supplyUi:
      supplyRaw != null && decimals != null
        ? (supplyOverride?.uiAmountString ?? formatUiAmount(supplyRaw, decimals))
        : null,
    mintAuthority: info ? info.mintAuthority ?? null : undefined,
    freezeAuthority: info ? info.freezeAuthority ?? null : undefined,
    authoritiesKnown: Boolean(info),
    holders: holdersResult.known ? holdersResult.holders : null,
    holdersKnown: holdersResult.known,
    extensions,
    extensionsKnown,
  };
}

function isParsedAccount(value: unknown): value is ParsedAccount {
  return Boolean(value && typeof value === "object" && "parsed" in (value as object));
}

export interface LoadMintDeps {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  retries?: number;
}

export async function loadMintFacts(mint: string, cluster: Cluster, deps: LoadMintDeps = {}): Promise<TokenFacts> {
  const endpoints = ENDPOINTS[cluster];
  const options = { fetch: deps.fetch, sleep: deps.sleep, retries: deps.retries };
  const pubkey = new PublicKey(mint).toBase58();

  const account = await rpcRequest<AccountInfoResult>(
    endpoints,
    "getAccountInfo",
    [pubkey, { encoding: "jsonParsed", commitment: "confirmed" }],
    options,
  );

  if (!account.ok) {
    return unknownFacts(mint, cluster, account.error.message);
  }
  if (!account.value.value) {
    return unknownFacts(mint, cluster, "No account was found at that address.");
  }

  const owner = account.value.value.owner;
  const parsed = account.value.value.data;
  const data = isParsedAccount(parsed) ? parsed : null;
  if (!data || data.parsed?.type !== "mint") {
    return {
      ...unknownFacts(mint, cluster, "That account is not a parsed token mint."),
      programId: owner,
      programKind: programKindFromOwner(owner),
    };
  }

  const [supply, largest] = await Promise.all([
    rpcRequest<TokenSupplyResult>(endpoints, "getTokenSupply", [pubkey], options),
    rpcRequest<LargestAccountsResult>(endpoints, "getTokenLargestAccounts", [pubkey], options),
  ]);

  const facts = factsFromParsedAccount(
    mint,
    cluster,
    owner,
    parsed,
    largest.ok ? largest.value.value : null,
    largest.ok,
    supply.ok ? supply.value.value : null,
  );

  const errors: string[] = [];
  if (!supply.ok) errors.push(`Supply: ${supply.error.message}`);
  if (!largest.ok) errors.push(`Largest accounts: ${largest.error.message}`);
  if (errors.length) facts.error = errors.join(" ");
  return facts;
}

export function unknownFacts(mint: string, cluster: Cluster, error: string): TokenFacts {
  return {
    mint,
    cluster,
    programId: null,
    programKind: "unknown",
    decimals: null,
    supplyRaw: null,
    supplyUi: null,
    mintAuthority: undefined,
    freezeAuthority: undefined,
    authoritiesKnown: false,
    holders: null,
    holdersKnown: false,
    extensions: null,
    extensionsKnown: false,
    error,
  };
}
