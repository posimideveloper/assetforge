import { Keypair, type Transaction } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { assetStats, auditIssuer, tomlCurrencies, type HorizonAccount } from "./audit.js";
import { run, type Io } from "./cli.js";
import { validateConfig, type IssuanceConfig } from "./config.js";
import { buildPlan, completedSteps, planBundle } from "./plan.js";

const ISSUER = Keypair.random().publicKey();
const DIST = Keypair.random().publicKey();
const CO = [Keypair.random().publicKey(), Keypair.random().publicKey()];

const base = (extra: Partial<IssuanceConfig> = {}): IssuanceConfig => ({
  network: "testnet",
  code: "ACME",
  issuer: ISSUER,
  distributor: DIST,
  supply: "1000",
  homeDomain: "acme.example",
  ...extra,
});
const seq = { issuer: "100", distributor: "200" };
const seqOf = (tx: Transaction) => tx.sequence;

describe("multisig issuer", () => {
  const multisig = base({ issuerSigners: [{ key: CO[0], weight: 1 }, { key: CO[1], weight: 1 }], issuerThresholds: { low: 1, med: 2, high: 2 } });

  it("validates signers and thresholds", () => {
    expect(() => validateConfig({ ...multisig, lockIssuer: true })).toThrow(/can't be combined with lockIssuer/);
    expect(() => validateConfig(base({ issuerSigners: [{ key: ISSUER, weight: 1 }] }))).toThrow(/master key/);
    expect(() => validateConfig(base({ issuerSigners: [{ key: CO[0], weight: 1 }], issuerThresholds: { low: 1, med: 2, high: 3 } }))).toThrow(
      /locked out/,
    );
    expect(validateConfig(multisig)).toBeTruthy();
  });

  it("adds a signers step after issuing", () => {
    const steps = buildPlan(validateConfig(multisig), seq);
    expect(steps.map((s) => s.id)).toEqual(["configure", "trust", "issue", "signers"]);
    expect(steps[3].transaction.operations).toHaveLength(3);
  });
});

describe("distribution", () => {
  const entries = (n: number) => Array.from({ length: n }, () => ({ destination: Keypair.random().publicKey(), amount: "1" }));

  it("batches claimable balances 100 per transaction", () => {
    const steps = buildPlan(validateConfig(base({ distribution: entries(250) })), seq);
    const batches = steps.filter((s) => s.id.startsWith("distribute-"));
    expect(batches.map((b) => b.transaction.operations.length)).toEqual([100, 100, 50]);
    expect(batches.every((b) => b.signer === "distributor")).toBe(true);
    // distributor: trust (201), then batches 202–204
    expect(batches.map((b) => seqOf(b.transaction))).toEqual(["202", "203", "204"]);
  });

  it("rejects distributions larger than the supply", () => {
    expect(() => validateConfig(base({ supply: "10", distribution: [{ destination: CO[0], amount: "11" }] }))).toThrow(/more than the supply/);
  });
});

describe("resuming a half-finished issuance", () => {
  const issuerAcct: Partial<HorizonAccount> = {
    home_domain: "acme.example",
    flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
    signers: [{ key: ISSUER, weight: 1 }],
  };
  const withTrust = (balance: string) => ({ balances: [{ asset_type: "credit_alphanum4", asset_code: "ACME", asset_issuer: ISSUER, balance }] });

  it("detects configure, trust and issue from Horizon state", () => {
    expect([...completedSteps(base(), issuerAcct, { balances: [] })]).toEqual(["configure"]);
    expect([...completedSteps(base(), issuerAcct, withTrust("0.0000000"))]).toEqual(["configure", "trust"]);
    expect([...completedSteps(base(), issuerAcct, withTrust("1000.0000000"))]).toEqual(["configure", "trust", "issue"]);
  });

  it("skips done steps and keeps the remaining ones on consecutive sequences", () => {
    const config = base({ lockIssuer: true });
    const done = completedSteps(config, issuerAcct, withTrust("1000.0000000"));
    const steps = buildPlan(config, seq, 3600, done);
    expect(steps.map((s) => s.id)).toEqual(["lock"]);
    expect(seqOf(steps[0].transaction)).toBe("101"); // next issuer sequence, not 103
  });

  it("bundles the plan for offline signing", () => {
    const bundle = planBundle(base(), buildPlan(base(), seq));
    expect(bundle.asset).toBe(`ACME:${ISSUER}`);
    expect(bundle.steps.map((s) => s.step)).toEqual([1, 2, 3]);
    expect(bundle.steps[0].xdr).toMatch(/^AAAA/);
  });
});

describe("stellar.toml checks", () => {
  const acct = (): HorizonAccount => ({
    account_id: ISSUER,
    home_domain: "acme.example",
    flags: { auth_required: false, auth_revocable: false, auth_immutable: true, auth_clawback_enabled: false },
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    signers: [{ key: ISSUER, weight: 0 }],
  });
  const serve = (body: string, cors: string | null) => async () => ({
    ok: true,
    status: 200,
    text: async () => body,
    headers: { get: (n: string) => (n === "access-control-allow-origin" ? cors : null) },
  });

  it("parses currency tables", () => {
    expect(tomlCurrencies(`[[CURRENCIES]]\ncode="A"\nissuer="X"\n[[CURRENCIES]]\ncode="B"\n[DOCUMENTATION]\nORG_NAME="o"`)).toEqual([
      { code: "A", issuer: "X" },
      { code: "B" },
    ]);
  });

  it("fails when the currency names another issuer and warns without CORS", async () => {
    const other = Keypair.random().publicKey();
    const checks = await auditIssuer(acct(), "ACME", serve(`ACCOUNTS=["${ISSUER}"]\n[[CURRENCIES]]\ncode="ACME"\nissuer="${other}"`, null));
    expect(checks.some((c) => c.level === "warn" && /Access-Control-Allow-Origin/.test(c.message))).toBe(true);
    expect(checks.at(-1)).toMatchObject({ level: "fail", message: expect.stringMatching(/different issuer/) });
  });
});

describe("assetStats", () => {
  it("reports holders, supply and the largest balances", async () => {
    const holder = (i: number, balance: string) => ({ account_id: `G${i}`, balances: [{ asset_code: "ACME", asset_issuer: ISSUER, balance }] });
    const fetchJson = async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.includes("/assets?")
          ? { _embedded: { records: [{ accounts: { authorized: 3 }, balances: { authorized: "60.0000000" } }] } }
          : { _embedded: { records: [holder(1, "5"), holder(2, "50"), holder(3, "5")] }, _links: {} },
    });
    const stats = await assetStats("https://h", "ACME", ISSUER, fetchJson);
    expect(stats).toMatchObject({ holders: 3, supply: "60.0000000", partial: false });
    expect(stats.top[0]).toEqual({ account: "G2", balance: "50" });
  });
});

describe("cli plan --out", () => {
  it("writes a JSON bundle and reports skipped steps", async () => {
    const written: Record<string, string> = {};
    const lines: string[] = [];
    const io: Io = {
      out: (l) => lines.push(l),
      readFile: () => JSON.stringify(base()),
      writeFile: (p, d) => (written[p] = d),
      fetch: async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith(ISSUER)
            ? { sequence: "10", home_domain: "acme.example", flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false }, signers: [{ key: ISSUER, weight: 1 }] }
            : { sequence: "20", balances: [] },
        text: async () => "",
      }),
    };
    expect(await run(["plan", "c.json", "--out", "plan.json"], io)).toBe(0);
    expect(lines[0]).toMatch(/Already done on-chain, skipped: configure/);
    const bundle = JSON.parse(written["plan.json"]);
    expect(bundle.steps.map((s: { id: string }) => s.id)).toEqual(["trust", "issue"]);
  });
});
