import { useMemo, useState, type FormEvent } from "react";
import { EXAMPLE_MINTS } from "./lib/examples";
import { explorerAccountUrl, explorerMintUrl, ratingLabel, shortAddress } from "./lib/format";
import type { Cluster, Rating, RiskReport } from "./lib/types";

const DISCLAIMER =
  "This is a read-only inspection of on-chain mint data. It is not financial advice, a security audit, or a guarantee of safety. Missing or failed data is shown as Unknown — never as safe. Do your own research.";

export function App() {
  const [cluster, setCluster] = useState<Cluster>("mainnet");
  const [mint, setMint] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RiskReport | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const examples = useMemo(
    () => EXAMPLE_MINTS.filter((example) => example.cluster === cluster || cluster === "mainnet"),
    [cluster],
  );

  async function runInspect(nextMint: string, nextCluster: Cluster) {
    setLoading(true);
    setError(null);
    setExplanation(null);
    setExplainError(null);
    try {
      const response = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint: nextMint, cluster: nextCluster }),
      });
      const payload = (await response.json()) as RiskReport & { error?: string };
      if (!response.ok) {
        setReport(null);
        setError(payload.error ?? "The inspection failed.");
        return;
      }
      setReport(payload);
    } catch {
      setReport(null);
      setError("The inspection request failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void runInspect(mint, cluster);
  }

  function useExample(address: string, nextCluster: Cluster) {
    setMint(address);
    setCluster(nextCluster);
    void runInspect(address, nextCluster);
  }

  async function explain() {
    if (!report) return;
    setExplaining(true);
    setExplainError(null);
    try {
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report }),
      });
      const payload = (await response.json()) as { explanation?: string; error?: string };
      if (!response.ok) {
        setExplainError(payload.error ?? "The explanation could not be generated.");
        return;
      }
      setExplanation(payload.explanation ?? "");
    } catch {
      setExplainError("The explanation request failed. Please try again.");
    } finally {
      setExplaining(false);
    }
  }

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <p className="eyebrow">Read-only · no wallet</p>
            <h1>Solana Token Risk Checker</h1>
          </div>
        </div>
        <div className="cluster" role="group" aria-label="Network">
          {(["mainnet", "devnet"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={cluster === value ? "is-on" : ""}
              onClick={() => setCluster(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </header>

      <p className="lede">
        Paste a token mint address to inspect who can mint, who can freeze accounts, how concentrated the supply is, and
        whether Token-2022 extensions add extra rules. Missing information is recorded as Unknown, not as safe.
      </p>

      <form className="search" onSubmit={onSubmit}>
        <label htmlFor="mint">Mint address</label>
        <div className="search-row">
          <input
            id="mint"
            name="mint"
            value={mint}
            onChange={(event) => setMint(event.target.value)}
            placeholder="Paste a Solana mint address"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
          />
          <button type="submit" disabled={loading}>
            {loading ? "Inspecting…" : "Inspect"}
          </button>
        </div>
        <div className="examples">
          <span>Examples</span>
          {examples.map((example) => (
            <button
              key={example.mint}
              type="button"
              className="chip"
              onClick={() => useExample(example.mint, example.cluster)}
              title={example.note}
            >
              {example.symbol}
            </button>
          ))}
        </div>
      </form>

      <aside className="disclaimer" role="note">
        {DISCLAIMER}
      </aside>

      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}

      {report && <ReportView report={report} />}

      {report && (
        <section className="explain">
          <div className="explain-head">
            <h2>Optional AI explanation</h2>
            <button type="button" className="ghost" onClick={() => void explain()} disabled={explaining}>
              {explaining ? "Writing…" : explanation ? "Regenerate" : "Explain this report"}
            </button>
          </div>
          <p className="muted">
            Sends the structured findings to a free Gemini model. The model is told not to upgrade Unknown to safe and
            not to give financial advice.
          </p>
          {explainError && (
            <p className="banner error" role="alert">
              {explainError}
            </p>
          )}
          {explanation && <pre className="explanation">{explanation}</pre>}
        </section>
      )}

      <footer className="foot">
        <p>No wallet connection. No signing. No transactions. Public RPC only.</p>
        <p>
          <a href="https://github.com/ottonielmorais2008-rgb/solana-token-risk-checker">Source on GitHub</a>
        </p>
      </footer>
    </div>
  );
}

function ReportView({ report }: { report: RiskReport }) {
  const { facts } = report;
  return (
    <article className="report">
      <div className="crop tl" />
      <div className="crop tr" />
      <div className="crop bl" />
      <div className="crop br" />

      <header className="report-head">
        <div>
          <p className="eyebrow">Case file · {facts.cluster}</p>
          <h2>
            <a href={explorerMintUrl(report.mint, facts.cluster)} target="_blank" rel="noreferrer">
              {shortAddress(report.mint, 6)}
            </a>
          </h2>
          <p className="mono full-mint">{report.mint}</p>
          <dl className="facts">
            <div>
              <dt>Program</dt>
              <dd>{programLabel(facts.programKind)}</dd>
            </div>
            <div>
              <dt>Decimals</dt>
              <dd>{facts.decimals ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Supply</dt>
              <dd>{facts.supplyUi ?? "Unknown"}</dd>
            </div>
          </dl>
        </div>
        <p className={`stamp rating-${report.overall}`}>
          <span>Overall</span>
          {ratingLabel(report.overall)}
        </p>
      </header>

      {facts.error && <p className="banner warn">{facts.error}</p>}

      <div className="checks">
        {report.checks.map((check) => (
          <section key={check.id} className={`check rating-${check.rating}`}>
            <header>
              <h3>{check.title}</h3>
              <span className="pill">{ratingLabel(check.rating)}</span>
            </header>
            <p>{check.summary}</p>
            {check.detail && <p className="mono detail">{check.detail}</p>}
          </section>
        ))}
      </div>

      <section className="holders">
        <h3>Top token accounts</h3>
        {!facts.holdersKnown || !facts.holders ? (
          <p className="muted">Largest accounts are unknown, so concentration is not treated as safe.</p>
        ) : facts.holders.length === 0 ? (
          <p className="muted">No token accounts were returned for this mint.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Account</th>
                <th>Share of supply</th>
              </tr>
            </thead>
            <tbody>
              {facts.holders.map((holder, index) => (
                <tr key={holder.address}>
                  <td>{index + 1}</td>
                  <td>
                    <a
                      className="mono"
                      href={explorerAccountUrl(holder.address, facts.cluster)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddress(holder.address, 5)}
                    </a>
                  </td>
                  <td>
                    <div className="bar-row">
                      <span className="bar" style={{ width: `${Math.min(100, holder.percent)}%` }} />
                      <span>{holder.percent.toFixed(2)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {facts.programKind === "spl-token-2022" && (
        <section className="extensions">
          <h3>Extensions</h3>
          {!facts.extensionsKnown || !facts.extensions ? (
            <p className="muted">Extensions could not be read in full.</p>
          ) : facts.extensions.length === 0 ? (
            <p className="muted">No extensions were reported on this mint.</p>
          ) : (
            <ul>
              {facts.extensions.map((item) => (
                <li key={item.name} className={`rating-${item.rating}`}>
                  <strong>
                    {item.name} · {ratingLabel(item.rating as Rating)}
                  </strong>
                  <span>{item.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </article>
  );
}

function programLabel(kind: RiskReport["facts"]["programKind"]): string {
  if (kind === "spl-token") return "SPL Token";
  if (kind === "spl-token-2022") return "Token-2022";
  return "Unknown";
}
