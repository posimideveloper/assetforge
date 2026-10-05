import { Networks, StrKey } from "@stellar/stellar-sdk";

export interface AssetFlags {
  /** Holders need the issuer's approval before they can hold the asset. */
  authRequired?: boolean;
  /** The issuer can freeze holders' balances. */
  authRevocable?: boolean;
  /** The issuer can claw back balances (requires authRevocable). */
  clawbackEnabled?: boolean;
}

export interface TomlInfo {
  name: string;
  desc: string;
  image?: string;
  orgName: string;
  orgUrl: string;
  orgSupportEmail?: string;
  /** e.g. "fiat", "crypto", "nft", "stock", "bond", "commodity", "realestate", "other" */
  anchorAssetType?: string;
}

/** An extra key that can sign for the issuer (multisig issuer). */
export interface IssuerSigner {
  key: string;
  weight: number;
}

/** One claimable balance to create from the distributor. */
export interface DistributionEntry {
  destination: string;
  amount: string;
}

export interface IssuanceConfig {
  network: "public" | "testnet";
  code: string;
  issuer: string;
  distributor: string;
  /** Initial supply sent to the distributor, as a decimal string. */
  supply: string;
  homeDomain?: string;
  flags?: AssetFlags;
  /** Permanently disable the issuer after issuing, fixing the supply forever. */
  lockIssuer?: boolean;
  /** Co-signers added to an issuer that stays unlocked (multisig issuer). */
  issuerSigners?: IssuerSigner[];
  /** Thresholds for a multisig issuer; the master key keeps weight 1. */
  issuerThresholds?: { low: number; med: number; high: number };
  /** Hand the supply out as claimable balances from the distributor. */
  distribution?: DistributionEntry[];
  toml?: TomlInfo;
}

export const PASSPHRASE = { public: Networks.PUBLIC, testnet: Networks.TESTNET } as const;

/** Largest amount Stellar can represent: int64 stroops. */
const MAX_STROOPS = 9_223_372_036_854_775_807n;

function toStroops(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole || "0") * 10_000_000n + BigInt((frac + "0000000").slice(0, 7));
}

const AMOUNT = /^(?=\.?\d)\d*(\.\d{1,7})?$/;
const DOMAIN = /^(?=.{1,32}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Throws an Error naming the first invalid field. */
export function validateConfig(c: IssuanceConfig): IssuanceConfig {
  if (c.network !== "public" && c.network !== "testnet") throw new Error('network must be "public" or "testnet"');
  if (!/^[A-Za-z0-9]{1,12}$/.test(c.code)) throw new Error("code must be 1-12 letters or digits");
  if (!StrKey.isValidEd25519PublicKey(c.issuer)) throw new Error("issuer must be a G… address");
  if (!StrKey.isValidEd25519PublicKey(c.distributor)) throw new Error("distributor must be a G… address");
  if (c.issuer === c.distributor) {
    throw new Error("issuer and distributor must be different accounts (an issuer can't hold its own asset)");
  }
  if (!AMOUNT.test(c.supply) || Number(c.supply) <= 0) throw new Error("supply must be a positive amount with ≤ 7 decimals");
  if (toStroops(c.supply) > MAX_STROOPS) throw new Error("supply exceeds Stellar's maximum amount");
  if (c.homeDomain !== undefined && !DOMAIN.test(c.homeDomain)) {
    throw new Error("homeDomain must be a domain name of at most 32 characters (no scheme or path)");
  }
  if (c.flags?.clawbackEnabled && !c.flags.authRevocable) {
    throw new Error("clawbackEnabled requires authRevocable");
  }
  if (c.lockIssuer && (c.flags?.authRequired || c.flags?.authRevocable || c.flags?.clawbackEnabled)) {
    throw new Error("a locked issuer can never authorize, freeze or claw back, so lockIssuer can't be combined with auth flags");
  }
  if (c.toml && !c.homeDomain) throw new Error("toml info needs a homeDomain to be published on");

  if (c.issuerSigners?.length || c.issuerThresholds) {
    if (c.lockIssuer) throw new Error("a multisig issuer stays unlocked: issuerSigners can't be combined with lockIssuer");
    const signers = c.issuerSigners ?? [];
    const seen = new Set<string>();
    for (const s of signers) {
      if (!StrKey.isValidEd25519PublicKey(s.key)) throw new Error(`issuerSigners: ${s.key} is not a G… address`);
      if (s.key === c.issuer) throw new Error("issuerSigners: the issuer's own key is the master key, don't list it");
      if (seen.has(s.key)) throw new Error(`issuerSigners: ${s.key} is listed twice`);
      seen.add(s.key);
      if (!Number.isInteger(s.weight) || s.weight < 1 || s.weight > 255) throw new Error("issuerSigners: weights must be 1-255");
    }
    const t = c.issuerThresholds;
    if (t) {
      const total = 1 + signers.reduce((n, s) => n + s.weight, 0); // master key keeps weight 1
      for (const [name, v] of Object.entries(t)) {
        if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`issuerThresholds.${name} must be 0-255`);
        if (v > total) throw new Error(`issuerThresholds.${name} (${v}) is more than all keys together can reach (${total}): the issuer would be locked out`);
      }
      if (!(t.low <= t.med && t.med <= t.high)) throw new Error("issuerThresholds must satisfy low ≤ med ≤ high");
    }
  }

  if (c.distribution?.length) {
    if (c.distribution.length > 1_000) throw new Error("distribution can have at most 1000 entries");
    let total = 0n;
    for (const d of c.distribution) {
      if (!StrKey.isValidEd25519PublicKey(d.destination)) throw new Error(`distribution: ${d.destination} is not a G… address`);
      if (!AMOUNT.test(d.amount) || Number(d.amount) <= 0) throw new Error(`distribution: ${d.amount} is not a positive amount with ≤ 7 decimals`);
      total += toStroops(d.amount);
    }
    if (total > toStroops(c.supply)) throw new Error("distribution adds up to more than the supply");
  }
  return c;
}
