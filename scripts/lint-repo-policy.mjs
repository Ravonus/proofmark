import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import {
	architectureBaseline,
	architectureBoundaries,
	structureDocPath,
	structureGeneratorCommand,
	structureManifest,
} from "../config/repo-policy.mjs";
import { renderOssStructureDoc } from "./render-oss-structure.mjs";

const repoRoot = process.cwd();
const errors = [];

function toPosix(filePath) {
	return filePath.split(path.sep).join("/");
}

function readText(filePath) {
	return fs.readFileSync(filePath, "utf8");
}

function exists(relativePath) {
	return fs.existsSync(path.join(repoRoot, relativePath));
}

function walk(dirPath, visit) {
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);
		const relativePath = toPosix(path.relative(repoRoot, fullPath));

		visit(fullPath, relativePath, entry);

		if (entry.isDirectory()) {
			walk(fullPath, visit);
		}
	}
}

function getExpectedManifestPaths() {
	const expected = new Set();
	const topLevelIgnore = new Set(["data", "node_modules", "tmp"]);

	for (const entry of fs.readdirSync(repoRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}

		if (entry.name.startsWith(".") || topLevelIgnore.has(entry.name)) {
			continue;
		}

		expected.add(entry.name);
	}

	expected.add("src/app");
	expected.add("src/components");
	expected.add("src/generated");
	expected.add("src/lib");
	expected.add("src/server");
	expected.add("src/stores");
	expected.add("src/styles");

	for (const root of ["src/components", "src/lib", "src/server"]) {
		const rootPath = path.join(repoRoot, root);
		if (!fs.existsSync(rootPath)) {
			continue;
		}

		for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}

			if (entry.name === "__tests__" || entry.name === "generated") {
				continue;
			}

			expected.add(`${root}/${entry.name}`);
		}
	}

	return expected;
}

function lintStructureManifest() {
	const manifestPaths = new Set(structureManifest.map((entry) => entry.path));
	const expectedPaths = getExpectedManifestPaths();

	for (const entry of structureManifest) {
		if (!exists(entry.path)) {
			errors.push(
				`[repo:structure] Manifest entry ${entry.path} does not exist on disk. Remove it or restore the directory.`,
			);
		}
	}

	for (const expectedPath of expectedPaths) {
		if (!manifestPaths.has(expectedPath)) {
			errors.push(
				`[repo:structure] ${expectedPath} is not documented in config/repo-policy.mjs. Add it so OSS contributors can find it.`,
			);
		}
	}
}

function getCategory(relativePath) {
	const categories = [
		"src/app",
		"src/components",
		"src/lib",
		"src/server",
		"src/stores",
	];
	return (
		categories.find(
			(prefix) =>
				relativePath === prefix || relativePath.startsWith(`${prefix}/`),
		) ?? null
	);
}

function resolveImportTarget(sourceFilePath, specifier) {
	if (specifier.startsWith("~/")) {
		return `src/${specifier.slice(2)}`;
	}

	if (specifier.startsWith("./") || specifier.startsWith("../")) {
		const absoluteTarget = path.resolve(
			path.dirname(sourceFilePath),
			specifier,
		);
		const relativeTarget = toPosix(path.relative(repoRoot, absoluteTarget));

		if (!relativeTarget.startsWith("..")) {
			return relativeTarget;
		}
	}

	return null;
}

function isTypeOnlyImport(node) {
	if (ts.isImportDeclaration(node)) {
		const clause = node.importClause;

		if (!clause) {
			return false;
		}

		if (clause.isTypeOnly) {
			return true;
		}

		if (clause.name) {
			return false;
		}

		if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
			return clause.namedBindings.elements.every(
				(element) => element.isTypeOnly,
			);
		}

		return false;
	}

	if (ts.isExportDeclaration(node)) {
		return Boolean(node.isTypeOnly);
	}

	return false;
}

function shouldSkipArchitectureFile(relativePath) {
	return (
		relativePath.includes("__tests__/") ||
		relativePath.startsWith("src/app/api/") ||
		relativePath.startsWith("src/generated/") ||
		relativePath.startsWith("src/lib/forensic/generated/")
	);
}

function findArchitectureException(filePath, targetPath) {
	return (
		architectureBaseline.find(
			(entry) =>
				entry.file === filePath && targetPath.startsWith(entry.targetPrefix),
		) ?? null
	);
}

function lintArchitectureBoundaries() {
	const usedExceptions = new Set();

	walk(path.join(repoRoot, "src"), (fullPath, relativePath, entry) => {
		if (!entry.isFile()) {
			return;
		}

		if (
			!/\.(ts|tsx|js|jsx)$/.test(relativePath) ||
			shouldSkipArchitectureFile(relativePath)
		) {
			return;
		}

		const sourceCategory = getCategory(relativePath);
		if (!sourceCategory) {
			return;
		}

		const sourceText = readText(fullPath);
		const scriptKind = relativePath.endsWith(".tsx")
			? ts.ScriptKind.TSX
			: relativePath.endsWith(".jsx")
				? ts.ScriptKind.JSX
				: ts.ScriptKind.TS;
		const sourceFile = ts.createSourceFile(
			fullPath,
			sourceText,
			ts.ScriptTarget.Latest,
			true,
			scriptKind,
		);

		function findViolatedBoundary(node, targetPath, targetCategory) {
			for (const boundary of architectureBoundaries) {
				if (
					boundary.from !== sourceCategory ||
					!boundary.to.includes(targetCategory)
				)
					continue;
				if (boundary.allowTypeImports && isTypeOnlyImport(node)) return null;
				const exception = findArchitectureException(relativePath, targetPath);
				if (exception) {
					usedExceptions.add(`${exception.file}::${exception.targetPrefix}`);
					return null;
				}
				return boundary;
			}
			return null;
		}

		function inspectSpecifier(node, specifierText) {
			const targetPath = resolveImportTarget(fullPath, specifierText);
			if (!targetPath) return;
			const targetCategory = getCategory(targetPath);
			if (!targetCategory) return;
			const boundary = findViolatedBoundary(node, targetPath, targetCategory);
			if (!boundary) return;
			const { line, character } = sourceFile.getLineAndCharacterOfPosition(
				node.getStart(sourceFile),
			);
			errors.push(
				`[repo:architecture] ${relativePath}:${line + 1}:${character + 1} imports ${specifierText}. ${boundary.message} See ${structureDocPath}.`,
			);
		}

		function visit(node) {
			if (
				(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
				node.moduleSpecifier &&
				ts.isStringLiteral(node.moduleSpecifier)
			) {
				inspectSpecifier(node, node.moduleSpecifier.text);
			}

			if (
				ts.isCallExpression(node) &&
				node.expression.kind === ts.SyntaxKind.ImportKeyword &&
				node.arguments.length === 1 &&
				ts.isStringLiteral(node.arguments[0])
			) {
				inspectSpecifier(node, node.arguments[0].text);
			}

			ts.forEachChild(node, visit);
		}

		visit(sourceFile);
	});

	for (const entry of architectureBaseline) {
		if (!exists(entry.file)) {
			errors.push(
				`[repo:architecture] Baseline exception ${entry.file} no longer exists. Remove it from architectureBaseline.`,
			);
			continue;
		}

		if (!usedExceptions.has(`${entry.file}::${entry.targetPrefix}`)) {
			errors.push(
				`[repo:architecture] Baseline exception ${entry.file} -> ${entry.targetPrefix} is stale. Remove it from architectureBaseline.`,
			);
		}
	}
}

function lintGeneratedDocs() {
	const expected = renderOssStructureDoc();
	const actualPath = path.join(repoRoot, structureDocPath);
	const actual = fs.existsSync(actualPath) ? readText(actualPath) : "";

	if (actual !== expected) {
		errors.push(
			`[repo:structure-doc] ${structureDocPath} is out of date. Run ${structureGeneratorCommand} and commit the refreshed directory map.`,
		);
	}
}

lintStructureManifest();
lintArchitectureBoundaries();
lintGeneratedDocs();

if (errors.length > 0) {
	console.error(errors.join("\n"));
	process.exit(1);
}

console.log("repo policy lint passed");
