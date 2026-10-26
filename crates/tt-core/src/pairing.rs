//! Phones paired to drivers.
//!
//! A phone that says "I'm Sam" is given a random token; the server keeps only its hash and the driver it
//! belongs to. From then on the phone is Sam without asking, and it can log out (the token is forgotten).
//! There are no passwords: the first phone to claim a driver wins, and any further phone needs a short
//! one-time code, shown on the PC or on a phone that is already paired to that driver.

use std::fmt;

use anyhow::Result;
use sha2::{Digest, Sha256};

/// How long a pairing code works.
pub const CODE_TTL_MS: i64 = 5 * 60 * 1000;

/// Why a phone could not be paired. The server turns these into something the phone can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairError {
    /// The driver already has a phone, so this one needs a code.
    CodeNeeded,
    /// The code was wrong or has run out.
    BadCode,
}

impl fmt::Display for PairError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CodeNeeded => f.write_str("this driver already has a phone: ask for a pairing code"),
            Self::BadCode => f.write_str("that code is wrong or has run out"),
        }
    }
}

impl std::error::Error for PairError {}

/// A fresh random token, 256 bits as hex.
pub fn new_token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| anyhow::anyhow!("no secure random numbers: {e}"))?;
    Ok(hex(&bytes))
}

/// What is stored in place of a token.
pub fn hash_token(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

/// A six digit code to type into a phone.
pub fn new_code() -> Result<String> {
    let mut bytes = [0u8; 4];
    getrandom::fill(&mut bytes).map_err(|e| anyhow::anyhow!("no secure random numbers: {e}"))?;
    Ok(format!("{:06}", u32::from_le_bytes(bytes) % 1_000_000))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_unique_and_only_their_hash_is_kept() {
        let (a, b) = (new_token().unwrap(), new_token().unwrap());
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert_ne!(hash_token(&a), a);
        assert_eq!(hash_token(&a), hash_token(&a));
        assert_ne!(hash_token(&a), hash_token(&b));
    }

    #[test]
    fn codes_are_six_digits() {
        for _ in 0..50 {
            let c = new_code().unwrap();
            assert_eq!(c.len(), 6);
            assert!(c.chars().all(|ch| ch.is_ascii_digit()));
        }
    }
}
