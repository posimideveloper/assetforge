const PLAN: [string, string][] = [
  ["Configure the issuer", "Home domain and flags, set before any trustline exists"],
  ["Distributor trusts ACME", "The holding account opts in to the asset"],
  ["Issue 1,000,000 ACME", "The full supply moves to the distributor"],
  ["Lock the issuer", "Signing weights to zero: the supply is fixed forever"],
];
import { Link, useTitle } from "../lib/router";

export function Home() {
  useTitle("assetforge · safe Stellar asset issuance");
  const STATS: [string, string][] = [
    ["Order", "enforced"],
    ["Signing", "Freighter"],
    ["Networks", "2"],
  ];
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 md:grid-cols-[1.2fr_1fr] md:pt-20">
        <div>
          <p className="stamp text-ember">Classic asset issuance on Stellar</p>
          <h1 className="mt-4 text-5xl leading-[1.03] md:text-6xl font-black uppercase tracking-tight text-spark">Mint it once. <span className="text-molten">Mint it right.</span></h1>
          <p className="mt-6 max-w-xl text-lg text-ash">Flags before trustlines, supply before locking, a home domain wallets can verify. assetforge plans the issuance in the only safe order, checks every irreversible choice, and has you sign each step in Freighter.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/app" className="hammer hammer-hot inline-block">Open the studio →</Link>
            <Link to="/docs" className="hammer hammer-cold inline-block">How it works</Link>
          </div>
          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6">
            {STATS.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] uppercase tracking-wider text-ash">{label}</dt>
                <dd className="mt-1 text-2xl font-black uppercase tracking-tight text-spark">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="plate p-7">
          <p className="stamp">Issuance plan · ACME</p>
          <ol className="mt-4 space-y-2">
            {PLAN.map(([step, detail], i) => (
              <li key={step} className="flex gap-3 rounded-[3px] border border-rivet bg-steel p-3">
                <span className="font-mono text-xs text-molten">{String(i + 1).padStart(2, "0")}</span>
                <span>
                  <b className="text-sm">{step}</b>
                  <br />
                  <span className="text-xs text-ash">{detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-y border-rivet bg-iron/60">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className="stamp text-ember">How it works</p>
          <h2 className="mt-3 text-3xl md:text-4xl font-black uppercase tracking-tight text-spark">Describe, plan, sign</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="plate p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold bg-molten text-[#1a0c00]">{i + 1}</span>
                <h3 className="mt-4 text-xl font-black uppercase tracking-tight text-spark">{title}</h3>
                <p className="mt-2 text-sm text-ash">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-20">
        <p className="stamp text-ember">Use cases</p>
        <h2 className="mt-3 text-3xl md:text-4xl font-black uppercase tracking-tight text-spark">For teams putting a real asset on Stellar</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {USES.map(([icon, title, body]) => (
            <div key={title} className="plate p-6">
              <span className="text-3xl">{icon}</span>
              <h3 className="mt-3 text-lg font-black uppercase tracking-tight text-spark">{title}</h3>
              <p className="mt-2 text-sm text-ash">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5">
        <p className="stamp text-ember">Guarantees</p>
        <h2 className="mt-3 text-3xl md:text-4xl font-black uppercase tracking-tight text-spark">Every irreversible choice, checked</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {PROMISES.map(([title, body]) => (
            <div key={title} className="rounded-2xl p-7 border border-molten/40 bg-molten/10 text-spark">
              <h3 className="text-xl font-black uppercase tracking-tight">{title}</h3>
              <p className="mt-2 text-sm text-ash">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pt-20">
        <div className="plate flex flex-col items-start justify-between gap-6 p-10 md:flex-row md:items-center">
          <div>
            <h2 className="text-3xl font-black uppercase tracking-tight text-spark">Plan an issuance on testnet first.</h2>
            <p className="mt-2 text-ash">Run the whole flow on testnet before you touch mainnet.</p>
          </div>
          <Link to="/app" className="hammer hammer-hot inline-block shrink-0">Open the studio →</Link>
        </div>
      </section>
    </>
  );
}

const STEPS: [string, string][] = [
  [
    "Describe the asset",
    "Code, issuer, distributor, supply, home domain, issuer powers and whether to lock the issuer."
  ],
  [
    "Review the plan",
    "assetforge validates the config and builds each transaction with real sequence numbers from Horizon."
  ],
  [
    "Sign each step",
    "Sign in Freighter in order, or copy the XDR. Then publish the generated stellar.toml."
  ]
];

const USES: [string, string, string][] = [
  [
    "🪙",
    "Stablecoins",
    "Set authorization and clawback powers deliberately, not by accident."
  ],
  [
    "🎫",
    "Loyalty points",
    "Fixed-supply tokens with a locked issuer and a verified home domain."
  ],
  [
    "🏗️",
    "Tokenised assets",
    "Issuer and distributor kept separate, with a published stellar.toml."
  ],
  [
    "🔍",
    "Due diligence",
    "Audit any issuer’s lock status, powers and toml before you list its asset."
  ]
];

const PROMISES: [string, string][] = [
  [
    "Safe ordering",
    "Flags are set before any trustline exists, and the issuer is locked only after the supply is minted."
  ],
  [
    "Validation first",
    "Asset code, keys, supply and domain are checked before a single transaction is built."
  ],
  [
    "Verifiable result",
    "The audit tool shows anyone whether the issuer is locked and which powers remain."
  ]
];
