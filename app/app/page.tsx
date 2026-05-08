"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import dynamic from "next/dynamic";
import { GhostLeaderboard } from "@/components/GhostLeaderboard";
import { RevealCeremony } from "@/components/RevealCeremony";
import { BidForm } from "@/components/BidForm";
import { CreateAuctionForm } from "@/components/CreateAuctionForm";
import { FinalizeButton } from "@/components/FinalizeButton";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (m) => m.WalletMultiButton
    ),
  { ssr: false }
);

export default function Home() {
  const [auctionAddr, setAuctionAddr] = useState<string>("");
  const [copied, setCopied] = useState(false);

  // Sync ?auction=<pda> URL param both ways
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("auction");
    if (fromUrl) setAuctionAddr(fromUrl);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (auctionAddr) url.searchParams.set("auction", auctionAddr);
    else url.searchParams.delete("auction");
    window.history.replaceState({}, "", url.toString());
  }, [auctionAddr]);

  const auctionPda = (() => {
    try {
      return auctionAddr ? new PublicKey(auctionAddr) : null;
    } catch {
      return null;
    }
  })();

  const network = process.env.NEXT_PUBLIC_NETWORK || "devnet";
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

  function copyAuction() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main className="min-h-screen px-6 py-12 max-w-4xl mx-auto">
      <header className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-ghost-accent">Specter</span>
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            your bid is real, but unseen — until reveal
          </p>
        </div>
        <WalletMultiButton />
      </header>

      <div className="text-xs text-gray-600 mb-10">
        cluster: <span className="text-ghost-accent">{network}</span>
        {rpcUrl ? <span className="ml-2">· custom RPC</span> : null}
      </div>

      <section className="space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          <CreateAuctionForm onCreated={setAuctionAddr} />
          <div className="rounded-2xl border border-ghost-dim bg-ghost-surface p-6 space-y-4">
            <div className="text-sm uppercase tracking-widest text-gray-500">
              load auction
            </div>
            <input
              value={auctionAddr}
              onChange={(e) => setAuctionAddr(e.target.value)}
              placeholder="auction PDA"
              className="w-full bg-ghost-bg border border-ghost-dim rounded-lg px-3 py-2 font-mono text-sm"
            />
            {auctionAddr && !auctionPda && (
              <div className="text-xs text-red-400">invalid pubkey</div>
            )}
          </div>
        </div>

        {auctionPda && (
          <div className="space-y-6 pt-6 border-t border-ghost-dim">
            <div className="rounded-xl border border-ghost-dim bg-ghost-surface/50 p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-widest text-gray-500">
                  auction pda
                </div>
                <div className="font-mono text-xs truncate text-gray-300 mt-1">
                  {auctionPda.toBase58()}
                </div>
              </div>
              <button
                onClick={copyAuction}
                className="text-xs px-3 py-2 rounded-md border border-ghost-dim hover:border-ghost-accent flex-shrink-0"
              >
                {copied ? "copied!" : "copy share link"}
              </button>
            </div>

            <GhostLeaderboard auctionPda={auctionPda} />
            <BidForm auctionPda={auctionPda} />
            <FinalizeButton auctionPda={auctionPda} />
            <RevealCeremony auctionPda={auctionPda} />
          </div>
        )}
      </section>

      <footer className="mt-16 text-xs text-gray-600 text-center">
        powered by Arcium MPC · running on Solana
      </footer>
    </main>
  );
}
