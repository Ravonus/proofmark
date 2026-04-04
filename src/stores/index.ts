/**
 * Store barrel export — single import point for all Zustand stores.
 *
 * Usage:
 *   import { useThemeStore, useWalletStore, useUiStore } from "~/stores";
 */

export { useThemeStore } from "./theme";
export { useWalletStore } from "./wallet";
export type { WalletOption } from "./wallet";
export { useUiStore } from "./ui";
export { useEditorStore } from "./editor";
export type { SignerDef } from "./editor";
export { useSigningStore } from "./signing";
export { useDashboardStore, filterDocuments } from "./dashboard";
