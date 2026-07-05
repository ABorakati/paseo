import { describe, expect, it, vi } from "vitest";
import { createTrailAnchorStore } from "./message-trail-anchor";

describe("createTrailAnchorStore", () => {
  it("starts with an empty snapshot", () => {
    const store = createTrailAnchorStore();

    expect(store.getSnapshot()).toEqual({ currentId: null, visibleIds: [] });
  });

  it("publishes a new snapshot and notifies listeners", () => {
    const store = createTrailAnchorStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.publish({ currentId: "u1", visibleIds: ["u1", "u2"] });

    expect(store.getSnapshot()).toEqual({ currentId: "u1", visibleIds: ["u1", "u2"] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ currentId: "u1", visibleIds: ["u1", "u2"] });
  });

  it("does not notify when publishing an identical snapshot", () => {
    const store = createTrailAnchorStore();
    store.publish({ currentId: "u1", visibleIds: ["u1", "u2"] });

    const listener = vi.fn();
    store.subscribe(listener);

    store.publish({ currentId: "u1", visibleIds: ["u1", "u2"] });

    expect(listener).not.toHaveBeenCalled();
  });

  it("treats visibleIds with a different order as a different snapshot", () => {
    const store = createTrailAnchorStore();
    store.publish({ currentId: "u1", visibleIds: ["u1", "u2"] });

    const listener = vi.fn();
    store.subscribe(listener);

    store.publish({ currentId: "u1", visibleIds: ["u2", "u1"] });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify when publishing the initial empty snapshot again", () => {
    const store = createTrailAnchorStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.publish({ currentId: null, visibleIds: [] });

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const store = createTrailAnchorStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.publish({ currentId: "u1", visibleIds: ["u1"] });

    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies multiple subscribed listeners independently", () => {
    const store = createTrailAnchorStore();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    store.subscribe(listenerA);
    const unsubscribeB = store.subscribe(listenerB);

    store.publish({ currentId: "u1", visibleIds: ["u1"] });
    unsubscribeB();
    store.publish({ currentId: "u2", visibleIds: ["u1", "u2"] });

    expect(listenerA).toHaveBeenCalledTimes(2);
    expect(listenerB).toHaveBeenCalledTimes(1);
  });
});
