use crate::crypto::{double_sha256, sha256};
use super::super::varint::btc_encode_varint;
use super::legacy::addresses_from_pubkey;
use super::witness::decode_bech32m_witness;

fn tagged_hash(tag: &str, msgs: &[&[u8]]) -> [u8; 32] {
    let tag_hash = sha256(tag.as_bytes());
    let mut data = Vec::new();
    data.extend_from_slice(&tag_hash);
    data.extend_from_slice(&tag_hash);
    for msg in msgs {
        data.extend_from_slice(msg);
    }
    sha256(&data)
}

fn build_to_spend(message: &str, script_pubkey: &[u8]) -> Vec<u8> {
    let msg_hash = tagged_hash("BIP0322-signed-message", &[message.as_bytes()]);

    let mut script_sig = vec![0x00, 0x20];
    script_sig.extend_from_slice(&msg_hash);

    let mut tx = Vec::new();
    tx.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // version
    tx.push(0x01); // input count
    tx.extend_from_slice(&[0u8; 32]); // prevout hash
    tx.extend_from_slice(&[0xff, 0xff, 0xff, 0xff]); // prevout index
    tx.extend_from_slice(&btc_encode_varint(script_sig.len()));
    tx.extend_from_slice(&script_sig);
    tx.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // sequence
    tx.push(0x01); // output count
    tx.extend_from_slice(&[0u8; 8]); // value
    tx.extend_from_slice(&btc_encode_varint(script_pubkey.len()));
    tx.extend_from_slice(script_pubkey);
    tx.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // locktime

    tx
}

fn build_sighash(to_spend_txid: &[u8; 32], script_pubkey: &[u8]) -> [u8; 32] {
    let mut prevout_data = Vec::new();
    prevout_data.extend_from_slice(to_spend_txid);
    prevout_data.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
    let prevouts = sha256(&prevout_data);

    let amounts = sha256(&[0u8; 8]);

    let mut spk_data = Vec::new();
    spk_data.extend_from_slice(&btc_encode_varint(script_pubkey.len()));
    spk_data.extend_from_slice(script_pubkey);
    let script_pubkeys = sha256(&spk_data);

    let sequences = sha256(&[0x00, 0x00, 0x00, 0x00]);

    let mut output = Vec::new();
    output.extend_from_slice(&[0u8; 8]);
    output.extend_from_slice(&[0x01, 0x6a]); // OP_RETURN
    let hash_outputs = sha256(&output);

    let mut preimage = Vec::new();
    preimage.push(0x00); // epoch
    preimage.push(0x00); // SIGHASH_DEFAULT
    preimage.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // nVersion
    preimage.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // nLockTime
    preimage.extend_from_slice(&prevouts);
    preimage.extend_from_slice(&amounts);
    preimage.extend_from_slice(&script_pubkeys);
    preimage.extend_from_slice(&sequences);
    preimage.extend_from_slice(&hash_outputs);
    preimage.push(0x00); // spendType
    preimage.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // input index

    tagged_hash("TapSighash", &[&preimage])
}

pub fn verify_taproot(
    address: &str,
    message: &str,
    schnorr_sig: &[u8],
    debug: &mut Vec<String>,
) -> bool {
    let addr_lower = address.to_lowercase();
    let pubkey_bytes = match decode_bech32m_witness(&addr_lower) {
        Some(bytes) if bytes.len() == 32 => bytes,
        _ => {
            debug.push("bip322-p2tr: failed to decode address".into());
            return false;
        }
    };

    debug.push(format!(
        "bip322-p2tr: pubkey_from_addr={} ({} bytes)",
        hex::encode(&pubkey_bytes),
        pubkey_bytes.len()
    ));

    // scriptPubKey: OP_1 PUSH32 <output_key>
    let mut script_pubkey = vec![0x51, 0x20];
    script_pubkey.extend_from_slice(&pubkey_bytes);

    let to_spend = build_to_spend(message, &script_pubkey);
    let to_spend_txid = double_sha256(&to_spend);

    let sighash = build_sighash(&to_spend_txid, &script_pubkey);
    debug.push(format!("bip322-p2tr: sighash={}", hex::encode(sighash)));

    let sig = if schnorr_sig.len() == 65 {
        &schnorr_sig[..64]
    } else {
        schnorr_sig
    };

    if sig.len() != 64 {
        debug.push(format!("bip322-p2tr: invalid sig length {}", sig.len()));
        return false;
    }

    use k256::schnorr::VerifyingKey as SchnorrVerifyingKey;
    use k256::schnorr::signature::hazmat::PrehashVerifier;

    let vk = match SchnorrVerifyingKey::from_bytes(&pubkey_bytes) {
        Ok(vk) => vk,
        Err(e) => {
            debug.push(format!("bip322-p2tr: invalid pubkey: {e}"));
            return false;
        }
    };

    let schnorr_signature = match k256::schnorr::Signature::try_from(sig) {
        Ok(s) => s,
        Err(e) => {
            debug.push(format!("bip322-p2tr: invalid schnorr sig: {e}"));
            return false;
        }
    };

    match vk.verify_prehash(&sighash, &schnorr_signature) {
        Ok(()) => {
            debug.push("bip322-p2tr: schnorr.verify=true".into());
            true
        }
        Err(e) => {
            debug.push(format!("bip322-p2tr: schnorr.verify=false ({e})"));
            false
        }
    }
}

pub fn verify_p2wpkh(address: &str, pubkey: &[u8], debug: &mut Vec<String>) -> bool {
    if pubkey.len() != 33 {
        return false;
    }
    let mut compressed = [0u8; 33];
    compressed.copy_from_slice(pubkey);
    let candidates = addresses_from_pubkey(&compressed);
    debug.push(format!(
        "bip322-p2wpkh: pubkey={} derived_addrs=[{}]",
        hex::encode(pubkey),
        candidates.join(", ")
    ));
    candidates.iter().any(|c| c == &address.to_lowercase())
}
