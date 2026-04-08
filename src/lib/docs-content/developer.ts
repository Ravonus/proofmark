import { DEVELOPER_API_DOCS } from "./developer-api";
import { DEVELOPER_SETUP_DOCS } from "./developer-setup";
import type { DocEntry } from "./types";

export const DEVELOPER_DOCS: DocEntry[] = [...DEVELOPER_API_DOCS, ...DEVELOPER_SETUP_DOCS];

export { DEVELOPER_API_DOCS } from "./developer-api";
export { DEVELOPER_SETUP_DOCS } from "./developer-setup";
