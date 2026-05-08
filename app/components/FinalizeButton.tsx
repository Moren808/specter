"use client";

import { useEffect, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  useConnection,
  useWallet,
  useAnchorWallet,
} from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import {
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getClusterAccAddress,
  getMXEAccAddress,
  getMXEPublicKey,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
} from "@arcium-hq/client";
import {
  getProgram,
  deriveBidPda,
  makeSentinelBid,
  nonceToBN,
  randomBytes,
  ARCIUM_CLUSTER_OFFSET,
  MAX_BIDDERS,
  SPECTER_PROGRAM_ID,
} from "@/lib/specter";

interface Props {
  auctionPda: PublicKey;
}

export function FinalizeButton({ auctionPda }: Props) {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const wallet = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const [closeTime, setCloseTime] = useState(0);
  const [status, setStatus] = useState<number>(0);
  const [bidCount, setBidCount] = useState(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ro = {
      publicKey: PublicKey.default,
      signTransaction: async (t: any) => t,
      signAllTransactions: async (t: any) => t,
    } as any;
    const provider = new anchor.AnchorProvider(connection, ro, {
      commitment: "confirmed",
    });
    const program = getProgram(provider);
    async function poll() {
      try {
        const a = await program.account.auction.fetch(auctionPda);
        if (cancelled) return;
        setCloseTime(Number(a.closeTime));
        setStatus(a.status);
        setBidCount(a.bidCount);
      } catch {}
    }
    poll();
    const i = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, [auctionPda, connection]);

  const canFinalize =
    status === 0 && closeTime > 0 && now >= closeTime && bidCount > 0;

  async function finalize() {
    if (!anchorWallet || !wallet.publicKey) {
      setError("connect a wallet first");
      return;
    }
    setError(null);
    setMessage(null);
    setSubmitting(true);
    try {
      const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
      });
      const program = getProgram(provider);

      setMessage("loading bids and MXE pubkey…");
      const [bids, mxePub] = await Promise.all([
        program.account.bid.all([
          { memcmp: { offset: 8, bytes: auctionPda.toBase58() } },
        ]),
        getMXEPublicKey(provider, SPECTER_PROGRAM_ID),
      ]);
      if (!mxePub) throw new Error("MXE pubkey unavailable");

      const sortedBids = bids
        .map((b) => b.account)
        .sort((a, b) => a.bidderIndex - b.bidderIndex);

      const payload: {
        publicKey: number[];
        nonce: anchor.BN;
        ciphertext: number[];
      }[] = sortedBids.map((b) => ({
        publicKey: Array.from(b.pubKey as number[]),
        nonce: new anchor.BN(b.nonce),
        ciphertext: Array.from(b.ciphertext as number[]),
      }));

      while (payload.length < MAX_BIDDERS) {
        const sentinel = makeSentinelBid(mxePub);
        payload.push({
          publicKey: Array.from(sentinel.publicKey),
          nonce: nonceToBN(sentinel.nonce),
          ciphertext: Array.from(sentinel.ciphertext),
        });
      }

      const computationOffset = new anchor.BN(randomBytes(8));

      // Decode the comp def offset (first 4 bytes, little-endian)
      const compDefBytes = getCompDefAccOffset("evaluate_sealed_bid_auction");
      const compDefU32 = new DataView(
        compDefBytes.buffer,
        compDefBytes.byteOffset,
        compDefBytes.byteLength
      ).getUint32(0, true);

      setMessage("submitting finalize_auction tx…");
      await program.methods
        .finalizeAuction(computationOffset, payload as any)
        .accountsPartial({
          payer: wallet.publicKey,
          auction: auctionPda,
          computationAccount: getComputationAccAddress(
            ARCIUM_CLUSTER_OFFSET,
            computationOffset
          ),
          clusterAccount: getClusterAccAddress(ARCIUM_CLUSTER_OFFSET),
          mxeAccount: getMXEAccAddress(SPECTER_PROGRAM_ID),
          mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          compDefAccount: getCompDefAccAddress(SPECTER_PROGRAM_ID, compDefU32),
          systemProgram: SystemProgram.programId,
        })
        .rpc({ skipPreflight: true, commitment: "confirmed" });

      setMessage("queued — Arcium MPC is computing the winner…");
    } catch (e: any) {
      setError(friendlyError(e));
      setMessage(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 2) return null; // already closed
  if (status === 1) {
    return (
      <div className="rounded-2xl border border-ghost-dim bg-ghost-surface p-4 text-center text-xs text-ghost-accent">
        finalization queued — waiting for MPC callback
      </div>
    );
  }

  const remaining = Math.max(0, closeTime - now);

  return (
    <div className="rounded-2xl border border-ghost-dim bg-ghost-surface p-6 space-y-3">
      <div className="text-sm uppercase tracking-widest text-gray-500">
        close auction
      </div>
      <div className="text-xs text-gray-500">
        {remaining > 0
          ? `available in ${remaining}s — anyone can call finalize once the timer hits zero`
          : `${bidCount} bid${bidCount === 1 ? "" : "s"} on chain · padding to ${MAX_BIDDERS} sentinels`}
      </div>
      <button
        onClick={finalize}
        disabled={submitting || !canFinalize || !wallet.publicKey}
        className="w-full py-3 rounded-lg bg-ghost-accent text-ghost-bg font-semibold disabled:opacity-40"
      >
        {submitting ? "queueing…" : "finalize & reveal"}
      </button>
      {message && <div className="text-xs text-gray-400">{message}</div>}
      {error && <div className="text-xs text-red-400 break-all">{error}</div>}
    </div>
  );
}

function friendlyError(e: any): string {
  const raw = e?.message || String(e);
  if (raw.includes("Attempt to load a program that does not exist")) {
    return "specter program isn't deployed on this cluster — see README for devnet/localnet setup";
  }
  if (raw.includes("0x1771")) return "auction is still active — wait for the timer";
  if (raw.includes("0x1770")) return "auction is not active";
  return raw;
}
