"use client";

import { useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import {
  getProgram,
  encryptBid,
  deriveBidPda,
  nonceToBN,
  bidKeyStorage,
  friendlyError,
} from "@/lib/specter";

interface Props {
  auctionPda: PublicKey;
  onPlaced?: () => void;
}

export function BidForm({ auctionPda, onPlaced }: Props) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const wallet = useWallet();
  const [solAmount, setSolAmount] = useState<string>("1.0");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function placeBid() {
    if (!anchorWallet || !wallet.publicKey) {
      setError("connect a wallet first");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      setStatus("encrypting bid locally…");
      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);

      const lamports = BigInt(Math.round(parseFloat(solAmount) * 1e9));
      const enc = await encryptBid(provider, lamports);

      const [bidPda] = deriveBidPda(auctionPda, wallet.publicKey);

      setStatus("submitting sealed bid to Solana…");
      await program.methods
        .placeBid(
          Array.from(enc.ciphertext),
          Array.from(enc.publicKey),
          nonceToBN(enc.nonce)
        )
        .accountsPartial({
          bidder: wallet.publicKey,
          auction: auctionPda,
          bid: bidPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });

      bidKeyStorage.save(
        auctionPda.toBase58(),
        wallet.publicKey.toBase58(),
        enc,
        enc.mxePublicKey
      );

      setStatus("🔐 your bid is sealed. nobody can see it.");
      onPlaced?.();
    } catch (e: any) {
      setError(friendlyError(e));
      setStatus("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ghost-dim bg-ghost-surface p-6 space-y-4">
      <div className="text-sm uppercase tracking-widest text-gray-500">
        place sealed bid
      </div>
      <div className="flex items-center gap-3">
        <input
          type="number"
          step="0.01"
          min="0"
          value={solAmount}
          onChange={(e) => setSolAmount(e.target.value)}
          disabled={submitting}
          className="flex-1 bg-ghost-bg border border-ghost-dim rounded-lg px-4 py-3 text-2xl font-mono focus:outline-none focus:border-ghost-accent"
        />
        <span className="text-gray-500">SOL</span>
      </div>
      <button
        onClick={placeBid}
        disabled={submitting || !wallet.publicKey}
        className="w-full py-3 rounded-lg bg-ghost-accent text-ghost-bg font-semibold disabled:opacity-40"
      >
        {submitting ? "sealing…" : "submit sealed bid"}
      </button>
      {status && <div className="text-xs text-gray-400">{status}</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
