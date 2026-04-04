import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const appDir = join(process.cwd(), ".next", "server", "app");
const timeoutMs = 15000;
const pollMs = 200;

async function collectTraceTargets(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const targets = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      targets.push(...(await collectTraceTargets(fullPath)));
      continue;
    }

    if (entry.isFile() && /(?:page|route)\.js$/.test(entry.name)) {
      targets.push(`${fullPath}.nft.json`);
    }
  }

  return targets;
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findMissing(targets) {
  const missing = [];

  for (const target of targets) {
    if (!(await exists(target))) {
      missing.push(target);
    }
  }

  return missing;
}

const traceTargets = await collectTraceTargets(appDir);
const start = Date.now();

for (; ;) {
  const missing = await findMissing(traceTargets);

  if (missing.length === 0) {
    process.exit(0);
  }

  if (Date.now() >= start + timeoutMs) {
    console.error("Missing Next trace files after build:");
    for (const target of missing) {
      console.error(`- ${relative(process.cwd(), target)}`);
    }
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
