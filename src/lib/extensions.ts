import type { ExtensionFinding, Rating } from "./types";

interface ParsedExtension {
  extension?: string;
  state?: Record<string, unknown>;
}

const INFORMATIONAL = new Set([
  "metadataPointer",
  "tokenMetadata",
  "metadata",
  "groupPointer",
  "groupMemberPointer",
  "tokenGroup",
  "tokenGroupMember",
  "mintCloseAuthority",
]);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function feeBps(state: Record<string, unknown> | undefined): number | null {
  const newer = state?.newerTransferFee;
  const older = state?.olderTransferFee;
  const from =
    newer && typeof newer === "object"
      ? (newer as { transferFeeBasisPoints?: unknown }).transferFeeBasisPoints
      : undefined;
  const fallback =
    older && typeof older === "object"
      ? (older as { transferFeeBasisPoints?: unknown }).transferFeeBasisPoints
      : undefined;
  const raw = from ?? fallback ?? state?.transferFeeBasisPoints;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return null;
}

export function assessExtension(entry: ParsedExtension): ExtensionFinding {
  const name = entry.extension ?? "unknown";
  const state = entry.state ?? {};

  switch (name) {
    case "permanentDelegate": {
      const delegate = asString(state.delegate) ?? asString(state.permanentDelegate);
      if (!delegate) {
        return {
          name,
          rating: "unknown",
          summary: "A permanent delegate extension is present, but the delegate address could not be read.",
        };
      }
      return {
        name,
        rating: "risk",
        summary: `A permanent delegate (${delegate}) can transfer or burn tokens from any account.`,
      };
    }
    case "transferHook": {
      const programId = asString(state.programId) ?? asString(state.hook) ?? "unknown program";
      return {
        name,
        rating: "risk",
        summary: `A transfer hook (${programId}) runs on every transfer and can block or alter it.`,
      };
    }
    case "defaultAccountState": {
      const accountState = String(state.accountState ?? state.state ?? "").toLowerCase();
      if (accountState === "frozen") {
        return {
          name,
          rating: "risk",
          summary: "New token accounts are frozen by default until the freeze authority thaws them.",
        };
      }
      if (!accountState) {
        return {
          name,
          rating: "unknown",
          summary: "A default account state extension is present, but the state could not be read.",
        };
      }
      return {
        name,
        rating: "warn",
        summary: `New token accounts start in the "${accountState}" state.`,
      };
    }
    case "pausable":
    case "pausableConfig": {
      const paused = state.paused === true;
      return {
        name,
        rating: "risk",
        summary: paused
          ? "This mint is paused: transfers may be blocked."
          : "This mint can be paused, which would block transfers.",
      };
    }
    case "transferFeeConfig": {
      const bps = feeBps(state);
      if (bps === null) {
        return {
          name,
          rating: "unknown",
          summary: "A transfer fee extension is present, but the fee could not be read.",
        };
      }
      if (bps === 0) {
        return {
          name,
          rating: "warn",
          summary: "A transfer fee extension is enabled, even though the current fee is 0 basis points and can be changed.",
        };
      }
      return {
        name,
        rating: "warn",
        summary: `Transfers are charged a fee of ${bps} basis points (${(bps / 100).toFixed(2)}%).`,
      };
    }
    case "confidentialTransferMint":
    case "confidentialTransferFeeConfig": {
      return {
        name,
        rating: "warn",
        summary: "Confidential transfers are enabled, so some balances and transfers may be hidden from a plain RPC view.",
      };
    }
    case "interestBearingConfig":
    case "scaledUiAmount":
    case "scaledUiAmountConfig":
    case "scaledUiAmountMint": {
      return {
        name,
        rating: "warn",
        summary: "Displayed amounts can change over time or by a scale factor, so the raw supply may not match what wallets show.",
      };
    }
    case "nonTransferable": {
      return {
        name,
        rating: "warn",
        summary: "This token is non-transferable.",
      };
    }
    case "mintCloseAuthority": {
      const authority = asString(state.authority) ?? asString(state.closeAuthority);
      return {
        name,
        rating: "warn",
        summary: authority
          ? `A mint close authority (${authority}) can close this mint account if the supply is zero.`
          : "A mint close authority is configured and can close this mint account if the supply is zero.",
      };
    }
    default: {
      if (INFORMATIONAL.has(name)) {
        return {
          name,
          rating: "pass",
          summary: `Informational extension: ${name}.`,
        };
      }
      return {
        name,
        rating: "warn",
        summary: `Unclassified Token-2022 extension "${name}". It was not treated as safe.`,
      };
    }
  }
}

export function assessExtensions(raw: unknown): { findings: ExtensionFinding[]; known: boolean } {
  if (raw == null) return { findings: [], known: true };
  if (!Array.isArray(raw)) return { findings: [], known: false };
  return { findings: raw.map((entry) => assessExtension(entry ?? {})), known: true };
}

export function extensionsRating(findings: ExtensionFinding[] | null, known: boolean): Rating {
  if (!known || findings == null) return "unknown";
  let worst: Rating = "pass";
  for (const finding of findings) {
    if (finding.rating === "risk") return "risk";
    if (finding.rating === "warn") worst = "warn";
    if (finding.rating === "unknown" && worst === "pass") worst = "unknown";
  }
  return worst;
}
