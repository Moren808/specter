use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct WinnerResult {
        winner_index: u8,
        winning_amount: u64,
    }

    #[instruction]
    pub fn evaluate_sealed_bid_auction(
        bid_0: Enc<Shared, u64>,
        bid_1: Enc<Shared, u64>,
        bid_2: Enc<Shared, u64>,
        bid_3: Enc<Shared, u64>,
        bid_4: Enc<Shared, u64>,
        bid_5: Enc<Shared, u64>,
        bid_6: Enc<Shared, u64>,
        bid_7: Enc<Shared, u64>,
    ) -> Enc<Shared, WinnerResult> {
        let amounts: [u64; 8] = [
            bid_0.to_arcis(),
            bid_1.to_arcis(),
            bid_2.to_arcis(),
            bid_3.to_arcis(),
            bid_4.to_arcis(),
            bid_5.to_arcis(),
            bid_6.to_arcis(),
            bid_7.to_arcis(),
        ];

        let mut best_amount: u64 = amounts[0];
        let mut best_index: u8 = 0;

        for i in 1..8 {
            let wins = amounts[i] > best_amount;
            best_amount = if wins { amounts[i] } else { best_amount };
            best_index = if wins { i as u8 } else { best_index };
        }

        let result = WinnerResult {
            winner_index: best_index,
            winning_amount: best_amount,
        };

        bid_0.owner.from_arcis(result)
    }
}
