import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { Specter } from "../target/types/specter";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getArciumProgram,
  uploadCircuit,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getLookupTableAddress,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

const MAX_BIDDERS = 8;
const SENTINEL_AMOUNT = BigInt(0);

describe("Specter — sealed-bid auction", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Specter as Program<Specter>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const arciumProgram = getArciumProgram(provider);

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E
  ): Promise<Event[E]> => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => res(event));
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  it("runs an end-to-end sealed-bid auction", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
    console.log("Owner:", owner.publicKey.toBase58());

    // 1. Init the comp def (idempotent — skip if already initialized)
    try {
      console.log("Initializing sealed-bid computation definition...");
      const sig = await initSealedBidCompDef(program, owner);
      console.log("Init comp def sig:", sig);
    } catch (e: any) {
      if (String(e).includes("already in use") || String(e).includes("custom program error: 0x0")) {
        console.log("Comp def already initialized — skipping");
      } else {
        throw e;
      }
    }

    // 2. Fetch MXE public key
    const mxePublicKey = await getMXEPublicKeyWithRetry(provider, program.programId);
    console.log("MXE x25519 pubkey:", Buffer.from(mxePublicKey).toString("hex"));

    // 3. Create auction with 8s duration
    const auctionNonce = new anchor.BN(randomBytes(8), "hex");
    const [auctionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("auction"),
        owner.publicKey.toBuffer(),
        auctionNonce.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    console.log("Auction PDA:", auctionPda.toBase58());

    const durationSecs = new anchor.BN(8);
    await program.methods
      .createAuction(auctionNonce, 0, durationSecs, "Phantom NFT #001", 1)
      .accounts({
        creator: owner.publicKey,
        auction: auctionPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });
    console.log("Auction created");

    // 4. Three bidders place bids: 1, 2, 3 SOL (in lamports).
    //    For Phase 3 simplicity we use the owner wallet to fund all bidders;
    //    each bidder is a fresh Keypair with its own X25519 key.
    const bidAmounts = [BigInt(1_000_000_000), BigInt(2_000_000_000), BigInt(3_000_000_000)];
    const bidders: BidderCtx[] = [];

    for (let i = 0; i < bidAmounts.length; i++) {
      const bidder = Keypair.generate();
      // Fund bidder
      const transferIx = SystemProgram.transfer({
        fromPubkey: owner.publicKey,
        toPubkey: bidder.publicKey,
        lamports: 50_000_000, // 0.05 SOL — covers bid PDA rent + tx fees
      });
      const tx = new anchor.web3.Transaction().add(transferIx);
      await provider.sendAndConfirm(tx, [owner], { commitment: "confirmed" });

      const ctx = await placeBid(program, provider, auctionPda, bidder, mxePublicKey, bidAmounts[i]);
      bidders.push(ctx);
      console.log(`Bidder ${i} placed bid (${bidAmounts[i]} lamports). ct=${Buffer.from(ctx.ciphertext).toString("hex").slice(0, 16)}...`);
    }

    // 5. Wait for auction to close
    console.log("Waiting for auction to close...");
    await sleep((Number(durationSecs) + 2) * 1000);

    // 6. Build the 15-bid payload (3 real + 12 sentinels). Bid 0's keypair
    //    will own the encrypted result.
    const payload: BidEntry[] = [...bidders];
    while (payload.length < MAX_BIDDERS) {
      payload.push(makeSentinelBid(mxePublicKey));
    }

    // 7. Finalize: queue MPC computation
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    const finalizeSig = await program.methods
      .finalizeAuction(
        computationOffset,
        payload.map((p) => ({
          pubKey: Array.from(p.publicKey),
          nonce: new anchor.BN(deserializeLE(p.nonce).toString()),
          ciphertext: Array.from(p.ciphertext),
        }))
      )
      .accountsPartial({
        payer: owner.publicKey,
        auction: auctionPda,
        computationAccount: getComputationAccAddress(
          arciumEnv.arciumClusterOffset,
          computationOffset
        ),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("evaluate_sealed_bid_auction")).readUInt32LE()
        ),
      })
      .signers([owner])
      .rpc({ skipPreflight: true, commitment: "confirmed" });
    console.log("Finalize queued sig:", finalizeSig);

    const finalizationSig = await awaitComputationFinalization(
      provider,
      computationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Computation finalized sig:", finalizationSig);

    // 8. Read encrypted result from auction account state
    const auction = await program.account.auction.fetch(auctionPda);
    expect(auction.status).to.equal(2); // Closed
    expect(auction.bidCount).to.equal(3);

    // 9. Decrypt result with bidder 0's private key (owner of `bid_0` in the circuit).
    const sharedSecret = x25519.getSharedSecret(bidders[0].privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);
    const [winnerIndexBig, winningAmountBig] = cipher.decrypt(
      [
        Uint8Array.from(auction.resultWinnerIndexCt),
        Uint8Array.from(auction.resultWinningAmountCt),
      ],
      Uint8Array.from(auction.resultNonce)
    );

    console.log("Decrypted winner_index:", winnerIndexBig.toString());
    console.log("Decrypted winning_amount:", winningAmountBig.toString());

    expect(Number(winnerIndexBig)).to.equal(2); // bidder index 2 had the highest bid (3 SOL)
    expect(winningAmountBig).to.equal(BigInt(3_000_000_000));
  });

  async function initSealedBidCompDef(
    program: Program<Specter>,
    owner: anchor.web3.Keypair
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset("evaluate_sealed_bid_auction");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

    const sig = await program.methods
      .initSealedBidCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    const rawCircuit = fs.readFileSync("build/evaluate_sealed_bid_auction.arcis");
    await uploadCircuit(
      provider,
      "evaluate_sealed_bid_auction",
      program.programId,
      rawCircuit,
      true,
      500,
      {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        commitment: "confirmed",
      }
    );

    return sig;
  }
});

interface BidEntry {
  publicKey: Uint8Array;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

interface BidderCtx extends BidEntry {
  privateKey: Uint8Array;
  bidPda: PublicKey;
  signer: Keypair;
}

async function placeBid(
  program: Program<Specter>,
  provider: anchor.AnchorProvider,
  auctionPda: PublicKey,
  bidder: Keypair,
  mxePublicKey: Uint8Array,
  amountLamports: bigint
): Promise<BidderCtx> {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  const nonce = randomBytes(16);
  const ciphertext = cipher.encrypt([amountLamports], nonce)[0];

  const [bidPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bid"), auctionPda.toBuffer(), bidder.publicKey.toBuffer()],
    program.programId
  );

  await program.methods
    .placeBid(
      Array.from(ciphertext),
      Array.from(publicKey),
      new anchor.BN(deserializeLE(nonce).toString())
    )
    .accounts({
      bidder: bidder.publicKey,
      auction: auctionPda,
      bid: bidPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([bidder])
    .rpc({ commitment: "confirmed" });

  return {
    publicKey,
    privateKey,
    ciphertext,
    nonce,
    bidPda,
    signer: bidder,
  };
}

function makeSentinelBid(mxePublicKey: Uint8Array): BidEntry {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  const nonce = randomBytes(16);
  const ciphertext = cipher.encrypt([SENTINEL_AMOUNT], nonce)[0];
  return { publicKey, ciphertext, nonce };
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) return mxePublicKey;
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }
    if (attempt < maxRetries) {
      await sleep(retryDelayMs);
    }
  }
  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
