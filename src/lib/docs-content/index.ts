export { DEVELOPER_DOCS } from "./developer";
export { GETTING_STARTED_DOCS } from "./getting-started";
export { GOVERNANCE_DOCS } from "./governance";
export { MARKETPLACE_DOCS } from "./marketplace";
export { MULTI_CHAIN_DOCS } from "./multi-chain";
export { NETWORK_DOCS } from "./network";
export { PROTOCOL_DOCS } from "./protocol";
export { SECURITY_DOCS } from "./security";
export { type DocAnchor, type DocEntry, extractAnchors, hashContent } from "./types";

import { DEVELOPER_DOCS } from "./developer";
import { GETTING_STARTED_DOCS } from "./getting-started";
import { GOVERNANCE_DOCS } from "./governance";
import { MARKETPLACE_DOCS } from "./marketplace";
import { MULTI_CHAIN_DOCS } from "./multi-chain";
import { NETWORK_DOCS } from "./network";
import { PROTOCOL_DOCS } from "./protocol";
import { SECURITY_DOCS } from "./security";
import type { DocEntry } from "./types";

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
