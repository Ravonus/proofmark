//! All compiled static regex patterns for PDF analysis.
//!
//! Each pattern is compiled once via `Lazy<Regex>` and reused across all analysis calls.

use once_cell::sync::Lazy;
use regex::Regex;

// ══════════════════════════════════════════════════════════════════════════════
// Core detection patterns
// ══════════════════════════════════════════════════════════════════════════════

pub static BLANK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?:_{3,}|\.{5,}|-{5,})").unwrap());

pub static MULTI_PARTY_INITIALS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b[A-Za-z]+\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,}).*\b[A-Za-z]+\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,})").unwrap()
});

pub static MULTI_PARTY_INITIALS_CAPTURE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b([A-Za-z]+)\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,})").unwrap()
});

pub static PARTY_ROLES_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:Buyer|Seller|Investor|Borrower|Lender|Licensor|Licensee|Landlord|Tenant|Legal\s*Counsel|Counsel|Auditor|Guarantor|Contractor|Client|Vendor|Supplier|Agent|Broker|Trustee|Beneficiary|Employer|Employee|Consultant|Service\s*Provider|Recipient|Grantor|Grantee|Assignor|Assignee|Mortgagor|Mortgagee|Pledgor|Pledgee|Principal|Surety|Indemnitor|Indemnitee|Obligor|Obligee|Franchisor|Franchisee|Lessor|Lessee|Partner|Member|Manager|Director|Officer|Shareholder|Stakeholder|Underwriter|Arranger|Servicer|Originator|Custodian)\b").unwrap()
});

pub static SIGNATURE_HEADING_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^\s*(?:IN\s+WITNESS\s+WHEREOF|SIGNATURES?\s*(?:PAGE|BLOCK|SECTION)?|EXECUTION\s+(?:PAGE|BLOCK)|AGREED\s+AND\s+ACCEPTED|ACKNOWLEDGED\s+AND\s+AGREED|SIGNED\s*,?\s*SEALED\s*,?\s*(?:AND\s*)?DELIVERED|BY\s+THEIR\s+(?:DULY\s+)?AUTHORIZED\s+REPRESENTATIVES?)\b").unwrap()
});

pub static CHECKBOX_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[\u{2610}\u{2611}\u{2612}\u{25A1}\u{25A0}\u{25CB}\u{25CF}]|(?:\[\s*[xX]?\s*\])")
        .unwrap()
});

// ══════════════════════════════════════════════════════════════════════════════
// Document type classification
// ══════════════════════════════════════════════════════════════════════════════

pub static DOCTYPE_NDA_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:non-?disclosure|nda|confidentiality)\b").unwrap()
});
pub static DOCTYPE_EMPLOYMENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:employment\s+(?:agreement|contract)|offer\s+letter|job\s+offer)\b")
        .unwrap()
});
pub static DOCTYPE_LEASE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:lease\s+agreement|rental\s+agreement|tenancy)\b").unwrap()
});
pub static DOCTYPE_LOAN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:loan\s+agreement|promissory\s+note|mortgage)\b").unwrap()
});
pub static DOCTYPE_SERVICE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(?:service\s+agreement|consulting\s+agreement|independent\s+contractor)\b",
    )
    .unwrap()
});
pub static DOCTYPE_PURCHASE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:purchase\s+agreement|sale\s+agreement|bill\s+of\s+sale)\b").unwrap()
});

// ══════════════════════════════════════════════════════════════════════════════
// Document type detection (inline regexes converted to statics)
// ══════════════════════════════════════════════════════════════════════════════

pub static NDA_AGREEMENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bnon[\s-]?disclosure\s+agreement\b").unwrap()
});
pub static CONFIDENTIALITY_AGREEMENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bconfidentiality\s+agreement\b").unwrap()
});
pub static MASTER_SERVICE_AGREEMENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bmaster\s+service\s+agreement\b").unwrap()
});
pub static SERVICE_LEVEL_AGREEMENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bservice\s+(?:level\s+)?agreement\b").unwrap()
});
pub static CONSULTING_AGREEMENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bconsulting\s+agreement\b").unwrap()
});
pub static TOKEN_PURCHASE_AGREEMENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\btoken\s+(purchase|sale)\s+agreement\b").unwrap()
});

// ══════════════════════════════════════════════════════════════════════════════
// Field detection patterns (inline regexes converted to statics)
// ══════════════════════════════════════════════════════════════════════════════

pub static CLAUSE_NUM_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^\d+\.\s+(?:COMPLEX\s+)?CLAUSE\s+\d+").unwrap()
});
pub static ARTICLE_SECTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:ARTICLE|SECTION)\s+\d+").unwrap()
});
pub static SPECIAL_CONDITIONS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^SPECIAL\s+CONDITIONS").unwrap()
});

// ══════════════════════════════════════════════════════════════════════════════
// Field-in-line detection patterns (inline regexes converted to statics)
// ══════════════════════════════════════════════════════════════════════════════

pub static SIG_LINE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)signature\s*:\s*(?:_{3,}|\.{5,}|-{5,})").unwrap()
});
pub static BY_LINE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bBy\s*:\s*(?:_{3,}|\.{5,}|-{5,})").unwrap()
});
pub static ITS_LINE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\bIts\s*:\s*(?:_{3,}|\.{5,}|-{5,})").unwrap()
});
pub static INITIALS_LINE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\binitials\s*:\s*(?:_{3,}|\.{3,}|-{3,})").unwrap()
});
pub static NAME_CAPTURE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(?:(?:typed\s+or\s+)?print(?:ed)?\s+name|name\s*\(print(?:ed)?\)|^name)\s*:\s*((?:_{3,}|\.{5,}|-{5,})|([A-Za-z\u{00C0}-\u{024F}][A-Za-z\u{00C0}-\u{024F}\s.'-]{1,60}))",
    )
    .unwrap()
});
pub static EFFECTIVE_DATE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)effective\s+date").unwrap()
});
pub static DATE_CAPTURE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\bDate\s*:\s*((?:_{3,}|\.{5,}|-{5,})|[\d/.-]+|[A-Z][a-z]+\s+\d{1,2},?\s*\d{4}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4})",
    )
    .unwrap()
});
pub static TITLE_CAPTURE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\bTitle\s*:\s*((?:_{3,}|\.{5,}|-{5,})|([A-Za-z\u{00C0}-\u{024F}][A-Za-z\u{00C0}-\u{024F}\s.'-]{2,40}))",
    )
    .unwrap()
});

// ══════════════════════════════════════════════════════════════════════════════
// Excluded zone patterns (inline regexes converted to statics)
// ══════════════════════════════════════════════════════════════════════════════

pub static WITNESS_ZONE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?:witness(?:ed)?(?:\s+by)?|in\s+the\s+presence\s+of)\s*:?").unwrap()
});
pub static NOTARY_ZONE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?:state\s+of|notary\s+public|before\s+me.*notary|subscribed\s+and\s+sworn)")
        .unwrap()
});
pub static LEGAL_REVIEW_ZONE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?:approved\s+as\s+to\s+form|legal\s+counsel\s+review)").unwrap()
});
pub static COPYRIGHT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?:copyright|©|\(c\))\s*\d{4}").unwrap()
});
pub static ALL_RIGHTS_RESERVED_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\ball\s+rights\s+reserved\b").unwrap()
});
pub static DRAFT_CONFIDENTIAL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?:draft|confidential|sample|do\s+not\s+copy|privileged)\s*$").unwrap()
});

// ══════════════════════════════════════════════════════════════════════════════
// Boilerplate detection patterns (inline regexes converted to statics)
// ══════════════════════════════════════════════════════════════════════════════

pub static FIELD_HEADER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:Signature|Date|Initials|(?:Typed\s+or\s+)?Print(?:ed)?\s+Name|Name|Title|By|Its|Email|Phone|Company|Wallet|Authorized)\s*:").unwrap()
});
pub static FIELD_IN_SENTENCE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)[.!?;]\s+(?:Signature|Date|Initials|Wallet)\s*:").unwrap()
});
pub static PARAGRAPH_START_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:Each|The\s|All\s|Any\s|No\s|In\s|This\s|That\s|Such\s|For\s|If\s|As\s|To\s|Upon\s)").unwrap()
});

// ══════════════════════════════════════════════════════════════════════════════
// Utility patterns (inline regexes converted to statics)
// ══════════════════════════════════════════════════════════════════════════════

pub static PARENS_UPPERCASE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\([A-Z]+\)$").unwrap()
});
