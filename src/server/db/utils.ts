import { randomBytes } from "crypto";

export function createId(): string {
  const bytes = randomBytes(12);
  return bytes.toString("base64url");
}
