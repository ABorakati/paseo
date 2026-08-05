import { useCallback, useMemo } from "react";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { resolveFocusedChatTarget } from "./focused-chat-target";

/**
 * Appends a text snippet (e.g. a code selection from the diff viewer) to the
 * focused chat's composer and focuses that chat's tab. Mirrors the file-level
 * "add to chat" flow (attachWorkspaceFile) for plain text.
 */
export function useAddSnippetToChat(input: {
  serverId: string;
  workspaceId: string | null | undefined;
}): { addSnippetToChat: (snippet: string) => void; canAddToChat: boolean } {
  const workspaceKey = input.workspaceId
    ? buildWorkspaceTabPersistenceKey({ serverId: input.serverId, workspaceId: input.workspaceId })
    : null;
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? state.layoutByWorkspace[workspaceKey] : undefined,
  );
  const focusTab = useWorkspaceLayoutStore((state) => state.focusTab);
  const focusedChat = useMemo(
    () => resolveFocusedChatTarget({ serverId: input.serverId, layout }),
    [input.serverId, layout],
  );
  const addSnippetToChat = useCallback(
    (snippet: string) => {
      if (!focusedChat || !workspaceKey) {
        return;
      }
      const record = useDraftStore.getState().drafts[focusedChat.draftKey];
      const current = record?.input?.text ?? "";
      const text = current.trim().length > 0 ? `${current.trimEnd()}\n\n${snippet}` : snippet;
      useDraftStore.getState().saveDraftInput({
        draftKey: focusedChat.draftKey,
        draft: { text, attachments: record?.input?.attachments ?? [] },
      });
      focusTab(workspaceKey, focusedChat.tabId);
    },
    [focusTab, focusedChat, workspaceKey],
  );
  return { addSnippetToChat, canAddToChat: focusedChat !== null };
}
