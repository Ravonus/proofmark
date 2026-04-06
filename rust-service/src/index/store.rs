//! RocksDB-backed storage engine for the document index.
//!
//! Column families:
//!   - `meta`       → document metadata (title, owner, status, timestamps)
//!   - `inverted`   → inverted index: token → set of doc IDs
//!   - `forward`    → forward index: doc_id → list of tokens (for deletion)
//!   - `prefix`     → prefix completions: prefix → set of doc IDs
//!   - `privacy`    → privacy classification: doc_id → PrivacyLevel
//!   - `encrypted`  → opt-in partial index for encrypted docs
//!   - `entities`   → extracted entities: entity_key → set of doc IDs
//!   - `queue`      → pending re-index jobs

use std::path::Path;
use std::sync::Arc;

use parking_lot::RwLock;
use rocksdb::{
    ColumnFamilyDescriptor, DBWithThreadMode, MultiThreaded, Options, WriteBatch,
    IteratorMode,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type RocksDb = DBWithThreadMode<MultiThreaded>;

pub const CF_META: &str = "meta";
pub const CF_INVERTED: &str = "inverted";
pub const CF_FORWARD: &str = "forward";
pub const CF_PREFIX: &str = "prefix";
pub const CF_PRIVACY: &str = "privacy";
pub const CF_ENCRYPTED: &str = "encrypted";
pub const CF_ENTITIES: &str = "entities";
pub const CF_QUEUE: &str = "queue";

const ALL_CFS: &[&str] = &[
    CF_META, CF_INVERTED, CF_FORWARD, CF_PREFIX,
    CF_PRIVACY, CF_ENCRYPTED, CF_ENTITIES, CF_QUEUE,
];

#[derive(Error, Debug)]
pub enum StoreError {
    #[error("RocksDB error: {0}")]
    Rocks(#[from] rocksdb::Error),
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("Column family not found: {0}")]
    CfNotFound(String),
}

pub type StoreResult<T> = Result<T, StoreError>;

/// Document metadata stored in the `meta` CF.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentMeta {
    pub doc_id: String,
    pub owner_id: String,
    pub title: String,
    pub status: String,
    pub proof_mode: String,
    pub encrypted: bool,
    pub encrypted_search_opt_in: bool,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub signer_labels: Vec<String>,
    pub hash_prefix: String,
    pub cid_prefix: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub token_count: usize,
}

/// Privacy level for indexed content.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PrivacyLevel {
    Public,
    Partial,
    Private,
}

/// Core index store wrapping RocksDB.
#[derive(Clone)]
pub struct IndexStore {
    db: Arc<RocksDb>,
    stats: Arc<RwLock<IndexStats>>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct IndexStats {
    pub total_documents: u64,
    pub total_tokens: u64,
    pub total_encrypted: u64,
    pub total_encrypted_opt_in: u64,
    pub pending_queue: u64,
}

impl IndexStore {
    /// Open or create the index store at the given path.
    pub fn open<P: AsRef<Path>>(path: P) -> StoreResult<Self> {
        let mut db_opts = Options::default();
        db_opts.create_if_missing(true);
        db_opts.create_missing_column_families(true);
        db_opts.set_max_background_jobs(4);
        db_opts.set_write_buffer_size(64 * 1024 * 1024); // 64MB
        db_opts.set_max_write_buffer_number(3);
        db_opts.increase_parallelism(num_cpus());
        db_opts.set_compression_type(rocksdb::DBCompressionType::Lz4);

        // Bloom filters for fast lookups
        let mut cf_opts = Options::default();
        let mut block_opts = rocksdb::BlockBasedOptions::default();
        block_opts.set_bloom_filter(10.0, false);
        block_opts.set_cache_index_and_filter_blocks(true);
        cf_opts.set_block_based_table_factory(&block_opts);

        let cfs: Vec<ColumnFamilyDescriptor> = ALL_CFS
            .iter()
            .map(|name| ColumnFamilyDescriptor::new(*name, cf_opts.clone()))
            .collect();

        let db = RocksDb::open_cf_descriptors(&db_opts, path, cfs)?;

        let store = Self {
            db: Arc::new(db),
            stats: Arc::new(RwLock::new(IndexStats::default())),
        };

        store.rebuild_stats()?;
        Ok(store)
    }

    /// Get raw DB handle.
    pub fn db(&self) -> &RocksDb {
        &self.db
    }

    /// Current index statistics.
    pub fn stats(&self) -> IndexStats {
        self.stats.read().clone()
    }

    // Meta operations

    pub fn put_meta(&self, doc_id: &str, meta: &DocumentMeta) -> StoreResult<()> {
        let cf = self.cf(CF_META)?;
        let val = serde_json::to_vec(meta)?;
        self.db.put_cf(&cf, doc_id.as_bytes(), &val)?;
        Ok(())
    }

    pub fn get_meta(&self, doc_id: &str) -> StoreResult<Option<DocumentMeta>> {
        let cf = self.cf(CF_META)?;
        match self.db.get_cf(&cf, doc_id.as_bytes())? {
            Some(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            None => Ok(None),
        }
    }

    pub fn delete_meta(&self, doc_id: &str) -> StoreResult<()> {
        let cf = self.cf(CF_META)?;
        self.db.delete_cf(&cf, doc_id.as_bytes())?;
        Ok(())
    }

    pub fn list_all_doc_ids(&self) -> StoreResult<Vec<String>> {
        let cf = self.cf(CF_META)?;
        let iter = self.db.iterator_cf(&cf, IteratorMode::Start);
        let mut ids = Vec::new();
        for item in iter {
            let (key, _) = item?;
            if let Ok(id) = String::from_utf8(key.to_vec()) {
                ids.push(id);
            }
        }
        Ok(ids)
    }

    // Generic CF operations

    /// Put a value into a column family.
    pub fn put_cf(&self, cf_name: &str, key: &[u8], value: &[u8]) -> StoreResult<()> {
        let cf = self.cf(cf_name)?;
        self.db.put_cf(&cf, key, value)?;
        Ok(())
    }

    /// Get a value from a column family.
    pub fn get_cf(&self, cf_name: &str, key: &[u8]) -> StoreResult<Option<Vec<u8>>> {
        let cf = self.cf(cf_name)?;
        Ok(self.db.get_cf(&cf, key)?)
    }

    /// Delete a key from a column family.
    pub fn delete_cf(&self, cf_name: &str, key: &[u8]) -> StoreResult<()> {
        let cf = self.cf(cf_name)?;
        self.db.delete_cf(&cf, key)?;
        Ok(())
    }

    /// Scan all keys with a given prefix in a column family.
    pub fn prefix_scan(&self, cf_name: &str, prefix: &[u8]) -> StoreResult<Vec<(Vec<u8>, Vec<u8>)>> {
        let cf = self.cf(cf_name)?;
        let iter = self.db.prefix_iterator_cf(&cf, prefix);
        let mut results = Vec::new();
        for item in iter {
            let (key, val) = item?;
            if !key.starts_with(prefix) {
                break;
            }
            results.push((key.to_vec(), val.to_vec()));
        }
        Ok(results)
    }

    /// Execute a write batch atomically.
    pub fn write_batch(&self, batch: WriteBatch) -> StoreResult<()> {
        self.db.write(batch)?;
        Ok(())
    }

    /// Create a new write batch.
    pub fn new_batch(&self) -> WriteBatch {
        WriteBatch::default()
    }

    /// Add to batch for a specific CF.
    pub fn batch_put(&self, batch: &mut WriteBatch, cf_name: &str, key: &[u8], value: &[u8]) -> StoreResult<()> {
        let cf = self.cf(cf_name)?;
        batch.put_cf(&cf, key, value);
        Ok(())
    }

    /// Delete from batch for a specific CF.
    pub fn batch_delete(&self, batch: &mut WriteBatch, cf_name: &str, key: &[u8]) -> StoreResult<()> {
        let cf = self.cf(cf_name)?;
        batch.delete_cf(&cf, key);
        Ok(())
    }

    // Stats

    pub fn increment_stat<F: FnOnce(&mut IndexStats)>(&self, f: F) {
        let mut stats = self.stats.write();
        f(&mut stats);
    }

    fn rebuild_stats(&self) -> StoreResult<()> {
        let mut stats = IndexStats::default();

        let cf = self.cf(CF_META)?;
        let iter = self.db.iterator_cf(&cf, IteratorMode::Start);
        for item in iter {
            let (_, val) = item?;
            if let Ok(meta) = serde_json::from_slice::<DocumentMeta>(&val) {
                stats.total_documents += 1;
                stats.total_tokens += meta.token_count as u64;
                if meta.encrypted {
                    stats.total_encrypted += 1;
                    if meta.encrypted_search_opt_in {
                        stats.total_encrypted_opt_in += 1;
                    }
                }
            }
        }

        let qcf = self.cf(CF_QUEUE)?;
        let qiter = self.db.iterator_cf(&qcf, IteratorMode::Start);
        for item in qiter {
            let _ = item?;
            stats.pending_queue += 1;
        }

        *self.stats.write() = stats;
        Ok(())
    }

    fn cf(&self, name: &str) -> StoreResult<Arc<rocksdb::BoundColumnFamily<'_>>> {
        self.db
            .cf_handle(name)
            .ok_or_else(|| StoreError::CfNotFound(name.to_string()))
    }

    /// Compact all column families.
    pub fn compact(&self) {
        for cf_name in ALL_CFS {
            if let Ok(cf) = self.cf(cf_name) {
                self.db.compact_range_cf(&cf, None::<&[u8]>, None::<&[u8]>);
            }
        }
    }

    /// Flush all pending writes.
    pub fn flush(&self) -> StoreResult<()> {
        self.db.flush()?;
        Ok(())
    }
}

fn num_cpus() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_store() -> (IndexStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("proofmark_test_{}", uuid::Uuid::new_v4()));
        let store = IndexStore::open(&dir).unwrap();
        (store, dir)
    }

    #[test]
    fn test_meta_round_trip() {
        let (store, dir) = temp_store();
        let meta = DocumentMeta {
            doc_id: "doc1".into(),
            owner_id: "owner1".into(),
            title: "Test Doc".into(),
            status: "PENDING".into(),
            proof_mode: "PRIVATE".into(),
            encrypted: false,
            encrypted_search_opt_in: false,
            category: Some("NDA".into()),
            tags: vec!["legal".into()],
            signer_labels: vec!["Alice".into()],
            hash_prefix: "abcd1234".into(),
            cid_prefix: None,
            created_at: "2025-01-01T00:00:00Z".into(),
            updated_at: "2025-01-01T00:00:00Z".into(),
            token_count: 42,
        };
        store.put_meta("doc1", &meta).unwrap();
        let got = store.get_meta("doc1").unwrap().unwrap();
        assert_eq!(got.title, "Test Doc");
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }
}
