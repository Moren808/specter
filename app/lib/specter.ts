import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Connection } from "@solana/web3.js";
import {
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  x25519,
} from "@arcium-hq/client";
import idl from "../../target/idl/specter.json";
import type { Specter } from "../../target/types/specter";

// Browser-safe replacement for Node `crypto.randomBytes`.
export function randomBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("WebCrypto getRandomValues is unavailable in this environment");
  }
  globalThis.crypto.getRandomValues(arr);
  return arr;
}

export const ARCIUM_CLUSTER_OFFSET = parseInt(
  process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET || "0",
  10
);

export const SPECTER_PROGRAM_ID = new PublicKey(
  "2APecQcb3XQ5hiQrY56hpEUb85am72Rj4PuvV5spRn5H"
);

export const MAX_BIDDERS = 8;

export type AuctionStatus = "Active" | "Computing" | "Closed";

export function getProgram(provider: anchor.AnchorProvider): anchor.Program<Specter> {
  return new anchor.Program(idl as any, provider) as anchor.Program<Specter>;
}

export function deriveAuctionPda(
  creator: PublicKey,
  auctionNonce: anchor.BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("auction"),
      creator.toBuffer(),
      auctionNonce.toArrayLike(Buffer, "le", 8),
    ],
    SPECTER_PROGRAM_ID
  );
}

export function deriveBidPda(
  auction: PublicKey,
  bidder: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bid"), auction.toBuffer(), bidder.toBuffer()],
    SPECTER_PROGRAM_ID
  );
}

export interface EncryptedBid {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  ciphertext: number[];
  nonce: Uint8Array;
}

export async function encryptBid(
  provider: anchor.AnchorProvider,
  bidLamports: bigint
): Promise<EncryptedBid & { mxePublicKey: Uint8Array }> {
  const mxePublicKey = await getMXEPublicKey(provider, SPECTER_PROGRAM_ID);
  if (!mxePublicKey) throw new Error("MXE pubkey unavailable");

  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  const nonce = new Uint8Array(randomBytes(16));
  const ciphertext = cipher.encrypt([bidLamports], nonce)[0];

  return { privateKey, publicKey, ciphertext, nonce, mxePublicKey };
}

export function makeSentinelBid(mxePublicKey: Uint8Array): EncryptedBid {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  const nonce = new Uint8Array(randomBytes(16));
  const ciphertext = cipher.encrypt([BigInt(0)], nonce)[0];
  return { privateKey, publicKey, ciphertext, nonce };
}

export function decryptResult(
  bidderPrivateKey: Uint8Array,
  mxePublicKey: Uint8Array,
  winnerIndexCt: number[],
  winningAmountCt: number[],
  resultNonce: number[]
): { winnerIndex: number; winningAmount: bigint } {
  const sharedSecret = x25519.getSharedSecret(bidderPrivateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  const [w, a] = cipher.decrypt(
    [winnerIndexCt, winningAmountCt],
    Uint8Array.from(resultNonce)
  );
  return { winnerIndex: Number(w), winningAmount: a as bigint };
}

export function statusFromU8(s: number): AuctionStatus {
  return ["Active", "Computing", "Closed"][s] as AuctionStatus;
}

export function nonceToBN(nonce: Uint8Array): anchor.BN {
  return new anchor.BN(deserializeLE(nonce).toString());
}

// Persist a bidder's ephemeral X25519 keypair so they can later decrypt
// the result if they win. Keyed by auction PDA + wallet address.
export const bidKeyStorage = {
  save(auction: string, wallet: string, bid: EncryptedBid, mxePub: Uint8Array) {
    if (typeof window === "undefined") return;
    const key = `specter:bid:${auction}:${wallet}`;
    sessionStorage.setItem(
      key,
      JSON.stringify({
        privateKey: Array.from(bid.privateKey),
        publicKey: Array.from(bid.publicKey),
        ciphertext: Array.from(bid.ciphertext),
        nonce: Array.from(bid.nonce),
        mxePublicKey: Array.from(mxePub),
      })
    );
  },
  load(auction: string, wallet: string) {
    if (typeof window === "undefined") return null;
    const raw = sessionStorage.getItem(`specter:bid:${auction}:${wallet}`);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return {
      privateKey: Uint8Array.from(o.privateKey),
      publicKey: Uint8Array.from(o.publicKey),
      ciphertext: Uint8Array.from(o.ciphertext),
      nonce: Uint8Array.from(o.nonce),
      mxePublicKey: Uint8Array.from(o.mxePublicKey),
    };
  },
};

export type Connection_ = Connection; // re-export marker

// Friendlier error messages — strip the technical noise from common Solana/Anchor errors.
export function friendlyError(e: any): string {
  const raw = e?.message || String(e);
  if (raw.includes("Attempt to load a program that does not exist")) {
    return "specter program isn't deployed on this cluster — see README for devnet/localnet setup";
  }
  if (raw.includes("WalletNotReadyError")) {
    return "install Phantom or Solflare to continue";
  }
  if (raw.includes("User rejected")) return "transaction rejected";
  if (raw.includes("0x1770")) return "auction is not active";
  if (raw.includes("0x1771")) return "auction has expired";
  if (raw.includes("0x1772")) return "auction is full (max 8 bidders)";
  if (raw.includes("0x1773")) return "auction is still active — wait for the timer";
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}
