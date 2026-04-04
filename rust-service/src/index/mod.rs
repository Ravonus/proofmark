//! Document Index System
//!
//! High-performance document indexing engine backed by RocksDB.
//!
//! Features:
//! - Full-text search with inverted index and TF-IDF scoring
//! - Prefix/autocomplete search via trie structure
//! - Fuzzy/typo-tolerant search via BK-tree (Damerau-Levenshtein)
//! - Smart document scanning with entity extraction
//! - Privacy-aware PII detection and redaction
//! - Opt-in encrypted document partial indexing
//! - AI-enhanced indexing (optional, multi-provider)
//! - Background queue for batch re-indexing with retries
//! - Multi-threaded parallel processing via rayon

pub mod ai;
pub mod bk_tree;
pub mod encrypted;
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
use self::queue::{IndexQueue, QueueConfig, IndexJob, JobType, JobPriority};
use self::store::{DocumentMeta, IndexStore, PrivacyLevel, StoreResult};

/// Main index engine — the unified entry point for all indexing operations.
pub struct IndexEngine {
    store: IndexStore,
    fuzzy: Arc<FuzzyIndex>,
    queue: Arc<IndexQueue>,
    ai_config: Arc<RwLock<ai::AiIndexConfig>>,
    encrypted_config: Arc<RwLock<EncryptedIndexConfig>>,
}

/// Configuration for the index engine.
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

/// Request to index a document.
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

/// Unified search request.
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
    /// All query terms must match (AND).
    All,
    /// Any query term can match (OR).
    Any,
    /// Prefix-based search.
    Prefix,
    /// Entity search.
    Entity,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchFilters {
    pub status: Option<String>,
    pub proof_mode: Option<String>,
    pub category: Option<String>,
    pub encrypted_only: bool,
}

/// Unified search response.
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

impl IndexEngine {
    /// Create a new index engine.
    pub fn new(config: IndexEngineConfig) -> StoreResult<Self> {
        let store = IndexStore::open(&config.db_path)?;
        let fuzzy = Arc::new(FuzzyIndex::new());
        let queue = Arc::new(IndexQueue::new(store.clone(), config.queue));

        let engine = Self {
            store: store.clone(),
            fuzzy,
            queue,
            ai_config: Arc::new(RwLock::new(config.ai)),
            encrypted_config: Arc::new(RwLock::new(config.encrypted)),
        };

        // Rebuild fuzzy index from stored tokens
        engine.rebuild_fuzzy_index()?;

        // Recover any pending queue jobs
        queue::recover_pending_jobs(&store)?;

        Ok(engine)
    }

    /// Index a new document or re-index an existing one.
    pub fn index_document(&self, req: &IndexRequest) -> StoreResult<IndexResult> {
        let start = std::time::Instant::now();

        // Step 1: Tokenize content
        let tokenized = tokenizer::tokenize(&req.content);
        let title_tokenized = tokenizer::tokenize(&req.title);

        // Step 2: Run privacy scan
        let privacy_scan = privacy::scan_privacy(&req.content);
        let privacy_level = if req.encrypted {
            PrivacyLevel::Private
        } else if privacy_scan.risk_score > 0.3 {
            PrivacyLevel::Partial
        } else {
            PrivacyLevel::Public
        };

        // Step 3: Store document metadata
        let meta = DocumentMeta {
            doc_id: req.doc_id.clone(),
            owner_id: req.owner_id.clone(),
            title: req.title.clone(),
            status: req.status.clone(),
            proof_mode: req.proof_mode.clone(),
            encrypted: req.encrypted,
            encrypted_search_opt_in: req.encrypted_search_opt_in,
            category: req.category.clone(),
            tags: req.tags.clone(),
            signer_labels: req.signer_labels.clone(),
            hash_prefix: req.hash_prefix.clone(),
            cid_prefix: req.cid_prefix.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            token_count: tokenized.tokens.len(),
        };
        self.store.put_meta(&req.doc_id, &meta)?;

        // Step 4: Build inverted index (for non-encrypted, or encrypted with opt-in)
        let mut indexed_tokens = Vec::new();
        if !req.encrypted {
            // Full indexing for unencrypted documents
            let all_tokens: Vec<(String, usize)> = title_tokenized
                .positions
                .iter()
                .map(|(t, p)| (t.clone(), *p))
                .chain(tokenized.positions.iter().map(|(t, p)| (t.clone(), p + 1000)))
                .collect();

            inverted::index_tokens(&self.store, &req.doc_id, &all_tokens)?;
            indexed_tokens = all_tokens.iter().map(|(t, _)| t.clone()).collect();

            // Step 5: Build prefix index
            let unique_tokens: Vec<String> = {
                let mut set = std::collections::HashSet::new();
                all_tokens
                    .iter()
                    .filter(|(t, _)| set.insert(t.clone()))
                    .map(|(t, _)| t.clone())
                    .collect()
            };
            trie::index_prefixes(&self.store, &req.doc_id, &unique_tokens)?;

            // Step 6: Update fuzzy index
            for token in &unique_tokens {
                self.fuzzy.insert(token, &req.doc_id);
            }

            // Step 7: Smart scan
            scanner::scan_document(&self.store, &req.doc_id, &req.content, false)?;
        } else if req.encrypted_search_opt_in {
            // Partial indexing for encrypted documents (safe tokens only)
            let config = self.encrypted_config.read().clone();
            if let Some(entry) = encrypted::index_encrypted_document(
                &self.store,
                &req.doc_id,
                &req.content,
                &config,
            )? {
                // Index safe tokens in inverted index
                let safe_positions: Vec<(String, usize)> = entry
                    .safe_tokens
                    .iter()
                    .enumerate()
                    .map(|(i, t)| (t.clone(), i))
                    .collect();
                inverted::index_tokens(&self.store, &req.doc_id, &safe_positions)?;

                indexed_tokens = entry.safe_tokens;
            }
        }

        // Step 8: Store privacy level
        let privacy_val = serde_json::to_vec(&privacy_level).unwrap_or_default();
        self.store.put_cf(
            store::CF_PRIVACY,
            req.doc_id.as_bytes(),
            &privacy_val,
        )?;

        // Update stats
        self.store.increment_stat(|s| {
            s.total_documents += 1;
            s.total_tokens += indexed_tokens.len() as u64;
            if req.encrypted {
                s.total_encrypted += 1;
                if req.encrypted_search_opt_in {
                    s.total_encrypted_opt_in += 1;
                }
            }
        });

        Ok(IndexResult {
            doc_id: req.doc_id.clone(),
            tokens_indexed: indexed_tokens.len(),
            privacy_level,
            pii_detected: !privacy_scan.detections.is_empty(),
            risk_score: privacy_scan.risk_score,
            processing_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    /// Remove a document from the index.
    pub fn remove_document(&self, doc_id: &str) -> StoreResult<()> {
        // Get forward index tokens for cleanup
        inverted::remove_document(&self.store, doc_id)?;

        // Remove prefix entries (need tokens from forward index)
        if let Some(bytes) = self.store.get_cf(store::CF_FORWARD, doc_id.as_bytes())? {
            if let Ok(tokens) = serde_json::from_slice::<Vec<String>>(&bytes) {
                trie::remove_prefixes(&self.store, doc_id, &tokens)?;
            }
        }

        // Remove from fuzzy index
        self.fuzzy.remove_doc(doc_id);

        // Remove encrypted partial index
        encrypted::remove_partial_index(&self.store, doc_id)?;

        // Remove entities, privacy, meta
        self.store.delete_cf(store::CF_ENTITIES, doc_id.as_bytes())?;
        self.store.delete_cf(store::CF_PRIVACY, doc_id.as_bytes())?;
        self.store.delete_meta(doc_id)?;

        self.store.increment_stat(|s| {
            s.total_documents = s.total_documents.saturating_sub(1);
        });

        Ok(())
    }

    /// Unified search across all index types.
    pub fn search(&self, req: &SearchRequest) -> StoreResult<SearchResponse> {
        let start = std::time::Instant::now();
        let max_results = req.max_results.unwrap_or(50);
        let query_tokens = tokenizer::tokenize_query(&req.query);

        // Primary search based on mode
        let scored_docs = match req.search_mode {
            SearchMode::All => {
                inverted::search(&self.store, &query_tokens, req.owner_id.as_deref(), max_results)?
            }
            SearchMode::Any => {
                inverted::search_any(&self.store, &query_tokens, req.owner_id.as_deref(), max_results)?
            }
            SearchMode::Prefix => {
                let prefix_results = trie::prefix_search(
                    &self.store,
                    &req.query,
                    req.owner_id.as_deref(),
                    max_results,
                )?;
                prefix_results
                    .into_iter()
                    .map(|p| inverted::ScoredDoc {
                        doc_id: p.doc_id,
                        score: p.score,
                    })
                    .collect()
            }
            SearchMode::Entity => {
                let entity_results = scanner::search_entities(
                    &self.store,
                    None,
                    &req.query,
                    max_results,
                )?;
                entity_results
                    .into_iter()
                    .map(|e| inverted::ScoredDoc {
                        doc_id: e.doc_id,
                        score: e.total_score,
                    })
                    .collect()
            }
        };

        // Enrich results with metadata
        let mut results = Vec::new();
        for scored in &scored_docs {
            if let Some(meta) = self.store.get_meta(&scored.doc_id)? {
                // Apply filters
                if let Some(ref status) = req.filters.status {
                    if meta.status != *status {
                        continue;
                    }
                }
                if let Some(ref proof_mode) = req.filters.proof_mode {
                    if meta.proof_mode != *proof_mode {
                        continue;
                    }
                }
                if let Some(ref category) = req.filters.category {
                    if meta.category.as_deref() != Some(category.as_str()) {
                        continue;
                    }
                }
                if req.filters.encrypted_only && !meta.encrypted {
                    continue;
                }

                results.push(SearchResultItem {
                    doc_id: scored.doc_id.clone(),
                    title: meta.title,
                    score: scored.score,
                    status: meta.status,
                    category: meta.category,
                    encrypted: meta.encrypted,
                    snippet: None,
                });
            }
        }

        // Fuzzy search (if enabled)
        let fuzzy_results = if req.include_fuzzy {
            let max_dist = req.fuzzy_distance.unwrap_or(2);
            let mut fuzzy = Vec::new();
            for qt in &query_tokens {
                let matches = self.fuzzy.search(qt, max_dist);
                for m in matches {
                    if m.distance > 0 {
                        for doc_id in &m.doc_ids {
                            fuzzy.push(FuzzyResultItem {
                                doc_id: doc_id.clone(),
                                matched_word: m.word.clone(),
                                distance: m.distance,
                            });
                        }
                    }
                }
            }
            fuzzy.truncate(max_results);
            fuzzy
        } else {
            Vec::new()
        };

        // Encrypted search (if enabled and opted in)
        let encrypted_results = if req.include_encrypted {
            encrypted::search_encrypted(
                &self.store,
                &query_tokens,
                req.owner_id.as_deref(),
                max_results,
            )?
        } else {
            Vec::new()
        };

        let total = results.len();
        results.truncate(max_results);

        Ok(SearchResponse {
            results,
            total,
            fuzzy_results,
            encrypted_results,
            query_tokens,
            search_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    /// Enqueue a document for background indexing.
    pub fn enqueue_index(&self, doc_id: &str, owner_id: &str, job_type: JobType) -> StoreResult<String> {
        let job = IndexQueue::new_job(doc_id, owner_id, job_type, JobPriority::Normal);
        let job_id = job.job_id.clone();
        self.queue.enqueue(job)?;
        Ok(job_id)
    }

    /// Enqueue bulk encrypted import for a user.
    pub fn enqueue_bulk_import(&self, owner_id: &str, doc_ids: &[String]) -> StoreResult<usize> {
        self.queue.enqueue_bulk_encrypted_import(owner_id, doc_ids)
    }

    /// Get queue statistics.
    pub fn queue_stats(&self) -> queue::QueueStats {
        self.queue.stats()
    }

    /// Get index statistics.
    pub fn index_stats(&self) -> store::IndexStats {
        self.store.stats()
    }

    /// Get queue jobs for a specific owner.
    pub fn get_owner_queue(&self, owner_id: &str) -> StoreResult<Vec<IndexJob>> {
        self.queue.get_owner_jobs(owner_id)
    }

    /// Cancel pending queue jobs for an owner.
    pub fn cancel_owner_queue(&self, owner_id: &str) -> StoreResult<usize> {
        self.queue.cancel_owner_jobs(owner_id)
    }

    /// Process the next batch of queued jobs.
    pub fn process_queue_batch(&self) -> StoreResult<usize> {
        let batch = self.queue.dequeue_batch(self.queue.stats().pending.min(10) as usize)?;
        let processed = batch.len();

        for job in batch {
            self.queue.mark_in_progress(&job.job_id)?;

            match self.process_job(&job) {
                Ok(()) => {
                    self.queue.mark_completed(&job.job_id)?;
                }
                Err(e) => {
                    self.queue.mark_failed(&job.job_id, &e.to_string())?;
                }
            }
        }

        Ok(processed)
    }

    /// AI-enhanced indexing for a document (async).
    pub async fn ai_index(&self, _doc_id: &str, content: &str) -> Result<ai::AiIndexResult, ai::AiIndexError> {
        let config = self.ai_config.read().clone();
        ai::ai_index_document(content, &config).await
    }

    /// Update AI configuration.
    pub fn set_ai_config(&self, config: ai::AiIndexConfig) {
        *self.ai_config.write() = config;
    }

    /// Update encrypted indexing configuration.
    pub fn set_encrypted_config(&self, config: EncryptedIndexConfig) {
        *self.encrypted_config.write() = config;
    }

    /// Autocomplete suggestions for a prefix.
    pub fn autocomplete(&self, prefix: &str, max_suggestions: usize) -> StoreResult<Vec<String>> {
        trie::autocomplete(&self.store, prefix, max_suggestions)
    }

    /// Get the underlying store (for advanced operations).
    pub fn store(&self) -> &IndexStore {
        &self.store
    }

    /// Compact the database.
    pub fn compact(&self) {
        self.store.compact();
    }

    /// Flush pending writes.
    pub fn flush(&self) -> StoreResult<()> {
        self.store.flush()
    }

    // ── Internal ─────────────────────────────────────────────────────

    fn rebuild_fuzzy_index(&self) -> StoreResult<()> {
        let doc_ids = self.store.list_all_doc_ids()?;
        let mut count = 0usize;

        for doc_id in &doc_ids {
            if let Some(bytes) = self.store.get_cf(store::CF_FORWARD, doc_id.as_bytes())? {
                if let Ok(tokens) = serde_json::from_slice::<Vec<String>>(&bytes) {
                    for token in &tokens {
                        self.fuzzy.insert(token, doc_id);
                        count += 1;
                    }
                }
            }
        }

        tracing::info!(
            docs = doc_ids.len(),
            tokens = count,
            "Rebuilt fuzzy index from stored tokens"
        );
        Ok(())
    }

    fn process_job(&self, job: &IndexJob) -> StoreResult<()> {
        match job.job_type {
            JobType::IndexNew | JobType::ReIndex | JobType::FullReIndex => {
                tracing::info!(doc_id = %job.doc_id, "Processing index job");
                // In a real system, we'd fetch the document content here
                // For now, just mark it as needing content from the caller
            }
            JobType::IndexEncrypted => {
                tracing::info!(doc_id = %job.doc_id, "Processing encrypted index job");
            }
            JobType::BulkEncryptedImport => {
                tracing::info!(owner_id = %job.owner_id, "Processing bulk encrypted import");
            }
            JobType::AiEnhance => {
                tracing::info!(doc_id = %job.doc_id, "AI enhance job queued (async)");
            }
        }
        Ok(())
    }
}

/// Result of indexing a document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexResult {
    pub doc_id: String,
    pub tokens_indexed: usize,
    pub privacy_level: PrivacyLevel,
    pub pii_detected: bool,
    pub risk_score: f64,
    pub processing_time_ms: u64,
}
