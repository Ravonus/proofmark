import QRCode from "qrcode";

export async function generateQrDataUrl(text: string, size: number = 256): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });
}

// Sync SVG string (for inline rendering)
export function generateQrSvg(text: string, size: number = 200): string {
  // Use the sync toString method
  let svg = "";
  QRCode.toString(
    text,
    {
      type: "svg",
      width: size,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    },
    (err, str) => {
      if (!err && str) svg = str;
    },
  );
  return svg;
}
