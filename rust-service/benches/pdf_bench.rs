//! PDF parsing and editing benchmarks.
//!
//! Run with: cargo bench --bench pdf_bench

use std::time::Instant;

fn generate_contract_text(sections: usize) -> String {
    let mut content = String::from("NON-DISCLOSURE AGREEMENT\n\n");
    content.push_str("This Non-Disclosure Agreement (\"Agreement\") is entered into as of _______ (\"Effective Date\")\n");
    content.push_str("by and between:\n\n");
    content.push_str("DISCLOSING PARTY\n");
    content.push_str("Name: _______________\n");
    content.push_str("Title: _______________\n");
    content.push_str("Company: _______________\n");
    content.push_str("Date: _______________\n");
    content.push_str("Signature: _______________\n\n");
    content.push_str("RECEIVING PARTY\n");
    content.push_str("Name: _______________\n");
    content.push_str("Title: _______________\n");
    content.push_str("Date: _______________\n");
    content.push_str("Signature: _______________\n\n");

    let section_names = [
        "DEFINITIONS", "CONFIDENTIAL INFORMATION", "OBLIGATIONS",
        "TERM AND TERMINATION", "GOVERNING LAW", "REPRESENTATIONS AND WARRANTIES",
        "INDEMNIFICATION", "MISCELLANEOUS",
    ];

    for i in 0..sections.min(section_names.len()) {
        content.push_str(&format!("\n{}. {}\n\n", i + 1, section_names[i]));
        for _ in 0..5 {
            content.push_str("Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\n");
        }
    }

    content.push_str("\nIN WITNESS WHEREOF, the parties have executed this Agreement.\n\n");
    content.push_str("DISCLOSING PARTY\n");
    content.push_str("Signature: _______________\n");
    content.push_str("Name: _______________\n");
    content.push_str("Date: _______________\n\n");
    content.push_str("RECEIVING PARTY\n");
    content.push_str("Signature: _______________\n");
    content.push_str("Name: _______________\n");
    content.push_str("Date: _______________\n");

    content
}

fn generate_test_pdf(content: &str) -> Vec<u8> {
    use printpdf::*;
    use std::io::BufWriter;

    let (doc, page, layer) =
        PdfDocument::new("Benchmark PDF", Mm(215.9), Mm(279.4), "Content");
    let font = doc.add_builtin_font(BuiltinFont::Helvetica).unwrap();
    let layer_ref = doc.get_page(page).get_layer(layer);

    let mut y = 260.0;
    for line in content.lines().take(60) {
        if y < 20.0 {
            break;
        }
        layer_ref.use_text(line, 10.0, Mm(20.0), Mm(y), &font);
        y -= 4.0;
    }

    let mut buf = BufWriter::new(Vec::new());
    doc.save(&mut buf).unwrap();
    buf.into_inner().unwrap()
}

fn main() {
    println!("=== PDF Parser & Editor Benchmarks ===\n");

    // Generate test data
    let small_contract = generate_contract_text(3);
    let medium_contract = generate_contract_text(6);
    let large_contract = generate_contract_text(8);

    let small_pdf = generate_test_pdf(&small_contract);
    let medium_pdf = generate_test_pdf(&medium_contract);
    let large_pdf = generate_test_pdf(&large_contract);

    println!("Test PDFs generated:");
    println!("  Small:  {} bytes ({} chars text)", small_pdf.len(), small_contract.len());
    println!("  Medium: {} bytes ({} chars text)", medium_pdf.len(), medium_contract.len());
    println!("  Large:  {} bytes ({} chars text)\n", large_pdf.len(), large_contract.len());

    // Benchmark: PDF Analysis
    println!("--- PDF Analysis ---");
    bench("Small contract parse", 100, || {
        proofmark_engine::pdf::analyze::analyze_pdf(&small_pdf).unwrap();
    });
    bench("Medium contract parse", 100, || {
        proofmark_engine::pdf::analyze::analyze_pdf(&medium_pdf).unwrap();
    });
    bench("Large contract parse", 50, || {
        proofmark_engine::pdf::analyze::analyze_pdf(&large_pdf).unwrap();
    });

    // Benchmark: Structure extraction
    println!("\n--- Structure Extraction ---");
    let lines: Vec<String> = large_contract.lines().map(String::from).collect();
    bench("Section extraction (large)", 1000, || {
        proofmark_engine::pdf::analyze::structure::extract_sections(&lines);
    });

    // Benchmark: Field detection
    println!("\n--- Field Detection ---");
    bench("Field detection (large)", 1000, || {
        proofmark_engine::pdf::analyze::fields::detect_fields(&lines, None);
    });

    // Benchmark: Template creation
    println!("\n--- PDF Editing ---");
    bench("Create blank template", 100, || {
        proofmark_engine::pdf::edit::create_blank_template(&small_pdf, &[]).unwrap();
    });
    bench("Flatten PDF", 100, || {
        proofmark_engine::pdf::edit::flatten_pdf(&small_pdf).unwrap();
    });

    // Benchmark: Walkthrough generation
    println!("\n--- Walkthrough ---");
    let sections = proofmark_engine::pdf::analyze::structure::extract_sections(&lines);
    bench("Walkthrough generation", 10000, || {
        proofmark_engine::pdf::analyze::structure::generate_walkthrough(&sections, 10, 2, false, false);
    });

    println!("\n=== All benchmarks complete ===");
}

fn bench<F: FnMut()>(name: &str, iterations: usize, mut f: F) {
    // Warmup
    for _ in 0..3 {
        f();
    }

    let start = Instant::now();
    for _ in 0..iterations {
        f();
    }
    let elapsed = start.elapsed();

    let per_iter = elapsed / iterations as u32;
    let per_iter_us = per_iter.as_micros();

    if per_iter_us > 1000 {
        println!("  {name}: {:.2}ms avg ({iterations} iters, {:.0}ms total)",
            per_iter_us as f64 / 1000.0,
            elapsed.as_millis() as f64);
    } else {
        println!("  {name}: {per_iter_us}us avg ({iterations} iters, {:.0}ms total)",
            elapsed.as_millis() as f64);
    }
}
