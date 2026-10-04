import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { StrKey } from "@stellar/stellar-sdk";
import { auditIssuer, type HorizonAccount } from "./audit.js";
import { validateConfig, type IssuanceConfig } from "./config.js";
import { buildPlan } from "./plan.js";
import { generateToml } from "./toml.js";

const HORIZON = { public: "https://horizon.stellar.org", testnet: "https://horizon-testnet.stellar.org" };

const HELP = `assetforge — issue Stellar assets the safe way

Usage:
  assetforge plan  <config.json>                 ordered, unsigned issuance transactions
  assetforge toml  <config.json>                 the stellar.toml to publish
  assetforge audit <G…issuer> [--code ACME] [--testnet]

Sign each "plan" step in your wallet or Stellar Lab, in order.`;

export interface Io {
  out: (line: string) => void;
  fetch: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;
  readFile: (path: string) => string;
}

const defaultIo: Io = {
  out: console.log,
  fetch: fetch as unknown as Io["fetch"],
  readFile: (p) => readFileSync(p, "utf8"),
};

async function loadAccount(io: Io, network: "public" | "testnet", id: string): Promise<HorizonAccount & { sequence: string }> {
  const res = await io.fetch(`${HORIZON[network]}/accounts/${id}`);
  if (res.status === 404) throw new Error(`account ${id} doesn't exist on ${network}; fund it first`);
  if (!res.ok) throw new Error(`Horizon returned HTTP ${res.status} for ${id}`);
  return (await res.json()) as HorizonAccount & { sequence: string };
}

export async function run(argv: string[], io: Io = defaultIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === "plan" || command === "toml") {
      if (!rest[0]) throw new Error(`${command} needs a config file`);
      const config = validateConfig(JSON.parse(io.readFile(rest[0])) as IssuanceConfig);
      if (command === "toml") {
        io.out(generateToml(config));
        return 0;
      }
      const [issuer, distributor] = await Promise.all([
        loadAccount(io, config.network, config.issuer),
        loadAccount(io, config.network, config.distributor),
      ]);
      // buildPlan reuses one Account object per signer, and TransactionBuilder
      // increments its sequence on every build, so consecutive steps by the
      // same account get consecutive sequence numbers automatically.
      const steps = buildPlan(config, { issuer: issuer.sequence, distributor: distributor.sequence });
      steps.forEach((step, i) => {
        io.out(`\nStep ${i + 1}: ${step.title}  (sign with: ${step.signer})`);
        for (const note of step.notes) io.out(`  • ${note}`);
        io.out(`  ${step.transaction.toXDR()}`);
      });
      return 0;
    }
    if (command === "audit") {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { code: { type: "string" }, testnet: { type: "boolean", default: false } },
        allowPositionals: true,
      });
      const id = positionals[0];
      if (!id || !StrKey.isValidEd25519PublicKey(id)) throw new Error("audit needs an issuer G… address");
      const account = await loadAccount(io, values.testnet ? "testnet" : "public", id);
      const checks = await auditIssuer(account, values.code, io.fetch);
      const icon = { ok: "✔", warn: "⚠", fail: "✘" };
      for (const c of checks) io.out(`${icon[c.level]} ${c.message}`);
      return checks.some((c) => c.level === "fail") ? 2 : 0;
    }
    io.out(HELP);
    return command === undefined || command === "--help" || command === "-h" ? 0 : 1;
  } catch (err) {
    io.out(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
