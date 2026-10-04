# Issuance checklist

- [ ] Issuer and distributor are separate, funded accounts
- [ ] Decide on flags **before** anyone holds the asset
- [ ] Home domain set and `stellar.toml` served with CORS (`Access-Control-Allow-Origin: *`)
- [ ] Distributor trustline created
- [ ] Full supply issued and the distributor balance verified
- [ ] (Fixed supply) issuer locked as the last step
- [ ] `assetforge audit <issuer> --code <CODE>` passes
- [ ] Asset listed on stellar.expert with the correct name and logo
