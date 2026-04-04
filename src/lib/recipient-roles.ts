export type RecipientRole = "SIGNER" | "APPROVER" | "CC" | "WITNESS" | "OBSERVER";

export const ACTIONABLE_RECIPIENT_ROLES: RecipientRole[] = ["SIGNER", "APPROVER", "WITNESS"];
export const VIEW_ONLY_RECIPIENT_ROLES: RecipientRole[] = ["CC", "OBSERVER"];

export function isActionableRecipientRole(role: RecipientRole | string | null | undefined): role is RecipientRole {
  return ACTIONABLE_RECIPIENT_ROLES.includes((role ?? "SIGNER") as RecipientRole);
}

export function isApprovalRecipientRole(role: RecipientRole | string | null | undefined): boolean {
  return (role ?? "SIGNER") === "APPROVER";
}

export function isViewOnlyRecipientRole(role: RecipientRole | string | null | undefined): boolean {
  return VIEW_ONLY_RECIPIENT_ROLES.includes((role ?? "SIGNER") as RecipientRole);
}

export function getRecipientActionLabel(role: RecipientRole | string | null | undefined): string {
  switch (role) {
    case "APPROVER":
      return "Approve";
    case "WITNESS":
      return "Witness";
    default:
      return "Sign";
  }
}

export function getRecipientCompletedLabel(role: RecipientRole | string | null | undefined): string {
  switch (role) {
    case "APPROVER":
      return "Approved";
    case "WITNESS":
      return "Witnessed";
    case "CC":
    case "OBSERVER":
      return "Viewed";
    default:
      return "Signed";
  }
}
