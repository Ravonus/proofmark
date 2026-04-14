//! PDF editing — fill form fields, create blank templates from filled contracts,
//! and flatten form fields into static content.
//!
//! Uses lopdf for low-level PDF manipulation. All operations are non-destructive
//! (produce a new PDF buffer rather than mutating in place).

mod fill;
mod flatten;
mod template;
mod types;

pub use fill::fill_pdf_fields;
pub use flatten::flatten_pdf;
pub use template::create_blank_template;
pub use types::*;
