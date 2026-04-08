export const structureDocPath = "docs/oss-structure.md";
export const structureGeneratorCommand = "npm run docs:structure";

export const biomePolicy = {
	noExcessiveCognitiveComplexity: 20,
	noExcessiveLinesPerFile: 650,
	noExcessiveLinesPerFunction: 120,
	useMaxParams: 5,
};

export const architectureBoundaries = [
	{
		from: "src/components",
		to: ["src/server"],
		allowTypeImports: true,
		message:
			"Components must stay client-facing. Pass server data in via props, hooks, or route handlers instead of importing server modules directly.",
	},
	{
		from: "src/lib",
		to: ["src/components"],
		allowTypeImports: false,
		message:
			"Shared lib code must stay UI-agnostic. Move reusable UI contracts into src/lib or adapt them at the component boundary.",
	},
	{
		from: "src/lib",
		to: ["src/server"],
		allowTypeImports: true,
		message:
			"Shared lib code must stay runtime-neutral. Depend on shared types or adapters instead of server implementation modules.",
	},
	{
		from: "src/server",
		to: ["src/components"],
		allowTypeImports: false,
		message:
			"Server modules must not depend on React/UI components. Keep rendering details at the app or component layer.",
	},
	{
		from: "src/stores",
		to: ["src/components", "src/server"],
		allowTypeImports: false,
		message:
			"Stores should coordinate client state, not import UI modules or server runtime code directly.",
	},
];

export const architectureBaseline = [
	{
		file: "src/lib/document/field-runtime.ts",
		targetPrefix: "src/components",
		reason:
			"Field runtime still reads component registry metadata. Split the registry contract into src/lib before removing this exception.",
	},
];

export const structureManifest = [
	{
		path: "cli",
		purpose: "Command-line entrypoints and shell-facing orchestration.",
		keepHere: [
			"Thin command wrappers and operator workflows.",
			"Argument parsing and output formatting.",
		],
		avoidHere: ["Domain logic that should live in src/lib or src/server."],
	},
	{
		path: "config",
		purpose: "Machine-readable repository policy and build-time configuration.",
		keepHere: [
			"Lint policy, directory contracts, and other source-of-truth config.",
		],
		avoidHere: ["Runtime business logic."],
	},
	{
		path: "docker",
		purpose: "Container and compose assets for local and deployment workflows.",
		keepHere: ["Dockerfiles, compose files, and runtime wiring."],
		avoidHere: ["Application logic duplicated from src or rust-service."],
	},
	{
		path: "docs",
		purpose: "Contributor and product documentation checked into the OSS repo.",
		keepHere: [
			"Guides, architectural docs, and contributor-facing references.",
		],
		avoidHere: ["Undocumented policy drift between docs and lint config."],
	},
	{
		path: "drizzle",
		purpose: "Database migrations and generated Drizzle metadata.",
		keepHere: ["SQL migrations and migration snapshots."],
		avoidHere: ["Hand-written app logic."],
	},
	{
		path: "patches",
		purpose: "Local dependency patches applied during install/build.",
		keepHere: ["Small, targeted upstream dependency fixes."],
		avoidHere: ["Feature work that belongs in first-party source directories."],
	},
	{
		path: "premium",
		purpose:
			"Optional premium-only code paths kept out of the OSS runtime path.",
		keepHere: ["Feature-gated premium components and server modules."],
		avoidHere: ["OSS-critical runtime dependencies."],
	},
	{
		path: "private",
		purpose:
			"Local-only assets or non-OSS material that should not bleed into the public product surface.",
		keepHere: ["Private fixtures or operator-only material."],
		avoidHere: ["Anything required for the OSS build to function."],
	},
	{
		path: "public",
		purpose: "Static assets served directly by Next.js.",
		keepHere: ["Images, icons, and static web assets."],
		avoidHere: ["Code or generated runtime data."],
	},
	{
		path: "rust-service",
		purpose: "Rust engine and native service implementation.",
		keepHere: ["Native PDF, crypto, and websocket runtime logic."],
		avoidHere: [
			"Duplicated TypeScript business rules unless they are bridging layers intentionally.",
		],
	},
	{
		path: "scripts",
		purpose:
			"One-off maintenance, benchmarking, generation, and operator scripts.",
		keepHere: [
			"Automations, migration helpers, seeders, and validation helpers.",
		],
		avoidHere: ["Reusable library code that should be imported from src."],
	},
	{
		path: "src",
		purpose: "Primary TypeScript application source tree.",
		keepHere: [
			"App, component, shared-lib, and server code for the web product.",
		],
		avoidHere: ["Undocumented top-level subdirectories."],
	},
	{
		path: "src/app",
		purpose: "Next.js App Router entrypoints, layouts, and route handlers.",
		keepHere: ["Route composition, request handlers, and page-level wiring."],
		avoidHere: [
			"Large reusable business logic blocks that belong in src/lib or src/server.",
		],
	},
	{
		path: "src/components",
		purpose: "Reusable React UI, page shells, and client-only composition.",
		keepHere: ["Presentational components, client flows, and UI hooks."],
		avoidHere: ["Runtime imports from src/server."],
	},
	{
		path: "src/components/document-editor",
		purpose: "Document editor surface, field placement, and editing workflows.",
		keepHere: ["Editor-specific components and interaction helpers."],
		avoidHere: ["Generic document logic that should live in src/lib/document."],
	},
	{
		path: "src/components/fields",
		purpose: "Field registry and field-specific UI renderers.",
		keepHere: ["Field presentation and UI adapters."],
		avoidHere: ["Pure document/runtime rules that belong in src/lib/document."],
	},
	{
		path: "src/components/forensic",
		purpose: "Forensic replay and investigation UI.",
		keepHere: ["Replay viewers, panels, and browser-facing rendering helpers."],
		avoidHere: ["Shared forensic algorithms that belong in src/lib/forensic."],
	},
	{
		path: "src/components/hooks",
		purpose: "Reusable client hooks that coordinate UI flows.",
		keepHere: ["Client-only state orchestration and interaction hooks."],
		avoidHere: [
			"Server runtime calls or storage logic outside route/TRPC boundaries.",
		],
	},
	{
		path: "src/components/layout",
		purpose: "Global layout scaffolding, providers, and navigation.",
		keepHere: ["Providers, shells, and app-wide UI chrome."],
		avoidHere: ["Feature-specific business rules."],
	},
	{
		path: "src/components/pages",
		purpose:
			"Large page-level UI assemblies that stitch together reusable widgets.",
		keepHere: [
			"Route-sized client compositions and page-specific experience code.",
		],
		avoidHere: ["Core domain utilities shared across multiple flows."],
	},
	{
		path: "src/components/post-sign",
		purpose: "Post-sign reveal, download, and follow-up client UX.",
		keepHere: ["Reveal/download UI and client orchestration."],
		avoidHere: ["Server-only post-sign policies."],
	},
	{
		path: "src/components/settings",
		purpose: "Workspace and user settings UI.",
		keepHere: ["Forms, editors, and client-side settings composition."],
		avoidHere: ["Persistence logic that belongs in server or lib layers."],
	},
	{
		path: "src/components/signing",
		purpose: "Signing experience UI, helpers, and signature capture surfaces.",
		keepHere: ["Signer-facing UI and client interaction helpers."],
		avoidHere: [
			"Shared signature math or verification rules that belong in src/lib.",
		],
	},
	{
		path: "src/components/ui",
		purpose: "Low-level shared UI primitives and motion helpers.",
		keepHere: [
			"Composable primitives, animation helpers, and design-system-style building blocks.",
		],
		avoidHere: ["Feature-specific document or signing rules."],
	},
	{
		path: "src/generated",
		purpose: "Generated bridges and OSS-safe premium shims.",
		keepHere: ["Generated code and compatibility shims only."],
		avoidHere: ["Hand-edited business logic."],
	},
	{
		path: "src/lib",
		purpose: "Shared framework-neutral utilities, schemas, and domain helpers.",
		keepHere: [
			"Cross-feature logic that can be reused outside any specific page or component.",
		],
		avoidHere: [
			"UI imports from src/components and runtime imports from src/server.",
		],
	},
	{
		path: "src/lib/auth",
		purpose: "Auth-facing client helpers and shared auth utilities.",
		keepHere: ["Shared auth adapters and client helpers."],
		avoidHere: ["Deep server implementation details."],
	},
	{
		path: "src/lib/crypto",
		purpose: "Chain metadata, wallet helpers, and shared crypto utilities.",
		keepHere: ["Reusable chain constants and browser-safe crypto helpers."],
		avoidHere: ["Server-only signing or persistence logic."],
	},
	{
		path: "src/lib/docs-content",
		purpose: "Structured documentation content rendered inside the product.",
		keepHere: ["Static doc data and content indexes."],
		avoidHere: ["UI rendering details or route logic."],
	},
	{
		path: "src/lib/document",
		purpose:
			"Document tokenization, field runtime, and document-domain helpers.",
		keepHere: [
			"Pure document rules, field value logic, and document transformations.",
		],
		avoidHere: ["Component registry coupling where it can be avoided."],
	},
	{
		path: "src/lib/forensic",
		purpose: "Shared forensic capture, replay, and analysis logic.",
		keepHere: [
			"Browser-safe forensic algorithms, codecs, and persistence helpers.",
		],
		avoidHere: ["Viewer-specific UI logic."],
	},
	{
		path: "src/lib/platform",
		purpose:
			"Cross-cutting platform adapters such as tRPC or premium feature gates.",
		keepHere: ["Infrastructure adapters shared across product surfaces."],
		avoidHere: ["Feature-specific UI or server orchestration."],
	},
	{
		path: "src/lib/schemas",
		purpose: "Shared validation schemas and contract definitions.",
		keepHere: ["Reusable Zod schemas and input/output contracts."],
		avoidHere: ["Rendering logic or DB access."],
	},
	{
		path: "src/lib/signature",
		purpose: "Shared signature asset and storage helpers.",
		keepHere: ["Signature formatting and shared signature support code."],
		avoidHere: ["UI-specific capture flows."],
	},
	{
		path: "src/lib/signing",
		purpose: "Signing-domain constants, verification, and recipient rules.",
		keepHere: ["Signing policies and reusable signing calculations."],
		avoidHere: ["Page-level or component-level interactions."],
	},
	{
		path: "src/lib/utils",
		purpose: "Small shared helpers with broad reuse across layers.",
		keepHere: [
			"Tiny general-purpose helpers such as logging or markdown helpers.",
		],
		avoidHere: ["Feature modules masquerading as generic utilities."],
	},
	{
		path: "src/server",
		purpose:
			"Server-only business logic, data access, and backend integrations.",
		keepHere: [
			"tRPC routers, DB access, messaging, auth, and server workflows.",
		],
		avoidHere: ["Imports from src/components."],
	},
	{
		path: "src/server/api",
		purpose: "tRPC root and router composition.",
		keepHere: ["API contracts, router assembly, and route-facing helpers."],
		avoidHere: [
			"DB or side-effect logic that should sit in deeper server modules.",
		],
	},
	{
		path: "src/server/audit",
		purpose: "Audit event creation and webhook dispatch.",
		keepHere: ["Audit logging and downstream audit fan-out."],
		avoidHere: ["Route/UI code."],
	},
	{
		path: "src/server/auth",
		purpose: "Server auth, identity resolution, and access checks.",
		keepHere: ["Auth runtime integration and request identity helpers."],
		avoidHere: ["Client auth UI helpers."],
	},
	{
		path: "src/server/crypto",
		purpose: "Server-only cryptographic operations and native engine bridges.",
		keepHere: [
			"Native engine interop, encryption, and secure server-side crypto workflows.",
		],
		avoidHere: ["Reusable browser-safe helpers that belong in src/lib/crypto."],
	},
	{
		path: "src/server/db",
		purpose: "Database client, schema, compatibility helpers, and IDs.",
		keepHere: ["Schema definitions and persistence-layer helpers."],
		avoidHere: ["Route composition or React types."],
	},
	{
		path: "src/server/documents",
		purpose:
			"Document-specific server workflows such as access, attachments, downloads, and proof packets.",
		keepHere: [
			"Document backend flows and persistence-backed document operations.",
		],
		avoidHere: ["UI rendering concerns."],
	},
	{
		path: "src/server/forensic",
		purpose:
			"Server orchestration for forensic automation and proof workflows.",
		keepHere: [
			"Forensic jobs, automation review, and server-side investigation flows.",
		],
		avoidHere: ["Browser replay viewers or UI controls."],
	},
	{
		path: "src/server/messaging",
		purpose: "Outbound messaging, email, and connector-facing communications.",
		keepHere: ["Delivery providers, templates, and dispatch orchestration."],
		avoidHere: ["Generic UI or page logic."],
	},
	{
		path: "src/server/pdf",
		purpose: "Server PDF-focused helpers that do not belong in route handlers.",
		keepHere: ["PDF runtime helpers and support utilities."],
		avoidHere: ["Client-side preview or editor code."],
	},
	{
		path: "src/server/workspace",
		purpose: "Workspace-scoped server logic and settings persistence.",
		keepHere: ["Workspace data and server-side workspace policies."],
		avoidHere: ["Settings UI logic."],
	},
	{
		path: "src/stores",
		purpose: "Client state containers and app-wide browser stores.",
		keepHere: ["State stores and selectors that remain client-side."],
		avoidHere: ["Server imports or UI component imports."],
	},
	{
		path: "src/styles",
		purpose: "Global styling entrypoints and shared CSS assets.",
		keepHere: ["Global CSS, tokens, and style-only assets."],
		avoidHere: ["Component logic."],
	},
];
