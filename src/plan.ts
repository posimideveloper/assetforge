import {
  Account,
  Asset,
  Claimant,
  AuthClawbackEnabledFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Operation,
  TransactionBuilder,
  type AuthFlag,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { HorizonAccount } from "./audit.js";
import { PASSPHRASE, type IssuanceConfig } from "./config.js";

export type StepId = "configure" | "trust" | "issue" | "lock" | "signers" | `distribute-${number}`;

export interface PlanStep {
  id: StepId;
  title: string;
  /** Which key must sign this step. */
  signer: "issuer" | "distributor";
  /** Human-readable consequences, especially irreversible ones. */
  notes: string[];
  transaction: Transaction;
}

export interface Sequences {
  issuer: string;
  distributor: string;
}

export function flagsValue(flags: IssuanceConfig["flags"]): number {
  let value = 0;
  if (flags?.authRequired) value |= AuthRequiredFlag;
  if (flags?.authRevocable) value |= AuthRevocableFlag;
  if (flags?.clawbackEnabled) value |= AuthClawbackEnabledFlag;
  return value;
}

/**
 * Build the issuance as ordered, unsigned transactions. Order matters:
 * flags must be set before any trustline exists (clawback only applies to
 * trustlines created afterwards), and the issuer is locked last.
 */
export function buildPlan(
  config: IssuanceConfig,
  seq: Sequences,
  timeoutSeconds = 3600,
  /** Steps already done on-chain (see completedSteps); they're left out so nothing runs twice. */
  skip: Set<StepId> = new Set(),
): PlanStep[] {
  const networkPassphrase = PASSPHRASE[config.network];
  const asset = new Asset(config.code, config.issuer);
  let issuer = new Account(config.issuer, seq.issuer);
  let distributor = new Account(config.distributor, seq.distributor);
  const build = (source: Account, ...ops: ReturnType<typeof Operation.setOptions>[]) => {
    const b = new TransactionBuilder(source, { fee: "1000", networkPassphrase });
    ops.forEach((op) => b.addOperation(op));
    return b.setTimeout(timeoutSeconds).build();
  };

  const all: PlanStep[] = [];
  // Building a step's transaction advances its source account's sequence. A
  // skipped step won't be submitted, so roll that back to keep the steps that
  // do run on consecutive sequence numbers.
  const steps = {
    push: (s: PlanStep) => {
      if (!skip.has(s.id)) return all.push(s);
      const back = (a: Account) => (BigInt(a.sequenceNumber()) - 1n).toString();
      if (s.signer === "issuer") issuer = new Account(config.issuer, back(issuer));
      else distributor = new Account(config.distributor, back(distributor));
    },
  };
  const flags = flagsValue(config.flags);
  if (config.homeDomain || flags) {
    steps.push({
      id: "configure",
      title: "Configure the issuer (home domain and flags)",
      signer: "issuer",
      notes: [
        ...(config.homeDomain ? [`Wallets will look for https://${config.homeDomain}/.well-known/stellar.toml`] : []),
        ...(config.flags?.authRequired ? ["Holders must be approved by the issuer before receiving the asset"] : []),
        ...(config.flags?.authRevocable ? ["The issuer can freeze holders"] : []),
        ...(config.flags?.clawbackEnabled ? ["The issuer can claw back balances from new trustlines"] : []),
      ],
      transaction: build(
        issuer,
        Operation.setOptions({
          ...(config.homeDomain ? { homeDomain: config.homeDomain } : {}),
          ...(flags ? { setFlags: flags as AuthFlag } : {}),
        }),
      ),
    });
  }

  steps.push({
    id: "trust",
    title: `Distributor trusts ${config.code}`,
    signer: "distributor",
    notes: ["Creates the trustline the supply will be paid into (costs 0.5 XLM of reserve)"],
    transaction: build(distributor, Operation.changeTrust({ asset }) as ReturnType<typeof Operation.setOptions>),
  });

  steps.push({
    id: "issue",
    title: `Issue ${config.supply} ${config.code} to the distributor`,
    signer: "issuer",
    notes: ["Payments from the issuer create new supply"],
    transaction: build(
      issuer,
      Operation.payment({ destination: config.distributor, asset, amount: config.supply }) as ReturnType<
        typeof Operation.setOptions
      >,
    ),
  });

  if (config.lockIssuer) {
    steps.push({
      id: "lock",
      title: "Lock the issuer (fix the supply forever)",
      signer: "issuer",
      notes: [
        "IRREVERSIBLE: sets the master key weight to 0, so no further supply can ever be issued",
        "Run this only after confirming the distributor received the full supply",
      ],
      transaction: build(
        issuer,
        Operation.setOptions({ masterWeight: 0, lowThreshold: 1, medThreshold: 1, highThreshold: 1 }),
      ),
    });
  }
  if (config.issuerSigners?.length || config.issuerThresholds) {
    const t = config.issuerThresholds;
    steps.push({
      id: "signers",
      title: "Make the issuer multisig",
      signer: "issuer",
      notes: [
        ...(config.issuerSigners ?? []).map((s) => `Adds co-signer ${s.key.slice(0, 4)}…${s.key.slice(-4)} with weight ${s.weight}`),
        ...(t ? [`Thresholds low ${t.low} / medium ${t.med} / high ${t.high}; the master key keeps weight 1`] : []),
        "Issuing more supply will need these signatures from now on",
      ],
      transaction: build(
        issuer,
        ...(config.issuerSigners ?? []).map((s) => Operation.setOptions({ signer: { ed25519PublicKey: s.key, weight: s.weight } })),
        ...(t ? [Operation.setOptions({ lowThreshold: t.low, medThreshold: t.med, highThreshold: t.high })] : []),
      ),
    });
  }

  // Claimable balances from the distributor, 100 per transaction (the
  // operation limit). The distributor is a second claimant so unclaimed
  // balances can be taken back.
  const entries = config.distribution ?? [];
  for (let start = 0, batch = 1; start < entries.length; start += 100, batch++) {
    const chunk = entries.slice(start, start + 100);
    steps.push({
      id: `distribute-${batch}`,
      title: `Distribute to ${chunk.length} recipient${chunk.length === 1 ? "" : "s"} (batch ${batch})`,
      signer: "distributor",
      notes: [
        "Creates claimable balances: recipients claim once they trust the asset",
        "The distributor can reclaim any balance that isn't claimed",
      ],
      transaction: build(
        distributor,
        ...chunk.map(
          (d) =>
            Operation.createClaimableBalance({
              asset,
              amount: d.amount,
              claimants: [
                new Claimant(d.destination, Claimant.predicateUnconditional()),
                new Claimant(config.distributor, Claimant.predicateUnconditional()),
              ],
            }) as ReturnType<typeof Operation.setOptions>,
        ),
      ),
    });
  }
  return all;
}

/** Distributor account fields used to detect progress. */
export interface HorizonBalances {
  balances?: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }[];
}

/**
 * Which plan steps have already happened on-chain, so a half-finished
 * issuance can resume without repeating anything (re-issuing supply would
 * be a real mistake). Distribution batches can't be detected and always run.
 */
export function completedSteps(
  config: IssuanceConfig,
  issuer: Partial<HorizonAccount>,
  distributor: HorizonBalances,
): Set<StepId> {
  const done = new Set<StepId>();
  const f = issuer.flags;
  const flagsOk =
    !!f &&
    (!config.flags?.authRequired || f.auth_required) &&
    (!config.flags?.authRevocable || f.auth_revocable) &&
    (!config.flags?.clawbackEnabled || f.auth_clawback_enabled);
  if (flagsOk && (!config.homeDomain || issuer.home_domain === config.homeDomain)) done.add("configure");

  const line = distributor.balances?.find(
    (b) => b.asset_type !== "native" && b.asset_code === config.code && b.asset_issuer === config.issuer,
  );
  if (line) done.add("trust");
  if (line && Number(line.balance) >= Number(config.supply)) done.add("issue");

  const signers = issuer.signers;
  if (signers && signers.every((s) => s.weight === 0)) done.add("lock");
  const wantsMultisig = !!(config.issuerSigners?.length || config.issuerThresholds);
  if (
    wantsMultisig &&
    signers &&
    (config.issuerSigners ?? []).every((want) => signers.some((s) => s.key === want.key && s.weight === want.weight)) &&
    (!config.issuerThresholds ||
      (issuer.thresholds?.low_threshold === config.issuerThresholds.low &&
        issuer.thresholds?.med_threshold === config.issuerThresholds.med &&
        issuer.thresholds?.high_threshold === config.issuerThresholds.high))
  )
    done.add("signers");
  return done;
}

/** A portable bundle of the plan, for offline or hardware-wallet signing. */
export function planBundle(config: IssuanceConfig, steps: PlanStep[]) {
  return {
    network: config.network,
    networkPassphrase: PASSPHRASE[config.network],
    asset: `${config.code}:${config.issuer}`,
    steps: steps.map((s, i) => ({ step: i + 1, id: s.id, title: s.title, signer: s.signer, notes: s.notes, xdr: s.transaction.toXDR() })),
  };
}
