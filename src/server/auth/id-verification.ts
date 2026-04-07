import type { InlineField } from "~/lib/document/document-tokens";
import type { IdentityVerificationCheck, IdentityVerificationFieldValue } from "~/lib/document/field-values";

function getFirstValue(fields: InlineField[], fieldValues: Record<string, string>, types: string[]): string {
  for (const field of fields) {
    if (!types.includes(field.type)) continue;
    const value = fieldValues[field.id]?.trim();
    if (value) return value;
  }
  return "";
}

function computeAge(isoDate: string): number | null {
  const dob = new Date(isoDate);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hasBirthdayPassed =
    now.getMonth() > dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hasBirthdayPassed) age -= 1;
  return age;
}

function buildCheck(id: string, label: string, ok: boolean, detail: string, weight: number): IdentityVerificationCheck {
  return { id, label, ok, detail, weight };
}

export function evaluateIdentityVerification(params: {
  fields: InlineField[];
  fieldValues: Record<string, string>;
  threshold?: number;
  signerAddress?: string | null;
  signerEmail?: string | null;
}): IdentityVerificationFieldValue {
  const threshold = params.threshold ?? 60;
  const fullName = getFirstValue(params.fields, params.fieldValues, ["full-name", "name"]);
  const firstName = getFirstValue(params.fields, params.fieldValues, ["first-name"]);
  const lastName = getFirstValue(params.fields, params.fieldValues, ["last-name"]);
  const dateOfBirth = getFirstValue(params.fields, params.fieldValues, ["dob"]);
  const email = getFirstValue(params.fields, params.fieldValues, ["email"]) || params.signerEmail || "";
  const phone = getFirstValue(params.fields, params.fieldValues, ["phone"]);
  const streetAddress = getFirstValue(params.fields, params.fieldValues, ["street-address", "address"]);
  const fullAddress = getFirstValue(params.fields, params.fieldValues, ["full-address"]);
  const zip = getFirstValue(params.fields, params.fieldValues, ["zip"]);
  const taxId = getFirstValue(params.fields, params.fieldValues, ["tax-id", "ssn", "ssn-full"]);
  const wallet =
    getFirstValue(params.fields, params.fieldValues, ["wallet-address", "eth-address", "btc-address", "sol-address"]) ||
    params.signerAddress ||
    "";

  const derivedName = fullName || [firstName, lastName].filter(Boolean).join(" ").trim();
  const age = dateOfBirth ? computeAge(dateOfBirth) : null;
  const normalizedAddress = [fullAddress, streetAddress, zip].filter(Boolean).join(" ").trim();

  const checks = [
    buildCheck(
      "name",
      "Legal name",
      derivedName.length >= 4,
      derivedName ? `Captured as ${derivedName}` : "Add a legal name field",
      20,
    ),
    buildCheck(
      "dob",
      "Date of birth",
      age !== null && age >= 18,
      age === null ? "Add a valid birth date" : `Signer is ${age} years old`,
      20,
    ),
    buildCheck(
      "address",
      "Address",
      normalizedAddress.length >= 10,
      normalizedAddress ? "Address details captured" : "Add street or mailing address",
      15,
    ),
    buildCheck(
      "email",
      "Email",
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      email ? `Email ${email} looks valid` : "Add an email address",
      10,
    ),
    buildCheck(
      "phone",
      "Phone",
      /^\+?[\d\s()-]{7,20}$/.test(phone),
      phone ? "Phone format looks valid" : "Add a phone number",
      10,
    ),
    buildCheck(
      "gov-id",
      "Tax or ID number",
      /^\d{4}$|^\d{2}-?\d{7}$|^\d{3}-?\d{2}-?\d{4}$/.test(taxId),
      taxId ? "Government-linked identifier present" : "Add SSN last4, SSN, or EIN",
      15,
    ),
    buildCheck(
      "wallet",
      "Wallet link",
      !!wallet && wallet.length >= 20,
      wallet ? "Wallet or signing address present" : "Add a wallet address",
      10,
    ),
  ];

  const score = checks.reduce((sum, check) => sum + (check.ok ? check.weight : 0), 0);
  const status =
    score >= threshold &&
    checks.find((check) => check.id === "name")?.ok &&
    checks.find((check) => check.id === "dob")?.ok
      ? "verified"
      : "needs_review";

  return {
    kind: "id-verification",
    status,
    score,
    threshold,
    verifiedAt: new Date().toISOString(),
    checks,
  };
}
