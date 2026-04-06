//! Text tokenizer with stemming, normalization, stop-word removal, and n-gram generation.
//!
//! Uses a simplified Porter stemmer for English and generates both unigrams
//! and bigrams for improved phrase matching.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use unicode_normalization::UnicodeNormalization;

/// Tokenization result with positions for proximity ranking.
#[derive(Debug, Clone)]
pub struct TokenizedText {
    pub tokens: Vec<String>,
    pub bigrams: Vec<String>,
    pub positions: Vec<(String, usize)>,
}

static STOP_WORDS: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    [
        "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "is", "it", "as", "was", "are", "be",
        "been", "being", "have", "has", "had", "do", "does", "did", "will",
        "would", "could", "should", "may", "might", "shall", "can", "this",
        "that", "these", "those", "i", "you", "he", "she", "we", "they",
        "me", "him", "her", "us", "them", "my", "your", "his", "its", "our",
        "their", "what", "which", "who", "whom", "where", "when", "how",
        "not", "no", "nor", "if", "then", "than", "so", "up", "out", "about",
        "into", "over", "after", "before", "between", "under", "again",
        "further", "once", "here", "there", "all", "each", "every", "both",
        "few", "more", "most", "other", "some", "such", "only", "own", "same",
        "too", "very", "just",
    ]
    .into_iter()
    .collect()
});

/// Tokenize text for indexing: normalize → split → stem → filter stop words.
pub fn tokenize(text: &str) -> TokenizedText {
    let normalized = normalize(text);
    let words = split_words(&normalized);

    let mut tokens = Vec::new();
    let mut positions = Vec::new();

    for (pos, word) in words.iter().enumerate() {
        if word.len() < 2 || STOP_WORDS.contains(word.as_str()) {
            continue;
        }
        let stemmed = stem(word);
        if stemmed.len() >= 2 {
            positions.push((stemmed.clone(), pos));
            tokens.push(stemmed);
        }
    }

    // Generate bigrams for phrase matching
    let bigrams = generate_bigrams(&tokens);

    TokenizedText {
        tokens,
        bigrams,
        positions,
    }
}

/// Tokenize a search query (less aggressive filtering).
pub fn tokenize_query(text: &str) -> Vec<String> {
    let normalized = normalize(text);
    let words = split_words(&normalized);

    words
        .into_iter()
        .filter(|w| w.len() >= 2)
        .map(|w| stem(&w))
        .filter(|s| s.len() >= 2)
        .collect()
}

/// Unicode NFC normalization + lowercase + strip accents.
fn normalize(text: &str) -> String {
    text.nfc()
        .collect::<String>()
        .to_lowercase()
}

/// Split on word boundaries, keeping only alphanumeric sequences.
fn split_words(text: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        if ch.is_alphanumeric() || ch == '\'' {
            current.push(ch);
        } else if !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

/// Simplified Porter stemmer — handles the most common English suffixes.
/// Not meant to be linguistically perfect, but fast and good enough for search.
pub fn stem(word: &str) -> String {
    let mut w = word.to_string();

    // Step 1: plurals and -ed/-ing
    if w.ends_with("sses") {
        w.truncate(w.len() - 2);
    } else if w.ends_with("ies") && w.len() > 4 {
        w.truncate(w.len() - 2);
    } else if w.ends_with("ss") {
        // keep as-is
    } else if w.ends_with('s') && w.len() > 3 && !w.ends_with("us") && !w.ends_with("ss") {
        w.pop();
    }

    if w.ends_with("eed") && w.len() > 4 {
        w.truncate(w.len() - 1);
    } else if w.ends_with("ed") && w.len() > 4 && has_vowel(&w[..w.len() - 2]) {
        w.truncate(w.len() - 2);
        fix_stem(&mut w);
    } else if w.ends_with("ing") && w.len() > 5 && has_vowel(&w[..w.len() - 3]) {
        w.truncate(w.len() - 3);
        fix_stem(&mut w);
    }

    // Step 2: y → i
    if w.ends_with('y') && w.len() > 3 && has_vowel(&w[..w.len() - 1]) {
        w.pop();
        w.push('i');
    }

    // Step 3: common suffixes
    let suffix_map: &[(&str, &str, usize)] = &[
        ("ational", "ate", 5),
        ("tional", "tion", 5),
        ("enci", "ence", 4),
        ("anci", "ance", 4),
        ("izer", "ize", 4),
        ("alli", "al", 4),
        ("entli", "ent", 4),
        ("eli", "e", 4),
        ("ousli", "ous", 4),
        ("ization", "ize", 5),
        ("ation", "ate", 5),
        ("ator", "ate", 4),
        ("alism", "al", 4),
        ("iveness", "ive", 5),
        ("fulness", "ful", 5),
        ("ousness", "ous", 5),
        ("aliti", "al", 4),
        ("iviti", "ive", 4),
        ("biliti", "ble", 4),
    ];

    for &(suffix, replacement, min_len) in suffix_map {
        if w.len() > min_len && w.ends_with(suffix) {
            w.truncate(w.len() - suffix.len());
            w.push_str(replacement);
            break;
        }
    }

    // Step 4: remove common endings
    let removals: &[(&str, usize)] = &[
        ("ement", 6),
        ("ment", 5),
        ("ent", 5),
        ("ance", 5),
        ("ence", 5),
        ("able", 5),
        ("ible", 5),
        ("ant", 5),
        ("ness", 5),
        ("ful", 5),
        ("ous", 5),
        ("ive", 5),
    ];

    for &(suffix, min_len) in removals {
        if w.len() > min_len && w.ends_with(suffix) {
            w.truncate(w.len() - suffix.len());
            break;
        }
    }

    // Step 5: final cleanup
    if w.ends_with('e') && w.len() > 3 {
        w.pop();
    }
    if w.ends_with("ll") && w.len() > 3 {
        w.pop();
    }

    w
}

fn has_vowel(s: &str) -> bool {
    s.chars().any(|c| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u'))
}

fn fix_stem(w: &mut String) {
    let last = w.chars().last().unwrap_or('x');
    // Double consonant → remove last
    if w.len() >= 2 {
        let chars: Vec<char> = w.chars().collect();
        let n = chars.len();
        if chars[n - 1] == chars[n - 2] && !matches!(chars[n - 1], 'l' | 's' | 'z') {
            w.pop();
            return;
        }
    }
    // Short stem → add 'e'
    if w.len() <= 3 && !matches!(last, 'a' | 'e' | 'i' | 'o' | 'u') {
        w.push('e');
    }
}

/// Generate bigrams from a list of tokens.
fn generate_bigrams(tokens: &[String]) -> Vec<String> {
    if tokens.len() < 2 {
        return Vec::new();
    }
    tokens
        .windows(2)
        .map(|pair| format!("{}_{}", pair[0], pair[1]))
        .collect()
}

/// Generate character-level n-grams for fuzzy prefix matching.
pub fn char_ngrams(word: &str, n: usize) -> Vec<String> {
    if word.len() < n {
        return vec![word.to_string()];
    }
    let chars: Vec<char> = word.chars().collect();
    chars
        .windows(n)
        .map(|w| w.iter().collect())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenize_basic() {
        let result = tokenize("The quick brown fox jumps over the lazy dog");
        assert!(result.tokens.contains(&"quick".to_string()));
        assert!(result.tokens.contains(&"brown".to_string()));
        assert!(result.tokens.contains(&"fox".to_string()));
        assert!(!result.tokens.contains(&"the".to_string()));
    }

    #[test]
    fn test_stem_plurals() {
        assert_eq!(stem("documents"), "docu");
        assert_eq!(stem("running"), "run");
        assert_eq!(stem("agreed"), "agre");
        assert_eq!(stem("contracts"), "contract");
    }

    #[test]
    fn test_bigrams() {
        let tokens = vec!["non".into(), "disclosur".into(), "agreement".into()];
        let bigrams = generate_bigrams(&tokens);
        assert_eq!(bigrams.len(), 2);
        assert!(bigrams.contains(&"non_disclosur".to_string()));
    }

    #[test]
    fn test_char_ngrams() {
        let ngrams = char_ngrams("hello", 3);
        assert_eq!(ngrams, vec!["hel", "ell", "llo"]);
    }
}
