import { extensionsRating } from "./extensions";
import type { CheckResult, Rating, RiskReport, TokenFacts } from "./types";
import { RATING_RANK } from "./types";

/** Top-holder share at or above this percentage is Risk. */
export const TOP1_RISK_PERCENT = 50;
/** Top-holder share at or above this percentage is Warn. */
export const TOP1_WARN_PERCENT = 20;
/** Combined top-10 share at or above this percentage is Risk. */
export const TOP10_RISK_PERCENT = 90;
/** Combined top-10 share at or above this percentage is Warn. */
export const TOP10_WARN_PERCENT = 70;

export function worstRating(ratings: Rating[]): Rating {
  let worst: Rating = "pass";
  for (const rating of ratings) {
    if (RATING_RANK[rating] > RATING_RANK[worst]) worst = rating;
  }
  return worst;
}

export function scoreMintAuthority(facts: TokenFacts): CheckResult {
  const title = "Mint authority";
  if (!facts.authoritiesKnown) {
    return {
      id: "mint_authority",
      title,
      rating: "unknown",
      summary: "The mint authority could not be read. Missing data is treated as unknown, not safe.",
    };
  }
  if (facts.mintAuthority) {
    return {
      id: "mint_authority",
      title,
      rating: "risk",
      summary: "Mint authority is still active, so new tokens can be created.",
      detail: facts.mintAuthority,
    };
  }
  return {
    id: "mint_authority",
    title,
    rating: "pass",
    summary: "Mint authority has been revoked. No further tokens can be minted by an authority key.",
  };
}

export function scoreFreezeAuthority(facts: TokenFacts): CheckResult {
  const title = "Freeze authority";
  if (!facts.authoritiesKnown) {
    return {
      id: "freeze_authority",
      title,
      rating: "unknown",
      summary: "The freeze authority could not be read. Missing data is treated as unknown, not safe.",
    };
  }
  if (facts.freezeAuthority) {
    return {
      id: "freeze_authority",
      title,
      rating: "warn",
      summary: "Freeze authority is still active, so token accounts can be frozen.",
      detail: facts.freezeAuthority,
    };
  }
  return {
    id: "freeze_authority",
    title,
    rating: "pass",
    summary: "Freeze authority has been revoked. Accounts cannot be frozen by an authority key.",
  };
}

export function scoreConcentration(facts: TokenFacts): CheckResult {
  const title = "Holder concentration";
  if (!facts.holdersKnown || facts.holders == null || facts.supplyRaw == null) {
    return {
      id: "holder_concentration",
      title,
      rating: "unknown",
      summary: "Largest accounts or supply could not be read. Concentration is unknown, not safe.",
    };
  }
  if (facts.supplyRaw === "0") {
    return {
      id: "holder_concentration",
      title,
      rating: "unknown",
      summary: "Reported supply is zero, so holder shares cannot be calculated.",
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
      detail,
    };
  }
  if (roundedTop1 >= TOP1_WARN_PERCENT || roundedTop10 >= TOP10_WARN_PERCENT) {
    return {
      id: "holder_concentration",
      title,
      rating: "warn",
      summary: "A large share of the supply sits in the top accounts.",
      detail,
    };
  }
  return {
    id: "holder_concentration",
    title,
    rating: "pass",
    summary: "The largest accounts do not concentrate a warning-level share of supply.",
    detail,
  };
}

export function scoreTokenProgram(facts: TokenFacts): CheckResult {
  const title = "Token program";
  if (facts.programKind === "spl-token") {
    return {
      id: "token_program",
      title,
      rating: "pass",
      summary: "This mint uses the classic SPL Token program.",
      detail: facts.programId ?? undefined,
    };
  }
  if (facts.programKind === "spl-token-2022") {
    return {
      id: "token_program",
      title,
      rating: "warn",
      summary: "This mint uses Token-2022, which can enable extra authorities and transfer rules.",
      detail: facts.programId ?? undefined,
    };
  }
  return {
    id: "token_program",
    title,
    rating: "unknown",
    summary: "The token program could not be identified. Missing data is treated as unknown, not safe.",
    detail: facts.programId ?? undefined,
  };
}

export function scoreExtensions(facts: TokenFacts): CheckResult {
  const title = "Token-2022 extensions";
  if (facts.programKind === "spl-token") {
    return {
      id: "extensions",
      title,
      rating: "pass",
      summary: "Classic SPL Token mints do not carry Token-2022 extensions.",
    };
  }
  const rating = extensionsRating(facts.extensions, facts.extensionsKnown);
  if (rating === "unknown") {
    return {
      id: "extensions",
      title,
      rating: "unknown",
      summary: "Token-2022 extensions could not be read in full. Missing data is treated as unknown, not safe.",
    };
  }
  const risky = (facts.extensions ?? []).filter((item) => item.rating === "risk" || item.rating === "warn");
  if (rating === "pass") {
    return {
      id: "extensions",
      title,
      rating: "pass",
      summary:
        facts.extensions && facts.extensions.length > 0
          ? "No high-risk or warning-level extensions were found. Informational extensions may still be present."
          : "No Token-2022 extensions were reported on this mint.",
    };
  }
  const names = risky.map((item) => item.name).join(", ");
  return {
    id: "extensions",
    title,
    rating,
    summary:
      rating === "risk"
        ? `One or more high-risk extensions are present: ${names}.`
        : `Warning-level extensions are present: ${names}.`,
  };
}

export function buildChecks(facts: TokenFacts): CheckResult[] {
  return [
    scoreMintAuthority(facts),
    scoreFreezeAuthority(facts),
    scoreConcentration(facts),
    scoreTokenProgram(facts),
    scoreExtensions(facts),
  ];
}

export function overallRating(checks: CheckResult[]): Rating {
  return worstRating(checks.map((check) => check.rating));
}

export function buildReport(facts: TokenFacts, fetchedAt = new Date().toISOString()): RiskReport {
  const checks = buildChecks(facts);
  return {
    mint: facts.mint,
    cluster: facts.cluster,
    overall: overallRating(checks),
    facts,
    checks,
    fetchedAt,
  };
}
