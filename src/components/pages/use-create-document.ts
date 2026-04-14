"use client";

import { useCallback, useRef, useState } from "react";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";
import type { ContractTemplate } from "~/lib/document/templates";
import { trpc } from "~/lib/platform/trpc";
import {
	type CreateDocumentInput,
	createDocumentSchema,
	type DocumentFieldInput,
	documentFieldSchema,
	type SaveTemplateInput,
	saveTemplateSchema,
} from "~/lib/schemas/document";
import type { SecurityMode } from "~/lib/signing/document-security";
import { useWallet } from "../layout/wallet-provider";

type CreateSignerInput = CreateDocumentInput["signers"][number];
type ReminderInput = NonNullable<CreateDocumentInput["reminder"]>;
type SaveTemplateSignerInput = SaveTemplateInput["signers"][number];
type SignerFieldLike = {
	id?: string;
	type: string;
	label: string;
	value?: string | null;
	required?: boolean;
	options?: string[];
	settings?: Record<string, unknown>;
};

export type SignerRow = {
	label: string;
	email: string;
	phone?: string;
	role?: CreateSignerInput["role"];
	signMethod?: CreateSignerInput["signMethod"];
	tokenGates?: CreateSignerInput["tokenGates"];
	fields?: SignerFieldLike[];
};

export type CreatedResult = {
	id: string;
	signerLinks: Array<{ label: string; signUrl: string; embedUrl?: string }>;
};

const emptySigner = (): SignerRow => ({
	label: "",
	email: "",
	phone: "",
	role: "SIGNER",
	tokenGates: null,
});
const DEFAULT_TERM = "2 years";

function getDeliveryMethods(phone?: string): Array<"EMAIL" | "SMS"> {
	return phone?.trim() ? ["EMAIL", "SMS"] : ["EMAIL"];
}

function buildReminderInput(
	cadence: ReminderInput["cadence"],
	signers: Array<Pick<SignerRow, "phone">>,
): ReminderInput | undefined {
	if (cadence === "NONE") return undefined;
	return {
		cadence,
		channels: signers.some((s) => s.phone?.trim())
			? ["EMAIL", "SMS"]
			: ["EMAIL"],
	};
}

function normalizeSignerFields(
	fields?: SignerFieldLike[],
): DocumentFieldInput[] | undefined {
	if (!fields?.length) return undefined;
	return fields.map((f) =>
		documentFieldSchema.parse({
			...f,
			required: f.required ?? true,
			value: f.value ?? null,
		}),
	);
}

function mapSignerForCreate(
	signer: SignerRow,
	proofMode: CreateDocumentInput["proofMode"],
): CreateSignerInput {
	return {
		label: signer.label,
		email: signer.email || undefined,
		phone: signer.phone || undefined,
		role: signer.role ?? "SIGNER",
		signMethod:
			signer.signMethod ?? (proofMode === "PRIVATE" ? "EMAIL_OTP" : "WALLET"),
		tokenGates: signer.tokenGates ?? undefined,
		fields: normalizeSignerFields(signer.fields),
		deliveryMethods: getDeliveryMethods(signer.phone),
	};
}

function mapSignerForTemplate(signer: SignerRow): SaveTemplateSignerInput {
	return {
		label: signer.label,
		email: signer.email || undefined,
		phone: signer.phone || undefined,
		role: signer.role ?? "SIGNER",
		tokenGates: signer.tokenGates ?? undefined,
		deliveryMethods: getDeliveryMethods(signer.phone),
		fields: normalizeSignerFields(signer.fields) ?? [],
	};
}

function useCreateDocumentState() {
	const [title, setTitle] = useState("");
	const [content, setContent] = useState("");
	const [creatorEmail, setCreatorEmail] = useState("");
	const [signers, setSigners] = useState<SignerRow[]>([
		emptySigner(),
		emptySigner(),
	]);
	const [created, setCreated] = useState<CreatedResult | null>(null);
	const [selectedSavedTemplateId, setSelectedSavedTemplateId] = useState<
		string | null
	>(null);
	const [expiresInDays, setExpiresInDays] = useState("30");
	const [reminderCadence, setReminderCadence] =
		useState<ReminderInput["cadence"]>("EVERY_2_DAYS");
	const [automationReviewMode, setAutomationReviewMode] = useState<
		"FLAG" | "DENY" | "DISABLED"
	>("FLAG");
	const [prepAutomationMode, setPrepAutomationMode] = useState<
		"ALLOW" | "FLAG"
	>("ALLOW");
	const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
	const [showPdfUpload, setShowPdfUpload] = useState(false);
	const [showEditor, setShowEditor] = useState(false);
	const [showTemplates, setShowTemplates] = useState(false);
	const [pdfStyleTemplateId, setPdfStyleTemplateId] = useState("");
	const [securityMode, setSecurityMode] = useState<SecurityMode>("HASH_ONLY");
	const [proofMode, setProofMode] =
		useState<CreateDocumentInput["proofMode"]>("HYBRID");
	const [signingOrder, setSigningOrder] =
		useState<CreateDocumentInput["signingOrder"]>("parallel");
	const [gazeTracking, setGazeTracking] =
		useState<CreateDocumentInput["gazeTracking"]>("off");
	const lastGeneratedRef = useRef<string | null>(null);
	const [pdfSource, setPdfSource] = useState<string | null>(null);
	const [pdfDetectedFields, setPdfDetectedFields] = useState<
		Array<{
			type: string;
			label: string;
			line: number;
			position: number;
			blank: boolean;
		}>
	>([]);
	const [pdfPageCount, setPdfPageCount] = useState(0);

	return {
		title,
		setTitle,
		content,
		setContent,
		creatorEmail,
		setCreatorEmail,
		signers,
		setSigners,
		created,
		setCreated,
		selectedSavedTemplateId,
		setSelectedSavedTemplateId,
		expiresInDays,
		setExpiresInDays,
		reminderCadence,
		setReminderCadence,
		automationReviewMode,
		setAutomationReviewMode,
		prepAutomationMode,
		setPrepAutomationMode,
		copiedIdx,
		setCopiedIdx,
		showPdfUpload,
		setShowPdfUpload,
		showEditor,
		setShowEditor,
		showTemplates,
		setShowTemplates,
		pdfStyleTemplateId,
		setPdfStyleTemplateId,
		securityMode,
		setSecurityMode,
		proofMode,
		setProofMode,
		signingOrder,
		setSigningOrder,
		gazeTracking,
		setGazeTracking,
		lastGeneratedRef,
		pdfSource,
		setPdfSource,
		pdfDetectedFields,
		setPdfDetectedFields,
		pdfPageCount,
		setPdfPageCount,
	};
}

function buildAutomationPolicy(
	mode: "FLAG" | "DENY" | "DISABLED",
	prepMode: "ALLOW" | "FLAG",
) {
	const humanSteps = [
		"signature",
		"consent",
		"final_submit",
		"wallet_auth",
	] as const;
	return mode === "DISABLED"
		? {
				enabled: false,
				onPreparationAutomation: prepMode,
				onCriticalAutomation: "FLAG" as const,
				notifyCreator: false,
				requireHumanSteps: [...humanSteps],
			}
		: {
				enabled: true,
				onPreparationAutomation: prepMode,
				onCriticalAutomation: mode,
				notifyCreator: true,
				requireHumanSteps: [...humanSteps],
			};
}

type StateType = ReturnType<typeof useCreateDocumentState>;

function useTemplateHandlers(s: StateType) {
	const generateFromTemplate = useCallback(
		(template: ContractTemplate, currentSigners: SignerRow[]) => {
			const partyNames = currentSigners
				.map((sig) => sig.label.trim())
				.filter(Boolean);
			const effectiveDate = new Date().toISOString().split("T")[0] || "";
			s.setTitle(template.name);
			s.setContent(
				template.content({
					partyNames:
						partyNames.length > 0 ? partyNames : ["Party A", "Party B"],
					effectiveDate,
					term: DEFAULT_TERM,
				}),
			);
			s.lastGeneratedRef.current = template.id;
		},
		[], // eslint-disable-line react-hooks/exhaustive-deps
	);

	const handleSelectTemplate = (template: ContractTemplate) => {
		s.setSelectedSavedTemplateId(null);
		s.setShowTemplates(false);
		generateFromTemplate(template, s.signers);
		s.setShowEditor(true);
	};

	const handleSelectSavedTemplate = (template: {
		id: string;
		title: string;
		content: string;
		signers: Array<{
			label: string;
			email?: string | null;
			phone?: string | null;
			role?: string | null;
			tokenGates?: unknown;
			fields?: Array<{ type: string }>;
		}>;
		defaults?: {
			expiresInDays?: number | null;
			reminder?: { cadence?: string } | null;
			proofMode?: string;
			signingOrder?: string;
		} | null;
	}) => {
		s.setSelectedSavedTemplateId(template.id);
		s.setTitle(template.title);
		s.setContent(template.content);
		s.setSigners(
			template.signers.length > 0
				? (template.signers.map((sig) => ({
						label: sig.label,
						email: sig.email ?? "",
						phone: sig.phone ?? "",
						role: (sig.role ?? "SIGNER") as CreateSignerInput["role"],
						tokenGates: (sig.tokenGates ??
							null) as CreateSignerInput["tokenGates"],
						fields: sig.fields?.map((f) => ({ ...f, type: f.type })),
					})) as SignerRow[])
				: [emptySigner(), emptySigner()],
		);
		s.setExpiresInDays(
			template.defaults?.expiresInDays
				? String(template.defaults.expiresInDays)
				: "30",
		);
		s.setReminderCadence(
			(template.defaults?.reminder?.cadence ??
				"EVERY_2_DAYS") as ReminderInput["cadence"],
		);
		s.setProofMode(
			(template.defaults?.proofMode ??
				"HYBRID") as CreateDocumentInput["proofMode"],
		);
		s.setSigningOrder(
			(template.defaults?.signingOrder ??
				"parallel") as CreateDocumentInput["signingOrder"],
		);
		s.setShowTemplates(false);
		s.setShowEditor(true);
	};

	const handleSelectBlank = () => {
		s.setSelectedSavedTemplateId(null);
		s.setShowTemplates(false);
		s.setTitle("");
		s.setContent("");
		s.lastGeneratedRef.current = null;
		s.setShowEditor(true);
	};

	const handlePdfComplete = (result: {
		title: string;
		content: string;
		signers: Array<{
			label: string;
			email: string;
			phone?: string;
			fields?: SignerFieldLike[];
		}>;
		pdfBase64?: string;
		detectedFields?: Array<{
			type: string;
			label: string;
			line: number;
			position: number;
			blank: boolean;
		}>;
		pageCount?: number;
	}) => {
		s.setTitle(result.title);
		s.setContent(result.content);
		s.setSigners(
			result.signers.length > 0
				? result.signers
				: [emptySigner(), emptySigner()],
		);
		s.setSelectedSavedTemplateId(null);
		s.setShowPdfUpload(false);
		s.setShowTemplates(false);
		s.setShowEditor(true);
		s.lastGeneratedRef.current = null;
		// Store PDF source for the viewer
		s.setPdfSource(result.pdfBase64 ?? null);
		s.setPdfDetectedFields(result.detectedFields ?? []);
		s.setPdfPageCount(result.pageCount ?? 0);
	};

	const resetToHome = () => {
		s.setCreated(null);
		s.setTitle("");
		s.setContent("");
		s.setSigners([emptySigner(), emptySigner()]);
		s.setShowTemplates(false);
		s.setShowPdfUpload(false);
		s.setShowEditor(false);
		s.setSelectedSavedTemplateId(null);
		s.lastGeneratedRef.current = null;
	};

	return {
		handleSelectTemplate,
		handleSelectSavedTemplate,
		handleSelectBlank,
		handlePdfComplete,
		resetToHome,
	};
}

function useSubmitHandlers(
	s: StateType,
	opts: { connected: boolean; authenticated: boolean; address: string | null },
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createMutation: { mutate: (input: any) => void },
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	saveTemplateMutation: { mutate: (input: any) => void },
) {
	const handleSubmit = (result: {
		title: string;
		content: string;
		signers: SignerRow[];
	}) => {
		if (!opts.connected || !opts.authenticated || !opts.address) return;
		createMutation.mutate(
			createDocumentSchema.parse({
				title: result.title,
				content: result.content,
				createdByEmail: s.creatorEmail || undefined,
				proofMode: s.proofMode,
				signingOrder: s.signingOrder,
				gazeTracking: s.gazeTracking,
				signers: result.signers.map((sig) =>
					mapSignerForCreate(sig, s.proofMode),
				),
				templateId: s.selectedSavedTemplateId || undefined,
				pdfStyleTemplateId:
					s.pdfStyleTemplateId && !s.pdfStyleTemplateId.startsWith("__")
						? s.pdfStyleTemplateId
						: undefined,
				securityMode: s.securityMode,
				expiresInDays: s.expiresInDays ? Number(s.expiresInDays) : undefined,
				reminder: buildReminderInput(s.reminderCadence, result.signers),
				automationPolicy: buildAutomationPolicy(
					s.automationReviewMode,
					s.prepAutomationMode,
				),
			}),
		);
	};

	const handleSaveTemplate = (result: {
		title: string;
		content: string;
		signers: SignerRow[];
	}) => {
		const name = window.prompt("Template name", result.title);
		if (!name) return;
		saveTemplateMutation.mutate(
			saveTemplateSchema.parse({
				id: s.selectedSavedTemplateId || undefined,
				name,
				title: result.title,
				description: s.selectedSavedTemplateId
					? "Updated from editor"
					: "Saved from editor",
				content: result.content,
				signers: result.signers.map(mapSignerForTemplate),
				defaults: {
					proofMode: s.proofMode,
					signingOrder: s.signingOrder,
					expiresInDays: s.expiresInDays ? Number(s.expiresInDays) : undefined,
					reminder: buildReminderInput(s.reminderCadence, result.signers),
				},
			}),
		);
	};

	return { handleSubmit, handleSaveTemplate };
}

export function useCreateDocument() {
	const identity = useConnectedIdentity();
	const { connected, authenticated, address } = useWallet();
	const savedTemplatesQuery = trpc.account.listTemplates.useQuery(undefined, {
		enabled: identity.isSignedIn,
	});
	const s = useCreateDocumentState();
	const pdfStyleTemplatesQuery = trpc.account.listPdfStyleTemplates.useQuery(
		undefined,
		{
			enabled: identity.isSignedIn,
		},
	);
	const initializedPdfStyleRef = useRef(false);
	const createMutation = trpc.document.create.useMutation({
		onSuccess: (data) =>
			s.setCreated({ id: data.id, signerLinks: data.signerLinks }),
	});
	const saveTemplateMutation = trpc.account.saveTemplate.useMutation({
		onSuccess: () => savedTemplatesQuery.refetch(),
	});

	const templateHandlers = useTemplateHandlers(s);
	const submitHandlers = useSubmitHandlers(
		s,
		{ connected, authenticated, address },
		createMutation,
		saveTemplateMutation,
	);

	const handleCopy = (url: string, idx: number) => {
		void navigator.clipboard.writeText(url);
		s.setCopiedIdx(idx);
		setTimeout(() => s.setCopiedIdx(null), 2000);
	};

	if (
		!initializedPdfStyleRef.current &&
		identity.isSignedIn &&
		!pdfStyleTemplatesQuery.isLoading
	) {
		initializedPdfStyleRef.current = true;
		const def = (pdfStyleTemplatesQuery.data ?? []).find((t) => t.isDefault);
		if (def) s.setPdfStyleTemplateId(def.id);
	}

	return {
		identity,
		connected,
		authenticated,
		address,
		title: s.title,
		content: s.content,
		signers: s.signers,
		created: s.created,
		copiedIdx: s.copiedIdx,
		showPdfUpload: s.showPdfUpload,
		setShowPdfUpload: s.setShowPdfUpload,
		showEditor: s.showEditor,
		setShowEditor: s.setShowEditor,
		showTemplates: s.showTemplates,
		setShowTemplates: s.setShowTemplates,
		creatorEmail: s.creatorEmail,
		setCreatorEmail: s.setCreatorEmail,
		expiresInDays: s.expiresInDays,
		setExpiresInDays: s.setExpiresInDays,
		reminderCadence: s.reminderCadence,
		setReminderCadence: s.setReminderCadence,
		pdfStyleTemplateId: s.pdfStyleTemplateId,
		setPdfStyleTemplateId: s.setPdfStyleTemplateId,
		securityMode: s.securityMode,
		setSecurityMode: s.setSecurityMode,
		proofMode: s.proofMode,
		setProofMode: s.setProofMode,
		signingOrder: s.signingOrder,
		setSigningOrder: s.setSigningOrder,
		gazeTracking: s.gazeTracking,
		setGazeTracking: s.setGazeTracking,
		automationReviewMode: s.automationReviewMode,
		setAutomationReviewMode: s.setAutomationReviewMode,
		prepAutomationMode: s.prepAutomationMode,
		setPrepAutomationMode: s.setPrepAutomationMode,
		pdfStyleTemplatesQuery,
		savedTemplatesQuery,
		createMutation,
		pdfSource: s.pdfSource,
		pdfDetectedFields: s.pdfDetectedFields,
		pdfPageCount: s.pdfPageCount,
		...templateHandlers,
		...submitHandlers,
		handleCopy,
	};
}
