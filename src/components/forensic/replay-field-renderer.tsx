"use client";

import { isFieldRequired, isFieldVisible } from "~/lib/document/field-runtime";
import { validateField } from "../signing/sign-document-helpers";
import { InlineFieldInput } from "../signing/sign-document-inline-field";
import type { ReplayState } from "./replay-document-helpers";
import type { SignerData } from "./replay-document-parts";

const noop = () => {
  /* noop */
};
const noopUpload = async () => "" as string;
const noopSuggestions = async () => [] as never[];
const noopPayment = async () => {
  /* noop */
};

type ReplayFieldProps = {
  field: {
    id: string;
    signerIdx: number;
    [key: string]: unknown;
  };
  forensicId: string;
  documentId: string;
  mergedFieldValues: Record<string, string>;
  activeState: ReplayState | null;
  signers: SignerData[];
};

export function ReplayFieldRenderer({
  field,
  forensicId,
  documentId,
  mergedFieldValues,
  activeState,
  signers,
}: ReplayFieldProps) {
  if (!isFieldVisible(field as Parameters<typeof isFieldVisible>[0], mergedFieldValues)) return null;
  const value = mergedFieldValues[field.id];
  const ownerSigner = signers.find((s) => s.index === field.signerIdx);
  const ownerVerdict = ownerSigner?.serverReview?.verdict;
  const verdictIcon =
    ownerVerdict === "agent"
      ? "\u{1F916}"
      : ownerVerdict === "human"
        ? "\u{1F464}"
        : ownerVerdict === "uncertain"
          ? "\u2753"
          : null;
  const verdictColor = ownerVerdict === "agent" ? "#f87171" : ownerVerdict === "human" ? "#34d399" : "#9ca3af";

  const typedField = field as Parameters<typeof InlineFieldInput>[0]["field"];

  return (
    <div className="relative inline-flex items-center gap-1">
      <InlineFieldInput
        key={field.id}
        documentId={documentId}
        claimToken={null}
        field={typedField}
        forensicId={forensicId}
        active={activeState?.focusedFieldId === field.id}
        canEdit={false}
        value={value}
        signatureReady={Boolean(value)}
        allValues={mergedFieldValues}
        isFilled={
          !validateField(typedField, value, {
            signatureReady: Boolean(value),
            allValues: mergedFieldValues,
          })
        }
        isRequired={isFieldRequired(typedField, mergedFieldValues)}
        onApplyAddressSuggestion={noop}
        onLoadAddressSuggestions={noopSuggestions}
        onChange={noop}
        onFillMatching={noop}
        onUploadAttachment={noopUpload}
        onRunIdentityCheck={noopUpload}
        onStartPayment={noopPayment}
        onStartSocialVerify={noop}
        onRequestSignature={noop}
        onRequestPhoneDraw={noop}
        onFocus={noop}
        onBlur={noop}
      />
      {verdictIcon && value && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none"
          style={{
            background: `${verdictColor}15`,
            color: verdictColor,
            border: `1px solid ${verdictColor}30`,
          }}
          title={`${ownerSigner?.label}: ${ownerVerdict}`}
        >
          {verdictIcon}
        </span>
      )}
    </div>
  );
}
