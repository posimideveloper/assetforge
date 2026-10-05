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

export type FetchText = (
  url: string,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; headers?: { get: (name: string) => string | null } }>;

/** The [[CURRENCIES]] tables of a stellar.toml, as key → value maps (strings only). */
export function tomlCurrencies(toml: string): Record<string, string>[] {
  return toml
    .split(/^\s*\[\[CURRENCIES\]\]\s*$/m)
    .slice(1)
    .map((block) => {
      const body = block.split(/^\s*\[/m)[0]; // stop at the next table
      const out: Record<string, string> = {};
      for (const m of body.matchAll(/^\s*([A-Za-z_]+)\s*=\s*"([^"]*)"/gm)) out[m[1]] = m[2];
      return out;
    });
}

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
    const cors = res.headers?.get("access-control-allow-origin");
    if (res.headers && cors !== "*") {
      add("warn", "stellar.toml isn't served with Access-Control-Allow-Origin: *, so browser wallets can't read it");
    }
    const currencies = tomlCurrencies(toml);
    if (!toml.includes(account.account_id)) {
      add("fail", "stellar.toml doesn't mention this issuer account");
    } else if (assetCode && !currencies.some((c) => c.code === assetCode)) {
      add("fail", `stellar.toml has no [[CURRENCIES]] entry for ${assetCode}`);
    } else if (assetCode && !currencies.some((c) => c.code === assetCode && c.issuer === account.account_id)) {
      add("fail", `stellar.toml's ${assetCode} entry names a different issuer`);
    } else {
      add("ok", "stellar.toml lists this issuer");
    }
  } catch {
    add("fail", `Couldn't fetch ${url}`);
  }
  return checks;
}

export interface AssetStats {
  holders: number;
  supply: string;
  /** Largest balances seen (from up to `maxAccounts` holders). */
  top: { account: string; balance: string }[];
  /** True when there were more holders than were scanned for `top`. */
  partial: boolean;
}

type FetchJson = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Holder count, circulating supply and the largest holders of an asset. */
export async function assetStats(
  horizonUrl: string,
  code: string,
  issuer: string,
  fetchJson: FetchJson = fetch as unknown as FetchJson,
  maxAccounts = 1_000,
): Promise<AssetStats> {
  const res = await fetchJson(`${horizonUrl}/assets?asset_code=${code}&asset_issuer=${issuer}`);
  if (!res.ok) throw new Error(`Horizon returned HTTP ${res.status} for the asset`);
  const record = ((await res.json()) as { _embedded: { records: { accounts?: { authorized: number }; balances?: { authorized: string } }[] } })
    ._embedded.records[0];
  const holders = record?.accounts?.authorized ?? 0;
  const supply = record?.balances?.authorized ?? "0";

  const balances: { account: string; balance: string }[] = [];
  let url: string | null = `${horizonUrl}/accounts?asset=${code}:${issuer}&limit=200`;
  while (url && balances.length < maxAccounts) {
    const page = (await (await fetchJson(url)).json()) as {
      _embedded: { records: { account_id: string; balances: { asset_code?: string; asset_issuer?: string; balance: string }[] }[] };
      _links: { next?: { href: string } };
    };
    const records = page._embedded.records;
    for (const a of records) {
      const b = a.balances.find((x) => x.asset_code === code && x.asset_issuer === issuer);
      if (b) balances.push({ account: a.account_id, balance: b.balance });
    }
    url = records.length === 200 ? (page._links.next?.href ?? null) : null;
  }
  balances.sort((x, y) => Number(y.balance) - Number(x.balance));
  return { holders, supply, top: balances.slice(0, 10), partial: holders > balances.length };
}