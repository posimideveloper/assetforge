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
  return c;
}
