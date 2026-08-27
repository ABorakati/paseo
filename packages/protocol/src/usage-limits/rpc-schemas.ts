import { z } from "zod";
import { UsageLimitsSnapshotSchema } from "./types.js";

export const UsageLimitsGetSnapshotRequestSchema = z.object({
  type: z.literal("usage.limits.get_snapshot.request"),
  requestId: z.string(),
});

export const UsageLimitsRefreshRequestSchema = z.object({
  type: z.literal("usage.limits.refresh.request"),
  requestId: z.string(),
  /** Refresh a single plugin; omit to refresh every enabled plugin. */
  pluginId: z.string().optional(),
});

const UsageLimitsResponsePayloadSchema = z.object({
  requestId: z.string(),
  snapshot: UsageLimitsSnapshotSchema,
});

export const UsageLimitsGetSnapshotResponseSchema = z.object({
  type: z.literal("usage.limits.get_snapshot.response"),
  payload: UsageLimitsResponsePayloadSchema,
});

export const UsageLimitsRefreshResponseSchema = z.object({
  type: z.literal("usage.limits.refresh.response"),
  payload: UsageLimitsResponsePayloadSchema,
});

export type UsageLimitsGetSnapshotRequest = z.infer<typeof UsageLimitsGetSnapshotRequestSchema>;
export type UsageLimitsGetSnapshotResponse = z.infer<typeof UsageLimitsGetSnapshotResponseSchema>;
export type UsageLimitsRefreshRequest = z.infer<typeof UsageLimitsRefreshRequestSchema>;
export type UsageLimitsRefreshResponse = z.infer<typeof UsageLimitsRefreshResponseSchema>;
