//! Background queue system for batch re-indexing.
//!
//! Handles:
//! - Re-indexing existing documents when users opt in to encrypted search
//! - Bulk import of previously encrypted reports
//! - Priority queue with configurable concurrency
//! - Progress tracking and resumability
//! - Rate limiting to prevent resource exhaustion

use std::sync::Arc;

use flume::{Receiver, Sender};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

use crate::index::store::{IndexStore, CF_QUEUE, StoreResult};

/// Job priority levels.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum JobPriority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

/// A queued indexing job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexJob {
    pub job_id: String,
    pub doc_id: String,
    pub owner_id: String,
    pub job_type: JobType,
    pub priority: JobPriority,
    pub status: JobStatus,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
    pub retry_count: u32,
    pub max_retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum JobType {
    /// Index a new unencrypted document.
    IndexNew,
    /// Re-index an existing document (content changed).
    ReIndex,
    /// Index encrypted document with opt-in partial indexing.
    IndexEncrypted,
    /// Bulk import: re-index all encrypted docs for a user who just opted in.
    BulkEncryptedImport,
    /// AI-enhanced re-indexing.
    AiEnhance,
    /// Full re-index (scanner + inverted + prefix + entities).
    FullReIndex,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum JobStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Retrying,
}

/// Queue configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueConfig {
    pub max_concurrent: usize,
    pub max_retries: u32,
    /// Retry delay in milliseconds.
    pub retry_delay_ms: u64,
    pub batch_size: usize,
    /// Poll interval in milliseconds.
    pub poll_interval_ms: u64,
}

impl Default for QueueConfig {
    fn default() -> Self {
        Self {
            max_concurrent: 4,
            max_retries: 3,
            retry_delay_ms: 5000,
            batch_size: 50,
            poll_interval_ms: 500,
        }
    }
}

/// Queue statistics.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct QueueStats {
    pub pending: u64,
    pub in_progress: u64,
    pub completed: u64,
    pub failed: u64,
    pub total_processed: u64,
}

/// The index queue manager.
pub struct IndexQueue {
    store: IndexStore,
    config: QueueConfig,
    stats: Arc<RwLock<QueueStats>>,
    tx: Sender<IndexJob>,
    rx: Receiver<IndexJob>,
    shutdown: Arc<RwLock<bool>>,
}

impl IndexQueue {
    pub fn new(store: IndexStore, config: QueueConfig) -> Self {
        let (tx, rx) = flume::bounded(config.batch_size * 4);

        Self {
            store,
            config,
            stats: Arc::new(RwLock::new(QueueStats::default())),
            tx,
            rx,
            shutdown: Arc::new(RwLock::new(false)),
        }
    }

    /// Enqueue a new indexing job.
    pub fn enqueue(&self, job: IndexJob) -> StoreResult<()> {
        // Persist to RocksDB for durability
        let val = serde_json::to_vec(&job)?;
        self.store.put_cf(CF_QUEUE, job.job_id.as_bytes(), &val)?;

        // Send to in-memory channel for fast processing
        let _ = self.tx.try_send(job);

        self.stats.write().pending += 1;
        self.store.increment_stat(|s| s.pending_queue += 1);

        Ok(())
    }

    /// Enqueue a bulk encrypted import for a user.
    /// Creates individual jobs for each of the user's encrypted documents.
    pub fn enqueue_bulk_encrypted_import(
        &self,
        owner_id: &str,
        doc_ids: &[String],
    ) -> StoreResult<usize> {
        let now = chrono::Utc::now().to_rfc3339();
        let mut count = 0;

        for doc_id in doc_ids {
            let job = IndexJob {
                job_id: uuid::Uuid::new_v4().to_string(),
                doc_id: doc_id.clone(),
                owner_id: owner_id.to_string(),
                job_type: JobType::IndexEncrypted,
                priority: JobPriority::Normal,
                status: JobStatus::Pending,
                created_at: now.clone(),
                started_at: None,
                completed_at: None,
                error: None,
                retry_count: 0,
                max_retries: self.config.max_retries,
            };
            self.enqueue(job)?;
            count += 1;
        }

        tracing::info!(
            owner_id = owner_id,
            count = count,
            "Enqueued bulk encrypted import"
        );

        Ok(count)
    }

    /// Get the next batch of pending jobs, ordered by priority.
    pub fn dequeue_batch(&self, batch_size: usize) -> StoreResult<Vec<IndexJob>> {
        let entries = self.store.prefix_scan(CF_QUEUE, &[])?;
        let mut jobs: Vec<IndexJob> = entries
            .into_iter()
            .filter_map(|(_, val)| serde_json::from_slice::<IndexJob>(&val).ok())
            .filter(|j| j.status == JobStatus::Pending || j.status == JobStatus::Retrying)
            .collect();

        // Sort by priority (highest first), then by creation time
        jobs.sort_by(|a, b| {
            b.priority.cmp(&a.priority)
                .then(a.created_at.cmp(&b.created_at))
        });

        jobs.truncate(batch_size);
        Ok(jobs)
    }

    /// Mark a job as in-progress.
    pub fn mark_in_progress(&self, job_id: &str) -> StoreResult<()> {
        if let Some(bytes) = self.store.get_cf(CF_QUEUE, job_id.as_bytes())? {
            if let Ok(mut job) = serde_json::from_slice::<IndexJob>(&bytes) {
                job.status = JobStatus::InProgress;
                job.started_at = Some(chrono::Utc::now().to_rfc3339());
                let val = serde_json::to_vec(&job)?;
                self.store.put_cf(CF_QUEUE, job_id.as_bytes(), &val)?;

                let mut stats = self.stats.write();
                stats.pending = stats.pending.saturating_sub(1);
                stats.in_progress += 1;
            }
        }
        Ok(())
    }

    /// Mark a job as completed and remove from queue.
    pub fn mark_completed(&self, job_id: &str) -> StoreResult<()> {
        self.store.delete_cf(CF_QUEUE, job_id.as_bytes())?;

        let mut stats = self.stats.write();
        stats.in_progress = stats.in_progress.saturating_sub(1);
        stats.completed += 1;
        stats.total_processed += 1;

        self.store.increment_stat(|s| s.pending_queue = s.pending_queue.saturating_sub(1));

        Ok(())
    }

    /// Mark a job as failed, potentially scheduling a retry.
    pub fn mark_failed(&self, job_id: &str, error: &str) -> StoreResult<()> {
        if let Some(bytes) = self.store.get_cf(CF_QUEUE, job_id.as_bytes())? {
            if let Ok(mut job) = serde_json::from_slice::<IndexJob>(&bytes) {
                job.retry_count += 1;
                job.error = Some(error.to_string());

                if job.retry_count < job.max_retries {
                    job.status = JobStatus::Retrying;
                    tracing::warn!(
                        job_id = job_id,
                        retry = job.retry_count,
                        max = job.max_retries,
                        "Job failed, scheduling retry"
                    );
                } else {
                    job.status = JobStatus::Failed;
                    job.completed_at = Some(chrono::Utc::now().to_rfc3339());
                    tracing::error!(
                        job_id = job_id,
                        error = error,
                        "Job permanently failed"
                    );

                    let mut stats = self.stats.write();
                    stats.in_progress = stats.in_progress.saturating_sub(1);
                    stats.failed += 1;
                }

                let val = serde_json::to_vec(&job)?;
                self.store.put_cf(CF_QUEUE, job_id.as_bytes(), &val)?;
            }
        }
        Ok(())
    }

    /// Get current queue statistics.
    pub fn stats(&self) -> QueueStats {
        self.stats.read().clone()
    }

    /// Get jobs for a specific owner (for progress tracking).
    pub fn get_owner_jobs(&self, owner_id: &str) -> StoreResult<Vec<IndexJob>> {
        let entries = self.store.prefix_scan(CF_QUEUE, &[])?;
        let jobs: Vec<IndexJob> = entries
            .into_iter()
            .filter_map(|(_, val)| serde_json::from_slice::<IndexJob>(&val).ok())
            .filter(|j| j.owner_id == owner_id)
            .collect();
        Ok(jobs)
    }

    /// Cancel all pending jobs for an owner.
    pub fn cancel_owner_jobs(&self, owner_id: &str) -> StoreResult<usize> {
        let jobs = self.get_owner_jobs(owner_id)?;
        let mut cancelled = 0;

        for job in jobs {
            if job.status == JobStatus::Pending || job.status == JobStatus::Retrying {
                self.store.delete_cf(CF_QUEUE, job.job_id.as_bytes())?;
                cancelled += 1;
            }
        }

        let mut stats = self.stats.write();
        stats.pending = stats.pending.saturating_sub(cancelled as u64);
        self.store.increment_stat(|s| s.pending_queue = s.pending_queue.saturating_sub(cancelled as u64));

        Ok(cancelled)
    }

    /// Signal the queue to shut down.
    pub fn shutdown(&self) {
        *self.shutdown.write() = true;
    }

    /// Check if shutdown was requested.
    pub fn is_shutdown(&self) -> bool {
        *self.shutdown.read()
    }

    /// Get the receiver for the in-memory job channel.
    pub fn receiver(&self) -> &Receiver<IndexJob> {
        &self.rx
    }

    /// Create a new job with auto-generated ID.
    pub fn new_job(
        doc_id: &str,
        owner_id: &str,
        job_type: JobType,
        priority: JobPriority,
    ) -> IndexJob {
        IndexJob {
            job_id: uuid::Uuid::new_v4().to_string(),
            doc_id: doc_id.to_string(),
            owner_id: owner_id.to_string(),
            job_type,
            priority,
            status: JobStatus::Pending,
            created_at: chrono::Utc::now().to_rfc3339(),
            started_at: None,
            completed_at: None,
            error: None,
            retry_count: 0,
            max_retries: 3,
        }
    }
}

/// Re-index all pending jobs on startup (recovery).
pub fn recover_pending_jobs(store: &IndexStore) -> StoreResult<Vec<IndexJob>> {
    let entries = store.prefix_scan(CF_QUEUE, &[])?;
    let mut jobs: Vec<IndexJob> = entries
        .into_iter()
        .filter_map(|(_, val)| serde_json::from_slice::<IndexJob>(&val).ok())
        .collect();

    // Reset any InProgress jobs back to Pending (crashed during processing)
    for job in &mut jobs {
        if job.status == JobStatus::InProgress {
            job.status = JobStatus::Retrying;
            job.retry_count += 1;
            let val = serde_json::to_vec(&job).unwrap_or_default();
            store.put_cf(CF_QUEUE, job.job_id.as_bytes(), &val)?;
        }
    }

    let pending_count = jobs.iter().filter(|j| {
        j.status == JobStatus::Pending || j.status == JobStatus::Retrying
    }).count();

    tracing::info!(
        total = jobs.len(),
        pending = pending_count,
        "Recovered queue jobs from storage"
    );

    Ok(jobs)
}
