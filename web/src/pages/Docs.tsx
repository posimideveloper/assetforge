import { Link, useTitle } from "../lib/router";

const SECTIONS = [
  ["start", "Getting started"],
  ["concepts", "Concepts"],
  ["reference", "CLI & library"],
  ["faq", "FAQ"],
] as const;

export function Docs() {
  useTitle("Docs · assetforge");
  return (
    <div className="mx-auto grid max-w-6xl gap-12 px-5 py-14 lg:grid-cols-[210px_1fr]">
      <aside className="hidden lg:block">
        <nav className="sticky top-24 space-y-1 text-sm">
          <p className="mb-3 px-3 stamp text-ember">On this page</p>
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href="#/docs"
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
              }}
              className="block rounded-lg px-3 py-2 text-ash hover:text-spark"
            >
              {label}
            </a>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 space-y-16">
        <header>
          <p className="stamp text-ember">Documentation</p>
          <h1 className="mt-3 text-4xl md:text-5xl font-black uppercase tracking-tight text-spark">Using assetforge</h1>
          <p className="mt-4 max-w-2xl text-lg text-ash">A CLI, library and web studio for issuing classic Stellar assets in a safe order, with stellar.toml generation and issuer audits.</p>
        </header>

        <section id="start" className="scroll-mt-24 space-y-5">
          <h2 className="text-3xl font-black uppercase tracking-tight text-spark">Getting started</h2>
          <ol className="space-y-3">
            {START.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold bg-molten text-[#1a0c00]">{i + 1}</span>
                <p className="pt-0.5 text-spark/90">{step}</p>
              </li>
            ))}
          </ol>
          <Link to="/app" className="hammer hammer-hot inline-block inline-block">Open the studio →</Link>
        </section>

        <section id="concepts" className="scroll-mt-24 space-y-5">
          <h2 className="text-3xl font-black uppercase tracking-tight text-spark">Concepts</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {CONCEPTS.map(([term, body]) => (
              <div key={term} className="plate p-5">
                <h3 className="text-lg font-black uppercase tracking-tight text-spark">{term}</h3>
                <p className="mt-1.5 text-sm text-ash">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="reference" className="scroll-mt-24 space-y-5">
          <h2 className="text-3xl font-black uppercase tracking-tight text-spark">CLI & library</h2>
          <p className="text-ash">The same checks are available from the command line:</p>
          <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed plate text-ember">{`assetforge plan acme.json                            # validate + print the ordered steps
assetforge toml acme.json > .well-known/stellar.toml
assetforge audit G…ISSUER --code ACME`}</pre>
          <div className="plate overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-rivet text-xs uppercase tracking-wider text-ash">
                <tr>
                  <th className="p-3.5">Export</th>
                  <th className="p-3.5">Kind</th>
                  <th className="p-3.5">What it does</th>
                </tr>
              </thead>
              <tbody>
                {REFERENCE.map(([fn, who, what]) => (
                  <tr key={fn} className="border-t border-rivet">
                    <td className="p-3.5 font-mono text-xs text-spark">{fn}</td>
                    <td className="p-3.5 text-ash">{who}</td>
                    <td className="p-3.5 text-ash">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 space-y-3">
          <h2 className="text-3xl font-black uppercase tracking-tight text-spark">FAQ</h2>
          {FAQ.map(([q, a]) => (
            <details key={q} className="plate group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-spark">
                {q}
                <span className="transition group-open:rotate-45 text-molten">+</span>
              </summary>
              <p className="mt-3 text-sm text-ash">{a}</p>
            </details>
          ))}
        </section>
      </article>
    </div>
  );
}

const START: string[] = [
  "Install Freighter and fund a testnet issuer and distributor with Friendbot.",
  "Open the studio’s Issue tab and describe the asset. Fix anything the validator flags.",
  "Build the plan, then sign and submit each step in order with Freighter.",
  "Fill in the stellar.toml tab, download the file and serve it from your home domain. Check the result with “Audit an issuer”."
];

const CONCEPTS: [string, string][] = [
  [
    "Issuer",
    "The account that creates the asset. Locking it (all signing weights to zero) fixes the supply forever."
  ],
  [
    "Distributor",
    "A separate account that holds the minted supply and sends it on to users."
  ],
  [
    "Issuer powers",
    "Authorization required, revocable and clawback flags. Some of these can never be turned off."
  ],
  [
    "stellar.toml",
    "A file on your home domain that wallets read to show your asset’s name, logo and organisation."
  ]
];

const REFERENCE: [string, string, string][] = [
  [
    "validateConfig(config)",
    "function",
    "Lists every problem with an issuance config"
  ],
  [
    "buildPlan(config, sequences)",
    "function",
    "Builds the ordered issuance transactions"
  ],
  [
    "generateToml(config)",
    "function",
    "Produces the stellar.toml for the asset"
  ],
  [
    "auditIssuer(…)",
    "function",
    "Checks lock status, powers, home domain and toml for any issuer"
  ],
  [
    "flagsValue(flags)",
    "function",
    "The issuer’s account-flags bitmask"
  ]
];

const FAQ: [string, string][] = [
  [
    "Why does order matter?",
    "Some flags only affect trustlines created after they’re set, and a locked issuer can’t change anything. Mistakes are permanent."
  ],
  [
    "Should I lock the issuer?",
    "For a fixed-supply token, yes, after minting. A stablecoin issuer usually stays unlocked so it can mint and redeem."
  ],
  [
    "Does assetforge hold my keys?",
    "No. Every transaction is signed in Freighter or wherever you paste the XDR."
  ],
  [
    "Can I audit someone else’s asset?",
    "Yes. The audit tab works for any issuer on testnet or mainnet."
  ],
  [
    "What is clawback?",
    "An issuer power to take the asset back from holders. Many holders and exchanges avoid assets that have it."
  ],
  [
    "Is mainnet supported?",
    "Yes, but test the exact same config on testnet first."
  ]
];
