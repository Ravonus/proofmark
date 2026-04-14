/* eslint-disable @typescript-eslint/no-unsafe-assignment */
"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WalletChain } from "~/lib/crypto/chains";
import { isFieldLocked, isFieldRequired, isFieldVisible } from "~/lib/document/field-runtime";
import { describeSignerTokenGate } from "~/lib/token-gates";
import { DocumentPaper } from "../document-editor/document-paper";
import { getEquivalentFieldIds } from "../hooks/signing-field-sync";
import { useSigningFlow } from "../hooks/use-signing-flow";
import { useWallet } from "../layout/wallet-provider";
import type { SignerInfo } from "./sign-document-helpers";
import { validateField } from "./sign-document-helpers";
import { InlineFieldInput } from "./sign-document-inline-field";
import { ConfirmModal, QrModal, SignaturePadModal, TokenGateCard } from "./sign-document-modals";
import { CenterCard, ChainButtons, CreatorClaimSlot, DocumentHeader, SignerList } from "./sign-document-parts";
import {
  ErrorBanner,
  FieldNavigationBar,
  FloatingToolbar,
  resolveTokenGateCardState,
  SignatureBlockRenderer,
  SigningActions,
  WalkthroughStepper,
} from "./sign-document-signing-ui";
import { DoneView, FinalizeView } from "./sign-document-views";

function buildOtherSignerValues(
  docSigners: ReturnType<typeof useSigningFlow>["docSigners"],
  currentSigner: ReturnType<typeof useSigningFlow>["currentSigner"],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const s of docSigners) {
    if (s.fieldValues && s.id !== currentSigner?.id) {
      for (const [k, v] of Object.entries(s.fieldValues)) {
        if (v) values[k] = v;
      }
    }
  }
  return values;
}

// TODO: re-integrate gaze gates (GazeGate, GazeGateMobile) and AI signer chat (AiSignerChat) in signing flow for premium build
// These components live at ~/components/gaze-gate, ~/components/gaze-gate-mobile, ~/components/ai/ai-signer-chat

// The hook's internal SignerRow strips tokenGates; the runtime API data includes them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

// ─── Main Component ──────────────────────────────────────────────────────────

export function SignDocument({ documentId, claimToken }: { documentId: string; claimToken: string | null }) {
  const { connected, address, chain } = useWallet();
  const [resolvedClaimToken, setResolvedClaimToken] = useState<string | null>(claimToken);
  const [sigPadMode, setSigPadMode] = useState<"signature" | "initials">("signature");
  const initialsFieldRef = useRef<string | null>(null);
  const flow = useSigningFlow(documentId, resolvedClaimToken);

  const { docQuery, doc, docSigners, currentSigner } = flow;
  const totalMyFields = flow.requiredFields.length;
  const needsDrawnSignature = flow.needsDrawnSig;
  const signerAny = currentSigner as SignerInfo | null | undefined;
  const tokenGateSummary = signerAny?.tokenGates ? describeSignerTokenGate(signerAny.tokenGates) : null;
  const tokenGateCardState = resolveTokenGateCardState(
    flow.requiresTokenGateWalletProofs,
    flow.tokenGateEvaluation,
    flow.tokenGateWallets,
    flow.tokenGateBlocked,
  );
  const mySignerIdx = currentSigner ? docSigners.findIndex((s) => s.id === currentSigner.id) : -1;
  const otherSignerValues = buildOtherSignerValues(docSigners, currentSigner);

  useEffect(() => {
    setResolvedClaimToken(claimToken);
  }, [claimToken, documentId]);

  useEffect(() => {
    const inferredClaimToken = signerAny?.claimToken ?? null;
    if (!resolvedClaimToken && inferredClaimToken) {
      setResolvedClaimToken(inferredClaimToken);
    }
  }, [resolvedClaimToken, signerAny?.claimToken]);

  // ── Early returns ───────────────────────────────────────────────────────
  if (docQuery.isLoading) {
    return (
      <CenterCard>
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" />
        <p className="mt-3 text-muted">Loading document...</p>
      </CenterCard>
    );
  }
  if (docQuery.error || !doc) {
    return (
      <CenterCard>
        <p className="flex items-center justify-center gap-2 font-medium text-red-400">
          <AlertCircle className="h-4 w-4" />
          {docQuery.error?.message ?? "Document not found"}
        </p>
        {!connected && <ChainButtons />}
      </CenterCard>
    );
  }

  if (flow.needsFinalization && !flow.done) {
    return (
      <FinalizeView
        doc={doc as AnyDoc}
        signedCount={flow.signedCount}
        totalRecipients={flow.totalRecipients}
        signingError={flow.signingError}
        clearSigningError={flow.clearSigningError}
        signing={flow.signing}
        connected={connected}
        groupId={flow.groupId}
        handleFinalize={flow.handleFinalize}
        handleBulkFinalize={flow.handleBulkFinalize}
      />
    );
  }

  if (flow.done || flow.alreadySigned || doc.status === "COMPLETED") {
    return (
      <DoneView
        doc={doc as AnyDoc}
        documentId={documentId}
        claimToken={resolvedClaimToken}
        address={address}
        signedCount={flow.signedCount}
        totalRecipients={flow.totalRecipients}
        done={flow.done}
        tokens={flow.tokens}
        allFieldValues={flow.allFieldValues}
      />
    );
  }

  // ── Main signing view ───────────────────────────────────────────────────
  return (
    <SignDocumentMainView
      documentId={documentId}
      claimToken={resolvedClaimToken}
      connected={connected}
      address={address}
      chain={chain}
      flow={flow}
      doc={doc}
      currentSigner={currentSigner}
      mySignerIdx={mySignerIdx}
      otherSignerValues={otherSignerValues}
      tokenGateSummary={tokenGateSummary}
      tokenGateCardState={tokenGateCardState}
      needsDrawnSignature={needsDrawnSignature}
      totalMyFields={totalMyFields}
      sigPadMode={sigPadMode}
      setSigPadMode={setSigPadMode}
      initialsFieldRef={initialsFieldRef}
    />
  );
}

// ─── Main signing view (extracted for line/complexity limits) ────────────────

function SignDocumentMainView({
  documentId,
  claimToken,
  connected,
  address,
  chain,
  flow,
  doc,
  currentSigner,
  mySignerIdx,
  otherSignerValues,
  tokenGateSummary,
  tokenGateCardState,
  needsDrawnSignature,
  totalMyFields,
  sigPadMode,
  setSigPadMode,
  initialsFieldRef,
}: {
  documentId: string;
  claimToken: string | null;
  connected: boolean;
  address: string | null;
  chain: WalletChain | null;
  flow: ReturnType<typeof useSigningFlow>;
  doc: NonNullable<ReturnType<typeof useSigningFlow>["doc"]>;
  currentSigner: ReturnType<typeof useSigningFlow>["currentSigner"];
  mySignerIdx: number;
  otherSignerValues: Record<string, string>;
  tokenGateSummary: string | null;
  tokenGateCardState: string;
  needsDrawnSignature: boolean;
  totalMyFields: number;
  sigPadMode: "signature" | "initials";
  setSigPadMode: (m: "signature" | "initials") => void;
  initialsFieldRef: React.MutableRefObject<string | null>;
}) {
  // Use short aliases for frequently-accessed renamed properties
  const fieldsFilled = flow.completed;
  const requiredFieldsRemaining = flow.remaining;
  const allFieldsComplete = flow.allComplete;
  const validationOptions = flow.opts;

  const openSignaturePad = (mode: "signature" | "initials" = "signature", fieldId?: string) => {
    setSigPadMode(mode);
    if (mode === "initials" && fieldId) initialsFieldRef.current = fieldId;
    flow.setShowSigPad(true);
  };

  const confirmAndSign = () => {
    flow.setShowConfirmModal(false);
    void flow.handleSign();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 pb-20 sm:pb-28">
      {flow.signingError && <ErrorBanner message={flow.signingError} onDismiss={flow.clearSigningError} />}
      <DocumentHeader doc={doc as AnyDoc} signedCount={flow.signedCount} totalRecipients={flow.totalRecipients} />

      {flow.canSign && (
        <>
          {connected && address && chain && currentSigner && (
            <FloatingToolbar
              chain={chain}
              address={address}
              currentSigner={currentSigner}
              myFieldIds={flow.myFieldIds}
              fieldsFilled={fieldsFilled}
              totalMyFields={totalMyFields}
              requiredFieldsRemaining={requiredFieldsRemaining}
              allFieldsComplete={allFieldsComplete}
              goToNextField={flow.goToNextField}
            />
          )}
          <WalkthroughStepper
            totalMyFields={totalMyFields}
            fieldsFilled={fieldsFilled}
            allFieldsComplete={allFieldsComplete}
            needsDrawnSignature={needsDrawnSignature}
            handSignature={flow.handSignature}
          />
        </>
      )}

      <SignDocumentPaperSection
        documentId={documentId}
        claimToken={claimToken}
        flow={flow}
        doc={doc}
        currentSigner={currentSigner}
        mySignerIdx={mySignerIdx}
        otherSignerValues={otherSignerValues}
        needsDrawnSignature={needsDrawnSignature}
        validationOptions={validationOptions}
        openSignaturePad={openSignaturePad}
      />

      <SignDocumentBottomCards
        doc={doc}
        documentId={documentId}
        address={address}
        connected={connected}
        chain={chain}
        claimToken={claimToken}
        canSign={flow.canSign}
        canSubmit={flow.canSubmit}
        isEmailOtpSigner={flow.isEmailOtpSigner}
        requiresWalletConnection={flow.requiresWalletConnection}
        currentSigner={currentSigner}
        isCreator={flow.isCreator}
        tokenGateSummary={tokenGateSummary}
        tokenGateCardState={tokenGateCardState}
        tokenGateEvaluation={flow.tokenGateEvaluation}
        tokenGateBlocked={flow.tokenGateBlocked}
        requiresTokenGateWalletProofs={flow.requiresTokenGateWalletProofs}
        tokenGateWallets={flow.tokenGateWallets}
        tokenGateWalletError={flow.tokenGateWalletError ?? null}
        verifyingTokenGateChain={flow.verifyingTokenGateChain}
        connectTokenGateChain={flow.connectTokenGateChain}
        verifyTokenGateWallet={flow.verifyTokenGateWallet}
        needsDrawnSignature={needsDrawnSignature}
        handSignature={flow.handSignature}
        allFieldsComplete={allFieldsComplete}
        totalMyFields={totalMyFields}
        requiredFieldsRemaining={requiredFieldsRemaining}
        canFinalize={flow.canFinalize}
        signing={flow.signing}
        currentRole={flow.currentRole}
        email={flow.email}
        setEmail={flow.setEmail}
        declined={flow.declined}
        declineMut={flow.declineMut}
        requestEmailOtp={flow.requestEmailOtp}
        requestEmailOtpPending={flow.requestSigningOtpMut.isPending}
        submitEmailSign={flow.handleEmailSign}
        openSignaturePad={openSignaturePad}
        openConfirmModal={() => flow.setShowConfirmModal(true)}
        goToNextField={flow.goToNextField}
        currentFieldIdx={flow.currentFieldIdx}
        myFieldsList={flow.myFieldsList}
        fieldValues={flow.fieldValues}
        validationOptions={validationOptions}
        navigateToField={flow.navigateToField}
        goToPrevField={flow.goToPrevField}
        goToNextFieldNav={flow.goToNextFieldNav}
      />

      <SignDocumentModals
        flow={flow}
        doc={doc}
        address={address}
        chain={chain}
        currentSigner={currentSigner}
        sigPadMode={sigPadMode}
        initialsFieldRef={initialsFieldRef}
        totalMyFields={totalMyFields}
        fieldsFilled={fieldsFilled}
        confirmAndSign={confirmAndSign}
      />
    </div>
  );
}

// ─── Document paper section (extracted for line limits) ──────────────────────

function SignDocumentPaperSection({
  documentId,
  claimToken,
  flow,
  doc,
  currentSigner,
  mySignerIdx,
  otherSignerValues,
  needsDrawnSignature,
  validationOptions,
  openSignaturePad,
}: {
  documentId: string;
  claimToken: string | null;
  flow: ReturnType<typeof useSigningFlow>;
  doc: NonNullable<ReturnType<typeof useSigningFlow>["doc"]>;
  currentSigner: ReturnType<typeof useSigningFlow>["currentSigner"];
  mySignerIdx: number;
  otherSignerValues: Record<string, string>;
  needsDrawnSignature: boolean;
  validationOptions: {
    signatureReady: boolean;
    allValues: Record<string, string>;
  };
  openSignaturePad: (mode?: "signature" | "initials", fieldId?: string) => void;
}) {
  return (
    <DocumentPaper
      tokens={flow.tokens}
      reveal
      renderField={({ field, forensicId }) => {
        if (!isFieldVisible(field, flow.mergedFieldValues)) return null;
        const siblingIds = getEquivalentFieldIds(field, flow.myFieldsList).filter((id) => id !== field.id);
        return (
          <InlineFieldInput
            key={field.id}
            documentId={documentId}
            claimToken={claimToken}
            field={field}
            forensicId={forensicId}
            active={flow.activeField === field.id}
            canEdit={!!flow.canSign && flow.myFieldIds.has(field.id) && !isFieldLocked(field, flow.mergedFieldValues)}
            isOtherSigners={field.signerIdx !== -1 && field.signerIdx !== mySignerIdx}
            otherValue={otherSignerValues[field.id]}
            hasSiblings={siblingIds.length > 0}
            siblingValue={siblingIds.filter((id) => flow.fieldValues[id]).map((id) => flow.fieldValues[id])[0]}
            value={flow.fieldValues[field.id]}
            signatureReady={!!flow.handSignature}
            allValues={flow.mergedFieldValues}
            walletAddress={null}
            isFilled={!validateField(field, flow.fieldValues[field.id], validationOptions)}
            isRequired={isFieldRequired(field, flow.mergedFieldValues)}
            onChange={flow.handleFieldChange}
            onFillMatching={flow.fillMatching}
            onApplyAddressSuggestion={flow.applyAddressSuggestion}
            onLoadAddressSuggestions={flow.loadAddressSuggestions}
            onUploadAttachment={flow.uploadAttachment}
            onRunIdentityCheck={flow.triggerIdentityCheck}
            onStartPayment={flow.triggerPayment}
            onStartSocialVerify={flow.triggerSocialVerify}
            onRequestSignature={() => openSignaturePad(field.type === "initials" ? "initials" : "signature", field.id)}
            onRequestPhoneDraw={() => {
              if (field.type === "initials") flow.triggerMobileInitials(field);
              else if (currentSigner && claimToken)
                flow.createMobileSession.mutate({
                  documentId,
                  claimToken,
                  signerLabel: currentSigner.label,
                });
            }}
            onFocus={() => flow.handleFieldFocus(field.id)}
            onBlur={() => flow.handleFieldBlur(field.id)}
          />
        );
      }}
      renderSignatureBlock={({ signerIdx }) => (
        <SignatureBlockRenderer
          signerIdx={signerIdx}
          mySignerIdx={mySignerIdx}
          doc={doc as AnyDoc}
          canSign={!!flow.canSign}
          needsDrawnSignature={needsDrawnSignature}
          handSignature={flow.handSignature}
          openSignaturePad={openSignaturePad}
          currentSigner={currentSigner}
          claimToken={claimToken}
          documentId={documentId}
          createMobileSession={flow.createMobileSession}
        />
      )}
    />
  );
}

// ─── Bottom section (extracted for line limits) ─────────────────────────────

function SignDocumentBottomCards(props: {
  doc: NonNullable<ReturnType<typeof useSigningFlow>["doc"]>;
  documentId: string;
  address: string | null;
  connected: boolean;
  chain: WalletChain | null;
  claimToken: string | null;
  canSign: boolean;
  canSubmit: boolean;
  isEmailOtpSigner: boolean;
  requiresWalletConnection: boolean;
  currentSigner: ReturnType<typeof useSigningFlow>["currentSigner"];
  isCreator: boolean;
  tokenGateSummary: string | null;
  tokenGateCardState: string;
  tokenGateEvaluation: ReturnType<typeof useSigningFlow>["tokenGateEvaluation"];
  tokenGateBlocked: boolean;
  requiresTokenGateWalletProofs: boolean;
  tokenGateWallets: ReturnType<typeof useSigningFlow>["tokenGateWallets"];
  tokenGateWalletError: string | null;
  verifyingTokenGateChain: WalletChain | null;
  connectTokenGateChain: (chain: WalletChain) => Promise<void>;
  verifyTokenGateWallet: (chain: WalletChain) => Promise<unknown>;
  needsDrawnSignature: boolean;
  handSignature: string | null;
  allFieldsComplete: boolean;
  totalMyFields: number;
  requiredFieldsRemaining: number;
  canFinalize: boolean;
  signing: boolean;
  currentRole: string;
  email: string;
  setEmail: (e: string) => void;
  declined: boolean;
  declineMut: ReturnType<typeof useSigningFlow>["declineMut"];
  requestEmailOtp: () => Promise<void>;
  requestEmailOtpPending: boolean;
  submitEmailSign: (otpCode: string) => Promise<void>;
  openSignaturePad: (mode?: "signature" | "initials", fieldId?: string) => void;
  openConfirmModal: () => void;
  goToNextField: () => void;
  currentFieldIdx: number;
  myFieldsList: ReturnType<typeof useSigningFlow>["myFieldsList"];
  fieldValues: Record<string, string>;
  validationOptions: ReturnType<typeof useSigningFlow>["opts"];
  navigateToField: ReturnType<typeof useSigningFlow>["navigateToField"];
  goToPrevField: () => void;
  goToNextFieldNav: () => void;
}) {
  const p = props;
  return (
    <>
      <SignerList signers={p.doc.signers as SignerInfo[]} currentAddress={p.address} />

      {(p.currentSigner as SignerInfo | null)?.tokenGates && (
        <TokenGateCard
          tokenGateSummary={p.tokenGateSummary}
          tokenGateCardState={p.tokenGateCardState}
          requiresTokenGateWalletProofs={p.requiresTokenGateWalletProofs}
          tokenGateEvaluation={p.tokenGateEvaluation}
          tokenGateBlocked={p.tokenGateBlocked}
          tokenGateWallets={p.tokenGateWallets}
          tokenGateWalletError={p.tokenGateWalletError}
          verifyingTokenGateChain={p.verifyingTokenGateChain}
          connected={p.connected}
          chain={p.chain ?? null}
          connectTokenGateChain={p.connectTokenGateChain}
          verifyTokenGateWallet={p.verifyTokenGateWallet}
        />
      )}

      {p.canSign && (
        <SigningActions
          needsDrawnSignature={p.needsDrawnSignature}
          handSignature={p.handSignature}
          allFieldsComplete={p.allFieldsComplete}
          totalMyFields={p.totalMyFields}
          requiredFieldsRemaining={p.requiredFieldsRemaining}
          canFinalize={p.canFinalize}
          signing={p.signing}
          address={p.address}
          chain={p.chain}
          claimToken={p.claimToken}
          canSubmit={p.canSubmit}
          isEmailOtpSigner={p.isEmailOtpSigner}
          currentSigner={p.currentSigner}
          currentRole={p.currentRole}
          email={p.email}
          setEmail={p.setEmail}
          declined={p.declined}
          declineMut={p.declineMut}
          requestEmailOtp={p.requestEmailOtp}
          requestEmailOtpPending={p.requestEmailOtpPending}
          submitEmailSign={p.submitEmailSign}
          documentId={p.documentId}
          openSignaturePad={p.openSignaturePad}
          openConfirmModal={p.openConfirmModal}
          goToNextField={p.goToNextField}
        />
      )}

      {!p.connected && p.claimToken && p.requiresWalletConnection && !p.requiresTokenGateWalletProofs && (
        <div className="glass-card space-y-4 rounded-2xl p-6 text-center">
          <p className="text-sm text-secondary">
            {p.tokenGateSummary
              ? `You can fill fields now. Connect an eligible wallet when you're ready to sign. Required: ${p.tokenGateSummary}`
              : "You can fill fields now. Connect your wallet when you're ready to sign this document."}
          </p>
          <ChainButtons />
        </div>
      )}

      {p.connected &&
        p.tokenGateBlocked &&
        (p.currentSigner as SignerInfo | null)?.tokenGates &&
        !p.requiresTokenGateWalletProofs && (
          <div className="glass-card space-y-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
            <p className="text-sm font-medium text-red-400">This wallet does not satisfy the token gate.</p>
            <p className="text-xs text-muted">{p.tokenGateEvaluation?.summary ?? p.tokenGateSummary}</p>
            <ChainButtons />
          </div>
        )}

      {p.connected && p.isCreator && !p.currentSigner && (
        <CreatorClaimSlot documentId={p.documentId} signers={p.doc.signers as SignerInfo[]} />
      )}

      {p.canSign && p.totalMyFields > 0 && p.connected && !p.isEmailOtpSigner && (
        <FieldNavigationBar
          currentFieldIdx={p.currentFieldIdx}
          totalMyFields={p.totalMyFields}
          myFieldsList={p.myFieldsList}
          fieldValues={p.fieldValues}
          validationOptions={p.validationOptions}
          allFieldsComplete={p.allFieldsComplete}
          needsDrawnSignature={p.needsDrawnSignature}
          handSignature={p.handSignature}
          currentRole={p.currentRole}
          navigateToField={p.navigateToField}
          goToPrevField={p.goToPrevField}
          goToNextFieldNav={p.goToNextFieldNav}
          openConfirmModal={p.openConfirmModal}
        />
      )}
    </>
  );
}

// ─── Modals section (extracted for line limits) ──────────────────────────────

function SignDocumentModals({
  flow,
  doc,
  address,
  chain,
  currentSigner,
  sigPadMode,
  initialsFieldRef,
  totalMyFields,
  fieldsFilled,
  confirmAndSign,
}: {
  flow: ReturnType<typeof useSigningFlow>;
  doc: NonNullable<ReturnType<typeof useSigningFlow>["doc"]>;
  address: string | null;
  chain: WalletChain | null;
  currentSigner: ReturnType<typeof useSigningFlow>["currentSigner"];
  sigPadMode: "signature" | "initials";
  initialsFieldRef: React.MutableRefObject<string | null>;
  totalMyFields: number;
  fieldsFilled: number;
  confirmAndSign: () => void;
}) {
  return (
    <>
      <SignaturePadModal
        show={flow.showSigPad}
        onClose={() => flow.setShowSigPad(false)}
        sigPadMode={sigPadMode}
        handSignature={flow.handSignature}
        fieldValues={flow.fieldValues}
        initialsFieldId={initialsFieldRef.current}
        onCapture={(mode, fieldId, dataUrl) => {
          if (mode === "initials" && fieldId) flow.handleFieldChange(fieldId, dataUrl);
          else flow.setHandSignature(dataUrl);
          flow.setShowSigPad(false);
        }}
        onClear={(mode, fieldId) => {
          if (mode === "initials" && fieldId) flow.handleFieldChange(fieldId, "");
          else flow.setHandSignature(null);
        }}
        forensicTracker={flow.forensicTracker}
        email={flow.email}
        address={address}
        documentId={doc?.id}
      />
      <QrModal
        show={flow.showQr}
        qrUrl={flow.qrUrl}
        qrImage={flow.qrImage}
        qrMode={flow.qrMode}
        mobileSignStatus={null}
        onClose={() => flow.setShowQr(false)}
      />
      <ConfirmModal
        show={flow.showConfirmModal}
        onClose={() => flow.setShowConfirmModal(false)}
        onConfirm={confirmAndSign}
        docTitle={doc.title}
        currentSignerLabel={currentSigner?.label ?? ""}
        totalMyFields={totalMyFields}
        fieldsFilled={fieldsFilled}
        chain={chain ?? null}
        confirmSigningMessage={flow.confirmSigningMessage}
        signing={flow.signing}
        currentRole={flow.currentRole}
      />
    </>
  );
}
