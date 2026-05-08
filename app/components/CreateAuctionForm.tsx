"use client";

import { useState } from "react";
import { SystemProgram } from "@solana/web3.js";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import { getProgram, deriveAuctionPda, randomBytes, friendlyError } from "@/lib/specter";

interface Props {
  onCreated: (auction: string) => void;
}

export function CreateAuctionForm({ onCreated }: Props) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const wallet = useWallet();
  const [description, setDescription] = useState("Phantom NFT #001");
  const [duration, setDuration] = useState("60");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!anchorWallet || !wallet.publicKey) {
      setError("connect a wallet first");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);

      const auctionNonce = new anchor.BN(randomBytes(8), "hex");
      const [auctionPda] = deriveAuctionPda(wallet.publicKey, auctionNonce);

      await program.methods
        .createAuction(
          auctionNonce,
          0,
          new anchor.BN(parseInt(duration, 10)),
          description,
          1
        )
        .accountsPartial({
          creator: wallet.publicKey,
          auction: auctionPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      onCreated(auctionPda.toBase58());
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ghost-dim bg-ghost-surface p-6 space-y-4">
      <div className="text-sm uppercase tracking-widest text-gray-500">
        create auction
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500">item</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-ghost-bg border border-ghost-dim rounded-lg px-3 py-2 mt-1"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">duration (seconds)</label>
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full bg-ghost-bg border border-ghost-dim rounded-lg px-3 py-2 mt-1"
          />
        </div>
      </div>
      <button
        onClick={create}
        disabled={submitting || !wallet.publicKey}
        className="w-full py-3 rounded-lg bg-ghost-accent text-ghost-bg font-semibold disabled:opacity-40"
      >
        {submitting ? "creating…" : "open auction"}
      </button>
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
