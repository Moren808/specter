"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import {
  getProgram,
  statusFromU8,
  decryptResult,
  bidKeyStorage,
} from "@/lib/specter";

interface Props {
  auctionPda: PublicKey;
}

type Stage = "waiting" | "lifting" | "winner" | "amount";

export function RevealCeremony({ auctionPda }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [stage, setStage] = useState<Stage>("waiting");
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [winningAmount, setWinningAmount] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ro = { publicKey: PublicKey.default, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any;
    const provider = new anchor.AnchorProvider(connection, ro, { commitment: "confirmed" });
    const program = getProgram(provider);

    async function poll() {
      try {
        const a = await program.account.auction.fetch(auctionPda);
        if (cancelled) return;
        const status = statusFromU8(a.status);
        if (status !== "Closed") return;

        // Stage 1: shadows lift
        setStage("lifting");
        await new Promise((r) => setTimeout(r, 1200));
        if (cancelled) return;

        // Try to decrypt — only the bid_0 holder can fully decrypt.
        if (!wallet.publicKey) {
          setStage("winner");
          return;
        }
        const stored = bidKeyStorage.load(
          auctionPda.toBase58(),
          wallet.publicKey.toBase58()
        );
        if (!stored) {
          setStage("winner");
          return;
        }
        try {
          const { winnerIndex, winningAmount } = decryptResult(
            stored.privateKey,
            stored.mxePublicKey,
            Array.from(a.resultWinnerIndexCt),
            Array.from(a.resultWinningAmountCt),
            Array.from(a.resultNonce)
          );
          setWinnerIndex(winnerIndex);
          setStage("winner");
          await new Promise((r) => setTimeout(r, 1200));
          if (cancelled) return;
          setWinningAmount(winningAmount);
          setStage("amount");
        } catch (e: any) {
          setError(`Decrypt failed: ${e.message || e}`);
          setStage("winner");
        }
      } catch {
        // not ready
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [auctionPda, connection, wallet.publicKey]);

  if (stage === "waiting") {
    return (
      <div className="rounded-2xl border border-ghost-dim bg-ghost-surface p-8 text-center text-gray-500">
        the reveal will materialize when the auction closes…
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-ghost-accent bg-ghost-surface p-8 text-center space-y-4">
      <div className="text-xs uppercase tracking-[0.3em] text-ghost-accent">
        Reveal Ceremony
      </div>

      {stage === "lifting" && (
        <div className="text-2xl materialize">the shadows lift…</div>
      )}

      {(stage === "winner" || stage === "amount") && (
        <div className="space-y-2">
          <div className="text-sm text-gray-500">winner</div>
          <div className="text-4xl font-bold materialize">
            {winnerIndex !== null ? `Bidder #${winnerIndex}` : "—"}
          </div>
          {winnerIndex === null && (
            <div className="text-xs text-gray-600">
              only bidder 0's wallet can decrypt the result locally
            </div>
          )}
        </div>
      )}

      {stage === "amount" && winningAmount !== null && (
        <div className="space-y-2 pt-4 border-t border-ghost-dim">
          <div className="text-sm text-gray-500">winning bid</div>
          <div className="text-3xl font-bold text-emerald-300 materialize">
            {(Number(winningAmount) / 1e9).toFixed(4)} SOL
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400 mt-4">{error}</div>
      )}
    </div>
  );
}
