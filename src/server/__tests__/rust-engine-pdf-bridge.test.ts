import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSignedPDF } from "~/server/crypto/rust-engine";

describe("rust-engine pdf bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts PDF generation to the Rust engine with structured content", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );

    const pdf = await generateSignedPDF({
      doc: {
        id: "doc-1",
        title: "Test NDA",
        content: ["NON-DISCLOSURE AGREEMENT", "", "Disclosing Party: ________", "Date: ________"].join("\n"),
        contentHash: "abcdef1234567890abcdef1234567890",
        createdAt: new Date("2026-03-28T00:00:00Z"),
        status: "PENDING",
        encryptedAtRest: true,
        ipfsCid: "bafybeigdyrzt4examplecid",
      } as unknown as Parameters<typeof generateSignedPDF>[0]["doc"],
      signers: [
        {
          id: "signer-1",
          label: "Disclosing Party",
          status: "PENDING",
          signerOrder: 0,
          chain: null,
          address: null,
          scheme: null,
          signature: null,
          signedAt: null,
          handSignatureHash: null,
          handSignatureData: null,
          fieldValues: null,
          forensicEvidence: null,
        } as unknown as Parameters<typeof generateSignedPDF>[0]["signers"][number],
      ],
      verifyUrl: "https://example.com/verify/abcdef1234567890abcdef1234567890",
      styleSettings: { fieldSummaryStyle: "hybrid", themePreset: "classic" },
    });

    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(Array.from(pdf)).toEqual([0x25, 0x50, 0x44, 0x46]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/pdf/generate");
    expect(init?.method).toBe("POST");

    const body = JSON.parse(init.body as string) as {
      title: string;
      encrypted_at_rest: boolean;
      ipfs_cid: string | null;
      field_summary_style: string;
      content: string;
      signers: Array<{ label: string }>;
      content_lines?: unknown;
      field_summary?: unknown;
    };
    expect(body.title).toBe("Test NDA");
    expect(body.encrypted_at_rest).toBe(true);
    expect(body.ipfs_cid).toBe("bafybeigdyrzt4examplecid");
    expect(body.content).toContain("Disclosing Party: ________");
    expect(body.signers).toHaveLength(1);
    expect(body.content_lines).toBeUndefined();
    expect(body.field_summary).toBeUndefined();
    expect(body.field_summary_style).toBe("hybrid");
  });
});
