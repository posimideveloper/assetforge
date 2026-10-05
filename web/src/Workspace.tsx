import { useMemo, useState } from "react";
import { signTransaction } from "@stellar/freighter-api";
import { StrKey } from "@stellar/stellar-sdk";
import { validateConfig, PASSPHRASE, type IssuanceConfig, type TomlInfo } from "../../src/config";
import { buildPlan, completedSteps, planBundle, type HorizonBalances, type PlanStep, type StepId } from "../../src/plan";
import { generateToml } from "../../src/toml";
import { assetStats, auditIssuer, type AssetStats, type AuditCheck, type HorizonAccount } from "../../src/audit";
import { connectWallet } from "./lib/stellar";

const HORIZON = { public: "https://horizon.stellar.org", testnet: "https://horizon-testnet.stellar.org" };
const EXPLORER = { public: "https://stellar.expert/explorer/public", testnet: "https://stellar.expert/explorer/testnet" };
type Tab = "issue" | "toml" | "audit";

async function horizonAccount(net: "public" | "testnet", id: string) {
  const res = await fetch(`${HORIZON[net]}/accounts/${id}`);
  if (res.status === 404) throw new Error(`${id.slice(0, 6)}… doesn't exist on ${net}. Fund it first.`);
  if (!res.ok) throw new Error(`Horizon returned ${res.status}`);
  return (await res.json()) as HorizonAccount & HorizonBalances & { sequence: string };
}

export function Workspace() {
  const [tab, setTab] = useState<Tab>("issue");
  const [cfg, setCfg] = useState<IssuanceConfig>({
    network: "testnet",
    code: "ACME",
    issuer: "",
    distributor: "",
    supply: "1000000",
    homeDomain: "",
    flags: {},
    lockIssuer: true,
    toml: { name: "Acme Credits", desc: "Loyalty credits redeemable at Acme stores.", orgName: "Acme Ltd", orgUrl: "https://acme.example" },
  });
  const set = <K extends keyof IssuanceConfig>(k: K, v: IssuanceConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  const cleaned: IssuanceConfig = useMemo(() => ({ ...cfg, homeDomain: cfg.homeDomain || undefined, toml: cfg.homeDomain ? cfg.toml : undefined }), [cfg]);
  const problem = useMemo(() => {
    try {
      validateConfig(cleaned);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [cleaned]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-rivet">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <nav className="flex gap-1">
            {(
              [
                ["issue", "Issue"],
                ["toml", "stellar.toml"],
                ["audit", "Audit an issuer"],
              ] as const
            ).map(([t, l]) => (
              <button key={t} onClick={() => setTab(t)} className={`hammer ${tab === t ? "hammer-hot" : "hammer-cold"}`}>
                {l}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <section className="mx-auto max-w-6xl px-5 py-10">
        <p className="stamp">Classic asset issuance · Stellar</p>
        <h1 className="mt-2 max-w-3xl text-5xl font-black uppercase leading-[0.95] tracking-tight">
          Mint it once. <span className="text-molten">Mint it right.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-ash">
          Flags before trustlines, supply before locking, a home domain wallets can verify. assetforge builds the
          issuance in the only safe order and checks every irreversible choice before you sign.
        </p>
      </section>
      <div className="mx-auto max-w-6xl px-5 pb-16">
        {tab === "issue" && <Issue cfg={cfg} cleaned={cleaned} set={set} problem={problem} />}
        {tab === "toml" && <Toml cfg={cfg} cleaned={cleaned} set={set} problem={problem} />}
        {tab === "audit" && <Audit defaultNet={cfg.network} />}
      </div>
    </div>
  );
}

type FormProps = {
  cfg: IssuanceConfig;
  cleaned: IssuanceConfig;
  set: <K extends keyof IssuanceConfig>(k: K, v: IssuanceConfig[K]) => void;
  problem: string | null;
};

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="stamp">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Issue({ cfg, cleaned, set, problem }: FormProps) {
  const [steps, setSteps] = useState<PlanStep[] | null>(null);
  const [skipped, setSkipped] = useState<StepId[]>([]);
  const [state, setState] = useState<Record<number, { busy?: boolean; hash?: string; error?: string }>>({});
  const [planErr, setPlanErr] = useState<string | null>(null);
  const flags = cfg.flags ?? {};

  async function plan() {
    setPlanErr(null);
    setState({});
    try {
      const c = validateConfig(cleaned);
      const [iss, dist] = await Promise.all([horizonAccount(c.network, c.issuer), horizonAccount(c.network, c.distributor)]);
      // Resume safely: anything already on-chain (flags, trustline, supply, lock) is left out.
      const done = completedSteps(c, iss, dist);
      setSkipped([...done]);
      setSteps(buildPlan(c, { issuer: iss.sequence, distributor: dist.sequence }, 3600, done));
    } catch (e) {
      setSteps(null);
      setPlanErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function signAndSubmit(i: number, step: PlanStep) {
    setState((s) => ({ ...s, [i]: { busy: true } }));
    try {
      const signerAddress = step.signer === "issuer" ? cfg.issuer : cfg.distributor;
      await connectWallet().catch(() => undefined);
      const signed = await signTransaction(step.transaction.toXDR(), { networkPassphrase: PASSPHRASE[cfg.network], address: signerAddress });
      if (signed.error || !signed.signedTxXdr) throw new Error(signed.error?.message ?? `Sign with the ${step.signer} account in Freighter.`);
      const res = await fetch(`${HORIZON[cfg.network]}/transactions`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `tx=${encodeURIComponent(signed.signedTxXdr)}`,
      });
      const body = (await res.json()) as { hash?: string; extras?: { result_codes?: unknown } };
      if (!res.ok) throw new Error(`Rejected: ${JSON.stringify(body.extras?.result_codes ?? body)}`);
      setState((s) => ({ ...s, [i]: { hash: body.hash } }));
    } catch (e) {
      setState((s) => ({ ...s, [i]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
      <section className="plate space-y-4 p-6">
        <h2 className="text-2xl font-black uppercase">Asset spec</h2>
        <div className="grid grid-cols-2 gap-4">
          <F label="Network">
            <select className="ingot" value={cfg.network} onChange={(e) => set("network", e.target.value as "testnet" | "public")}>
              <option value="testnet">Testnet</option>
              <option value="public">Mainnet</option>
            </select>
          </F>
          <F label="Asset code">
            <input className="ingot font-mono" value={cfg.code} onChange={(e) => set("code", e.target.value.toUpperCase())} />
          </F>
        </div>
        <F label="Issuer account (creates the asset)">
          <input className="ingot font-mono text-xs" placeholder="G…" value={cfg.issuer} onChange={(e) => set("issuer", e.target.value.trim())} />
        </F>
        <F label="Distributor account (holds the supply)">
          <input className="ingot font-mono text-xs" placeholder="G…" value={cfg.distributor} onChange={(e) => set("distributor", e.target.value.trim())} />
        </F>
        <div className="grid grid-cols-2 gap-4">
          <F label="Supply">
            <input className="ingot" value={cfg.supply} onChange={(e) => set("supply", e.target.value)} />
          </F>
          <F label="Home domain">
            <input className="ingot" placeholder="acme.example" value={cfg.homeDomain ?? ""} onChange={(e) => set("homeDomain", e.target.value.trim())} />
          </F>
        </div>
        <div className="space-y-2 rounded border border-rivet p-3">
          <p className="stamp">Issuer powers (set before anyone holds the asset)</p>
          {(
            [
              ["authRequired", "Holders need my approval"],
              ["authRevocable", "I can freeze holders"],
              ["clawbackEnabled", "I can claw back balances"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!flags[k]} onChange={(e) => set("flags", { ...flags, [k]: e.target.checked })} /> {l}
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm font-bold text-ember">
            <input type="checkbox" checked={!!cfg.lockIssuer} onChange={(e) => set("lockIssuer", e.target.checked)} /> Lock issuer afterwards (fixed supply, irreversible)
          </label>
        </div>
        {problem ? (
          <p className="rounded border border-slag/40 bg-slag/10 p-3 text-sm text-slag">✘ {problem}</p>
        ) : (
          <p className="rounded border border-quench/40 bg-quench/10 p-3 text-sm text-quench">✔ Spec is valid</p>
        )}
        <button className="hammer hammer-hot w-full" disabled={!!problem} onClick={plan}>
          Build issuance plan
        </button>
        {planErr && <p className="text-sm text-slag">{planErr}</p>}
      </section>

      <section className="space-y-3">
        {!steps && (
          <div className="plate flex h-full min-h-64 items-center justify-center p-10 text-center text-ash">
            Fill in the spec and build the plan. Sequence numbers come live from Horizon, and you sign each step with
            Freighter, switching between the issuer and distributor accounts.
          </div>
        )}
        {steps && (
          <div className="plate flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span className="text-ash">
              {skipped.length
                ? `Already done on-chain, skipped: ${skipped.join(", ")}.`
                : "Nothing done on-chain yet: all steps below are needed."}
              {steps.length === 0 && " The issuance is complete."}
            </span>
            {steps.length > 0 && (
              <button
                className="hammer hammer-cold"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(planBundle(validateConfig(cleaned), steps), null, 2)], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${cfg.code || "asset"}-plan.json`;
                  a.click();
                }}
              >
                Download plan (JSON)
              </button>
            )}
          </div>
        )}
        {steps?.map((s, i) => {
          const st = state[i] ?? {};
          const blocked = i > 0 && !state[i - 1]?.hash;
          return (
            <article key={i} className={`plate p-5 ${st.hash ? "border-quench/50" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="stamp">
                    step {i + 1} · sign with {s.signer}
                  </p>
                  <h3 className="mt-1 text-lg font-extrabold">{s.title}</h3>
                </div>
                {st.hash && <span className="font-mono text-xs text-quench">done</span>}
              </div>
              <ul className="mt-2 space-y-1 text-sm text-ash">
                {s.notes.map((n) => (
                  <li key={n} className={n.startsWith("IRREVERSIBLE") ? "font-bold text-ember" : ""}>
                    › {n}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  className={`hammer ${s.notes.some((n) => n.startsWith("IRREVERSIBLE")) ? "bg-ember text-steel" : "hammer-hot"}`}
                  disabled={st.busy || !!st.hash || blocked}
                  onClick={() => signAndSubmit(i, s)}
                >
                  {st.busy ? "Signing…" : st.hash ? "Submitted" : "Sign & submit"}
                </button>
                <button className="hammer hammer-cold" onClick={() => navigator.clipboard.writeText(s.transaction.toXDR())}>
                  Copy XDR
                </button>
                {st.hash && (
                  <a className="font-mono text-xs underline" href={`${EXPLORER[cfg.network]}/tx/${st.hash}`} target="_blank" rel="noreferrer">
                    view ↗
                  </a>
                )}
              </div>
              {blocked && !st.hash && <p className="mt-2 text-xs text-ash">Finish step {i} first.</p>}
              {st.error && <p className="mt-2 text-sm text-slag">{st.error}</p>}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function Toml({ cfg, cleaned, set, problem }: FormProps) {
  const t: TomlInfo = cfg.toml ?? { name: "", desc: "", orgName: "", orgUrl: "" };
  const setT = (k: keyof TomlInfo, v: string) => set("toml", { ...t, [k]: v || undefined } as TomlInfo);
  const toml = useMemo(() => {
    try {
      return { text: generateToml(validateConfig(cleaned)) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [cleaned]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="plate space-y-4 p-6">
        <h2 className="text-2xl font-black uppercase">What wallets will show</h2>
        <F label="Asset name">
          <input className="ingot" value={t.name} onChange={(e) => setT("name", e.target.value)} />
        </F>
        <F label="Description">
          <textarea className="ingot h-20" value={t.desc} onChange={(e) => setT("desc", e.target.value)} />
        </F>
        <F label="Logo URL (PNG, https)">
          <input className="ingot" value={t.image ?? ""} onChange={(e) => setT("image", e.target.value)} />
        </F>
        <div className="grid grid-cols-2 gap-4">
          <F label="Organisation">
            <input className="ingot" value={t.orgName} onChange={(e) => setT("orgName", e.target.value)} />
          </F>
          <F label="Website">
            <input className="ingot" value={t.orgUrl} onChange={(e) => setT("orgUrl", e.target.value)} />
          </F>
        </div>
        <F label="Asset type">
          <select className="ingot" value={t.anchorAssetType ?? ""} onChange={(e) => setT("anchorAssetType", e.target.value)}>
            <option value="">Not anchored</option>
            {["fiat", "crypto", "stock", "bond", "commodity", "realestate", "nft", "other"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </F>
        {problem && <p className="text-sm text-slag">Fix the asset spec first: {problem}</p>}
        {!cfg.homeDomain && <p className="text-sm text-ember">Set a home domain on the Issue tab to publish a stellar.toml.</p>}
      </section>
      <section className="plate p-6">
        <div className="flex items-center justify-between">
          <p className="stamp">https://{cfg.homeDomain || "your-domain"}/.well-known/stellar.toml</p>
          {toml.text && (
            <button
              className="hammer hammer-cold"
              onClick={() => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([toml.text!], { type: "text/plain" }));
                a.download = "stellar.toml";
                a.click();
              }}
            >
              Download
            </button>
          )}
        </div>
        <pre className="mt-3 min-h-80 overflow-auto rounded bg-steel p-4 font-mono text-xs text-ember">{toml.text ?? `# ${toml.error}`}</pre>
        <p className="mt-3 text-xs text-ash">Serve it with the header Access-Control-Allow-Origin: * so wallets can read it.</p>
      </section>
    </div>
  );
}

function Audit({ defaultNet }: { defaultNet: "public" | "testnet" }) {
  const [net, setNet] = useState(defaultNet);
  const [issuer, setIssuer] = useState("");
  const [code, setCode] = useState("");
  const [checks, setChecks] = useState<AuditCheck[] | null>(null);
  const [stats, setStats] = useState<AssetStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const icon = { ok: ["✔", "text-quench"], warn: ["▲", "text-ember"], fail: ["✘", "text-slag"] } as const;
  return (
    <section className="plate mx-auto max-w-3xl p-6">
      <h2 className="text-2xl font-black uppercase">Audit an issuer</h2>
      <p className="mt-1 text-sm text-ash">Check your own issuer after launch, or someone else's before you trust their token.</p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px_120px_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          setChecks(null);
          setStats(null);
          if (!StrKey.isValidEd25519PublicKey(issuer)) return setErr("Enter an issuer G… address.");
          setBusy(true);
          try {
            setChecks(await auditIssuer(await horizonAccount(net, issuer), code || undefined));
            if (code) assetStats(HORIZON[net], code, issuer).then(setStats).catch(() => setStats(null));
          } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : String(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="ingot font-mono text-xs" placeholder="Issuer G…" value={issuer} onChange={(e) => setIssuer(e.target.value.trim())} />
        <input className="ingot font-mono" placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <select className="ingot" value={net} onChange={(e) => setNet(e.target.value as "public" | "testnet")}>
          <option value="testnet">Testnet</option>
          <option value="public">Mainnet</option>
        </select>
        <button className="hammer hammer-hot" disabled={busy}>
          {busy ? "…" : "Audit"}
        </button>
      </form>
      {err && <p className="mt-3 text-sm text-slag">{err}</p>}
      {checks && (
        <ul className="mt-5 space-y-2">
          {checks.map((c, i) => (
            <li key={i} className="flex gap-3 rounded border border-rivet bg-steel px-3 py-2.5 text-sm">
              <span className={`font-mono ${icon[c.level][1]}`}>{icon[c.level][0]}</span>
              {c.message}
            </li>
          ))}
        </ul>
      )}
      {stats && (
        <div className="mt-5 rounded border border-rivet bg-steel p-4 text-sm">
          <p className="stamp">Distribution</p>
          <p className="mt-2">
            <b>{stats.holders}</b> holder{stats.holders === 1 ? "" : "s"} · <b>{stats.supply}</b> {code} in circulation
          </p>
          {stats.top.length > 0 && (
            <ol className="mt-3 space-y-1 font-mono text-xs text-ash">
              {stats.top.map((h) => (
                <li key={h.account} className="flex justify-between gap-3">
                  <span>
                    {h.account.slice(0, 6)}…{h.account.slice(-6)}
                  </span>
                  <span className="text-spark">{h.balance}</span>
                </li>
              ))}
            </ol>
          )}
          {stats.partial && <p className="mt-2 text-xs text-ash">Top holders from the first {stats.top.length ? "1,000" : ""} accounts scanned.</p>}
        </div>
      )}
    </section>
  );
}
