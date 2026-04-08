import {
	architectureBaseline,
	architectureBoundaries,
	biomePolicy,
	structureManifest,
} from "../config/repo-policy.mjs";

function renderList(items) {
	return items.map((item) => `- ${item}`).join("\n");
}

function renderStructureSection(entry) {
	return [
		`## \`${entry.path}\``,
		"",
		entry.purpose,
		"",
		"Keep here:",
		renderList(entry.keepHere),
		"",
		"Avoid here:",
		renderList(entry.avoidHere),
		"",
	].join("\n");
}

function renderBoundary(boundary) {
	const targets = boundary.to.map((entry) => `\`${entry}\``).join(", ");
	const qualifier = boundary.allowTypeImports
		? "Runtime imports are blocked; type-only imports are allowed."
		: "All imports are blocked.";

	return `- \`${boundary.from}\` -> ${targets}: ${boundary.message} ${qualifier}`;
}

function renderArchitectureException(exception) {
	return `- \`${exception.file}\` -> \`${exception.targetPrefix}\`: ${exception.reason}`;
}

export function renderOssStructureDoc() {
	return `# OSS Structure Contract

This document is generated from \`config/repo-policy.mjs\`. Update the policy there, then run \`npm run docs:structure\`.

## Guardrails Enforced By Lint

- Biome warns when a file grows beyond ${biomePolicy.noExcessiveLinesPerFile} lines with \`lint/nursery/noExcessiveLinesPerFile\`.
- Biome warns when a function body grows beyond ${biomePolicy.noExcessiveLinesPerFunction} lines with \`lint/complexity/noExcessiveLinesPerFunction\`.
- Biome warns when a function exceeds cognitive complexity ${biomePolicy.noExcessiveCognitiveComplexity} with \`lint/complexity/noExcessiveCognitiveComplexity\`.
- Biome warns when a function takes more than ${biomePolicy.useMaxParams} parameters via \`lint/complexity/useMaxParams\`.
- \`npm run lint:repo\` validates architectural boundaries and ensures this directory map stays in sync with the real tree.

## Directory Map

${structureManifest.map(renderStructureSection).join("\n")}
## Architectural Boundaries

${architectureBoundaries.map(renderBoundary).join("\n")}

### Temporary Exceptions

${
	architectureBaseline.length > 0
		? architectureBaseline.map(renderArchitectureException).join("\n")
		: "- None."
}
`;
}
