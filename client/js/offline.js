/* ================================================================
   RAKSHA — offline.js (shared, loaded AFTER each page's main script)
   ----------------------------------------------------------------
   Real offline layer:
   • IndexedDB database "rakshaDB" with 9 stores:
     community · foodInventory · resources · scenarios · safetyRules ·
     simulationResults · actionPlans · syncQueue · metadata
   • Snapshot caching (read path) with legacy-name compatibility
   • OFFLINE MODE UI (pill, banner, gating, demo buttons)
   • Offline write queueing: applies changes to the local snapshot
     (optimistic) and enqueues them for sync — never pretends an API
     call succeeded.

   v1.1.5 updates:
   ★ FIX: Guaranteed merged snapshot management during offline CRUD.
   ★ FIX 1 — queue compaction for locally-created records.
   ★ FIX 2 — server-recovery poll.
   ★ FIX 3 — confirm dialog patch: <form method="dialog"> wrapper.
   ★ FIX 4 — persisted simulated-offline state (localStorage).
   ★ FIX 6 — db facade store-name mapping for sync_queue → syncQueue.
   ================================================================ */
(function () {
  'use strict';
  var R = window.RAKSHA = window.RAKSHA || {};
  R.version = '1.1.5-offline';

  var DB_NAME = 'rakshaDB';
  var DB_VERSION = 1;
  var STORES = ['community', 'foodInventory', 'resources', 'scenarios',
    'safetyRules', 'simulationResults', 'actionPlans', 'syncQueue', 'metadata'];

  var FORCED_KEY = 'raksha.forcedOffline';

  /* Legacy snapshot names (used by the pages' API layers) → new stores */
  var SNAPSHOT_MAP = {
    community:   { store: 'community',        key: 'current'  },
    summary:     { store: 'community',        key: 'snapshot' },
    inventory:   { store: 'foodInventory',    key: 'snapshot' },
    resources:   { store: 'resources',        key: 'snapshot' },
    scenarios:   { store: 'scenarios',        key: 'snapshot' },
    rules:       { store: 'safetyRules',      key: 'snapshot' },
    latestRun:   { store: 'simulationResults', key: 'latest'  },
    latestPlan:  { store: 'actionPlans',      key: 'latest'   }
  };

  /* Persistent device identity for the sync queue */
  var deviceId = null;
  try {
    deviceId = localStorage.getItem('raksha.deviceId');
    if (!deviceId) {
      deviceId = 'device-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('raksha.deviceId', deviceId);
    }
  } catch (e) { deviceId = 'device-unknown'; }

  /* ---------------- IndexedDB ---------------- */
  function openDB() {
    if (off._dbPromise) return off._dbPromise;
    off._dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB not available')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        STORES.forEach(function (s) {
          if (!db.objectStoreNames.contains(s)) {
            if (s === 'syncQueue') db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
            else db.createObjectStore(s, { keyPath: 'key' });
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return off._dbPromise;
  }

  function tx(store, mode, op) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var req = op(t.objectStore(store));
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function rawGet(store, key)      { return tx(store, 'readonly',  function (s) { return s.get(key); }); }
  function rawPut(store, rec)      { return tx(store, 'readwrite', function (s) { return s.put(rec); }); }
  function rawAdd(store, rec)      { return tx(store, 'readwrite', function (s) { return s.add(rec); }); }
  function rawGetAll(store)        { return tx(store, 'readonly',  function (s) { return s.getAll(); }); }
  function rawDelete(store, key)   { return tx(store, 'readwrite', function (s) { return s['delete'](key); }); }

  /* ---------------- compatibility facade + offline state ---------------- */
  var forcedStored = false;
  try { forcedStored = localStorage.getItem(FORCED_KEY) === 'true'; } catch (e) { /* ignore */ }

  var off = {
    forced: forcedStored,
    _dbPromise: null,
    deviceId: deviceId,
    isOnline: function () { return navigator.onLine && !off.forced; },
    setForced: function (v) {
      off.forced = !!v;
      try { localStorage.setItem(FORCED_KEY, String(off.forced)); } catch (e) { /* ignore */ }
      offlineUpdate();
    },
    db: {
      get: function (store, key) {
        if (store === 'plan_notes') return rawGet('metadata', 'notes:' + key);
        if (store === 'offline_plans') return rawGet('actionPlans', key);
        if (store === 'sync_queue') return rawGet('syncQueue', Number(key));
        return rawGet(store, key);
      },
      put: function (store, rec) {
        if (store === 'plan_notes') return rawPut('metadata', Object.assign({ key: 'notes:' + rec.planId }, rec));
        if (store === 'offline_plans') return rawPut('actionPlans', Object.assign({ key: rec.runId }, rec));
        if (store === 'sync_queue') return rawPut('syncQueue', rec);
        return rawPut(store, rec);
      },
      add: function (store, rec) {
        if (store === 'sync_queue') return rawAdd('syncQueue', rec);
        return rawAdd(store, rec);
      },
      getAll: function (store) {
        if (store === 'offline_plans') {
          return rawGetAll('actionPlans').then(function (all) {
            return all.filter(function (r) { return r.runId && r.plan; });
          });
        }
        if (store === 'sync_queue') return rawGetAll('syncQueue');
        return rawGetAll(store);
      },
      delete: function (store, key) {
        if (store === 'offline_plans') return rawDelete('actionPlans', key);
        if (store === 'sync_queue') return rawDelete('syncQueue', Number(key));
        return rawDelete(store, key);
      }
    }
  };
  R.offline = off;

  /* ---------------- snapshots (read path) ---------------- */
  off.cacheSnapshot = function (name, data) {
    var m = SNAPSHOT_MAP[name] || { store: 'metadata', key: 'snap-' + name };
    return rawPut(m.store, { key: m.key, data: data, cachedAt: new Date().toISOString() })
      .catch(function (e) { console.warn('[RAKSHA] snapshot write failed:', name, e); });
  };

  off.loadSnapshot = function (name) {
    var m = SNAPSHOT_MAP[name] || { store: 'metadata', key: 'snap-' + name };
    return rawGet(m.store, m.key).then(function (rec) { return rec ? rec.data : null; })
      .catch(function () { return null; });
  };

  off.getSnapshotRecord = function (store, key) { return rawGet(store, key); };

  /* ---------------- offline write queue ---------------- */
  var COLLECTION_STORE = { food_items: 'foodInventory', resources: 'resources' };

  function mutateSnapshot(store, mutator) {
    return rawGet(store, 'snapshot').then(function (rec) {
      var list = (rec && Array.isArray(rec.data)) ? rec.data : [];
      var result = mutator(list);
      return rawPut(store, { key: 'snapshot', data: list, cachedAt: new Date().toISOString() })
        .then(function () { return result; });
    });
  }

  off.writeQueued = function (collection, operation, recordId, payload) {
    var store = COLLECTION_STORE[collection];
    if (!store) return Promise.reject(new Error('Offline writes not supported for ' + collection));

    /* Queue compaction for locally-created records */
    if (recordId && String(recordId).indexOf('local-') === 0 && operation !== 'create') {
      return rawGetAll('syncQueue').then(function (entries) {
        var create = entries.filter(function (e) {
          return e.collection === collection && e.operation === 'create' &&
                 e.status === 'pending' && e.recordId === recordId;
        })[0];

        var queueOp = (create && operation === 'update')
          ? rawPut('syncQueue', Object.assign({}, create, {
              payload: Object.assign({}, create.payload, payload)
            }))
          : (create && operation === 'delete')
            ? rawDelete('syncQueue', create.id)
            : Promise.resolve();

        return queueOp.then(function () {
          return mutateSnapshot(store, function (list) {
            if (operation === 'update') {
              var it = list.filter(function (x) { return x.id === recordId; })[0];
              if (it) Object.assign(it, payload, { id: recordId });
              return it;
            }
            var idx = list.findIndex(function (x) { return x.id === recordId; });
            if (idx !== -1) list.splice(idx, 1);
            return { ok: true, deleted: recordId };
          });
        });
      }).then(function (applied) {
        R.dispatch('ra:sync-queue', {});
        return applied;
      });
    }

    var baseUpdatedAt = null;

    return rawGet(store, 'snapshot').then(function (rec) {
      var list = (rec && Array.isArray(rec.data)) ? rec.data : [];
      if (operation !== 'create' && recordId != null) {
        var cur = list.filter(function (x) { return x.id === recordId; })[0];
        if (cur) baseUpdatedAt = cur.updatedAt || null;
      }
      return list;
    }).then(function (existingList) {
      var localId = recordId;

      function applyLocal() {
        var list = existingList;
        if (operation === 'create') {
          localId = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          var item = Object.assign({}, payload, { id: localId });
          list.push(item);
          return item;
        }
        if (operation === 'update') {
          var it = list.filter(function (x) { return x.id === recordId; })[0];
          if (!it) return null;
          Object.assign(it, payload, { id: recordId });
          return it;
        }
        var idx = list.findIndex(function (x) { return x.id === recordId; });
        if (idx !== -1) list.splice(idx, 1);
        return { ok: true, deleted: recordId };
      }

      var applied = applyLocal();
      
      return rawPut(store, { key: 'snapshot', data: existingList, cachedAt: new Date().toISOString() })
        .then(function () {
          return rawAdd('syncQueue', {
            deviceId: deviceId,
            collection: collection,
            operation: operation,
            recordId: (operation === 'create') ? localId : recordId,
            payload: payload,
            baseUpdatedAt: baseUpdatedAt,
            status: 'pending',
            queuedAt: new Date().toISOString()
          });
        }).then(function () {
          R.dispatch('ra:sync-queue', {});
          return applied;
        });
    });
  };

  off.applyServerDoc = function (collection, recordId, serverDoc) {
    var store = COLLECTION_STORE[collection];
    if (!store) return Promise.resolve();
    return mutateSnapshot(store, function (list) {
      var it = list.filter(function (x) { return x.id === recordId; })[0];
      if (it) {
        ['name', 'quantity', 'unit', 'category', 'storageType', 'status', 'priority'].forEach(function (k) {
          if (serverDoc[k] !== undefined) it[k] = serverDoc[k];
        });
        it.updatedAt = serverDoc.updatedAt || new Date().toISOString();
      }
    });
  };

  /* ---------------- connectivity UI ---------------- */
  var lastGateToast = 0;

  function say(msg, type) {
    if (R.ui && R.ui.toast) { R.ui.toast(msg, type); return; }
    console.log('[RAKSHA]', msg);
  }

  function pill() {
    var p = document.getElementById('ra-conn-pill');
    var label = document.getElementById('ra-conn-label');
    if (!p || !label) return;
    var online = off.isOnline();
    p.classList.toggle('on', online);
    p.classList.toggle('off', !online);
    label.textContent = online ? 'ONLINE' : 'OFFLINE MODE';
    p.title = online
      ? 'Connected — live operations available.'
      : (off.forced
        ? 'Simulated internet loss (demo). Cached data is being used; changes are queued for sync.'
        : 'No internet connection. Cached data remains available; changes are queued for sync.');
    var tag = p.querySelector('.sim-tag');
    if (!online && off.forced && !tag) {
      tag = document.createElement('em');
      tag.className = 'sim-tag'; tag.textContent = 'SIMULATED';
      p.appendChild(tag);
    } else if (tag && (online || !off.forced)) { tag.remove(); }
  }

  function banner() {
    var main = document.getElementById('main');
    if (!main) return;
    var b = document.getElementById('ra-offline-banner');
    if (!off.isOnline()) {
      if (!b) {
        b = document.createElement('div');
        b.id = 'ra-offline-banner'; b.className = 'offline-banner';
        b.setAttribute('role', 'status');
        b.innerHTML =
          '<p><strong>OFFLINE MODE.</strong> You are viewing cached data stored on this device.</p>' +
          '<p class="ob-list"><span>Still available:</span> community data, inventory &amp; resource snapshots, ' +
          'latest simulation (local calculation), emergency action plan, offline food edits, local notes. ' +
          '<span>Needs a connection:</span> resource edits, optimization, plan generation, synchronisation.</p>';
        main.prepend(b);
      }
    } else if (b) { b.remove(); }
  }

  off.applyGate = function () {
    var online = off.isOnline();
    document.querySelectorAll('[data-requires-online]').forEach(function (el) {
      if (!online) { el.classList.add('is-gated'); el.setAttribute('aria-disabled', 'true'); }
      else { el.classList.remove('is-gated'); el.removeAttribute('aria-disabled'); }
    });
  };

  document.addEventListener('click', function (e) {
    if (off.isOnline()) return;
    var el = e.target.closest ? e.target.closest('[data-requires-online]') : null;
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    var now = Date.now();
    if (now - lastGateToast > 2500) {
      lastGateToast = now;
      say('This operation needs the server and is unavailable offline. Food inventory edits and local simulations still work — they are queued for sync.', 'warn');
    }
  }, true);

  function updateSimButtons() {
    document.querySelectorAll('[data-ra-force-offline]').forEach(function (btn) {
      btn.classList.toggle('active', off.forced);
      btn.textContent = off.forced ? 'Restore Connection' : 'Simulate Internet Loss';
    });
  }

  function offlineUpdate() {
    pill(); banner(); off.applyGate(); updateSimButtons();
    document.body.classList.toggle('ra-offline', !off.isOnline());
    R.dispatch('ra:connectivity', { online: off.isOnline(), simulated: off.forced });
  }

  window.addEventListener('online', offlineUpdate);
  window.addEventListener('offline', offlineUpdate);

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-ra-force-offline]') : null;
    if (!btn) return;
    var was = off.forced;
    off.setForced(!off.forced);
    if (!was && off.forced) {
      say('Internet loss simulated — OFFLINE MODE. Cached data in use; food edits and local simulations are queued for sync.', 'warn');
    } else if (was && !off.forced) {
      say('Connection restored — checking the sync queue…', 'success');
    }
  });

  /* ---------------- injected styles ---------------- */
  (function injectStyles() {
    var css = document.createElement('style');
    css.textContent =
      '.ra-pending-chip{display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:2px 9px;' +
        'border-radius:999px;background:#FBEFDD;border:1px solid #E7CFA9;color:#9A5B00;' +
        'font-size:10px;font-weight:700;letter-spacing:.05em;white-space:nowrap;}' +
      '.ra-pending-chip::before{content:"⏳";font-size:10px;}' +
      '.ra-offline-calc-note{background:#EAF2F0;border:1px solid #BFD8D1;color:#0B5E53;' +
        'border-radius:10px;padding:10px 14px;font-size:12.5px;margin-bottom:14px;}';
    document.head.appendChild(css);
  })();

  /* Confirm dialog patch */
  (function patchConfirmDialog() {
    var existing = document.getElementById('ra-confirm');
    if (existing) {
      existing.remove();
    }

    var d = document.createElement('dialog');
    d.id = 'ra-confirm';
    d.className = 'modal modal-sm';
    d.innerHTML =
      '<h2 class="confirm-title" id="ra-confirm-title"></h2>' +
      '<p class="confirm-msg" id="ra-confirm-msg"></p>' +
      '<form method="dialog" class="modal-actions">' +
        '<button type="submit" value="cancel" class="btn">Cancel</button>' +
        '<button type="submit" value="confirm" id="ra-confirm-ok" class="btn btn-danger">Confirm</button>' +
      '</form>';
    document.body.appendChild(d);
  })();

  /* Server-recovery poll */
  setInterval(function () {
    if (!navigator.onLine || off.forced) return;
    if (!R.api || R.api.mode === 'live') return;
    fetch('api/health').then(function (res) {
      if (!res.ok) return;
      R.api.mode = 'live';
      R.dispatch('ra:apimode', { mode: 'live' });
      R.dispatch('ra:connectivity', { online: true, recovered: true });
      say('Connection to the RAKSHA server restored — LIVE DATA resumed. Reload the page to fetch fresh server data.', 'success');
    }).catch(function () { /* still down; keep polling */ });
  }, 15000);

  /* Run once at load. */
  offlineUpdate();
  if (typeof R.onReady === 'function') {
    R.onReady(function () { offlineUpdate(); });
  }
})();