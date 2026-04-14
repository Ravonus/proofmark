import { describe, expect, it } from "vitest";
import { removePostSignRevealDownload, upsertPostSignRevealDownload } from "~/server/documents/post-sign-downloads";

describe("post-sign shared downloads", () => {
  it("adds a download and enables reveal access", () => {
    const reveal = upsertPostSignRevealDownload(null, {
      nextDownload: {
        label: "Court packet",
        filename: "court-packet.pdf",
        uploadedByLabel: "Contract owner",
        uploadedByAddress: "0xabc",
        uploadedAt: "2026-04-02T20:00:00.000Z",
      },
    });

    expect(reveal.enabled).toBe(true);
    expect(reveal.downloads).toEqual([
      {
        label: "Court packet",
        filename: "court-packet.pdf",
        uploadedByLabel: "Contract owner",
        uploadedByAddress: "0xabc",
        uploadedAt: "2026-04-02T20:00:00.000Z",
      },
    ]);
  });

  it("replaces an existing download while preserving other reveal content", () => {
    const reveal = upsertPostSignRevealDownload(
      {
        enabled: true,
        summary: "Signed participants can unlock the package.",
        downloads: [
          {
            label: "Old bundle",
            filename: "old-bundle.pdf",
            icon: "📄",
            uploadedByLabel: "Alice",
            uploadedAt: "2026-04-02T20:00:00.000Z",
          },
        ],
      },
      {
        previousFilename: "old-bundle.pdf",
        nextDownload: {
          label: "Updated bundle",
          filename: "updated-bundle.pdf",
        },
      },
    );

    expect(reveal.enabled).toBe(true);
    expect(reveal.summary).toBe("Signed participants can unlock the package.");
    expect(reveal.downloads).toEqual([
      {
        label: "Updated bundle",
        filename: "updated-bundle.pdf",
        icon: "📄",
        uploadedByLabel: "Alice",
        uploadedAt: "2026-04-02T20:00:00.000Z",
      },
    ]);
  });

  it("overrides uploader metadata when a new file is uploaded over an existing entry", () => {
    const reveal = upsertPostSignRevealDownload(
      {
        enabled: true,
        downloads: [
          {
            label: "Evidence set",
            filename: "evidence-set-v1.pdf",
            uploadedByLabel: "Alice",
            uploadedByAddress: "0xalice",
            uploadedAt: "2026-04-02T20:00:00.000Z",
          },
        ],
      },
      {
        previousFilename: "evidence-set-v1.pdf",
        nextDownload: {
          label: "Evidence set",
          filename: "evidence-set-v2.pdf",
          uploadedByLabel: "Bob",
          uploadedByAddress: "0xbob",
          uploadedAt: "2026-04-02T21:00:00.000Z",
        },
      },
    );

    expect(reveal.downloads).toEqual([
      {
        label: "Evidence set",
        filename: "evidence-set-v2.pdf",
        uploadedByLabel: "Bob",
        uploadedByAddress: "0xbob",
        uploadedAt: "2026-04-02T21:00:00.000Z",
      },
    ]);
  });

  it("disables reveal when the last shared file is removed and no other content remains", () => {
    const reveal = removePostSignRevealDownload(
      {
        enabled: true,
        downloads: [
          {
            label: "Only file",
            filename: "only-file.pdf",
          },
        ],
      },
      "only-file.pdf",
    );

    expect(reveal.enabled).toBe(false);
    expect(reveal.downloads).toBeUndefined();
  });

  it("keeps reveal enabled when shared files are removed but sections still exist", () => {
    const reveal = removePostSignRevealDownload(
      {
        enabled: true,
        sections: [
          {
            title: "Next steps",
            content: "Schedule the kickoff call.",
          },
        ],
        downloads: [
          {
            label: "Only file",
            filename: "only-file.pdf",
          },
        ],
      },
      "only-file.pdf",
    );

    expect(reveal.enabled).toBe(true);
    expect(reveal.sections).toHaveLength(1);
    expect(reveal.downloads).toBeUndefined();
  });
});
