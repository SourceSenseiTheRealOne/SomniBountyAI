"use client";

import Link from "next/link";
import { useSomniBounty, type UiPaidBounty } from "@/hooks/use-somnibounty";

function shortWallet(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function PaidBountyRow({ bounty }: { bounty: UiPaidBounty }) {
  return (
    <tr className="border-b border-white/7 last:border-0">
      <td className="px-4 py-4 font-mono text-xs text-emerald-100">
        FIX-{bounty.fixId.toString().padStart(3, "0")}
      </td>
      <td className="px-4 py-4">
        <p className="font-display text-sm font-semibold text-white">{bounty.project}</p>
        <p className="mt-1 font-mono text-xs text-white/45">
          INC-{bounty.incidentId.toString().padStart(3, "0")}
        </p>
      </td>
      <td className="px-4 py-4 font-mono text-xs text-cyan-100">
        {shortWallet(bounty.payoutRecipient)}
      </td>
      <td className="px-4 py-4 font-mono text-xs text-amber-200">{bounty.amount}</td>
      <td className="px-4 py-4">
        <span className="rounded-full border border-emerald-200/20 bg-emerald-300/10 px-3 py-1 font-mono text-xs text-emerald-100">
          {bounty.verifierResult}
        </span>
      </td>
      <td className="px-4 py-4">
        <a
          href={bounty.proofURI}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-cyan-100 underline decoration-cyan-200/30 underline-offset-4"
        >
          PR proof
        </a>
      </td>
      <td className="px-4 py-4">
        <a
          href={bounty.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-emerald-100 underline decoration-emerald-200/30 underline-offset-4"
        >
          Explorer
        </a>
      </td>
    </tr>
  );
}

export function PaidBounties() {
  const bounty = useSomniBounty(null, null);

  return (
    <main className="noise scanlines relative min-h-[100dvh] overflow-hidden bg-[#030706] px-4 py-5 text-foreground sm:px-6 lg:px-8">
      <div className="aurora" aria-hidden="true" />
      <div className="starfield" aria-hidden="true" />
      <div className="grid-floor" aria-hidden="true" />
      <div className="relative z-10 mx-auto max-w-[86rem]">
        <nav className="nav-glass flex flex-wrap items-center justify-between gap-3 rounded-full border border-white/10 px-4 py-3">
          <Link href="/" className="iris-text font-display text-base font-semibold">
            SomniBounty AI
          </Link>
          <Link href="/" className="btn-ghost px-4 py-2 text-sm">
            Console
          </Link>
        </nav>

        <section className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="holo-panel rounded-[1.5rem] border border-white/10 p-5 sm:p-6">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-emerald-200/70">
                paid history
              </p>
              <h1 className="chrome-text mt-3 font-display text-3xl font-semibold sm:text-5xl">
                Paid Bounties
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-white/55">
                Live Somnia testnet records where verifier result is VALID and escrow released STT.
              </p>

              <div className="mt-7 overflow-hidden rounded-[1.1rem] border border-white/8 bg-white/[0.025]">
                {bounty.paidBounties.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[54rem] border-collapse text-left">
                      <thead className="border-b border-white/8 bg-white/[0.035]">
                        <tr>
                          {[
                            "Fix",
                            "Project",
                            "Recipient",
                            "Amount",
                            "Verifier",
                            "PR",
                            "Chain",
                          ].map((label) => (
                            <th
                              key={label}
                              className="px-4 py-3 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-white/45"
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bounty.paidBounties.map((item) => (
                          <PaidBountyRow key={item.fixId.toString()} bounty={item} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-5 py-14 text-center">
                    <p className="font-display text-xl font-semibold text-white">
                      No paid bounties yet
                    </p>
                    <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-white/52">
                      History appears after live contract data contains a paid fix.
                    </p>
                  </div>
                )}
              </div>
          </div>

          <aside className="holo-panel rounded-[1.5rem] border border-white/10 p-5">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-cyan-100/70">
                sync
              </p>
              <div className="mt-5 rounded-xl holo-card border border-white/8 p-4">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-white/45">
                  status
                </p>
                <p className="mt-3 text-sm leading-6 text-white/55">{bounty.status}</p>
              </div>
              <div className="mt-3 rounded-xl holo-card border border-white/8 p-4">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-white/45">
                  paid records
                </p>
                <p className="mt-3 font-display text-3xl font-semibold text-emerald-100">
                  {String(bounty.paidBounties.length).padStart(2, "0")}
                </p>
              </div>
              {bounty.contractAddress ? (
                <a
                  href={`${bounty.explorerBase}/address/${bounty.contractAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex rounded-full border border-emerald-200/20 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-300/16"
                >
                  Contract explorer
                </a>
              ) : null}
          </aside>
        </section>
      </div>
    </main>
  );
}
