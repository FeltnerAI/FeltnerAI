use std::{fs, path::Path};

use aes_gcm::{
    Aes256Gcm, KeyInit, Nonce,
    aead::{Aead, OsRng, rand_core::RngCore},
};
use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::STANDARD_NO_PAD};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

#[derive(Clone)]
pub struct Encryption {
    cipher: Aes256Gcm,
}

impl Encryption {
    pub fn load_or_create(data_dir: &Path) -> Result<Self> {
        fs::create_dir_all(data_dir)?;
        let path = data_dir.join("encryption.key");
        let key = if path.exists() {
            Zeroizing::new(fs::read(&path).context("failed to read encryption key")?)
        } else {
            let mut bytes = Zeroizing::new(vec![0_u8; 32]);
            OsRng.fill_bytes(&mut bytes);
            fs::write(&path, bytes.as_slice()).context("failed to write encryption key")?;
            bytes
        };
        if key.len() != 32 {
            bail!("encryption key must be 32 bytes");
        }
        Ok(Self {
            cipher: Aes256Gcm::new_from_slice(&key).expect("validated key length"),
        })
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String> {
        let mut nonce = [0_u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let ciphertext = self
            .cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
            .map_err(|_| anyhow::anyhow!("encryption failed"))?;
        let mut payload = nonce.to_vec();
        payload.extend(ciphertext);
        Ok(STANDARD_NO_PAD.encode(payload))
    }

    pub fn decrypt(&self, encoded: &str) -> Result<Zeroizing<String>> {
        let payload = STANDARD_NO_PAD.decode(encoded)?;
        if payload.len() < 13 {
            bail!("invalid encrypted payload");
        }
        let plaintext = self
            .cipher
            .decrypt(Nonce::from_slice(&payload[..12]), &payload[12..])
            .map_err(|_| anyhow::anyhow!("decryption failed"))?;
        Ok(Zeroizing::new(String::from_utf8(plaintext)?))
    }
}

pub fn random_token() -> String {
    let mut token = [0_u8; 32];
    OsRng.fill_bytes(&mut token);
    STANDARD_NO_PAD.encode(token)
}

pub fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypts_with_random_nonces_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let crypto = Encryption::load_or_create(dir.path()).unwrap();
        let first = crypto.encrypt("secret").unwrap();
        let second = crypto.encrypt("secret").unwrap();
        assert_ne!(first, second);
        assert_eq!(&*crypto.decrypt(&first).unwrap(), "secret");
    }

    #[test]
    fn token_hash_is_stable_without_storing_token() {
        assert_eq!(token_hash("a"), token_hash("a"));
        assert_ne!(token_hash("a"), token_hash("b"));
    }
}
