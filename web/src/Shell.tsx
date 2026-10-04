import { useState, type ReactNode } from "react";

import { Link, useTitle } from "./lib/router";

const NAV = [
  ["/", "Home"],
  ["/app", "Studio"],
  ["/docs", "Docs"],
] as const;

const REPO = "https://github.com/posimideveloper/assetforge";

function HeaderAction() {
  return (
    <a className="hammer hammer-hot inline-block" href={REPO} target="_blank" rel="noreferrer">
      GitHub ↗
    </a>
  );
}

export function Shell({ route, children }: { route: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-rivet bg-steel/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
            <span className="text-xl font-black uppercase tracking-tight text-spark">asset<span className="text-molten">forge</span></span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map(([to, label]) => (
              <Link key={to} to={to} className={`rounded-[3px] px-3.5 py-2 text-xs font-extrabold uppercase tracking-wider ${route === to ? "bg-molten text-[#1a0c00]" : "text-ash hover:text-spark"}`}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="hidden md:block">
            <HeaderAction />
          </div>
          <button className="hammer hammer-cold px-3 py-2 md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu" aria-expanded={open}>
            {open ? "✕" : "☰"}
          </button>
        </div>
        {open && (
          <div className="space-y-1 border-t border-rivet px-5 py-4 md:hidden" onClick={() => setOpen(false)}>
            {NAV.map(([to, label]) => (
              <Link key={to} to={to} className={`block rounded-[3px] px-3.5 py-2 text-xs font-extrabold uppercase tracking-wider ${route === to ? "bg-molten text-[#1a0c00]" : "text-ash hover:text-spark"}`}>
                {label}
              </Link>
            ))}
            <div className="pt-2">
              <HeaderAction />
            </div>
          </div>
        )}
        
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-20 border-t border-rivet bg-iron">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="text-xl font-black uppercase tracking-tight text-spark">asset<span className="text-molten">forge</span></p>
            <p className="mt-2 max-w-xs text-sm text-ash">Issue classic Stellar assets in the only safe order, and audit any issuer.</p>
          </div>
          <div className="text-sm">
            <p className="font-semibold text-spark">Product</p>
            <ul className="mt-3 space-y-2 text-ash">
              <li><Link to="/app" className="hover:underline">Studio</Link></li>
              <li><Link to="/docs" className="hover:underline">Documentation</Link></li>
              <li><a href="#/docs" onClick={() => setTimeout(() => document.getElementById("faq")?.scrollIntoView(), 60)} className="hover:underline">FAQ</a></li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="font-semibold text-spark">Open source</p>
            <ul className="mt-3 space-y-2 text-ash">
              <li><a href={REPO} target="_blank" rel="noreferrer" className="hover:underline">GitHub</a></li>
              
              <li><a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="hover:underline">MIT license</a></li>
            </ul>
          </div>
        </div>
        <p className="pb-8 text-center text-xs text-ash opacity-80">Issuer settings are permanent. Run the exact config on testnet before you touch mainnet.</p>
      </footer>
    </div>
  );
}

export function NotFound() {
  useTitle("Not found · assetforge");
  return (
    <section className="mx-auto max-w-xl px-5 py-28 text-center">
      <p className="text-8xl font-black uppercase tracking-tight text-molten">404</p>
      <p className="mt-4 text-lg text-ash">There’s nothing at this address.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link to="/" className="hammer hammer-hot inline-block">Back home</Link>
        <Link to="/docs" className="hammer hammer-cold inline-block">Read the docs</Link>
      </div>
    </section>
  );
}
