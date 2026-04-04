import type { DocEntry } from "./types";
import { MARKETPLACE_CORE_DOCS } from "./marketplace-core";
import { MARKETPLACE_FEATURES_DOCS } from "./marketplace-features";

export const MARKETPLACE_DOCS: DocEntry[] = [...MARKETPLACE_CORE_DOCS, ...MARKETPLACE_FEATURES_DOCS];

export { MARKETPLACE_CORE_DOCS } from "./marketplace-core";
export { MARKETPLACE_FEATURES_DOCS } from "./marketplace-features";
