import type { DocEntry } from "./types";
import { SECURITY_ARCHITECTURE_DOCS } from "./security-architecture";
import { SECURITY_THREATS_DOCS } from "./security-threats";

export const SECURITY_DOCS: DocEntry[] = [...SECURITY_ARCHITECTURE_DOCS, ...SECURITY_THREATS_DOCS];

export { SECURITY_ARCHITECTURE_DOCS } from "./security-architecture";
export { SECURITY_THREATS_DOCS } from "./security-threats";
