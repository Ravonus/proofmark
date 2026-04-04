//! BK-tree for fuzzy / typo-tolerant search using Damerau-Levenshtein distance.
//!
//! The BK-tree exploits the triangle inequality of edit distance to prune
//! the search space, yielding O(log n) average-case fuzzy lookups.
//! Rebuilt from the forward index on startup; updated incrementally.

use std::collections::{HashMap, HashSet};

use parking_lot::RwLock;

/// Damerau-Levenshtein distance using the two-row Wagner-Fischer algorithm.
///
/// Space: O(min(m, n)). Time: O(m * n).
/// Supports transposition as a single edit (swap of adjacent characters).
pub fn damerau_levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();

    // Ensure `a` is the longer string so `b` fits in a single row.
    let (a, b) = if a.len() >= b.len() { (a, b) } else { (b, a) };
    let (m, n) = (a.len(), b.len());

    if n == 0 {
        return m;
    }

    // Three rows: prev-prev, prev, current (for transposition look-back).
    let mut pp_row = vec![0usize; n + 1]; // i-2
    let mut p_row: Vec<usize> = (0..=n).collect(); // i-1
    let mut c_row = vec![0usize; n + 1]; // i

    for i in 1..=m {
        c_row[0] = i;

        for j in 1..=n {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };

            c_row[j] = (p_row[j] + 1) // deletion
                .min(c_row[j - 1] + 1) // insertion
                .min(p_row[j - 1] + cost); // substitution

            // Transposition of two adjacent characters
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                c_row[j] = c_row[j].min(pp_row[j - 2] + cost);
            }
        }

        std::mem::swap(&mut pp_row, &mut p_row);
        std::mem::swap(&mut p_row, &mut c_row);
        c_row.iter_mut().for_each(|v| *v = 0);
    }

    p_row[n]
}

// ── BK-tree internals ────────────────────────────────────────────────

#[derive(Debug)]
struct BkNode {
    word: String,
    doc_ids: HashSet<String>,
    children: HashMap<usize, Box<BkNode>>,
}

impl BkNode {
    fn new(word: String, doc_id: String) -> Self {
        Self {
            word,
            doc_ids: HashSet::from([doc_id]),
            children: HashMap::new(),
        }
    }

    /// Insert via recursive descent — O(log n) average.
    fn insert(&mut self, word: &str, doc_id: &str) {
        if self.word == word {
            self.doc_ids.insert(doc_id.to_string());
            return;
        }

        let dist = damerau_levenshtein(&self.word, word);
        match self.children.get_mut(&dist) {
            Some(child) => child.insert(word, doc_id),
            None => {
                self.children
                    .insert(dist, Box::new(BkNode::new(word.to_string(), doc_id.to_string())));
            }
        }
    }

    /// Range search — only visits children whose distance from `query`
    /// could possibly satisfy `dist ± max_dist` (triangle inequality).
    fn search(&self, query: &str, max_dist: usize, results: &mut Vec<FuzzyMatch>) {
        let dist = damerau_levenshtein(&self.word, query);

        if dist <= max_dist {
            results.push(FuzzyMatch {
                word: self.word.clone(),
                distance: dist,
                doc_ids: self.doc_ids.clone(),
            });
        }

        let low = dist.saturating_sub(max_dist);
        let high = dist + max_dist;
        for d in low..=high {
            if let Some(child) = self.children.get(&d) {
                child.search(query, max_dist, results);
            }
        }
    }

    fn remove_doc(&mut self, doc_id: &str) {
        self.doc_ids.remove(doc_id);
        for child in self.children.values_mut() {
            child.remove_doc(doc_id);
        }
    }

    fn node_count(&self) -> usize {
        1 + self.children.values().map(|c| c.count()).sum::<usize>()
    }

    fn count(&self) -> usize {
        self.node_count()
    }
}

// ── Public API ───────────────────────────────────────────────────────

/// Thread-safe BK-tree for fuzzy search.
pub struct FuzzyIndex {
    root: RwLock<Option<BkNode>>,
}

impl FuzzyIndex {
    pub fn new() -> Self {
        Self {
            root: RwLock::new(None),
        }
    }

    pub fn insert(&self, word: &str, doc_id: &str) {
        let mut root = self.root.write();
        match root.as_mut() {
            Some(node) => node.insert(word, doc_id),
            None => *root = Some(BkNode::new(word.to_string(), doc_id.to_string())),
        }
    }

    pub fn bulk_insert(&self, entries: &[(String, String)]) {
        let mut root = self.root.write();
        for (word, doc_id) in entries {
            match root.as_mut() {
                Some(node) => node.insert(word, doc_id),
                None => *root = Some(BkNode::new(word.clone(), doc_id.clone())),
            }
        }
    }

    pub fn search(&self, query: &str, max_distance: usize) -> Vec<FuzzyMatch> {
        let root = self.root.read();
        let mut results = Vec::new();
        if let Some(node) = root.as_ref() {
            node.search(query, max_distance, &mut results);
        }
        results.sort_by(|a, b| a.distance.cmp(&b.distance).then(a.word.cmp(&b.word)));
        results
    }

    pub fn remove_doc(&self, doc_id: &str) {
        let mut root = self.root.write();
        if let Some(node) = root.as_mut() {
            node.remove_doc(doc_id);
        }
    }

    pub fn node_count(&self) -> usize {
        self.root.read().as_ref().map_or(0, |n| n.node_count())
    }
}

#[derive(Debug, Clone)]
pub struct FuzzyMatch {
    pub word: String,
    pub distance: usize,
    pub doc_ids: HashSet<String>,
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_damerau_levenshtein() {
        assert_eq!(damerau_levenshtein("kitten", "sitting"), 3);
        assert_eq!(damerau_levenshtein("", "abc"), 3);
        assert_eq!(damerau_levenshtein("same", "same"), 0);
        assert_eq!(damerau_levenshtein("ab", "ba"), 1); // transposition
    }

    #[test]
    fn test_bk_tree_search() {
        let tree = FuzzyIndex::new();
        tree.insert("contract", "d1");
        tree.insert("contact", "d2");
        tree.insert("content", "d3");
        tree.insert("context", "d4");
        tree.insert("abstract", "d5");

        let results = tree.search("contrat", 2);
        let words: Vec<&str> = results.iter().map(|r| r.word.as_str()).collect();
        assert!(words.contains(&"contract"));
        assert!(words.contains(&"contact"));
    }

    #[test]
    fn test_bk_tree_remove() {
        let tree = FuzzyIndex::new();
        tree.insert("hello", "d1");
        tree.insert("hello", "d2");
        tree.remove_doc("d1");

        let results = tree.search("hello", 0);
        assert_eq!(results.len(), 1);
        assert!(!results[0].doc_ids.contains("d1"));
        assert!(results[0].doc_ids.contains("d2"));
    }
}
