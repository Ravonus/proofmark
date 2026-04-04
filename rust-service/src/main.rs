mod api;
mod audit;
pub mod collab;
mod crypto;
mod forensic;
pub mod index;
mod pdf;
pub mod pqcrypto;
mod qr;
pub mod util;
mod verify;

use std::sync::Arc;
use std::time::Duration;

use actix_web::{middleware, web, App, HttpServer};
use tracing_subscriber::{fmt, EnvFilter};

const DEFAULT_PDF_UPLOAD_MAX_MB: usize = 10;
const BYTES_PER_MEGABYTE: usize = 1024 * 1024;

fn get_num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

fn get_pdf_upload_max_mb() -> usize {
    std::env::var("PDF_UPLOAD_MAX_MB")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_PDF_UPLOAD_MAX_MB)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Structured JSON logging with env filter
    fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive("proofmark_engine=info".parse().unwrap()),
        )
        .json()
        .init();

    let bind = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:9090".into());
    let workers = std::env::var("WORKERS")
        .ok()
        .and_then(|w| w.parse::<usize>().ok())
        .unwrap_or_else(get_num_cpus);
    let pdf_upload_max_mb = get_pdf_upload_max_mb();
    let pdf_analyze_payload_limit_bytes = pdf_upload_max_mb.saturating_mul(BYTES_PER_MEGABYTE);

    tracing::info!(bind = %bind, workers = workers, pdf_upload_max_mb = pdf_upload_max_mb, "Starting proofmark-engine");

    // Pre-warm the rayon thread pool
    rayon::ThreadPoolBuilder::new()
        .num_threads(workers)
        .build_global()
        .ok();

    // Initialize index engine
    let index_db_path = std::env::var("INDEX_DB_PATH")
        .unwrap_or_else(|_| "./data/index".into());
    let index_config = index::IndexEngineConfig {
        db_path: index_db_path,
        ..Default::default()
    };
    let index_engine = index::IndexEngine::new(index_config)
        .expect("Failed to initialize index engine");
    let index_engine = Arc::new(index_engine);

    tracing::info!("Index engine initialized");

    // Initialize collaboration room manager
    let room_manager = Arc::new(collab::RoomManager::new());
    tracing::info!("Collaboration room manager initialized");

    // Spawn background tasks
    spawn_background_tasks(room_manager.clone());

    let engine = index_engine.clone();
    let rooms = room_manager.clone();
    HttpServer::new(move || {
        App::new()
            .wrap(middleware::Compress::default())
            .wrap(middleware::Logger::new("%a %r %s %Dms"))
            .app_data(web::Data::from(engine.clone()))
            .app_data(web::Data::from(rooms.clone()))
            .configure(|cfg| api::configure(cfg, pdf_analyze_payload_limit_bytes))
            // WebSocket route for collaboration
            .route(
                "/ws/collab/{session_id}",
                web::get().to(collab::collab_ws_handler),
            )
    })
    .bind(&bind)?
    .workers(workers)
    .run()
    .await
}

/// Spawn background maintenance tasks.
fn spawn_background_tasks(room_mgr: Arc<collab::RoomManager>) {
    // Stale awareness cleanup (every 30s)
    let mgr = room_mgr.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            let removed = mgr.clean_stale_awareness(Duration::from_secs(30));
            if removed > 0 {
                tracing::debug!(removed, "Cleaned stale awareness states");
            }
        }
    });

    // Periodic room compaction (every 5 minutes)
    let mgr = room_mgr.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300));
        loop {
            interval.tick().await;
            let saved = mgr.compact_all();
            if saved > 0 {
                tracing::info!(saved_bytes = saved, "Compacted room states");
            }
        }
    });
}
