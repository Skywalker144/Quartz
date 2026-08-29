"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QuartzStorage = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  function createIndexedDBRecords(indexedDB) {
    let databasePromise = null;

    function open() {
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open("chatbox", 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("kv")) database.createObjectStore("kv");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return databasePromise;
    }

    return Object.freeze({
      get(key) {
        return open().then(database => new Promise((resolve, reject) => {
          const request = database.transaction("kv", "readonly").objectStore("kv").get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }));
      },
      set(key, value) {
        return open().then(database => new Promise((resolve, reject) => {
          const transaction = database.transaction("kv", "readwrite");
          transaction.objectStore("kv").put(value, key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        }));
      },
      delete(key) {
        return open().then(database => new Promise((resolve, reject) => {
          const transaction = database.transaction("kv", "readwrite");
          transaction.objectStore("kv").delete(key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        }));
      },
    });
  }

  function hash(value) {
    let result = 5381;
    for (let index = 0; index < value.length; index++) result = ((result << 5) + result + value.charCodeAt(index)) | 0;
    return result + ":" + value.length;
  }

  function metaOf(state) {
    const meta = Object.assign({}, state);
    meta.order = (state.conversations || []).map(conversation => conversation.id);
    meta.archivedOrder = (state.archived || []).map(conversation => conversation.id);
    delete meta.conversations;
    delete meta.archived;
    meta._split = 1;
    return meta;
  }

  function createStateStore(options) {
    const config = options || {};
    const records = config.records || createIndexedDBRecords(config.indexedDB);
    const localStorage = config.localStorage;
    let conversationHashes = Object.create(null);
    let metaHash = "";

    function warn(message, error) {
      if (config.onWarning) config.onWarning(message, error);
    }

    function readLocal(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
    }

    async function decryptLegacyKeys(state) {
      const providers = state && state.settings && state.settings.providers;
      if (!providers) return false;
      let converted = false;
      for (const key of Object.keys(providers)) {
        const secret = providers[key] && providers[key].key;
        if (typeof secret !== "string" || !secret.startsWith("qzenc1:")) continue;
        let plain = null;
        try { plain = config.decryptSecret ? await config.decryptSecret(secret.slice(7)) : null; } catch (_) {}
        providers[key].key = plain != null ? plain : "";
        converted = true;
      }
      return converted;
    }

    async function loadConversations(ids) {
      const conversations = [];
      for (const id of ids || []) {
        let conversation = null;
        try { conversation = await records.get("c:" + id); } catch (error) { warn("conversation read failed", error); }
        if (conversation && conversation.id) conversations.push(conversation);
      }
      return conversations;
    }

    async function persist(state) {
      try {
        const operations = [];
        const meta = metaOf(state);
        const nextMetaHash = JSON.stringify(meta);
        if (nextMetaHash !== metaHash) operations.push(records.set("meta", meta).then(() => { metaHash = nextMetaHash; }));
        const present = new Set();
        for (const conversation of (state.conversations || []).concat(state.archived || [])) {
          present.add(conversation.id);
          const nextHash = hash(JSON.stringify(conversation));
          if (conversationHashes[conversation.id] !== nextHash) operations.push(records.set("c:" + conversation.id, conversation).then(() => { conversationHashes[conversation.id] = nextHash; }));
        }
        for (const id of Object.keys(conversationHashes)) {
          if (present.has(id)) continue;
          operations.push(records.delete("c:" + id).catch(error => warn("conversation delete failed", error)));
          delete conversationHashes[id];
        }
        await Promise.all(operations);
        return true;
      } catch (error) {
        warn("split write failed", error);
        try {
          localStorage.setItem("chatbox_state_v2", JSON.stringify(state));
          return true;
        } catch (fallbackError) {
          warn("fallback write failed", fallbackError);
          return false;
        }
      }
    }

    async function load() {
      let meta = null;
      try { meta = await records.get("meta"); } catch (error) { warn("meta read failed", error); }
      if (meta && meta.settings && meta.settings.providers) {
        const conversations = await loadConversations(meta.order);
        const archived = await loadConversations(meta.archivedOrder);
        conversationHashes = Object.create(null);
        for (const conversation of conversations.concat(archived)) conversationHashes[conversation.id] = hash(JSON.stringify(conversation));
        metaHash = "";
        const state = Object.assign({}, meta, { conversations, archived });
        delete state.order;
        delete state.archivedOrder;
        delete state._split;
        const converted = await decryptLegacyKeys(state);
        const normalized = config.normalizeState(state);
        if (converted) await persist(normalized);
        return normalized;
      }
      let blob = null;
      try { blob = await records.get("state"); } catch (error) { warn("legacy record read failed", error); }
      if (!(blob && blob.settings && blob.settings.providers)) {
        const local = readLocal("chatbox_state_v2");
        if (local && local.settings && local.settings.providers) blob = local;
      }
      if (blob && blob.settings && blob.settings.providers) {
        await decryptLegacyKeys(blob);
        const normalized = config.normalizeState(blob);
        conversationHashes = Object.create(null);
        metaHash = "";
        await persist(normalized);
        return normalized;
      }
      const oldState = readLocal("chatbox_state_v1");
      if (oldState && oldState.settings) {
        const migrated = config.migrateLegacyState(oldState);
        conversationHashes = Object.create(null);
        metaHash = "";
        await persist(migrated);
        return migrated;
      }
      return config.freshState();
    }

    return Object.freeze({ load, persist });
  }

  return Object.freeze({ createStateStore });
});
