import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * Create a minimal single-page PDF whose text content is the provided string.
 * Each line is rendered as a separate text draw so pdf-parse extracts it as
 * individual lines. Returns a Buffer suitable for analyzePdf().
 */
export async function createFakePdf(text: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontSize = 8;
  const margin = 40;
  const lineHeight = fontSize + 2;

  const lines = text.split("\n");
  const pageLines = Math.floor((792 - margin * 2) / lineHeight); // ~71 lines per page at 8pt

  let page = pdf.addPage([612, 792]);
  let y = 792 - margin;
  let lineOnPage = 0;

  for (const line of lines) {
    if (lineOnPage >= pageLines) {
      page = pdf.addPage([612, 792]);
      y = 792 - margin;
      lineOnPage = 0;
    }
    page.drawText(line.slice(0, 120), { x: margin, y, size: fontSize, font });
    y -= lineHeight;
    lineOnPage++;
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
