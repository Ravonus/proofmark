//! Replay tape validation — decodes binary replay tapes and extracts
//! ground-truth metrics for cross-validation against claimed values.

mod anomalies;
mod decode;
mod types;
mod validate;

pub use validate::validate_replay_tape;
