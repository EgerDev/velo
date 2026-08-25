import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountOwnerId,
  isolateBrowserSession,
  readPersistedShelf,
  shelfStorageKey,
  useHistoryStore,
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
