import type { DocEntry } from "./types";
import { DEVELOPER_API_DOCS } from "./developer-api";
import { DEVELOPER_SETUP_DOCS } from "./developer-setup";

export const DEVELOPER_DOCS: DocEntry[] = [...DEVELOPER_API_DOCS, ...DEVELOPER_SETUP_DOCS];

export { DEVELOPER_API_DOCS } from "./developer-api";
export { DEVELOPER_SETUP_DOCS } from "./developer-setup";
