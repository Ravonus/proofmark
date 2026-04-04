export { type DocEntry, type DocAnchor, extractAnchors, hashContent } from "./types";
export { GETTING_STARTED_DOCS } from "./getting-started";
export { PROTOCOL_DOCS } from "./protocol";
export { MULTI_CHAIN_DOCS } from "./multi-chain";
export { SECURITY_DOCS } from "./security";
export { NETWORK_DOCS } from "./network";
export { GOVERNANCE_DOCS } from "./governance";
export { DEVELOPER_DOCS } from "./developer";
export { MARKETPLACE_DOCS } from "./marketplace";

import type { DocEntry } from "./types";
import { GETTING_STARTED_DOCS } from "./getting-started";
import { PROTOCOL_DOCS } from "./protocol";
import { MULTI_CHAIN_DOCS } from "./multi-chain";
import { SECURITY_DOCS } from "./security";
import { NETWORK_DOCS } from "./network";
import { GOVERNANCE_DOCS } from "./governance";
import { DEVELOPER_DOCS } from "./developer";
import { MARKETPLACE_DOCS } from "./marketplace";

export const DOC_SECTIONS: DocEntry[] = [
  ...GETTING_STARTED_DOCS,
  ...PROTOCOL_DOCS,
  ...MULTI_CHAIN_DOCS,
  ...SECURITY_DOCS,
  ...NETWORK_DOCS,
  ...MARKETPLACE_DOCS,
  ...GOVERNANCE_DOCS,
  ...DEVELOPER_DOCS,
];
