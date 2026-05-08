# Specter — Private Blind Auctions on Solana

> "Your bid is real. But until close — it's a ghost."

Specter is a trustless blind-auction platform on Solana powered by [Arcium](https://arcium.com)'s Multi-Party Computation network. Bids are encrypted on the client, evaluated **without decryption** by Arcium's MPC nodes, and revealed only after the auction closes.

Built for the Arcium RTG: [Blind Auctions](https://rtg.arcium.com/rtg/dev-blind-auctions).

## How it works

```
[Bidder]            [Solana program]            [Arcium MPC cluster]
encrypt bid ───────▶ store ciphertext  ┐
                                       │
                                  finalize ────▶ evaluate on encrypted data
                                       │              │
                                  callback ◀──── encrypted WinnerResult
                                       │
                            update Auction account
                                       │
                                       ▼
                            [Bidder] decrypts result client-side
```

- **X25519 + Rescue cipher** locks bid amounts client-side
- **Arcis circuit** ([encrypted-ixs/src/lib.rs](encrypted-ixs/src/lib.rs)) compares encrypted `u64` amounts in MPC and returns an encrypted `WinnerResult { winner_index, winning_amount }`
- **Anchor program** ([programs/specter/src/lib.rs](programs/specter/src/lib.rs)) coordinates `create_auction`, `place_bid`, `finalize_auction`, the MPC callback, and `claim_prize`
- **Frontend** ([app/](app/)) shows a live "Ghost Leaderboard" (count only, no amounts) and animates a Reveal Ceremony when MPC finishes

## Constraints

| | |
|---|---|
| Max bidders per auction | **8** (Anchor's `BorshInstructionCoder` allocates a 1000-byte instruction buffer; 8 × 80-byte `BidData` entries fit comfortably) |
| Output size | 65 bytes (winner_index ct + winning_amount ct + nonce) — well under the 1232-byte Solana callback limit |
| Encryption | X25519 key exchange, Rescue cipher (one ciphertext per encrypted scalar) |

## Running

You need:
- Rust + `cargo build-sbf` (via Solana 3.x CLI for builds)
- Solana CLI 2.x for `solana-test-validator` (3.x crashes on `--bind-address 0.0.0.0` that Arcium passes)
- Anchor 0.32.1 (`avm install 0.32.1 && avm use 0.32.1`)
- Arcium CLI 0.9.7 (`arcup install`)
- Docker Desktop (Arcium localnet pulls `arcium/arx-node` and `arcium/trusted-dealer`)
- Node 18+ and Yarn

### Path A — Local end-to-end (recommended for dev)

```bash
# 1. Build everything (use Solana 3.x for build-sbf)
agave-install init 3.1.14
arcium build

# 2. Run the integration test (uses Solana 2.x for test-validator)
agave-install init 2.1.0
arcium test --skip-build

# 3. (Optional) Keep localnet running and wire the frontend to it
arcium localnet                                    # in one shell
cd app
cp .env.example .env.local
# set NEXT_PUBLIC_NETWORK=localnet
# set NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET=0
yarn install
yarn dev                                           # http://localhost:3000
```

### Path B — Devnet (shareable demo)

```bash
# Fund the deployer wallet (faucet.solana.com) with ~5 SOL
agave-install init 3.1.14
arcium build
arcium deploy --cluster devnet                     # ~5 SOL
arcium test --cluster devnet                       # optional sanity check

cd app
cp .env.example .env.local
# default NEXT_PUBLIC_NETWORK=devnet works — set NEXT_PUBLIC_RPC_URL if rate-limited
yarn install
yarn dev
```

The frontend reads the IDL and types from `target/idl/specter.json` + `target/types/specter.ts`, so a successful `arcium build` is required before `yarn dev`.

## Structure

```
specter/
├── encrypted-ixs/src/lib.rs           ← Arcis circuit (MPC)
├── programs/specter/src/lib.rs        ← Anchor program
├── tests/specter.ts                   ← End-to-end test (passes in 23s)
├── app/                               ← Next.js 14 frontend
│   ├── app/page.tsx
│   ├── components/
│   │   ├── CreateAuctionForm.tsx
│   │   ├── BidForm.tsx
│   │   ├── GhostLeaderboard.tsx       ← live bid count + countdown
│   │   ├── FinalizeButton.tsx         ← triggers MPC computation
│   │   └── RevealCeremony.tsx         ← staged reveal animation
│   └── lib/specter.ts                 ← encrypt / derive / decrypt helpers
├── Anchor.toml
├── Arcium.toml                        ← devnet cluster offset = 456
└── CLAUDE.md / BUILD_GUIDE.md / PHASE_0_CHECKLIST.md
```

## Privacy guarantees

- The auctioneer cannot see bid amounts during the auction
- Other bidders cannot see bid amounts at any point
- Arcium nodes never see plaintext (dishonest-majority MPC security model)
- Only the encrypted result is written on-chain — the holder of `bid_0`'s ephemeral X25519 key (typically the auction creator or first bidder) decrypts it client-side

## Known limitations

1. Max 8 bidders per auction (see Constraints)
2. Bid amounts in u64 lamports (max ~18.4M SOL)
3. Sealed bids are final — no cancellation
4. MPC computation takes ~30–60 seconds after `finalize_auction`
5. The on-chain `claim_prize` currently only emits an event; real escrow/transfer is mocked for the hackathon

## License

MIT
