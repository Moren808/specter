# PHASE_0_CHECKLIST.md — Specter Pre-Build

Complete every item before writing a single line of code.

---

## 1. UNDERSTAND THE RULES ✅

**RTG:** Blind Auctions (Sealed-Bid / Vickrey / Uniform) — Arcium
**Source:** https://rtg.arcium.com/rtg/dev-blind-auctions

### Requirements
- [x] Functional Solana project integrated with Arcium
- [x] Clear explanation of how Arcium is used + privacy benefits
- [x] Open-source GitHub repo
- [x] Submission in English

### Judging Criteria (weight your time accordingly)
| Criteria | Our Angle |
|---|---|
| Innovation | Ghost Leaderboard + Reveal Ceremony UX — nobody has done this |
| Technical | Arcis circuits for 3 auction types, real on-chain execution |
| UX | Countdown UI, live ghost count, animated reveal |
| Impact | Fair price discovery for NFTs, token launches, whitelist sales |
| Clarity | One-sentence pitch + demo video |

---

## 2. STRESS-TEST THE IDEA ✅

**Core Idea:** Specter — blind auction platform with Ghost Leaderboard + Reveal Ceremony

### Killer Question Battery

**Q: Is this actually novel?**
A: Yes. Blind auctions exist. Arcium integration exists in theory. But nobody has built the reveal ceremony UX — where Arcium MPC outputs a sorted bid list that animates on-chain at close. That is genuinely new.

**Q: Is it too ambitious to ship in a hackathon?**
A: No. Start with Sealed-Bid only (Phase 1). Vickrey and Uniform are optional extensions. Core MXE is small — 1 encrypted instruction, 3 Solana instructions, simple frontend. The Ghost Leaderboard is just a bid counter pulled from on-chain — no extra MPC needed.

**Q: What's the demo-able moment?**
A: Create auction → 3 people bid → timer closes → Arcium computes winner → reveal animates. That's a 60-second demo. Perfect.

**Q: Where could it break technically?**
A: Output size. If we try to reveal 15 bids × 9 bytes = 135 bytes — fine. Max 15 bids is a hard design constraint we accept and document clearly.

**Q: Does it use Arcium naturally or forced?**
A: Natural. The entire point of a blind auction is that bids must be private during bidding. MPC is the only trustless way to do this on-chain. This is the canonical use case.

**Q: What's the competition?**
A: Lit Protocol blind auctions (TEE-based, not MPC), OpenSea timed auctions (not blind), custom ZK auction circuits (complex). Specter is MPC + UX + multi-mode in one package. No direct competitor.

**Q: What's the one-sentence pitch?**
A: "Specter uses Arcium's MPC to run sealed-bid auctions where your bid is real but invisible — until the moment it materializes at reveal."

### Decision: ✅ Build it. Start with Sealed-Bid. Vickrey is stretch goal. Reveal Ceremony is the demo hook.

---

## 3. ENVIRONMENT SETUP CHECKLIST

### Prerequisites
- [ ] Rust installed (`rustup`, stable toolchain)
- [ ] Solana CLI installed (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`)
- [ ] Anchor CLI installed (v0.31+)
- [ ] Arcium CLI installed (`arcup` version manager from Arcium docs)
- [ ] Node.js 18+ installed
- [ ] Yarn installed
- [ ] Solana wallet keypair at `~/.config/solana/id.json`
- [ ] Devnet SOL funded (use `solana airdrop 2 --url devnet`)

### Verify installs
```bash
rustc --version
solana --version
anchor --version
arcium --version
node --version
```

### Project init
```bash
arcium init specter
cd specter
yarn install
```

### Arcium.toml — add devnet cluster
```toml
[clusters.devnet]
offset = 456
```

---

## 4. SCOPE LOCK — What we are NOT building

These are explicitly out of scope for hackathon submission:
- [ ] ~~Real token/NFT escrow~~ (use mock mint for demo)
- [ ] ~~More than 15 bidders~~ (design constraint, document it)
- [ ] ~~Mainnet deployment~~ (devnet is enough for RTG)
- [ ] ~~Bid cancellation~~ (sealed bids are final)
- [ ] ~~Multiple concurrent auctions per demo~~ (one clean demo auction)
- [ ] ~~Biometric or identity verification~~ (any wallet can bid)

---

## 5. PHASE PLAN

| Phase | Deliverable | Target |
|---|---|---|
| 0 | This checklist + CLAUDE.md + BUILD_GUIDE.md | Before any code |
| 1 | Arcis circuit: `evaluate_sealed_bid_auction` | Core MPC logic |
| 2 | Solana program: create_auction, place_bid, finalize, callback | On-chain coordination |
| 3 | TypeScript client: encrypt bid, submit, await callback | End-to-end flow |
| 4 | Next.js frontend: create, bid, Ghost Leaderboard, Reveal | Demo-ready UI |
| 5 | README + demo video script + 4-slide deck | Submission package |

---

## 6. COMPETITIVE ANALYSIS NOTES

| Project | Mechanism | Gap vs Specter |
|---|---|---|
| Lit Protocol auctions | TEE-based sealed bid | Centralized trust assumption, no MPC |
| OpenSea timed auctions | Public bids, no privacy | Zero privacy |
| Custom ZK circuits | zk-SNARK bid comparison | Complex, slow, no reveal ceremony |
| Dialect + Metaplex | Open ascending auctions | Fully public, no encryption |
| Specter | Arcium MPC | Trustless, multi-mode, UX-first reveal |

Our moat: **Arcium's MPC + the Reveal Ceremony UX + multi auction type support in one clean interface**.

---

## 7. GITHUB REPO PREP

- [ ] Create public GitHub repo: `specter`
- [ ] Add MIT license
- [ ] Add `.gitignore` (Anchor default + `/app/node_modules`)
- [ ] Set up repo description: "Privacy-first blind auctions on Solana, powered by Arcium MPC"
- [ ] Protect `main` branch — merge via PRs per phase

---

## SIGN-OFF

- [ ] All checklist items above completed
- [ ] CLAUDE.md reviewed and understood
- [ ] BUILD_GUIDE.md read fully
- [ ] Environment set up and verified
- [ ] Ready to enter Phase 1
