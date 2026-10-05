import { AuthClawbackEnabledFlag, AuthRevocableFlag, Keypair, Networks, type Transaction } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { auditIssuer, type HorizonAccount } from "./audit.js";
import { validateConfig, type IssuanceConfig } from "./config.js";
import { buildPlan, flagsValue } from "./plan.js";
import { generateToml } from "./toml.js";
import { run, type Io } from "./cli.js";

const ISSUER = Keypair.random().publicKey();
const DIST = Keypair.random().publicKey();

const base = (extra: Partial<IssuanceConfig> = {}): IssuanceConfig => ({
  network: "testnet",
  code: "ACME",
  issuer: ISSUER,
  distributor: DIST,
  supply: "1000000",
  homeDomain: "acme.example",
  ...extra,
});

const ops = (tx: Transaction) => tx.operations;

describe("validateConfig", () => {
  it.each([
    [{ code: "TOOLONGASSETCODE" }, /code/],
    [{ issuer: "GNOPE" }, /issuer/],
    [{ distributor: ISSUER }, /must be different/],
    [{ supply: "0" }, /supply/],
    [{ supply: "1.12345678" }, /supply/],
    [{ supply: "922337203686" }, /maximum/],
    [{ homeDomain: "https://acme.example" }, /homeDomain/],
    [{ flags: { clawbackEnabled: true } }, /requires authRevocable/],
    [{ lockIssuer: true, flags: { authRequired: true } }, /lockIssuer can't be combined/],
    [{ homeDomain: undefined, toml: { name: "A", desc: "B", orgName: "C", orgUrl: "https://c" } }, /homeDomain/],
  ])("rejects %j", (extra, message) => {
    expect(() => validateConfig(base(extra as Partial<IssuanceConfig>))).toThrow(message);
  });

  it("accepts a sensible config", () => {
    expect(() => validateConfig(base({ lockIssuer: true }))).not.toThrow();
  });
});

describe("buildPlan", () => {
  it("orders configure → trust → issue → lock with consecutive sequences", () => {
    const steps = buildPlan(base({ lockIssuer: true }), { issuer: "100", distributor: "500" });
    expect(steps.map((s) => s.signer)).toEqual(["issuer", "distributor", "issuer", "issuer"]);
    expect(steps.map((s) => s.transaction.sequence)).toEqual(["101", "501", "102", "103"]);
    for (const s of steps) expect(s.transaction.networkPassphrase).toBe(Networks.TESTNET);

    const [configure, trust, issue, lock] = steps.map((s) => ops(s.transaction)[0]);
    expect(configure).toMatchObject({ type: "setOptions", homeDomain: "acme.example" });
    expect(trust).toMatchObject({ type: "changeTrust" });
    expect(issue).toMatchObject({ type: "payment", destination: DIST, amount: "1000000.0000000" });
    expect(lock).toMatchObject({ type: "setOptions", masterWeight: 0 });
    expect(steps[3].notes[0]).toMatch(/IRREVERSIBLE/);
  });

  it("sets flags before the trustline exists, and skips configure when nothing to set", () => {
    const flagged = buildPlan(base({ flags: { authRevocable: true, clawbackEnabled: true } }), { issuer: "1", distributor: "1" });
    expect(ops(flagged[0].transaction)[0]).toMatchObject({ setFlags: AuthRevocableFlag | AuthClawbackEnabledFlag });
    expect(flagged[0].notes.join(" ")).toMatch(/claw back/);

    const minimal = buildPlan(base({ homeDomain: undefined }), { issuer: "1", distributor: "1" });
    expect(minimal.map((s) => s.title)).toEqual(["Distributor trusts ACME", "Issue 1000000 ACME to the distributor"]);
  });

  it("maps flags", () => {
    expect(flagsValue(undefined)).toBe(0);
    expect(flagsValue({ authRequired: true, authRevocable: true })).toBe(3);
  });
});

describe("generateToml", () => {
  it("emits issuer, currency and documentation sections, escaping strings", () => {
    const toml = generateToml(
      base({
        lockIssuer: true,
        toml: { name: 'Acme "Gold" Credits', desc: "Loyalty points", orgName: "Acme", orgUrl: "https://acme.example", anchorAssetType: "other" },
      }),
    );
    expect(toml).toContain(`ACCOUNTS=["${ISSUER}"]`);
    expect(toml).toContain('NETWORK_PASSPHRASE="Test SDF Network ; September 2015"');
    expect(toml).toContain('name="Acme \\"Gold\\" Credits"');
    expect(toml).toContain("fixed_number=1000000");
    expect(toml).toContain("is_unlimited=false");
    expect(toml).toContain("is_asset_anchored=false");
  });
});

const account = (extra: Partial<HorizonAccount> = {}): HorizonAccount => ({
  account_id: ISSUER,
  home_domain: "acme.example",
  flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
  thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
  signers: [{ key: ISSUER, weight: 0 }],
  ...extra,
});

const tomlFetch = (body: string, status = 200) => async () => ({ ok: status === 200, status, text: async () => body });

describe("auditIssuer", () => {
  it("passes a locked issuer with a matching stellar.toml", async () => {
    const checks = await auditIssuer(account(), "ACME", tomlFetch(`ACCOUNTS=["${ISSUER}"]\n[[CURRENCIES]]\ncode="ACME"\nissuer="${ISSUER}"`));
    expect(checks.every((c) => c.level === "ok")).toBe(true);
  });

  it("warns about an unlocked issuer, freezing and clawback", async () => {
    const checks = await auditIssuer(
      account({
        signers: [{ key: ISSUER, weight: 1 }],
        flags: { auth_required: false, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: true },
      }),
      undefined,
      tomlFetch(ISSUER),
    );
    const warnings = checks.filter((c) => c.level === "warn").map((c) => c.message).join(" | ");
    expect(warnings).toMatch(/NOT locked/);
    expect(warnings).toMatch(/Clawback/);
    expect(warnings).toMatch(/freeze/);
  });

  it("fails without a home domain or a matching toml", async () => {
    expect((await auditIssuer(account({ home_domain: undefined }), "ACME")).at(-1)?.level).toBe("fail");
    const noCurrency = await auditIssuer(account(), "ACME", tomlFetch(`ACCOUNTS=["${ISSUER}"]`));
    expect(noCurrency.at(-1)).toMatchObject({ level: "fail", message: expect.stringMatching(/no \[\[CURRENCIES\]\] entry/) });
    const missing = await auditIssuer(account(), "ACME", tomlFetch("", 404));
    expect(missing.at(-1)?.message).toMatch(/HTTP 404/);
  });
});

describe("cli", () => {
  const io = (files: Record<string, string>, accounts: Record<string, unknown>): Io & { lines: string[] } => {
    const lines: string[] = [];
    return {
      lines,
      out: (l) => lines.push(l),
      readFile: (p) => files[p],
      fetch: async (url: string) => {
        const id = url.split("/").pop()!;
        const body = accounts[id];
        return {
          ok: body !== undefined,
          status: body === undefined ? 404 : 200,
          json: async () => body,
          text: async () => `ACCOUNTS=["${ISSUER}"]\ncode="ACME"`,
        };
      },
    };
  };

  it("plan prints numbered, signer-labelled XDR steps", async () => {
    const t = io({ "c.json": JSON.stringify(base({ lockIssuer: true })) }, {
      [ISSUER]: { sequence: "10" },
      [DIST]: { sequence: "20" },
    });
    expect(await run(["plan", "c.json"], t)).toBe(0);
    const text = t.lines.join("\n");
    expect(text).toMatch(/Step 1: Configure the issuer .*\(sign with: issuer\)/);
    expect(text).toMatch(/Step 4: Lock the issuer/);
    expect(t.lines.filter((l) => /^ {2}AAAA/.test(l))).toHaveLength(4);
  });

  it("plan explains unfunded accounts", async () => {
    const t = io({ "c.json": JSON.stringify(base()) }, { [ISSUER]: { sequence: "1" } });
    expect(await run(["plan", "c.json"], t)).toBe(1);
    expect(t.lines[0]).toMatch(/doesn't exist on testnet; fund it first/);
  });

  it("audit exits 2 on failures", async () => {
    const t = io({}, { [ISSUER]: account({ home_domain: undefined }) });
    expect(await run(["audit", ISSUER, "--testnet"], t)).toBe(2);
    expect(t.lines.join("\n")).toMatch(/✘ No home domain/);
  });
});
