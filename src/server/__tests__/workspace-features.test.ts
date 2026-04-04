import { describe, expect, it } from "vitest";
import { getFeatureCatalog } from "~/lib/feature-access";
import { createReminderConfig, getDefaultReminderChannels } from "~/server/workspace";

describe("feature catalog", () => {
  const catalog = getFeatureCatalog();
  const find = (id: string) => catalog.find((f) => f.id === id);

  it("SMS is OSS but bring-your-own", () => {
    const sms = find("sms_delivery");
    expect(sms?.oss).toBe(true);
    expect(sms?.byo).toBe(true);
  });

  it("address autocomplete is OSS but bring-your-own", () => {
    const addressAutocomplete = find("address_autocomplete");
    expect(addressAutocomplete?.oss).toBe(true);
    expect(addressAutocomplete?.byo).toBe(true);
  });

  it("payments is OSS but bring-your-own", () => {
    const payments = find("payments");
    expect(payments?.oss).toBe(true);
    expect(payments?.byo).toBe(true);
  });

  it("SSO is OSS but bring-your-own", () => {
    const sso = find("sso");
    expect(sso?.oss).toBe(true);
    expect(sso?.byo).toBe(true);
  });

  it("zero-knowledge vault is free OSS", () => {
    const vault = find("zero_knowledge_vault");
    expect(vault?.oss).toBe(true);
    expect(vault?.byo).toBe(false);
  });

  it("blockchain anchoring is premium only", () => {
    const anchoring = find("blockchain_anchoring");
    expect(anchoring?.oss).toBe(false);
  });

  it("enterprise features are premium", () => {
    expect(find("teams")?.oss).toBe(false);
    expect(find("reporting")?.oss).toBe(false);
    expect(find("group_access_controls")?.oss).toBe(false);
  });

  it("ID verification algo is free", () => {
    expect(find("id_verification")?.oss).toBe(true);
    expect(find("id_verification")?.byo).toBe(false);
  });

  it("all core features are OSS", () => {
    const core = catalog.filter((f) => f.category === "core");
    expect(core.every((f) => f.oss)).toBe(true);
  });

  it("wallet signing is free, on-chain writing and managed wallets are premium", () => {
    expect(find("wallet_signing")?.oss).toBe(true);
    expect(find("auto_wallet")?.oss).toBe(false);
    expect(find("blockchain_anchoring")?.oss).toBe(false);
    expect(find("html_inscriptions")?.oss).toBe(false);
  });
});

describe("workspace reminder helpers", () => {
  it("builds a reminder schedule when cadence is enabled", () => {
    const now = new Date("2026-03-27T10:00:00.000Z");
    const reminder = createReminderConfig("DAILY", ["EMAIL", "SMS"], now);
    expect(reminder).not.toBeNull();
    expect(reminder?.enabled).toBe(true);
    expect(reminder?.nextReminderAt).toBe("2026-03-28T10:00:00.000Z");
  });

  it("derives delivery channels from available contact methods", () => {
    expect(getDefaultReminderChannels("ops@example.com", null)).toEqual(["EMAIL"]);
    expect(getDefaultReminderChannels(null, "+15550001111")).toEqual(["SMS"]);
    expect(getDefaultReminderChannels("ops@example.com", "+15550001111")).toEqual(["EMAIL", "SMS"]);
  });
});
