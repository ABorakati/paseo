export interface TrailAnchorSnapshot {
  currentId: string | null;
  visibleIds: readonly string[];
}

export interface TrailAnchorStore {
  publish(next: TrailAnchorSnapshot): void;
  getSnapshot(): TrailAnchorSnapshot;
  subscribe(listener: (s: TrailAnchorSnapshot) => void): () => void;
}

const INITIAL_SNAPSHOT: TrailAnchorSnapshot = { currentId: null, visibleIds: [] };

function isSameSnapshot(a: TrailAnchorSnapshot, b: TrailAnchorSnapshot): boolean {
  if (a.currentId !== b.currentId) {
    return false;
  }
  if (a.visibleIds.length !== b.visibleIds.length) {
    return false;
  }
  return a.visibleIds.every((id, index) => id === b.visibleIds[index]);
}

export function createTrailAnchorStore(): TrailAnchorStore {
  let snapshot: TrailAnchorSnapshot = INITIAL_SNAPSHOT;
  const listeners = new Set<(s: TrailAnchorSnapshot) => void>();

  return {
    publish(next) {
      if (isSameSnapshot(snapshot, next)) {
        return;
      }
      snapshot = next;
      for (const listener of listeners) {
        listener(snapshot);
      }
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
