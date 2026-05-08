use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

const COMP_DEF_OFFSET_SEALED_BID: u32 = comp_def_offset("evaluate_sealed_bid_auction");

declare_id!("2APecQcb3XQ5hiQrY56hpEUb85am72Rj4PuvV5spRn5H");

const MAX_BIDDERS: u8 = 8;
const MAX_DESC_LEN: usize = 64;
const SENTINEL_INDEX: u8 = 255;

#[arcium_program]
pub mod specter {
    use super::*;

    pub fn init_sealed_bid_comp_def(ctx: Context<InitSealedBidCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, None, None)?;
        Ok(())
    }

    pub fn create_auction(
        ctx: Context<CreateAuction>,
        auction_nonce: u64,
        auction_type: u8,
        duration_secs: i64,
        item_description: String,
        num_winners: u8,
    ) -> Result<()> {
        require!(
            item_description.len() <= MAX_DESC_LEN,
            SpecterError::DescriptionTooLong
        );
        require!(duration_secs > 0, SpecterError::InvalidDuration);
        require!(num_winners >= 1, SpecterError::InvalidNumWinners);

        let auction = &mut ctx.accounts.auction;
        auction.creator = ctx.accounts.creator.key();
        auction.auction_nonce = auction_nonce;
        auction.auction_type = auction_type;
        auction.close_time = Clock::get()?.unix_timestamp + duration_secs;
        auction.status = 0;
        auction.bid_count = 0;
        auction.num_winners = num_winners;
        auction.item_description = item_description;
        auction.winner_index = SENTINEL_INDEX;
        auction.clearing_price = 0;
        auction.computation_offset = 0;
        auction.result_winner_index_ct = [0u8; 32];
        auction.result_winning_amount_ct = [0u8; 32];
        auction.result_nonce = [0u8; 16];
        Ok(())
    }

    pub fn place_bid(
        ctx: Context<PlaceBid>,
        ciphertext: [u8; 32],
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let auction_key = ctx.accounts.auction.key();
        let bidder_key = ctx.accounts.bidder.key();
        let auction = &mut ctx.accounts.auction;
        require!(auction.status == 0, SpecterError::AuctionNotActive);
        require!(
            Clock::get()?.unix_timestamp < auction.close_time,
            SpecterError::AuctionExpired
        );
        require!(auction.bid_count < MAX_BIDDERS, SpecterError::AuctionFull);

        let bid = &mut ctx.accounts.bid;
        bid.auction = auction_key;
        bid.bidder = bidder_key;
        bid.bidder_index = auction.bid_count;
        bid.ciphertext = ciphertext;
        bid.pub_key = pub_key;
        bid.nonce = nonce;

        auction.bid_count = auction.bid_count.checked_add(1).unwrap();
        Ok(())
    }

    pub fn finalize_auction(
        ctx: Context<FinalizeAuction>,
        computation_offset: u64,
        bids: Vec<BidData>,
    ) -> Result<()> {
        let auction = &mut ctx.accounts.auction;
        require!(auction.status == 0, SpecterError::AuctionNotActive);
        require!(
            Clock::get()?.unix_timestamp >= auction.close_time,
            SpecterError::AuctionStillActive
        );
        require!(
            bids.len() == MAX_BIDDERS as usize,
            SpecterError::InvalidBidPayloadLen
        );
        auction.status = 1;
        auction.computation_offset = computation_offset;

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        let mut args = ArgBuilder::new();
        for bid in bids.iter() {
            args = args
                .x25519_pubkey(bid.pub_key)
                .plaintext_u128(bid.nonce)
                .encrypted_u64(bid.ciphertext);
        }
        let args = args.build();

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![EvaluateSealedBidAuctionCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[CallbackAccount {
                    pubkey: ctx.accounts.auction.key(),
                    is_writable: true,
                }],
            )?],
            1,
            0,
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "evaluate_sealed_bid_auction")]
    pub fn evaluate_sealed_bid_auction_callback(
        ctx: Context<EvaluateSealedBidAuctionCallback>,
        output: SignedComputationOutputs<EvaluateSealedBidAuctionOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(EvaluateSealedBidAuctionOutput { field_0 }) => field_0,
            Err(_) => {
                let auction = &mut ctx.accounts.auction;
                auction.status = 0;
                return Err(SpecterError::ComputationFailed.into());
            }
        };

        let auction = &mut ctx.accounts.auction;
        auction.status = 2;
        auction.result_winner_index_ct = result.ciphertexts[0];
        auction.result_winning_amount_ct = result.ciphertexts[1];
        auction.result_nonce = result.nonce.to_le_bytes();

        emit!(AuctionClosedEvent {
            auction: auction.key(),
            winner_index_ciphertext: result.ciphertexts[0],
            winning_amount_ciphertext: result.ciphertexts[1],
            nonce: result.nonce.to_le_bytes(),
        });
        Ok(())
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        let bid = &ctx.accounts.bid;
        require!(auction.status == 2, SpecterError::AuctionNotClosed);
        require!(
            bid.bidder == ctx.accounts.claimant.key(),
            SpecterError::NotBidder
        );
        emit!(PrizeClaimedEvent {
            auction: auction.key(),
            winner: bid.bidder,
            bidder_index: bid.bidder_index,
        });
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BidData {
    pub pub_key: [u8; 32],
    pub nonce: u128,
    pub ciphertext: [u8; 32],
}

#[event]
pub struct AuctionClosedEvent {
    pub auction: Pubkey,
    pub winner_index_ciphertext: [u8; 32],
    pub winning_amount_ciphertext: [u8; 32],
    pub nonce: [u8; 16],
}

#[event]
pub struct PrizeClaimedEvent {
    pub auction: Pubkey,
    pub winner: Pubkey,
    pub bidder_index: u8,
}

#[account]
pub struct Auction {
    pub creator: Pubkey,
    pub auction_nonce: u64,
    pub auction_type: u8,
    pub status: u8,
    pub bid_count: u8,
    pub num_winners: u8,
    pub close_time: i64,
    pub winner_index: u8,
    pub clearing_price: u64,
    pub computation_offset: u64,
    pub result_winner_index_ct: [u8; 32],
    pub result_winning_amount_ct: [u8; 32],
    pub result_nonce: [u8; 16],
    pub item_description: String,
}

impl Auction {
    pub const MAX_SIZE: usize =
        32 + 8 + 1 + 1 + 1 + 1 + 8 + 1 + 8 + 8 + 32 + 32 + 16 + (4 + MAX_DESC_LEN);
}

#[account]
pub struct Bid {
    pub auction: Pubkey,
    pub bidder: Pubkey,
    pub bidder_index: u8,
    pub ciphertext: [u8; 32],
    pub pub_key: [u8; 32],
    pub nonce: u128,
}

impl Bid {
    pub const MAX_SIZE: usize = 32 + 32 + 1 + 32 + 32 + 16;
}

#[derive(Accounts)]
#[instruction(auction_nonce: u64)]
pub struct CreateAuction<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + Auction::MAX_SIZE,
        seeds = [b"auction", creator.key().as_ref(), &auction_nonce.to_le_bytes()],
        bump,
    )]
    pub auction: Account<'info, Auction>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBid<'info> {
    #[account(mut)]
    pub bidder: Signer<'info>,
    #[account(mut)]
    pub auction: Account<'info, Auction>,
    #[account(
        init,
        payer = bidder,
        space = 8 + Bid::MAX_SIZE,
        seeds = [b"bid", auction.key().as_ref(), bidder.key().as_ref()],
        bump,
    )]
    pub bid: Account<'info, Bid>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("evaluate_sealed_bid_auction", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct FinalizeAuction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub auction: Account<'info, Auction>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SEALED_BID))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Box<Account<'info, ClockAccount>>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("evaluate_sealed_bid_auction")]
#[derive(Accounts)]
pub struct EvaluateSealedBidAuctionCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SEALED_BID))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: computation_account, checked by arcium program via constraints in the callback context.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub auction: Account<'info, Auction>,
}

#[init_computation_definition_accounts("evaluate_sealed_bid_auction", payer)]
#[derive(Accounts)]
pub struct InitSealedBidCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot)
    )]
    /// CHECK: address_lookup_table, checked by arcium program.
    pub address_lookup_table: UncheckedAccount<'info>,
    #[account(address = LUT_PROGRAM_ID)]
    /// CHECK: lut_program is the Address Lookup Table program.
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimPrize<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,
    pub auction: Account<'info, Auction>,
    #[account(
        seeds = [b"bid", auction.key().as_ref(), claimant.key().as_ref()],
        bump,
        has_one = auction,
    )]
    pub bid: Account<'info, Bid>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The computation was aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
}

#[error_code]
pub enum SpecterError {
    #[msg("Auction is not active")]
    AuctionNotActive,
    #[msg("Auction has expired")]
    AuctionExpired,
    #[msg("Auction is full (max 8 bidders)")]
    AuctionFull,
    #[msg("Auction is still active — cannot finalize yet")]
    AuctionStillActive,
    #[msg("Arcium computation failed")]
    ComputationFailed,
    #[msg("Bid does not belong to this wallet")]
    NotBidder,
    #[msg("Auction is not yet closed")]
    AuctionNotClosed,
    #[msg("Item description exceeds max length")]
    DescriptionTooLong,
    #[msg("Duration must be positive")]
    InvalidDuration,
    #[msg("Number of winners must be at least 1")]
    InvalidNumWinners,
    #[msg("Bid payload must contain exactly 8 entries (pad with sentinels)")]
    InvalidBidPayloadLen,
}
