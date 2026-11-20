// src/lib/rate-limit.ts
var hits = /* @__PURE__ */ new Map();
function allow(key, limit = 20, windowMs = 6e4, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5e3) hits.clear();
  return true;
}
function clientIp(headers, fallback = "unknown") {
  const forwarded = headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value && value.trim()) return value.split(",")[0].trim();
  const real = headers["x-real-ip"];
  const realValue = Array.isArray(real) ? real[0] : real;
  if (realValue && realValue.trim()) return realValue.trim();
  return fallback;
}

// src/lib/http.ts
var MAX_BODY_BYTES = 16384;
function methodOf(req) {
  return (req.method ?? "GET").toUpperCase();
}
function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}
function byteLength(value) {
  return new TextEncoder().encode(value).length;
}
function tooLarge(req, max = MAX_BODY_BYTES) {
  const length = header(req, "content-length");
  if (length && Number(length) > max) return true;
  if (typeof req.body === "string" && byteLength(req.body) > max) return true;
  return false;
}
function readJsonBody(req) {
  if (req.body == null || req.body === "") {
    return { ok: false, error: "Invalid JSON body." };
  }
  if (typeof req.body === "string") {
    try {
      return { ok: true, value: JSON.parse(req.body) };
    } catch {
      return { ok: false, error: "Invalid JSON body." };
    }
  }
  return { ok: true, value: req.body };
}
function cors(res) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type");
}

// src/lib/address.ts
var BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(input) {
  let value = 0n;
  for (const ch of input) {
    const digit = BASE58.indexOf(ch);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes = [];
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
function isSolanaAddress(input) {
  if (input.length < 32 || input.length > 44) return false;
  return base58Decode(input)?.length === 32;
}
function parseMintAddress(raw) {
  if (typeof raw !== "string") {
    return { ok: false, error: "Paste a Solana token mint address." };
  }
  const mint = raw.trim();
  if (!mint) return { ok: false, error: "Paste a Solana token mint address." };
  if (!isSolanaAddress(mint)) {
    return {
      ok: false,
      error: "That is not a valid Solana address. It should be a 32-byte public key in base58."
    };
  }
  return { ok: true, mint };
}

// src/lib/extensions.ts
var INFORMATIONAL = /* @__PURE__ */ new Set([
  "metadataPointer",
  "tokenMetadata",
  "metadata",
  "groupPointer",
  "groupMemberPointer",
  "tokenGroup",
  "tokenGroupMember",
  "mintCloseAuthority"
]);
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function feeBps(state) {
  const newer = state?.newerTransferFee;
  const older = state?.olderTransferFee;
  const from = newer && typeof newer === "object" ? newer.transferFeeBasisPoints : void 0;
  const fallback = older && typeof older === "object" ? older.transferFeeBasisPoints : void 0;
  const raw = from ?? fallback ?? state?.transferFeeBasisPoints;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return null;
}
function assessExtension(entry) {
  const name = entry.extension ?? "unknown";
  const state = entry.state ?? {};
  switch (name) {
    case "permanentDelegate": {
      const delegate = asString(state.delegate) ?? asString(state.permanentDelegate);
      if (!delegate) {
        return {
          name,
          rating: "unknown",
          summary: "A permanent delegate extension is present, but the delegate address could not be read."
        };
      }
      return {
        name,
        rating: "risk",
        summary: `A permanent delegate (${delegate}) can transfer or burn tokens from any account.`
      };
    }
    case "transferHook": {
      const programId = asString(state.programId) ?? asString(state.hook) ?? "unknown program";
      return {
        name,
        rating: "risk",
        summary: `A transfer hook (${programId}) runs on every transfer and can block or alter it.`
      };
    }
    case "defaultAccountState": {
      const accountState = String(state.accountState ?? state.state ?? "").toLowerCase();
      if (accountState === "frozen") {
        return {
          name,
          rating: "risk",
          summary: "New token accounts are frozen by default until the freeze authority thaws them."
        };
      }
      if (!accountState) {
        return {
          name,
          rating: "unknown",
          summary: "A default account state extension is present, but the state could not be read."
        };
      }
      return {
        name,
        rating: "warn",
        summary: `New token accounts start in the "${accountState}" state.`
      };
    }
    case "pausable":
    case "pausableConfig": {
      const paused = state.paused === true;
      return {
        name,
        rating: "risk",
        summary: paused ? "This mint is paused: transfers may be blocked." : "This mint can be paused, which would block transfers."
      };
    }
    case "transferFeeConfig": {
      const bps = feeBps(state);
      if (bps === null) {
        return {
          name,
          rating: "unknown",
          summary: "A transfer fee extension is present, but the fee could not be read."
        };
      }
      if (bps === 0) {
        return {
          name,
          rating: "warn",
          summary: "A transfer fee extension is enabled, even though the current fee is 0 basis points and can be changed."
        };
      }
      return {
        name,
        rating: "warn",
        summary: `Transfers are charged a fee of ${bps} basis points (${(bps / 100).toFixed(2)}%).`
      };
    }
    case "confidentialTransferMint":
    case "confidentialTransferFeeConfig": {
      return {
        name,
        rating: "warn",
        summary: "Confidential transfers are enabled, so some balances and transfers may be hidden from a plain RPC view."
      };
    }
    case "interestBearingConfig":
    case "scaledUiAmount":
    case "scaledUiAmountConfig":
    case "scaledUiAmountMint": {
      return {
        name,
        rating: "warn",
        summary: "Displayed amounts can change over time or by a scale factor, so the raw supply may not match what wallets show."
      };
    }
    case "nonTransferable": {
      return {
        name,
        rating: "warn",
        summary: "This token is non-transferable."
      };
    }
    case "mintCloseAuthority": {
      const authority = asString(state.authority) ?? asString(state.closeAuthority);
      return {
        name,
        rating: "warn",
        summary: authority ? `A mint close authority (${authority}) can close this mint account if the supply is zero.` : "A mint close authority is configured and can close this mint account if the supply is zero."
      };
    }
    default: {
      if (INFORMATIONAL.has(name)) {
        return {
          name,
          rating: "pass",
          summary: `Informational extension: ${name}.`
        };
      }
      return {
        name,
        rating: "warn",
        summary: `Unclassified Token-2022 extension "${name}". It was not treated as safe.`
      };
    }
  }
}
function assessExtensions(raw) {
  if (raw == null) return { findings: [], known: true };
  if (!Array.isArray(raw)) return { findings: [], known: false };
  return { findings: raw.map((entry) => assessExtension(entry ?? {})), known: true };
}
function extensionsRating(findings, known) {
  if (!known || findings == null) return "unknown";
  let worst = "pass";
  for (const finding of findings) {
    if (finding.rating === "risk") return "risk";
    if (finding.rating === "warn") worst = "warn";
    if (finding.rating === "unknown" && worst === "pass") worst = "unknown";
  }
  return worst;
}

// src/lib/format.ts
function formatUiAmount(raw, decimals) {
  if (!/^\d+$/.test(raw)) return "unknown";
  if (decimals < 0 || decimals > 18) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  if (decimals === 0) return groupInteger(padded);
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return frac ? `${groupInteger(whole)}.${frac}` : groupInteger(whole);
}
function groupInteger(value) {
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}
function holderPercent(amount, supply) {
  if (supply <= 0n) return 0;
  const bps = amount * 10000n / supply;
  return Number(bps) / 100;
}

// src/lib/rpc.ts
var TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
var TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
var ENDPOINTS = {
  mainnet: ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"],
  devnet: ["https://api.devnet.solana.com"]
};
function isCluster(value) {
  return value === "mainnet" || value === "devnet";
}
var RETRYABLE = /* @__PURE__ */ new Set([429, 500, 502, 503, 504]);
async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
async function rpcRequest(endpoints, method, params, options = {}) {
  const fetchFn = options.fetch ?? fetch;
  const retries = options.retries ?? 2;
  const pause = options.sleep ?? sleep;
  let lastMessage = "The Solana RPC request failed.";
  let lastStatus;
  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetchFn(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "solana-token-risk-checker/1.0"
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
        });
        lastStatus = response.status;
        if (RETRYABLE.has(response.status)) {
          lastMessage = response.status === 429 ? "The public RPC is rate-limited. Please wait a moment and try again." : `The public RPC returned HTTP ${response.status}.`;
          await pause(200 * 2 ** attempt);
          continue;
        }
        if (!response.ok) {
          lastMessage = `The public RPC returned HTTP ${response.status}.`;
          break;
        }
        const payload = await response.json();
        if (payload.error) {
          lastMessage = payload.error.message ?? "The public RPC returned an error.";
          break;
        }
        if (payload.result === void 0) {
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
function programKindFromOwner(owner) {
  if (owner === TOKEN_PROGRAM) return "spl-token";
  if (owner === TOKEN_2022_PROGRAM) return "spl-token-2022";
  return "unknown";
}
function holdersFromLargest(accounts, supplyRaw) {
  if (!accounts || supplyRaw == null || !/^\d+$/.test(supplyRaw)) {
    return { holders: [], known: false };
  }
  const supply = BigInt(supplyRaw);
  const holders = accounts.slice(0, 10).map((account) => ({
    address: account.address,
    amount: account.amount,
    percent: holderPercent(BigInt(account.amount), supply)
  }));
  return { holders, known: true };
}
function factsFromParsedAccount(mint, cluster, owner, parsed, largest, largestKnown, supplyOverride) {
  const data = isParsedAccount(parsed) ? parsed : null;
  const info = data?.parsed?.type === "mint" ? data.parsed.info : void 0;
  const programKind = programKindFromOwner(owner);
  const decimals = supplyOverride?.decimals ?? info?.decimals ?? null;
  const supplyRaw = supplyOverride?.amount ?? info?.supply ?? null;
  const extensionsSource = info?.extensions;
  let extensions = null;
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
    supplyUi: supplyRaw != null && decimals != null ? supplyOverride?.uiAmountString ?? formatUiAmount(supplyRaw, decimals) : null,
    mintAuthority: info ? info.mintAuthority ?? null : void 0,
    freezeAuthority: info ? info.freezeAuthority ?? null : void 0,
    authoritiesKnown: Boolean(info),
    holders: holdersResult.known ? holdersResult.holders : null,
    holdersKnown: holdersResult.known,
    extensions,
    extensionsKnown
  };
}
function isParsedAccount(value) {
  return Boolean(value && typeof value === "object" && "parsed" in value);
}
async function loadMintFacts(mint, cluster, deps = {}) {
  const endpoints = ENDPOINTS[cluster];
  const options = { fetch: deps.fetch, sleep: deps.sleep, retries: deps.retries };
  const pubkey = mint;
  const account = await rpcRequest(
    endpoints,
    "getAccountInfo",
    [pubkey, { encoding: "jsonParsed", commitment: "confirmed" }],
    options
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
      programKind: programKindFromOwner(owner)
    };
  }
  const [supply, largest] = await Promise.all([
    rpcRequest(endpoints, "getTokenSupply", [pubkey], options),
    rpcRequest(endpoints, "getTokenLargestAccounts", [pubkey], options)
  ]);
  const facts = factsFromParsedAccount(
    mint,
    cluster,
    owner,
    parsed,
    largest.ok ? largest.value.value : null,
    largest.ok,
    supply.ok ? supply.value.value : null
  );
  const errors = [];
  if (!supply.ok) errors.push(`Supply: ${supply.error.message}`);
  if (!largest.ok) errors.push(`Largest accounts: ${largest.error.message}`);
  if (errors.length) facts.error = errors.join(" ");
  return facts;
}
function unknownFacts(mint, cluster, error) {
  return {
    mint,
    cluster,
    programId: null,
    programKind: "unknown",
    decimals: null,
    supplyRaw: null,
    supplyUi: null,
    mintAuthority: void 0,
    freezeAuthority: void 0,
    authoritiesKnown: false,
    holders: null,
    holdersKnown: false,
    extensions: null,
    extensionsKnown: false,
    error
  };
}

// src/lib/types.ts
var RATING_RANK = {
  pass: 0,
  unknown: 1,
  warn: 2,
  risk: 3
};

// src/lib/scoring.ts
var TOP1_RISK_PERCENT = 50;
var TOP1_WARN_PERCENT = 20;
var TOP10_RISK_PERCENT = 90;
var TOP10_WARN_PERCENT = 70;
function worstRating(ratings) {
  let worst = "pass";
  for (const rating of ratings) {
    if (RATING_RANK[rating] > RATING_RANK[worst]) worst = rating;
  }
  return worst;
}
function scoreMintAuthority(facts) {
  const title = "Mint authority";
  if (!facts.authoritiesKnown) {
    return {
      id: "mint_authority",
      title,
      rating: "unknown",
      summary: "The mint authority could not be read. Missing data is treated as unknown, not safe."
    };
  }
  if (facts.mintAuthority) {
    return {
      id: "mint_authority",
      title,
      rating: "risk",
      summary: "Mint authority is still active, so new tokens can be created.",
      detail: facts.mintAuthority
    };
  }
  return {
    id: "mint_authority",
    title,
    rating: "pass",
    summary: "Mint authority has been revoked. No further tokens can be minted by an authority key."
  };
}
function scoreFreezeAuthority(facts) {
  const title = "Freeze authority";
  if (!facts.authoritiesKnown) {
    return {
      id: "freeze_authority",
      title,
      rating: "unknown",
      summary: "The freeze authority could not be read. Missing data is treated as unknown, not safe."
    };
  }
  if (facts.freezeAuthority) {
    return {
      id: "freeze_authority",
      title,
      rating: "warn",
      summary: "Freeze authority is still active, so token accounts can be frozen.",
      detail: facts.freezeAuthority
    };
  }
  return {
    id: "freeze_authority",
    title,
    rating: "pass",
    summary: "Freeze authority has been revoked. Accounts cannot be frozen by an authority key."
  };
}
function scoreConcentration(facts) {
  const title = "Holder concentration";
  if (!facts.holdersKnown || facts.holders == null || facts.supplyRaw == null) {
    return {
      id: "holder_concentration",
      title,
      rating: "unknown",
      summary: "Largest accounts or supply could not be read. Concentration is unknown, not safe."
    };
  }
  if (facts.supplyRaw === "0") {
    return {
      id: "holder_concentration",
      title,
      rating: "unknown",
      summary: "Reported supply is zero, so holder shares cannot be calculated."
    };
  }
  const top1 = facts.holders[0]?.percent ?? 0;
  const top10 = facts.holders.reduce((sum, holder) => sum + holder.percent, 0);
  const roundedTop1 = Math.min(100, top1);
  const roundedTop10 = Math.min(100, top10);
  const detail = `Largest account: ${roundedTop1.toFixed(2)}% of supply. Top ${facts.holders.length}: ${roundedTop10.toFixed(2)}%.`;
  if (roundedTop1 >= TOP1_RISK_PERCENT || roundedTop10 >= TOP10_RISK_PERCENT) {
    return {
      id: "holder_concentration",
      title,
      rating: "risk",
      summary: "Supply is highly concentrated in a small number of accounts.",
      detail
    };
  }
  if (roundedTop1 >= TOP1_WARN_PERCENT || roundedTop10 >= TOP10_WARN_PERCENT) {
    return {
      id: "holder_concentration",
      title,
      rating: "warn",
      summary: "A large share of the supply sits in the top accounts.",
      detail
    };
  }
  return {
    id: "holder_concentration",
    title,
    rating: "pass",
    summary: "The largest accounts do not concentrate a warning-level share of supply.",
    detail
  };
}
function scoreTokenProgram(facts) {
  const title = "Token program";
  if (facts.programKind === "spl-token") {
    return {
      id: "token_program",
      title,
      rating: "pass",
      summary: "This mint uses the classic SPL Token program.",
      detail: facts.programId ?? void 0
    };
  }
  if (facts.programKind === "spl-token-2022") {
    return {
      id: "token_program",
      title,
      rating: "warn",
      summary: "This mint uses Token-2022, which can enable extra authorities and transfer rules.",
      detail: facts.programId ?? void 0
    };
  }
  return {
    id: "token_program",
    title,
    rating: "unknown",
    summary: "The token program could not be identified. Missing data is treated as unknown, not safe.",
    detail: facts.programId ?? void 0
  };
}
function scoreExtensions(facts) {
  const title = "Token-2022 extensions";
  if (facts.programKind === "spl-token") {
    return {
      id: "extensions",
      title,
      rating: "pass",
      summary: "Classic SPL Token mints do not carry Token-2022 extensions."
    };
  }
  const rating = extensionsRating(facts.extensions, facts.extensionsKnown);
  if (rating === "unknown") {
    return {
      id: "extensions",
      title,
      rating: "unknown",
      summary: "Token-2022 extensions could not be read in full. Missing data is treated as unknown, not safe."
    };
  }
  const risky = (facts.extensions ?? []).filter((item) => item.rating === "risk" || item.rating === "warn");
  if (rating === "pass") {
    return {
      id: "extensions",
      title,
      rating: "pass",
      summary: facts.extensions && facts.extensions.length > 0 ? "No high-risk or warning-level extensions were found. Informational extensions may still be present." : "No Token-2022 extensions were reported on this mint."
    };
  }
  const names = risky.map((item) => item.name).join(", ");
  return {
    id: "extensions",
    title,
    rating,
    summary: rating === "risk" ? `One or more high-risk extensions are present: ${names}.` : `Warning-level extensions are present: ${names}.`
  };
}
function buildChecks(facts) {
  return [
    scoreMintAuthority(facts),
    scoreFreezeAuthority(facts),
    scoreConcentration(facts),
    scoreTokenProgram(facts),
    scoreExtensions(facts)
  ];
}
function overallRating(checks) {
  return worstRating(checks.map((check) => check.rating));
}
function buildReport(facts, fetchedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  const checks = buildChecks(facts);
  return {
    mint: facts.mint,
    cluster: facts.cluster,
    overall: overallRating(checks),
    facts,
    checks,
    fetchedAt
  };
}

// src/lib/inspect.ts
async function inspectMint(input, deps = {}) {
  const parsed = parseMintAddress(input.mint);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const cluster = input.cluster == null ? "mainnet" : input.cluster;
  if (!isCluster(cluster)) {
    return { ok: false, status: 400, error: "Cluster must be mainnet or devnet." };
  }
  const facts = await loadMintFacts(parsed.mint, cluster, deps);
  return { ok: true, report: buildReport(facts) };
}

// src/lib/inspect-http.ts
var INSPECT_LIMIT = 30;
var INSPECT_WINDOW_MS = 6e4;
async function handleInspectHttp(req, res, deps = {}) {
  cors(res);
  if (methodOf(req) === "OPTIONS") {
    res.status(204).json(null);
    return;
  }
  if (methodOf(req) !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  if (tooLarge(req)) {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }
  const ip = clientIp(req.headers ?? {}, req.socket?.remoteAddress ?? "unknown");
  if (!allow(`inspect:${ip}`, INSPECT_LIMIT, INSPECT_WINDOW_MS)) {
    res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
    return;
  }
  const body = readJsonBody(req);
  if (!body.ok) {
    res.status(400).json({ error: body.error });
    return;
  }
  const payload = body.value ?? {};
  const result = await inspectMint(payload, deps);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.setHeader?.("Cache-Control", "no-store");
  res.status(200).json(result.report);
}

// server/inspect.ts
async function handler(req, res) {
  await handleInspectHttp(req, res);
}
export {
  handler as default
};
