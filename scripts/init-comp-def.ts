// One-off script: initializes the `evaluate_sealed_bid_auction` comp def on
// the cluster pointed to by ANCHOR_PROVIDER_URL and uploads the compiled
// Arcis circuit from build/evaluate_sealed_bid_auction.arcis.
//
// Run:
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
//   ANCHOR_WALLET=~/.config/solana/id.json \
//   yarn ts-node scripts/init-comp-def.ts

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Specter } from "../target/types/specter";
import {
  getArciumAccountBaseSeed,
  getArciumProgramId,
  getArciumProgram,
  uploadCircuit,
  getMXEAccAddress,
  getLookupTableAddress,
  getCompDefAccOffset,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Specter as Program<Specter>;
  const arciumProgram = getArciumProgram(provider);

  const owner = anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(
      JSON.parse(
        fs.readFileSync(
          process.env.ANCHOR_WALLET!.replace("~", os.homedir()),
          "utf8"
        )
      )
    )
  );

  console.log("provider URL:", provider.connection.rpcEndpoint);
  console.log("payer:", owner.publicKey.toBase58());
  console.log("program:", program.programId.toBase58());

  const baseSeedCompDefAcc = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const offset = getCompDefAccOffset("evaluate_sealed_bid_auction");

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgramId()
  )[0];
  console.log("comp def PDA:", compDefPDA.toBase58());

  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

  // Skip init if already exists
  const compDefInfo = await provider.connection.getAccountInfo(compDefPDA);
  if (compDefInfo) {
    console.log("comp def already initialized — skipping init_sealed_bid_comp_def");
  } else {
    console.log("calling init_sealed_bid_comp_def…");
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
    console.log("init_sealed_bid_comp_def sig:", sig);
  }

  console.log("uploading encrypted circuit (build/evaluate_sealed_bid_auction.arcis)…");
  console.warn(
    "  note: devnet upload requires ~70 SOL of rent for the 9.4MB circuit account.\n" +
      "  if you don't have that, prefer Path A (Arcium localnet) — see README."
  );
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

  console.log("done — comp def + circuit ready on", provider.connection.rpcEndpoint);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
