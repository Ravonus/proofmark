//! AI-enhanced indexing module.
//!
//! When AI is enabled (by user or system config), this module sends document
//! content to an AI provider for:
//! - Semantic tagging and categorization
//! - Key clause extraction
//! - Summary generation for search snippets
//! - Entity disambiguation
//! - Custom taxonomy mapping
//!
//! The AI layer is fully optional and disabled by default.

use serde::{Deserialize, Serialize};

/// Configuration for AI-enhanced indexing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiIndexConfig {
    pub enabled: bool,
    pub provider: AiProvider,
    pub api_key: Option<String>,
    pub api_url: Option<String>,
    pub model: String,
    pub max_input_tokens: usize,
    pub timeout_secs: u64,
    pub features: AiFeatures,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AiProvider {
    Anthropic,
    OpenAI,
    Local,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiFeatures {
    pub semantic_tags: bool,
    pub clause_extraction: bool,
    pub summary_generation: bool,
    pub entity_disambiguation: bool,
    pub taxonomy_mapping: bool,
    pub risk_assessment: bool,
}

impl Default for AiIndexConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: AiProvider::Anthropic,
            api_key: None,
            api_url: None,
            model: "claude-sonnet-4-5-20250514".to_string(),
            max_input_tokens: 4000,
            timeout_secs: 30,
            features: AiFeatures {
                semantic_tags: true,
                clause_extraction: true,
                summary_generation: true,
                entity_disambiguation: false,
                taxonomy_mapping: false,
                risk_assessment: false,
            },
        }
    }
}

/// Result from AI-enhanced indexing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiIndexResult {
    pub semantic_tags: Vec<SemanticTag>,
    pub extracted_clauses: Vec<ExtractedClause>,
    pub summary: Option<String>,
    pub entities: Vec<DisambiguatedEntity>,
    pub taxonomy: Vec<TaxonomyMapping>,
    pub risk_indicators: Vec<RiskIndicator>,
    pub processing_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticTag {
    pub tag: String,
    pub confidence: f64,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedClause {
    pub clause_type: String,
    pub summary: String,
    pub importance: f64,
    pub parties_involved: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisambiguatedEntity {
    pub original: String,
    pub canonical: String,
    pub entity_type: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxonomyMapping {
    pub category: String,
    pub subcategory: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskIndicator {
    pub risk_type: String,
    pub severity: f64,
    pub description: String,
    pub location_hint: String,
}

/// Process a document with AI-enhanced indexing.
///
/// This is async because it calls external AI APIs.
pub async fn ai_index_document(
    text: &str,
    config: &AiIndexConfig,
) -> Result<AiIndexResult, AiIndexError> {
    if !config.enabled {
        return Err(AiIndexError::Disabled);
    }

    let api_key = config.api_key.as_ref().ok_or(AiIndexError::NoApiKey)?;
    let start = std::time::Instant::now();

    // Truncate input to max tokens (rough char estimate: 4 chars per token)
    let max_chars = config.max_input_tokens * 4;
    let truncated = if text.len() > max_chars {
        &text[..max_chars]
    } else {
        text
    };

    let prompt = build_index_prompt(truncated, &config.features);

    let response = match config.provider {
        AiProvider::Anthropic => call_anthropic(api_key, &config.model, &prompt, config.timeout_secs).await?,
        AiProvider::OpenAI => call_openai(api_key, &config.model, &prompt, config.timeout_secs).await?,
        AiProvider::Local => call_local(config.api_url.as_deref(), &prompt, config.timeout_secs).await?,
        AiProvider::Custom => {
            let url = config.api_url.as_ref().ok_or(AiIndexError::NoApiUrl)?;
            call_custom(url, api_key, &prompt, config.timeout_secs).await?
        }
    };

    let result = parse_ai_response(&response, &config.features)?;

    Ok(AiIndexResult {
        processing_time_ms: start.elapsed().as_millis() as u64,
        ..result
    })
}

#[derive(Debug, thiserror::Error)]
pub enum AiIndexError {
    #[error("AI indexing is disabled")]
    Disabled,
    #[error("No API key configured")]
    NoApiKey,
    #[error("No API URL configured")]
    NoApiUrl,
    #[error("AI API request failed: {0}")]
    RequestFailed(String),
    #[error("Failed to parse AI response: {0}")]
    ParseFailed(String),
    #[error("AI request timed out")]
    Timeout,
}

// ── Prompt building ──────────────────────────────────────────────────

fn build_index_prompt(text: &str, features: &AiFeatures) -> String {
    let mut sections = Vec::new();

    sections.push("Analyze this legal/business document and return a JSON object with the requested fields.".to_string());

    if features.semantic_tags {
        sections.push(r#"
"semantic_tags": Array of objects with { "tag": string, "confidence": 0-1, "category": string }.
Tags should be relevant searchable terms like "non-compete", "ip-assignment", "data-protection".
Categories: "legal", "business", "compliance", "financial", "operational"."#.to_string());
    }

    if features.clause_extraction {
        sections.push(r#"
"extracted_clauses": Array of objects with { "clause_type": string, "summary": string (1-2 sentences), "importance": 0-1, "parties_involved": string[] }.
Focus on the most important clauses: obligations, rights, termination, payment, liability."#.to_string());
    }

    if features.summary_generation {
        sections.push(r#"
"summary": A 2-3 sentence summary suitable for search result snippets. Focus on parties, purpose, and key terms."#.to_string());
    }

    if features.entity_disambiguation {
        sections.push(r#"
"entities": Array of { "original": string, "canonical": string, "entity_type": "person"|"organization"|"location", "confidence": 0-1 }.
Resolve abbreviations and aliases to canonical forms."#.to_string());
    }

    if features.taxonomy_mapping {
        sections.push(r#"
"taxonomy": Array of { "category": string, "subcategory": string, "confidence": 0-1 }.
Map to standard document taxonomy."#.to_string());
    }

    if features.risk_assessment {
        sections.push(r#"
"risk_indicators": Array of { "risk_type": string, "severity": 0-1, "description": string, "location_hint": string }.
Identify potentially problematic clauses (one-sided terms, unusual provisions, missing protections)."#.to_string());
    }

    format!(
        "{}\n\nReturn ONLY valid JSON, no markdown.\n\n--- DOCUMENT ---\n{}",
        sections.join("\n"),
        text
    )
}

// ── AI provider calls ────────────────────────────────────────────────

async fn call_anthropic(
    api_key: &str,
    model: &str,
    prompt: &str,
    timeout_secs: u64,
) -> Result<String, AiIndexError> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .json(&serde_json::json!({
            "model": model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}]
        }))
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                AiIndexError::Timeout
            } else {
                AiIndexError::RequestFailed(e.to_string())
            }
        })?;

    let body: serde_json::Value = resp.json().await.map_err(|e| AiIndexError::RequestFailed(e.to_string()))?;

    body["content"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AiIndexError::ParseFailed("No text in response".to_string()))
}

async fn call_openai(
    api_key: &str,
    model: &str,
    prompt: &str,
    timeout_secs: u64,
) -> Result<String, AiIndexError> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .json(&serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 4096,
            "response_format": {"type": "json_object"}
        }))
        .send()
        .await
        .map_err(|e| AiIndexError::RequestFailed(e.to_string()))?;

    let body: serde_json::Value = resp.json().await.map_err(|e| AiIndexError::RequestFailed(e.to_string()))?;

    body["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AiIndexError::ParseFailed("No content in response".to_string()))
}

async fn call_local(
    api_url: Option<&str>,
    prompt: &str,
    timeout_secs: u64,
) -> Result<String, AiIndexError> {
    let url = api_url.unwrap_or("http://localhost:11434/api/generate");
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .json(&serde_json::json!({
            "prompt": prompt,
            "stream": false,
            "format": "json"
        }))
        .send()
        .await
        .map_err(|e| AiIndexError::RequestFailed(e.to_string()))?;

    let body: serde_json::Value = resp.json().await.map_err(|e| AiIndexError::RequestFailed(e.to_string()))?;

    body["response"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AiIndexError::ParseFailed("No response in body".to_string()))
}

async fn call_custom(
    url: &str,
    api_key: &str,
    prompt: &str,
    timeout_secs: u64,
) -> Result<String, AiIndexError> {
    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .json(&serde_json::json!({ "prompt": prompt }))
        .send()
        .await
        .map_err(|e| AiIndexError::RequestFailed(e.to_string()))?;

    resp.text().await.map_err(|e| AiIndexError::RequestFailed(e.to_string()))
}

// ── Response parsing ─────────────────────────────────────────────────

fn parse_ai_response(response: &str, features: &AiFeatures) -> Result<AiIndexResult, AiIndexError> {
    let json: serde_json::Value = serde_json::from_str(response)
        .map_err(|e| AiIndexError::ParseFailed(format!("Invalid JSON: {}", e)))?;

    let semantic_tags = if features.semantic_tags {
        parse_array(&json, "semantic_tags")
    } else {
        Vec::new()
    };

    let extracted_clauses = if features.clause_extraction {
        parse_array(&json, "extracted_clauses")
    } else {
        Vec::new()
    };

    let summary = if features.summary_generation {
        json["summary"].as_str().map(|s| s.to_string())
    } else {
        None
    };

    let entities = if features.entity_disambiguation {
        parse_array(&json, "entities")
    } else {
        Vec::new()
    };

    let taxonomy = if features.taxonomy_mapping {
        parse_array(&json, "taxonomy")
    } else {
        Vec::new()
    };

    let risk_indicators = if features.risk_assessment {
        parse_array(&json, "risk_indicators")
    } else {
        Vec::new()
    };

    Ok(AiIndexResult {
        semantic_tags,
        extracted_clauses,
        summary,
        entities,
        taxonomy,
        risk_indicators,
        processing_time_ms: 0,
    })
}

fn parse_array<T: serde::de::DeserializeOwned>(json: &serde_json::Value, key: &str) -> Vec<T> {
    json[key]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}
