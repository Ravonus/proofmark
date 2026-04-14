import { type NextRequest, NextResponse } from "next/server";
import {
  dismissMergeRequest,
  mergeCurrentIdentityAccounts,
  syncCurrentIdentityFromRequest,
} from "~/server/auth/auth-identity";

export const dynamic = "force-dynamic";

function getErrorStatus(message: string) {
  if (/required|missing|not signed in|not found/i.test(message)) return 401;
  if (/blocked|conflict|already/i.test(message)) return 409;
  return 400;
}

export async function GET(request: NextRequest) {
  const status = await syncCurrentIdentityFromRequest(request);
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  try {
    const result = await mergeCurrentIdentityAccounts(request);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to merge accounts";
    return NextResponse.json({ error: message }, { status: getErrorStatus(message) });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const status = await syncCurrentIdentityFromRequest(request);
    if (status.status === "merge-required" && status.authUser && status.mergeRequest) {
      await dismissMergeRequest({
        currentUserId: status.authUser.id,
        conflictingUserId: status.mergeRequest.conflictingUser.id,
        walletAddress: status.mergeRequest.wallet.address,
        walletChain: status.mergeRequest.wallet.chain,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to dismiss merge prompt";
    return NextResponse.json({ error: message }, { status: getErrorStatus(message) });
  }
}
