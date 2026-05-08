"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import { getProgram, statusFromU8, AuctionStatus } from "@/lib/specter";

interface Props {
  auctionPda: PublicKey;
}

export function GhostLeaderboard({ auctionPda }: Props) {
  const { connection } = useConnection();
  const [bidCount, setBidCount] = useState<number>(0);
  const [status, setStatus] = useState<AuctionStatus>("Active");
  const [closeTime, setCloseTime] = useState<number>(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const wallet = { publicKey: PublicKey.default, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any;
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const program = getProgram(provider);

    async function poll() {
      try {
        const a = await program.account.auction.fetch(auctionPda);
        if (cancelled) return;
        setBidCount(a.bidCount);
        setStatus(statusFromU8(a.status));
        setCloseTime(Number(a.closeTime));
      } catch {
        // PDA may not exist yet
      }
    }

    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [auctionPda, connection]);

  const remaining = Math.max(0, closeTime - now);
  const mm = Math.floor(remaining / 60).toString().padStart(2, "0");
  const ss = (remaining % 60).toString().padStart(2, "0");

  return (
    <div className="rounded-2xl border border-ghost-dim bg-ghost-surface p-8 text-center">
      <div className="text-7xl font-bold text-ghost-accent flex items-center justify-center gap-3">
        <span>{bidCount}</span>
        <span className="opacity-70">🌑</span>
      </div>
      <div className="mt-2 text-sm uppercase tracking-widest text-gray-500">
        shadows competing
      </div>

      <div className="mt-6">
        {status === "Active" && (
          <div className="text-3xl font-mono">
            {closeTime ? `${mm}:${ss}` : "—:—"}
          </div>
        )}
        {status === "Computing" && (
          <div className="rounded-md py-3 px-4 shimmer text-ghost-accent">
            Arcium MPC is evaluating encrypted bids…
          </div>
        )}
        {status === "Closed" && (
          <div className="text-emerald-400 font-semibold">
            Auction closed — see reveal below
          </div>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-600">
        nobody — not even the auctioneer — can see bid amounts
      </div>
    </div>
  );
}
