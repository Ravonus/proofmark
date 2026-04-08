import fs from "node:fs";
import path from "node:path";

import { structureDocPath } from "../config/repo-policy.mjs";
import { renderOssStructureDoc } from "./render-oss-structure.mjs";

const outputPath = path.resolve(process.cwd(), structureDocPath);
fs.writeFileSync(outputPath, renderOssStructureDoc());
