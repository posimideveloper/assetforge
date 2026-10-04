export type Level = "ok" | "warn" | "fail";

export interface AuditCheck {
  level: Level;
  message: string;
}

/** The fields of a Horizon /accounts/:id response the audit reads. */
export interface HorizonAccount {
  account_id: string;
  home_domain?: string;
  flags: { auth_required: boolean; auth_revocable: boolean; auth_immutable: boolean; auth_clawback_enabled: boolean };
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
  signers: { key: string; weight: number }[];
}

export type FetchText = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Inspect an issuer account (and its stellar.toml) for common issuance mistakes. */
export async function auditIssuer(
  account: HorizonAccount,
  assetCode: string | undefined,
  fetchText: FetchText = fetch as unknown as FetchText,
): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];
  const add = (level: Level, message: string) => checks.push({ level, message });

  const activeSigners = account.signers.filter((s) => s.weight > 0);
  const locked = activeSigners.length === 0;
  if (locked) add("ok", "Issuer is locked: no key can sign, so supply is fixed forever");
  else {
    add("warn", `Issuer is NOT locked: ${activeSigners.length} key(s) can still issue new supply`);
    if (activeSigners.some((s) => s.weight >= account.thresholds.high_threshold)) {
      add("warn", "A single key meets the high threshold; consider a multisig issuer if it stays unlocked");
    }
  }

  const f = account.flags;
  if (f.auth_clawback_enabled) add("warn", "Clawback is enabled: the issuer can take balances back from holders");
  if (f.auth_revocable) add("warn", "AUTH_REVOCABLE: the issuer can freeze holders");
  if (f.auth_required) add("warn", "AUTH_REQUIRED: holders need the issuer's approval");
  if (!f.auth_revocable && !f.auth_clawback_enabled) add("ok", "Holders can't be frozen or clawed back");
  if (f.auth_immutable) add("ok", "Flags are immutable");

  if (!account.home_domain) {
    add("fail", "No home domain: wallets can't find a stellar.toml, so the asset shows as unverified");
    return checks;
  }
  add("ok", `Home domain is ${account.home_domain}`);

  const url = `https://${account.home_domain}/.well-known/stellar.toml`;
  try {
    const res = await fetchText(url);
    if (!res.ok) {
      add("fail", `${url} returned HTTP ${res.status}`);
      return checks;
    }
    const toml = await res.text();
    if (!toml.includes(account.account_id)) {
      add("fail", "stellar.toml doesn't mention this issuer account");
    } else if (assetCode && !new RegExp(`code\\s*=\\s*"${assetCode}"`).test(toml)) {
      add("fail", `stellar.toml has no [[CURRENCIES]] entry for ${assetCode}`);
    } else {
      add("ok", "stellar.toml lists this issuer");
    }
  } catch {
    add("fail", `Couldn't fetch ${url}`);
  }
  return checks;
}
