/**
 * Conversation persistence — load/save AI chat threads to the aiConversations table.
 */

import { eq, and } from "drizzle-orm";
import { db } from "../../src/server/db";
import { aiConversations } from "../../src/server/db/schema";
import type { AiChatMessage } from "../../src/server/db/schema";

export interface AiConversationData {
  messages: AiChatMessage[];
  id: string | undefined;
}

/**
 * Load a conversation by ID. Returns empty messages if not found or no ID provided.
 */
export async function loadConversation(
  conversationId: string | undefined,
  ownerAddress: string,
): Promise<AiConversationData> {
  if (!conversationId) {
    return { messages: [], id: undefined };
  }

  const [conv] = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.ownerAddress, ownerAddress)))
    .limit(1);

  if (!conv) {
    return { messages: [], id: undefined };
  }

  return {
    messages: conv.messages ?? [],
    id: conv.id,
  };
}

/**
 * Save a conversation — creates new or updates existing.
 * Returns the conversation ID.
 */
export async function saveConversation(params: {
  conversationId: string | undefined;
  ownerAddress: string;
  documentId: string;
  feature: string;
  messages: AiChatMessage[];
  title: string;
}): Promise<string> {
  if (params.conversationId) {
    // Update existing
    await db
      .update(aiConversations)
      .set({
        messages: params.messages,
        title: params.title,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiConversations.id, params.conversationId),
          eq(aiConversations.ownerAddress, params.ownerAddress),
        ),
      );
    return params.conversationId;
  }

  // Create new
  const [created] = await db
    .insert(aiConversations)
    .values({
      ownerAddress: params.ownerAddress,
      documentId: params.documentId,
      feature: params.feature as "scraper_fix" | "editor_assistant" | "signer_qa" | "general",
      title: params.title,
      messages: params.messages,
    })
    .returning();

  return created!.id;
}
