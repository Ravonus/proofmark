//! QR code generation — SVG and PNG data URL output.
//! Mirrors src/lib/qr-svg.ts.

use image::{ImageBuffer, Luma};
use qrcode::QrCode;
use qrcode::types::QrError;

/// Generate a QR code as an SVG string.
pub fn generate_qr_svg(text: &str, size: u32) -> Result<String, QrError> {
    let code = QrCode::new(text.as_bytes())?;
    let modules = code.to_colors();
    let module_count = code.width() as u32;
    let margin = 2u32;
    let total = module_count + margin * 2;

    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {} {}\" width=\"{}\" height=\"{}\" shape-rendering=\"crispEdges\">",
        total, total, size, size,
    );

    // White background
    svg.push_str(&format!(
        "<rect fill=\"#ffffff\" width=\"{}\" height=\"{}\"/>",
        total, total,
    ));

    // Dark modules
    for y in 0..module_count {
        for x in 0..module_count {
            let idx = (y * module_count + x) as usize;
            if idx < modules.len() && modules[idx] == qrcode::Color::Dark {
                let px = x + margin;
                let py = y + margin;
                svg.push_str(&format!(
                    "<rect x=\"{}\" y=\"{}\" width=\"1\" height=\"1\" fill=\"#000000\"/>",
                    px, py,
                ));
            }
        }
    }

    svg.push_str("</svg>");
    Ok(svg)
}

/// Generate a QR code as a PNG data URL (base64-encoded).
pub fn generate_qr_data_url(text: &str, size: u32) -> Result<String, anyhow::Error> {
    let code = QrCode::new(text.as_bytes())?;
    let modules = code.to_colors();
    let module_count = code.width() as u32;
    let margin = 2u32;
    let total = module_count + margin * 2;
    let scale = (size as f64 / total as f64).max(1.0);
    let img_size = (total as f64 * scale).ceil() as u32;

    let img: ImageBuffer<Luma<u8>, Vec<u8>> = ImageBuffer::from_fn(img_size, img_size, |x, y| {
        let mx = (x as f64 / scale) as u32;
        let my = (y as f64 / scale) as u32;

        if mx >= margin && mx < margin + module_count && my >= margin && my < margin + module_count
        {
            let idx = ((my - margin) * module_count + (mx - margin)) as usize;
            if idx < modules.len() && modules[idx] == qrcode::Color::Dark {
                return Luma([0u8]);
            }
        }
        Luma([255u8])
    });

    let mut buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    image::ImageEncoder::write_image(
        encoder,
        &img,
        img_size,
        img_size,
        image::ExtendedColorType::L8,
    )?;

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &buf);
    Ok(format!("data:image/png;base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_qr_svg() {
        let svg = generate_qr_svg("https://example.com", 200).unwrap();
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("rect"));
        assert!(svg.ends_with("</svg>"));
    }

    #[test]
    fn test_generate_qr_data_url() {
        let url = generate_qr_data_url("test", 128).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
    }
}
