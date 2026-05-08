# CLAUDE.md — Specter | Arcium Blind Auction Hackathon

## What We're Building

**Specter** — a privacy-first onchain blind auction platform powered by Arcium's MPC network on Solana.

Three auction modes: Sealed-Bid, Vickrey (second-price), and Uniform (multi-winner clearing price).
Core UX hook: a live **Ghost Leaderboard** (bid count visible, amounts hidden) + a **Reveal Ceremony** when the auction closes (Arcium MPC sorts and reveals all bids dramatically on-chain).

Nobody sees anyone's bid until it's over. The reveal is the experience.

---

## Stack

| Layer | Tech |
|---|---|
| Encrypted Logic | Arcis (Rust) — runs in Arcium MPC |
| Solana Program | Anchor via `arcium` CLI (`#[arcium_program]`) |
| Client SDK | `@arcium-hq/client` TypeScript |
| Frontend | Next.js + Tailwind |
| Encryption | X25519 key exchange + Rescue cipher |
| Network | Solana devnet → mainnet-alpha |

---

## Arcium Mental Model (never forget these)

```
Client encrypts bid → submits to Solana MXE program → MXE queues computation
→ Arcium Program routes to MPC cluster → Arx nodes compute on encrypted data
→ callback fires on Solana with result → frontend reads event
```

- **MXE** = your full app (Solana program + Arcis circuits + MXE account)
- **Confidential Instruction** = Arcis function marked `#[instruction]` — runs in MPC
- **Computation Definition** = compiled circuit stored on-chain, init once
- **`cluster_offset`** = `456` on devnet
- **`computation_offset`** = random u64 per invocation (`randomBytes(8)`)
- **`comp_def_offset`** = `sha256(instruction_name)` truncated to u32
- Output size limit: **~1232 bytes** (fits in one Solana transaction callback)
- `Enc<Shared, T>` = encrypted with shared secret (client + MXE both can decrypt)
- `Enc<Mxe, T>` = MXE-only decryptable

---

## Arcis Encrypted Types Available

- `u8`, `u16`, `u32`, `u64`, `u128`
- `bool`
- Structs (flatten into encrypted fields)
- Arrays (fixed-size)

Comparisons (`>`, `<`, `==`) work on encrypted values in MPC context.

---

## Confidential Instructions We Need

### 1. `evaluate_sealed_bid_auction`
- Input: array of encrypted `(bid_amount: u64, bidder_index: u8)` — up to 15 bids
- Logic: find max bid, return winner index + winning amount
- Output: `Enc<Shared, WinnerResult>` where `WinnerResult = { winner_index: u8, winning_amount: u64 }`

### 2. `evaluate_vickrey_auction`
- Input: array of encrypted `(bid_amount: u64, bidder_index: u8)` — up to 15 bids
- Logic: find max AND second-max bid
- Output: `{ winner_index: u8, winning_amount: u64, pay_price: u64 }` (winner pays second price)

### 3. `evaluate_uniform_auction`
- Input: array of encrypted bids + `num_winners: u8` parameter
- Logic: sort descending, find clearing price (lowest winning bid)
- Output: `{ clearing_price: u64, winner_bitmap: u16 }` (bitmask of winner indices, max 15 bidders)

### 4. `reveal_all_bids` (optional — for Reveal Ceremony)
- Input: array of encrypted bids
- Logic: sort descending, return plaintext sorted order
- Output: sorted `[(amount: u64, bidder_index: u8); 15]`
- Note: only called AFTER auction closes, triggered by auction creator

---

## Solana Program Instructions (per auction type)

For each encrypted instruction, we need 3 Solana instructions:
1. `init_<name>_comp_def` — one-time circuit initialization
2. `<name>` — queue the computation (called at auction close)
3. `<name>_callback` — receives MPC result, updates auction state, emits event

Plus standard auction management:
- `create_auction` — create auction account with type, duration, item metadata
- `place_bid` — bidder submits encrypted bid + ciphertext, stored on-chain
- `finalize_auction` — triggers MPC evaluation computation
- `claim_prize` — winner claims after callback confirms their index

---

## Account Structure

```rust
// Auction account
pub struct Auction {
    pub creator: Pubkey,
    pub auction_type: AuctionType, // SealedBid | Vickrey | Uniform
    pub item_mint: Pubkey,         // NFT or token being auctioned
    pub num_winners: u8,           // for Uniform mode
    pub bid_count: u8,             // max 15
    pub close_time: i64,           // Unix timestamp
    pub status: AuctionStatus,     // Active | Computing | Closed
    pub winner_index: u8,
    pub clearing_price: u64,
}

// Bid account (one per bidder)
pub struct Bid {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub bidder_index: u8,
    pub ciphertext: [u8; 32],      // encrypted bid amount
    pub pub_key: [u8; 32],         // bidder's ephemeral X25519 pubkey
    pub nonce: u128,
}
```

---

## Output Size Math

- `WinnerResult` (sealed): 1 + 8 = 9 bytes ✅
- `VickreyResult`: 1 + 8 + 8 = 17 bytes ✅
- `UniformResult`: 8 + 2 = 10 bytes ✅
- `RevealResult` (15 bids): 15 × (8 + 1) = 135 bytes ✅
- All well within 1232 byte limit.

---

## Key Commands

```bash
# Init project
arcium init specter

# Build (compiles Arcis circuits + Solana program)
arcium build

# Test locally
arcium test

# Test on devnet
arcium test --cluster devnet

# Deploy
arcium deploy --cluster devnet
```

---

## Repo Structure

```
specter/
├── encrypted-ixs/
│   ├── evaluate_sealed_bid.rs
│   ├── evaluate_vickrey.rs
│   ├── evaluate_uniform.rs
│   └── reveal_bids.rs
├── programs/
│   └── specter/
│       └── src/
│           └── lib.rs
├── app/                        ← Next.js frontend
│   ├── components/
│   │   ├── AuctionCard.tsx
│   │   ├── GhostLeaderboard.tsx
│   │   └── RevealCeremony.tsx
│   └── pages/
├── tests/
│   └── specter.ts
├── Arcium.toml
├── Anchor.toml
└── README.md
```

---

## Session Prompt (paste at start of every coding session)

> We are building Specter — a blind auction MXE on Arcium/Solana. Stack: Arcis (Rust encrypted instructions), Anchor Solana program, TypeScript client, Next.js frontend. Current task: [TASK]. Constraints: output < 1232 bytes, max 15 bids per auction, devnet cluster_offset = 456. Never break the encrypted data flow: Client encrypts → Solana queues → MPC cluster computes → callback fires → frontend reads event. Reference CLAUDE.md for full context.

## Phase Prompt (paste when starting a new phase)

> Starting Phase [N] of Specter. Phase goal: [GOAL]. Previous phase completed: [WHAT WAS DONE]. Do not refactor previous phase work unless there's a bug. Focus only on the current phase deliverable.

## Stuck Prompt

> I'm stuck on [SPECIFIC THING] in Specter. Here's the error/blocker: [PASTE ERROR]. We're using Arcium's MPC framework — Arcis for encrypted instructions, arcium_anchor for Solana CPI, @arcium-hq/client for TypeScript. Likely related to: [your guess]. Suggest 3 possible fixes in order of likelihood.

## Commit Prompt

> Review the current state of Specter Phase [N]. Summarize: what was built, what works, what's left for next phase, and any known issues. Format as a git commit message + brief phase notes.
