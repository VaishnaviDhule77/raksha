/* ================================================================
   RAKSHA — sync.js (shared, loaded after offline.js)
   ----------------------------------------------------------------
   Sync engine:  IndexedDB syncQueue → POST /api/sync → MongoDB
                 → operation marked synced (entry removed).

   Conflict handling: if the server detects the record changed online
   after our offline edit (baseUpdatedAt), it returns status "conflict"
   with the server document. We NEVER silently overwrite: a dialog shows
   both versions and the coordinator chooses.

   v1.1.6 changes:
   ★ FIX 5 — listen for ra:sync-queue event (badge updates on queueing).
   ★ FIX 7 — updateBadge has a .catch() for visible console errors.
   ★ FIX 8 — flush() probes /api/health directly instead of trusting
     the stale cached R.api.mode.
   ★ FIX 9 — removed the self-dispatching R.dispatch('ra:sync-queue')
     from inside updateBadge(). This created an infinite event loop:
     updateBadge dispatched ra:sync-queue → the ra:sync-queue listener
     called updateBadge again → which dispatched again → hundreds of
     API requests and a page that constantly reloaded the table.
   ================================================================ */
(function () {
  'use strict';
  var R = window.RAKSHA;
  var off = R.offline;

  function esc(s) { return R.ui ? R.ui.esc(s) : String(s); }

  function req(method, path, body) {
    return fetch('api' + path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error((j && j.error) || ('Request failed (' + res.status + ')'));
        return j;
      });
    });
  }

  function queueGet(id)        { return off.db.get('sync_queue', id); }
  function queuePut(entry)     { return off.db.put('sync_queue', entry); }
  function queueDelete(id)     { return off.db.delete('sync_queue', id); }
  function queueAll()          { return off.db.getAll('sync_queue'); }

  var sync = {
    queueOp: function (op) {
      return off.db.add('sync_queue', {
        deviceId: off.deviceId,
        collection: op.collection,
        operation: op.operation,
        recordId: op.recordId || null,
        payload: op.payload || {},
        baseUpdatedAt: op.baseUpdatedAt || null,
        status: 'pending',
        queuedAt: new Date().toISOString()
      }).then(function () { return sync.updateBadge(); });
    },
    enqueue: function (type, payload) {
      var parts = String(type || '').split('.');
      return sync.queueOp({ collection: parts[0], operation: parts[1], payload: payload });
    },
    pendingEntries: function () {
      return queueAll().then(function (items) {
        return items.filter(function (i) { return i.status === 'pending'; });
      });
    },
    conflictEntries: function () {
      return queueAll().then(function (items) {
        return items.filter(function (i) { return i.status === 'conflict'; });
      });
    },
    pendingByCollection: function (collection) {
      return queueAll().then(function (items) {
        var map = {};
        items.forEach(function (i) {
          if (i.collection === collection && (i.status === 'pending' || i.status === 'conflict')) {
            map[i.recordId] = i;
          }
        });
        return map;
      }).catch(function () { return {}; });
    },
    /* ★ FIX 9: no R.dispatch() here — dispatching ra:sync-queue from
       inside updateBadge creates an infinite loop because the
       ra:sync-queue listener calls updateBadge again. offline.js
       dispatches the event when it queues a write; that's sufficient. */
    updateBadge: function () {
      return queueAll().then(function (items) {
        var pending = items.filter(function (i) { return i.status === 'pending'; }).length;
        var conflicts = items.filter(function (i) { return i.status === 'conflict'; }).length;
        var badge = document.getElementById('ra-sync-badge');
        if (!badge) return;
        badge.hidden = (pending + conflicts) === 0;
        badge.textContent = conflicts
          ? 'Sync · ' + pending + ' pending · ' + conflicts + ' conflict' + (conflicts > 1 ? 's' : '')
          : 'Sync · ' + pending + ' pending';
        badge.title = (pending + conflicts)
          ? (pending + ' queued change(s) waiting to sync' + (conflicts ? ' — ' + conflicts + ' conflict(s) need your decision' : '') + '. Click to sync now.')
          : 'All changes synchronised.';
      }).catch(function (err) {
        console.warn('[RAKSHA sync] Badge update failed:', err);
      });
    },
    /* ★ FIX 8: flush() probes /api/health directly. */
    flush: function (opts) {
      var silent = !!(opts && opts.silent);
      return sync.pendingEntries().then(function (pending) {
        if (!pending.length) {
          return sync.conflictEntries().then(function (conflicts) {
            if (conflicts.length) showNextConflict();
            else if (!silent && R.ui) R.ui.toast('Nothing to synchronise — the queue is empty.', 'info');
            return 0;
          });
        }
        if (!off.isOnline()) {
          if (R.ui) R.ui.toast('Still offline — ' + pending.length + ' change(s) remain queued.', 'warn');
          return 0;
        }

        return fetch('api/health').then(function (healthRes) {
          if (!healthRes.ok) {
            throw new Error('Server not responding');
          }
          if (R.api && R.api.mode !== 'live') {
            R.api.mode = 'live';
            R.dispatch('ra:apimode', { mode: 'live' });
          }

          showSyncPanel('Syncing ' + pending.length + ' change' + (pending.length > 1 ? 's' : '') + '…');

          var body = {
            items: pending.map(function (e) {
              return {
                deviceId: e.deviceId, operation: e.operation, collection: e.collection,
                recordId: e.recordId, payload: e.payload, baseUpdatedAt: e.baseUpdatedAt
              };
            })
          };

          return req('POST', '/sync', body).then(function (res) {
            var results = res.results || [];
            var applied = 0, conflicts = 0, failed = 0;
            var chain = Promise.resolve();
            pending.forEach(function (entry, i) {
              var r = results[i] || { status: 'failed', reason: 'no response' };
              chain = chain.then(function () {
                if (r.status === 'conflict') {
                  conflicts++;
                  entry.status = 'conflict';
                  entry.serverDoc = r.serverDoc || null;
                  return queuePut(entry);
                }
                if (r.status === 'failed') {
                  failed++;
                  return Promise.resolve();
                }
                applied++;
                return queueDelete(entry.id);
              });
            });
            return chain.then(function () {
              return sync.updateBadge();
            }).then(function () {
              updateSyncPanel('Synced ' + applied + ' change' + (applied === 1 ? '' : 's') +
                (conflicts ? ' · ' + conflicts + ' conflict' + (conflicts > 1 ? 's' : '') + ' need your decision' : '') +
                (failed ? ' · ' + failed + ' failed (will retry)' : ''), conflicts > 0);
              if (conflicts > 0) {
                if (R.ui) R.ui.toast(conflicts + ' record(s) were changed online while you were offline. Please review.', 'warn');
                showNextConflict();
              }
              return applied;
            });
          });
        }).catch(function (err) {
          if (err.message && err.message.indexOf('Server not') !== -1) {
            if (R.ui) R.ui.toast('Backend not connected — ' + pending.length + ' queued change(s) will sync when the RAKSHA server is reachable.', 'warn');
          } else {
            updateSyncPanel('Sync failed: ' + err.message, true);
            if (R.ui) R.ui.toast('Sync failed: ' + err.message, 'error');
          }
          return 0;
        });
      });
    },
    resolve: function (entryId, choice) {
      return queueGet(entryId).then(function (entry) {
        if (!entry) return;
        if (choice === 'mine') {
          var body = {
            deviceId: entry.deviceId, operation: entry.operation, collection: entry.collection,
            recordId: entry.recordId, payload: entry.payload,
            baseUpdatedAt: entry.baseUpdatedAt, force: true
          };
          return req('POST', '/sync', body).then(function (res) {
            var r = (res.results && res.results[0]) || {};
            if (r.status === 'failed') throw new Error(r.reason || 'apply failed');
            return queueDelete(entry.id);
          }).then(function () {
            if (R.ui) R.ui.toast('Your offline version was applied to the server.', 'success');
          });
        }
        var p = entry.serverDoc
          ? off.applyServerDoc(entry.collection, entry.recordId, entry.serverDoc)
          : Promise.resolve();
        return p.then(function () { return queueDelete(entry.id); })
          .then(function () {
            if (R.ui) R.ui.toast('Server version kept — your local copy was updated.', 'info');
          });
      }).catch(function (err) {
        if (R.ui) R.ui.toast('Could not resolve conflict: ' + err.message + ' (it stays in the queue.)', 'error');
      }).then(function () {
        return sync.updateBadge();
      }).then(function () {
        closeConflictModal();
        return sync.conflictEntries();
      }).then(function (remaining) {
        if (remaining.length) showNextConflict();
      });
    }
  };
  R.sync = sync;

  /* ---------------- sync status panel ---------------- */
  function showSyncPanel(text) {
    var p = document.getElementById('ra-sync-panel');
    if (!p) {
      p = document.createElement('div');
      p.id = 'ra-sync-panel';
      p.setAttribute('role', 'status');
      document.body.appendChild(p);
    }
    p.textContent = text;
    p.className = 'ra-sync-panel show';
  }
  function updateSyncPanel(text, hold) {
    var p = document.getElementById('ra-sync-panel');
    if (!p) return;
    p.textContent = text;
    if (!hold) setTimeout(function () { p.classList.remove('show'); }, 4200);
    else setTimeout(function () { p.classList.remove('show'); }, 8000);
  }

  /* ---------------- conflict modal ---------------- */
  var FIELDS = ['name', 'quantity', 'unit', 'category', 'storageType', 'status'];

  function showNextConflict() {
    sync.conflictEntries().then(function (entries) {
      if (!entries.length) return;
      openConflictModal(entries[0], entries.length - 1);
    });
  }

  function fieldRows(label, doc, payload) {
    var src = (label === 'server') ? doc : payload;
    return FIELDS.map(function (f) {
      var v = (src && src[f] !== undefined) ? src[f] : '—';
      return '<div class="ra-cf-row"><span>' + f + '</span><b>' + esc(v) + '</b></div>';
    }).join('');
  }

  function openConflictModal(entry, more) {
    closeConflictModal();
    var d = document.createElement('dialog');
    d.id = 'ra-conflict-modal';
    d.className = 'ra-conflict';
    var title = (entry.serverDoc && entry.serverDoc.name) || (entry.payload && entry.payload.name) || entry.recordId;
    d.innerHTML =
      '<h2>Sync conflict — ' + esc(title) + '</h2>' +
      '<p class="ra-cf-sub">This record was changed <strong>online</strong> after you edited it <strong>offline</strong>. ' +
      'RAKSHA will not overwrite either version silently — choose which one to keep.' +
      (more ? ' (' + more + ' more conflict' + (more > 1 ? 's' : '') + ' after this)' : '') + '</p>' +
      '<div class="ra-cf-cols">' +
        '<div class="ra-cf-col"><h3>Your offline version</h3>' + fieldRows('local', null, entry.payload) + '</div>' +
        '<div class="ra-cf-col"><h3>Current server version</h3>' + fieldRows('server', entry.serverDoc, null) + '</div>' +
      '</div>' +
      '<div class="ra-cf-actions">' +
        '<button type="button" class="btn" id="ra-cf-server">Use server version</button>' +
        '<button type="button" class="btn btn-primary" id="ra-cf-mine">Keep my offline version</button>' +
      '</div>';
    document.body.appendChild(d);
    d.querySelector('#ra-cf-mine').addEventListener('click', function () { sync.resolve(entry.id, 'mine'); });
    d.querySelector('#ra-cf-server').addEventListener('click', function () { sync.resolve(entry.id, 'server'); });
    d.showModal();
  }
  function closeConflictModal() {
    var d = document.getElementById('ra-conflict-modal');
    if (d) { try { d.close(); } catch (e) {} d.remove(); }
  }

  /* ---------------- styles + wiring ---------------- */
  (function injectStyles() {
    var css = document.createElement('style');
    css.textContent =
      '.ra-sync-panel{position:fixed;right:18px;bottom:76px;z-index:135;max-width:340px;background:#0F212B;color:#EDF3F6;' +
        'padding:11px 15px;border-radius:10px;border-left:3px solid #2FBFA8;font-size:13px;line-height:1.5;' +
        'box-shadow:0 14px 36px rgba(23,40,48,.35);opacity:0;pointer-events:none;transition:opacity .2s ease;}' +
      '.ra-sync-panel.show{opacity:1;}' +
      'dialog.ra-conflict{border:0;border-radius:14px;box-shadow:0 18px 50px rgba(23,40,48,.3);padding:0;' +
        'width:min(640px,calc(100vw - 32px));background:#FFFFFF;color:#182830;font-family:inherit;}' +
      'dialog.ra-conflict::backdrop{background:rgba(15,33,43,.55);}' +
      '.ra-conflict h2{font-family:inherit;font-size:17px;padding:18px 22px 4px;margin:0;}' +
      '.ra-cf-sub{padding:0 22px 12px;color:#5F7079;font-size:13px;}' +
      '.ra-cf-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:0 22px;}' +
      '.ra-cf-col{border:1px solid #E3DFD4;border-radius:10px;padding:12px 14px;background:#FAF8F2;}' +
      '.ra-cf-col h3{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#0E7568;margin:0 0 8px;}' +
      '.ra-cf-row{display:flex;justify-content:space-between;font-size:12.5px;padding:2.5px 0;color:#3D4E58;}' +
      '.ra-cf-row b{color:#182830;font-variant-numeric:tabular-nums;}' +
      '.ra-cf-actions{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px 18px;}' +
      '.ra-cf-actions .btn{font:600 13.5px inherit;padding:9px 16px;border-radius:9px;cursor:pointer;border:1px solid #CFC9BA;background:#fff;color:#182830;}' +
      '.ra-cf-actions .btn-primary{background:#0E7568;border-color:#0B5E53;color:#fff;}' +
      '@media (max-width:640px){.ra-cf-cols{grid-template-columns:1fr;}}';
    document.head.appendChild(css);
  })();

  /* Click the badge = manual "Sync now" (verbose) */
  document.addEventListener('click', function (e) {
    var badge = e.target.closest ? e.target.closest('#ra-sync-badge') : null;
    if (badge) sync.flush();
  });

  /* Initial badge update on page load */
  R.onReady(function () { sync.updateBadge(); });

  /* ★ FIX 5 — Listen for queue changes from offline.js. */
  window.addEventListener('ra:sync-queue', function () {
    sync.updateBadge();
  });

  /* Auto-sync when connectivity returns. */
  var flushTimer = null;
  window.addEventListener('ra:connectivity', function (e) {
    if (!(e.detail && e.detail.online)) return;
    var silent = !!(e.detail && e.detail.recovered);
    flushTimer = setTimeout(function () { sync.flush({ silent: silent }); }, 1200);
  });
})();