# Architecture

```text
config.ts   validateConfig  catches irreversible mistakes up front
plan.ts     buildPlan       ordered unsigned transactions
toml.ts     generateToml    stellar.toml for wallets
audit.ts    auditIssuer     inspects a live issuer + its stellar.toml
cli.ts      plan | toml | audit
```

## Why the order matters

1. **Flags first.** Clawback only applies to trustlines created *after* the
   flag is set. Setting it later silently exempts early holders.
2. **Trustline before payment.** The distributor must trust the asset to
   receive it.
3. **Issue before locking.** Locking is irreversible. Lock first and you can
   never mint the supply.

`buildPlan` reuses one `Account` object per signer, and `TransactionBuilder`
increments its sequence on each build, so consecutive steps by the same
account always get consecutive sequence numbers.

## Audit checks

Lock status (no positive-weight signer), single-key control, freeze and
clawback powers, home domain presence, and stellar.toml reachability and
contents (issuer listed, asset code present).
