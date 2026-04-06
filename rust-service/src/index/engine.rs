use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

use super::*;
use super::bk_tree::FuzzyIndex;
use super::encrypted::EncryptedIndexConfig;
use super::queue::{IndexQueue, IndexJob, JobType, JobPriority};
use super::store::{self, DocumentMeta, IndexStore, PrivacyLevel, StoreResult};

impl IndexEngine {
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

        engine.rebuild_fuzzy_index()?;
        queue::recover_pending_jobs(&store)?;

        Ok(engine)
    }

    pub fn index_document(&self, req: &IndexRequest) -> StoreResult<IndexResult> {
        let start = std::time::Instant::now();

        let tokenized = tokenizer::tokenize(&req.content);
        let title_tokenized = tokenizer::tokenize(&req.title);

        let privacy_scan = privacy::scan_privacy(&req.content);
        let privacy_level = if req.encrypted {
            PrivacyLevel::Private
        } else if privacy_scan.risk_score > 0.3 {
            PrivacyLevel::Partial
        } else {
            PrivacyLevel::Public
        };

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

        let mut indexed_tokens = Vec::new();
        if !req.encrypted {
            let all_tokens: Vec<(String, usize)> = title_tokenized
                .positions
                .iter()
                .map(|(t, p)| (t.clone(), *p))
                .chain(tokenized.positions.iter().map(|(t, p)| (t.clone(), p + 1000)))
                .collect();

            inverted::index_tokens(&self.store, &req.doc_id, &all_tokens)?;
            indexed_tokens = all_tokens.iter().map(|(t, _)| t.clone()).collect();

            let unique_tokens: Vec<String> = {
                let mut set = std::collections::HashSet::new();
                all_tokens
                    .iter()
                    .filter(|(t, _)| set.insert(t.clone()))
                    .map(|(t, _)| t.clone())
                    .collect()
            };
            trie::index_prefixes(&self.store, &req.doc_id, &unique_tokens)?;

            for token in &unique_tokens {
                self.fuzzy.insert(token, &req.doc_id);
            }

            scanner::scan_document(&self.store, &req.doc_id, &req.content, false)?;
        } else if req.encrypted_search_opt_in {
            let config = self.encrypted_config.read().clone();
            if let Some(entry) = encrypted::index_encrypted_document(
                &self.store,
                &req.doc_id,
                &req.content,
                &config,
            )? {
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

        let privacy_val = serde_json::to_vec(&privacy_level).unwrap_or_default();
        self.store.put_cf(
            store::CF_PRIVACY,
            req.doc_id.as_bytes(),
            &privacy_val,
        )?;

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

    pub fn remove_document(&self, doc_id: &str) -> StoreResult<()> {
        inverted::remove_document(&self.store, doc_id)?;

        if let Some(bytes) = self.store.get_cf(store::CF_FORWARD, doc_id.as_bytes())? {
            if let Ok(tokens) = serde_json::from_slice::<Vec<String>>(&bytes) {
                trie::remove_prefixes(&self.store, doc_id, &tokens)?;
            }
        }

        self.fuzzy.remove_doc(doc_id);
        encrypted::remove_partial_index(&self.store, doc_id)?;

        self.store.delete_cf(store::CF_ENTITIES, doc_id.as_bytes())?;
        self.store.delete_cf(store::CF_PRIVACY, doc_id.as_bytes())?;
        self.store.delete_meta(doc_id)?;

        self.store.increment_stat(|s| {
            s.total_documents = s.total_documents.saturating_sub(1);
        });

        Ok(())
    }

    pub fn search(&self, req: &SearchRequest) -> StoreResult<SearchResponse> {
        let start = std::time::Instant::now();
        let max_results = req.max_results.unwrap_or(50);
        let query_tokens = tokenizer::tokenize_query(&req.query);

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

        let mut results = Vec::new();
        for scored in &scored_docs {
            if let Some(meta) = self.store.get_meta(&scored.doc_id)? {
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

    pub fn enqueue_index(&self, doc_id: &str, owner_id: &str, job_type: JobType) -> StoreResult<String> {
        let job = IndexQueue::new_job(doc_id, owner_id, job_type, JobPriority::Normal);
        let job_id = job.job_id.clone();
        self.queue.enqueue(job)?;
        Ok(job_id)
    }

    pub fn enqueue_bulk_import(&self, owner_id: &str, doc_ids: &[String]) -> StoreResult<usize> {
        self.queue.enqueue_bulk_encrypted_import(owner_id, doc_ids)
    }

    pub fn queue_stats(&self) -> queue::QueueStats {
        self.queue.stats()
    }

    pub fn index_stats(&self) -> store::IndexStats {
        self.store.stats()
    }

    pub fn get_owner_queue(&self, owner_id: &str) -> StoreResult<Vec<IndexJob>> {
        self.queue.get_owner_jobs(owner_id)
    }

    pub fn cancel_owner_queue(&self, owner_id: &str) -> StoreResult<usize> {
        self.queue.cancel_owner_jobs(owner_id)
    }

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

    pub async fn ai_index(&self, _doc_id: &str, content: &str) -> Result<ai::AiIndexResult, ai::AiIndexError> {
        let config = self.ai_config.read().clone();
        ai::ai_index_document(content, &config).await
    }

    pub fn set_ai_config(&self, config: ai::AiIndexConfig) {
        *self.ai_config.write() = config;
    }

    pub fn set_encrypted_config(&self, config: EncryptedIndexConfig) {
        *self.encrypted_config.write() = config;
    }

    pub fn autocomplete(&self, prefix: &str, max_suggestions: usize) -> StoreResult<Vec<String>> {
        trie::autocomplete(&self.store, prefix, max_suggestions)
    }

    pub fn store(&self) -> &IndexStore {
        &self.store
    }

    pub fn compact(&self) {
        self.store.compact();
    }

    pub fn flush(&self) -> StoreResult<()> {
        self.store.flush()
    }

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexResult {
    pub doc_id: String,
    pub tokens_indexed: usize,
    pub privacy_level: PrivacyLevel,
    pub pii_detected: bool,
    pub risk_score: f64,
    pub processing_time_ms: u64,
}
