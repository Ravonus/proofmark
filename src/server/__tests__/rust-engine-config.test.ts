import { afterEach, describe, expect, it } from "vitest";
import { resolveRustEngineUrl } from "~/server/crypto/rust-engine";

const testEnv = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = testEnv.NODE_ENV;
const ORIGINAL_RUST_ENGINE_URL = testEnv.RUST_ENGINE_URL;

afterEach(() => {
  if (ORIGINAL_NODE_ENV) testEnv.NODE_ENV = ORIGINAL_NODE_ENV;
  else delete testEnv.NODE_ENV;

  if (ORIGINAL_RUST_ENGINE_URL) testEnv.RUST_ENGINE_URL = ORIGINAL_RUST_ENGINE_URL;
  else delete testEnv.RUST_ENGINE_URL;
});

describe("resolveRustEngineUrl", () => {
  it("uses the configured production URL", () => {
    testEnv.NODE_ENV = "production";
    testEnv.RUST_ENGINE_URL = "https://rust.internal.example/";

    expect(resolveRustEngineUrl()).toBe("https://rust.internal.example");
  });

  it("falls back to localhost outside production", () => {
    testEnv.NODE_ENV = "development";
    delete testEnv.RUST_ENGINE_URL;

    expect(resolveRustEngineUrl()).toBe("http://127.0.0.1:9090");
  });

  it("throws in production when the rust engine URL is missing", () => {
    testEnv.NODE_ENV = "production";
    delete testEnv.RUST_ENGINE_URL;

    expect(() => resolveRustEngineUrl()).toThrow(/RUST_ENGINE_URL is not configured in production/i);
  });
});
