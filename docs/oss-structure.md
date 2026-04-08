# OSS Structure Contract

This document is generated from `config/repo-policy.mjs`. Update the policy there, then run `npm run docs:structure`.

## Guardrails Enforced By Lint

- Biome warns when a file grows beyond 650 lines with `lint/nursery/noExcessiveLinesPerFile`.
- Biome warns when a function body grows beyond 120 lines with `lint/complexity/noExcessiveLinesPerFunction`.
- Biome warns when a function exceeds cognitive complexity 20 with `lint/complexity/noExcessiveCognitiveComplexity`.
- Biome warns when a function takes more than 5 parameters via `lint/complexity/useMaxParams`.
- `npm run lint:repo` validates architectural boundaries and ensures this directory map stays in sync with the real tree.

## Directory Map

## `cli`

Command-line entrypoints and shell-facing orchestration.

Keep here:

- Thin command wrappers and operator workflows.
- Argument parsing and output formatting.

Avoid here:

- Domain logic that should live in src/lib or src/server.

## `config`

Machine-readable repository policy and build-time configuration.

Keep here:

- Lint policy, directory contracts, and other source-of-truth config.

Avoid here:

- Runtime business logic.

## `docker`

Container and compose assets for local and deployment workflows.

Keep here:

- Dockerfiles, compose files, and runtime wiring.

Avoid here:

- Application logic duplicated from src or rust-service.

## `docs`

Contributor and product documentation checked into the OSS repo.

Keep here:

- Guides, architectural docs, and contributor-facing references.

Avoid here:

- Undocumented policy drift between docs and lint config.

## `drizzle`

Database migrations and generated Drizzle metadata.

Keep here:

- SQL migrations and migration snapshots.

Avoid here:

- Hand-written app logic.

## `patches`

Local dependency patches applied during install/build.

Keep here:

- Small, targeted upstream dependency fixes.

Avoid here:

- Feature work that belongs in first-party source directories.

## `premium`

Optional premium-only code paths kept out of the OSS runtime path.

Keep here:

- Feature-gated premium components and server modules.

Avoid here:

- OSS-critical runtime dependencies.

## `private`

Local-only assets or non-OSS material that should not bleed into the public product surface.

Keep here:

- Private fixtures or operator-only material.

Avoid here:

- Anything required for the OSS build to function.

## `public`

Static assets served directly by Next.js.

Keep here:

- Images, icons, and static web assets.

Avoid here:

- Code or generated runtime data.

## `rust-service`

Rust engine and native service implementation.

Keep here:

- Native PDF, crypto, and websocket runtime logic.

Avoid here:

- Duplicated TypeScript business rules unless they are bridging layers intentionally.

## `scripts`

One-off maintenance, benchmarking, generation, and operator scripts.

Keep here:

- Automations, migration helpers, seeders, and validation helpers.

Avoid here:

- Reusable library code that should be imported from src.

## `src`

Primary TypeScript application source tree.

Keep here:

- App, component, shared-lib, and server code for the web product.

Avoid here:

- Undocumented top-level subdirectories.

## `src/app`

Next.js App Router entrypoints, layouts, and route handlers.

Keep here:

- Route composition, request handlers, and page-level wiring.

Avoid here:

- Large reusable business logic blocks that belong in src/lib or src/server.

## `src/components`

Reusable React UI, page shells, and client-only composition.

Keep here:

- Presentational components, client flows, and UI hooks.

Avoid here:

- Runtime imports from src/server.

## `src/components/document-editor`

Document editor surface, field placement, and editing workflows.

Keep here:

- Editor-specific components and interaction helpers.

Avoid here:

- Generic document logic that should live in src/lib/document.

## `src/components/fields`

Field registry and field-specific UI renderers.

Keep here:

- Field presentation and UI adapters.

Avoid here:

- Pure document/runtime rules that belong in src/lib/document.

## `src/components/forensic`

Forensic replay and investigation UI.

Keep here:

- Replay viewers, panels, and browser-facing rendering helpers.

Avoid here:

- Shared forensic algorithms that belong in src/lib/forensic.

## `src/components/hooks`

Reusable client hooks that coordinate UI flows.

Keep here:

- Client-only state orchestration and interaction hooks.

Avoid here:

- Server runtime calls or storage logic outside route/TRPC boundaries.

## `src/components/layout`

Global layout scaffolding, providers, and navigation.

Keep here:

- Providers, shells, and app-wide UI chrome.

Avoid here:

- Feature-specific business rules.

## `src/components/pages`

Large page-level UI assemblies that stitch together reusable widgets.

Keep here:

- Route-sized client compositions and page-specific experience code.

Avoid here:

- Core domain utilities shared across multiple flows.

## `src/components/post-sign`

Post-sign reveal, download, and follow-up client UX.

Keep here:

- Reveal/download UI and client orchestration.

Avoid here:

- Server-only post-sign policies.

## `src/components/settings`

Workspace and user settings UI.

Keep here:

- Forms, editors, and client-side settings composition.

Avoid here:

- Persistence logic that belongs in server or lib layers.

## `src/components/signing`

Signing experience UI, helpers, and signature capture surfaces.

Keep here:

- Signer-facing UI and client interaction helpers.

Avoid here:

- Shared signature math or verification rules that belong in src/lib.

## `src/components/ui`

Low-level shared UI primitives and motion helpers.

Keep here:

- Composable primitives, animation helpers, and design-system-style building blocks.

Avoid here:

- Feature-specific document or signing rules.

## `src/generated`

Generated bridges and OSS-safe premium shims.

Keep here:

- Generated code and compatibility shims only.

Avoid here:

- Hand-edited business logic.

## `src/lib`

Shared framework-neutral utilities, schemas, and domain helpers.

Keep here:

- Cross-feature logic that can be reused outside any specific page or component.

Avoid here:

- UI imports from src/components and runtime imports from src/server.

## `src/lib/auth`

Auth-facing client helpers and shared auth utilities.

Keep here:

- Shared auth adapters and client helpers.

Avoid here:

- Deep server implementation details.

## `src/lib/crypto`

Chain metadata, wallet helpers, and shared crypto utilities.

Keep here:

- Reusable chain constants and browser-safe crypto helpers.

Avoid here:

- Server-only signing or persistence logic.

## `src/lib/docs-content`

Structured documentation content rendered inside the product.

Keep here:

- Static doc data and content indexes.

Avoid here:

- UI rendering details or route logic.

## `src/lib/document`

Document tokenization, field runtime, and document-domain helpers.

Keep here:

- Pure document rules, field value logic, and document transformations.

Avoid here:

- Component registry coupling where it can be avoided.

## `src/lib/forensic`

Shared forensic capture, replay, and analysis logic.

Keep here:

- Browser-safe forensic algorithms, codecs, and persistence helpers.

Avoid here:

- Viewer-specific UI logic.

## `src/lib/platform`

Cross-cutting platform adapters such as tRPC or premium feature gates.

Keep here:

- Infrastructure adapters shared across product surfaces.

Avoid here:

- Feature-specific UI or server orchestration.

## `src/lib/schemas`

Shared validation schemas and contract definitions.

Keep here:

- Reusable Zod schemas and input/output contracts.

Avoid here:

- Rendering logic or DB access.

## `src/lib/signature`

Shared signature asset and storage helpers.

Keep here:

- Signature formatting and shared signature support code.

Avoid here:

- UI-specific capture flows.

## `src/lib/signing`

Signing-domain constants, verification, and recipient rules.

Keep here:

- Signing policies and reusable signing calculations.

Avoid here:

- Page-level or component-level interactions.

## `src/lib/utils`

Small shared helpers with broad reuse across layers.

Keep here:

- Tiny general-purpose helpers such as logging or markdown helpers.

Avoid here:

- Feature modules masquerading as generic utilities.

## `src/server`

Server-only business logic, data access, and backend integrations.

Keep here:

- tRPC routers, DB access, messaging, auth, and server workflows.

Avoid here:

- Imports from src/components.

## `src/server/api`

tRPC root and router composition.

Keep here:

- API contracts, router assembly, and route-facing helpers.

Avoid here:

- DB or side-effect logic that should sit in deeper server modules.

## `src/server/audit`

Audit event creation and webhook dispatch.

Keep here:

- Audit logging and downstream audit fan-out.

Avoid here:

- Route/UI code.

## `src/server/auth`

Server auth, identity resolution, and access checks.

Keep here:

- Auth runtime integration and request identity helpers.

Avoid here:

- Client auth UI helpers.

## `src/server/crypto`

Server-only cryptographic operations and native engine bridges.

Keep here:

- Native engine interop, encryption, and secure server-side crypto workflows.

Avoid here:

- Reusable browser-safe helpers that belong in src/lib/crypto.

## `src/server/db`

Database client, schema, compatibility helpers, and IDs.

Keep here:

- Schema definitions and persistence-layer helpers.

Avoid here:

- Route composition or React types.

## `src/server/documents`

Document-specific server workflows such as access, attachments, downloads, and proof packets.

Keep here:

- Document backend flows and persistence-backed document operations.

Avoid here:

- UI rendering concerns.

## `src/server/forensic`

Server orchestration for forensic automation and proof workflows.

Keep here:

- Forensic jobs, automation review, and server-side investigation flows.

Avoid here:

- Browser replay viewers or UI controls.

## `src/server/messaging`

Outbound messaging, email, and connector-facing communications.

Keep here:

- Delivery providers, templates, and dispatch orchestration.

Avoid here:

- Generic UI or page logic.

## `src/server/pdf`

Server PDF-focused helpers that do not belong in route handlers.

Keep here:

- PDF runtime helpers and support utilities.

Avoid here:

- Client-side preview or editor code.

## `src/server/workspace`

Workspace-scoped server logic and settings persistence.

Keep here:

- Workspace data and server-side workspace policies.

Avoid here:

- Settings UI logic.

## `src/stores`

Client state containers and app-wide browser stores.

Keep here:

- State stores and selectors that remain client-side.

Avoid here:

- Server imports or UI component imports.

## `src/styles`

Global styling entrypoints and shared CSS assets.

Keep here:

- Global CSS, tokens, and style-only assets.

Avoid here:

- Component logic.

## Architectural Boundaries

- `src/components` -> `src/server`: Components must stay client-facing. Pass server data in via props, hooks, or route handlers instead of importing server modules directly. Runtime imports are blocked; type-only imports are allowed.
- `src/lib` -> `src/components`: Shared lib code must stay UI-agnostic. Move reusable UI contracts into src/lib or adapt them at the component boundary. All imports are blocked.
- `src/lib` -> `src/server`: Shared lib code must stay runtime-neutral. Depend on shared types or adapters instead of server implementation modules. Runtime imports are blocked; type-only imports are allowed.
- `src/server` -> `src/components`: Server modules must not depend on React/UI components. Keep rendering details at the app or component layer. All imports are blocked.
- `src/stores` -> `src/components`, `src/server`: Stores should coordinate client state, not import UI modules or server runtime code directly. All imports are blocked.

### Temporary Exceptions

- `src/lib/document/field-runtime.ts` -> `src/components`: Field runtime still reads component registry metadata. Split the registry contract into src/lib before removing this exception.
