import {
  Account,
  Asset,
  AuthClawbackEnabledFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Operation,
  TransactionBuilder,
  type AuthFlag,
  type Transaction,
} from "@stellar/stellar-sdk";
import { PASSPHRASE, type IssuanceConfig } from "./config.js";

export interface PlanStep {
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
export function buildPlan(config: IssuanceConfig, seq: Sequences, timeoutSeconds = 3600): PlanStep[] {
  const networkPassphrase = PASSPHRASE[config.network];
  const asset = new Asset(config.code, config.issuer);
  const issuer = new Account(config.issuer, seq.issuer);
  const distributor = new Account(config.distributor, seq.distributor);
  const build = (source: Account, ...ops: ReturnType<typeof Operation.setOptions>[]) => {
    const b = new TransactionBuilder(source, { fee: "1000", networkPassphrase });
    ops.forEach((op) => b.addOperation(op));
    return b.setTimeout(timeoutSeconds).build();
  };

  const steps: PlanStep[] = [];
  const flags = flagsValue(config.flags);
  if (config.homeDomain || flags) {
    steps.push({
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
    title: `Distributor trusts ${config.code}`,
    signer: "distributor",
    notes: ["Creates the trustline the supply will be paid into (costs 0.5 XLM of reserve)"],
    transaction: build(distributor, Operation.changeTrust({ asset }) as ReturnType<typeof Operation.setOptions>),
  });

  steps.push({
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
  return steps;
}
