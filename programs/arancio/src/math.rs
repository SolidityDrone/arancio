use anchor_lang::prelude::*;

use crate::errors::ArancioError;

pub fn validate_weights(weights: &[u16]) -> Result<()> {
    if weights.is_empty() {
        return Err(error!(ArancioError::EmptyWeights));
    }

    let total = weights.iter().try_fold(0u128, |total, weight| {
        total
            .checked_add(u128::from(*weight))
            .ok_or_else(|| error!(ArancioError::ArithmeticOverflow))
    })?;

    if total != 10_000 {
        return Err(error!(ArancioError::InvalidWeightTotal));
    }

    Ok(())
}

pub fn shares_for_deposit(assets: u128, supply: u128, total_assets: u128) -> Result<u128> {
    if supply == 0 {
        return Ok(assets);
    }

    assets
        .checked_mul(supply)
        .ok_or_else(|| error!(ArancioError::ArithmeticOverflow))?
        .checked_div(total_assets)
        .ok_or_else(|| error!(ArancioError::DivisionByZero))
}

pub fn proportional_amount(amount: u128, shares: u128, supply: u128) -> Result<u128> {
    amount
        .checked_mul(shares)
        .ok_or_else(|| error!(ArancioError::ArithmeticOverflow))?
        .checked_div(supply)
        .ok_or_else(|| error!(ArancioError::DivisionByZero))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_or_non_total_weights() {
        assert!(validate_weights(&[]).is_err());
        assert!(validate_weights(&[5_000, 4_999]).is_err());
        assert!(validate_weights(&[5_000, 5_000]).is_ok());
    }

    #[test]
    fn floors_later_deposit_shares() {
        assert_eq!(shares_for_deposit(7, 0, 0).unwrap(), 7);
        assert_eq!(shares_for_deposit(5, 10, 3).unwrap(), 16);
    }

    #[test]
    fn rejects_zero_total_assets_and_overflow() {
        assert!(shares_for_deposit(1, 1, 0).is_err());
        assert!(shares_for_deposit(u128::MAX, 2, 1).is_err());
        assert!(proportional_amount(u128::MAX, 2, 1).is_err());
    }

    #[test]
    fn floors_proportional_redemption() {
        assert_eq!(proportional_amount(10, 3, 4).unwrap(), 7);
        assert!(proportional_amount(10, 1, 0).is_err());
    }
}
