import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountOwnerId,
  isolateBrowserSession,
  readPersistedShelf,
  reconcilePersistedShelf,
  shelfStorageKey,
  useHistoryStore,
  writePersistedShelf,
} from "./history-store.ts";
import { mediaCacheOwner } from "./media-cache.ts";

const clip = {
  title: "Clip",
  author: "A",
  thumbnail: "",
  duration: 12,
  url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  lastItag: 137,
  lastPreset: "Full HD",
  lastExt: "mp4",
};

test("account owner ids are unique per person and never share the guest shelf", () => {
  assert.equal(accountOwnerId(null), "guest");
  assert.equal(accountOwnerId(undefined), "guest");
  assert.equal(accountOwnerId("user-a"), "u:user-a");
  assert.notEqual(accountOwnerId("user-a"), accountOwnerId("user-b"));
  assert.notEqual(accountOwnerId("user-a"), accountOwnerId(null));
});

test("Recent is isolated per login — memory holds only the current person", () => {
  useHistoryStore.getState().adoptOwner("u:alice");
  useHistoryStore.getState().clear();
  useHistoryStore.getState().record({ ...clip, id: "vid-alice", title: "Alice only" });
  assert.equal(useHistoryStore.getState().items[0]?.id, "vid-alice");
  assert.deepEqual(Object.keys(useHistoryStore.getState().shelves), ["u:alice"]);

  useHistoryStore.getState().adoptOwner("u:bob");
  assert.equal(useHistoryStore.getState().items.length, 0);
  assert.deepEqual(Object.keys(useHistoryStore.getState().shelves), ["u:bob"]);
  useHistoryStore.getState().record({ ...clip, id: "vid-bob", title: "Bob only", lastItag: 18 });
  assert.equal(useHistoryStore.getState().items[0]?.id, "vid-bob");

  useHistoryStore.getState().adoptOwner("u:alice");
  assert.equal(useHistoryStore.getState().items.length, 1);
  assert.equal(useHistoryStore.getState().items[0]?.id, "vid-alice");
  assert.equal(readPersistedShelf("u:bob").items[0]?.id, "vid-bob");
  assert.equal(shelfStorageKey("u:alice"), "velo-history:u:alice");
});

test("isolateBrowserSession binds media copies to that login", () => {
  isolateBrowserSession("u:alice");
  assert.equal(mediaCacheOwner(), "u:alice");
  isolateBrowserSession("guest");
  assert.equal(mediaCacheOwner(), "guest");
});

test("another tab's shelf write is replayed by the storage listener, not clobbered", () => {
  useHistoryStore.getState().adoptOwner("u:carol");
  useHistoryStore.getState().clear();
  useHistoryStore.getState().record({ ...clip, id: "vid-1", title: "First" });

  // "Other tab": persists a second item on the same shelf, bypassing this
  // tab's in-memory state — exactly what a concurrent tab's write looks like.
  const persisted = readPersistedShelf("u:carol");
  writePersistedShelf("u:carol", {
    ...persisted,
    items: [{ ...clip, id: "vid-2", title: "Second", downloadedAt: Date.now() }, ...persisted.items],
  });
  assert.equal(useHistoryStore.getState().items.length, 1, "in-memory is stale until the event replays");

  // Events for other owners' shelves (or unrelated keys) are ignored.
  reconcilePersistedShelf(shelfStorageKey("u:someone-else"));
  reconcilePersistedShelf(null);
  assert.equal(useHistoryStore.getState().items.length, 1);

  // The storage event for the active shelf key pulls the other tab's write in.
  reconcilePersistedShelf(shelfStorageKey("u:carol"));
  assert.deepEqual(
    useHistoryStore.getState().items.map((item) => item.id),
    ["vid-2", "vid-1"],
  );
});

test("mutations build on the persisted shelf, so concurrent tabs stay additive", () => {
  useHistoryStore.getState().adoptOwner("u:dave");
  useHistoryStore.getState().clear();
  useHistoryStore.getState().record({ ...clip, id: "vid-a" });

  // Another tab records vid-b; this tab's storage-event replay has NOT run yet.
  const persisted = readPersistedShelf("u:dave");
  writePersistedShelf("u:dave", {
    ...persisted,
    items: [{ ...clip, id: "vid-b", downloadedAt: Date.now() }, ...persisted.items],
  });

  // Recording here used to base the write on the stale in-memory [vid-a] and
  // erase vid-b. It must land on top of the freshest persisted shelf instead.
  useHistoryStore.getState().record({ ...clip, id: "vid-c" });
  assert.deepEqual(
    readPersistedShelf("u:dave").items.map((item) => item.id),
    ["vid-c", "vid-b", "vid-a"],
  );
  assert.deepEqual(
    useHistoryStore.getState().items.map((item) => item.id),
    ["vid-c", "vid-b", "vid-a"],
  );

  // remove also reconciles before rewriting the shelf.
  useHistoryStore.getState().remove("vid-b");
  assert.deepEqual(
    readPersistedShelf("u:dave").items.map((item) => item.id),
    ["vid-c", "vid-a"],
  );
});
