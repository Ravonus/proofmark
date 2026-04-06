//! Document indexing engine backed by RocksDB.
//!
//! Full-text search (inverted index + TF-IDF), prefix/autocomplete (trie),
//! fuzzy/typo-tolerant search (BK-tree), PII detection, encrypted partial
//! indexing, AI-enhanced indexing, and background job queue.

pub mod ai;
pub mod bk_tree;
pub mod encrypted;
mod engine;
pub mod inverted;
pub mod keys;
pub mod privacy;
pub mod queue;
pub mod scanner;
pub mod store;
pub mod tokenizer;
pub mod trie;

use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

use self::bk_tree::FuzzyIndex;
use self::encrypted::EncryptedIndexConfig;
use self::queue::{IndexQueue, QueueConfig};
use self::store::IndexStore;

pub use engine::IndexResult;

pub struct IndexEngine {
    store: IndexStore,
    fuzzy: Arc<FuzzyIndex>,
    queue: Arc<IndexQueue>,
    ai_config: Arc<RwLock<ai::AiIndexConfig>>,
    encrypted_config: Arc<RwLock<EncryptedIndexConfig>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexEngineConfig {
    pub db_path: String,
    pub queue: QueueConfig,
    pub ai: ai::AiIndexConfig,
    pub encrypted: EncryptedIndexConfig,
}

impl Default for IndexEngineConfig {
    fn default() -> Self {
        Self {
            db_path: "./data/index".to_string(),
            queue: QueueConfig::default(),
            ai: ai::AiIndexConfig::default(),
            encrypted: EncryptedIndexConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexRequest {
    pub doc_id: String,
    pub owner_id: String,
    pub title: String,
    pub content: String,
    pub status: String,
    pub proof_mode: String,
    pub encrypted: bool,
    pub encrypted_search_opt_in: bool,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub signer_labels: Vec<String>,
    pub hash_prefix: String,
    pub cid_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub owner_id: Option<String>,
    pub search_mode: SearchMode,
    pub include_encrypted: bool,
    pub include_fuzzy: bool,
    pub fuzzy_distance: Option<usize>,
    pub max_results: Option<usize>,
    pub filters: SearchFilters,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SearchMode {
    All,
    Any,
    Prefix,
    Entity,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchFilters {
    pub status: Option<String>,
    pub proof_mode: Option<String>,
    pub category: Option<String>,
    pub encrypted_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResultItem>,
    pub total: usize,
    pub fuzzy_results: Vec<FuzzyResultItem>,
    pub encrypted_results: Vec<encrypted::EncryptedSearchResult>,
    pub query_tokens: Vec<String>,
    pub search_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub doc_id: String,
    pub title: String,
    pub score: f64,
    pub status: String,
    pub category: Option<String>,
    pub encrypted: bool,
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FuzzyResultItem {
    pub doc_id: String,
    pub matched_word: String,
    pub distance: usize,
}
