//! Phones paired to drivers.
//!
//! A phone that says "I'm Sam" is given a random token; the server keeps only its hash and the driver it
//! belongs to. From then on the phone is Sam without asking, and it can log out (the token is forgotten).
//! There are no passwords: the first phone to claim a driver just takes them, and a driver who is already
//! signed in on another device asks "are you sure?" first (the `confirmed` flag), then signs this one in too.
//! Several devices can be signed in as one driver at once; the PC lists them and can sign any of them out.

use std::fmt;

use anyhow::Result;
use sha2::{Digest, Sha256};

/// Why a phone could not be paired. The server turns this into something the phone can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairError {
    /// The driver is already signed in on another device and this phone has not said it is sure.
    AlreadySignedIn,
}

impl fmt::Display for PairError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadySignedIn => f.write_str("this driver is already signed in on another device"),
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

}
