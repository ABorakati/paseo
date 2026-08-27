import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UsageLimitsSnapshot } from "@getpaseo/protocol/usage-limits/types";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

export function usageLimitsQueryKey(serverId: string | null) {
  return ["usage-limits", serverId] as const;
}

interface UseUsageLimitsResult {
  snapshot: UsageLimitsSnapshot | null;
  isLoading: boolean;
  isUnsupported: boolean;
  refresh: (pluginId?: string) => Promise<void>;
}

export function useUsageLimits(serverId: string | null): UseUsageLimitsResult {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supportsUsageLimits = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.usageLimits === true,
  );
  const queryKey = useMemo(() => usageLimitsQueryKey(serverId), [serverId]);

  const snapshotQuery = useQuery({
    queryKey,
    enabled: Boolean(supportsUsageLimits && serverId && client && isConnected),
    staleTime: 60_000,
    queryFn: async () => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      const result = await client.getUsageLimitsSnapshot();
      return result.snapshot;
    },
  });

  const refresh = useCallback(
    async (pluginId?: string) => {
      if (!client) {
        return;
      }
      const result = await client.refreshUsageLimits(pluginId ? { pluginId } : {});
      queryClient.setQueryData(queryKey, result.snapshot);
    },
    [client, queryClient, queryKey],
  );

  return {
    snapshot: snapshotQuery.data ?? null,
    isLoading: snapshotQuery.isLoading,
    isUnsupported: !supportsUsageLimits,
    refresh,
  };
}
