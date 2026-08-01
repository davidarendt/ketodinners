// Weight tracker — skeleton app. Validates the full stack (PIN -> function ->
// Supabase -> PWA). The UI is intentionally minimal; real layout comes next.
(function () {
  var PIN_KEY = 'weightPin';
  var pin = null;
  try { pin = localStorage.getItem(PIN_KEY); } catch (e) {}

  var els = {
    lock: document.getElementById('lockScreen'),
    main: document.getElementById('mainScreen'),
    pinInput: document.getElementById('pinInput'),
    pinBtn: document.getElementById('pinBtn'),
    pinError: document.getElementById('pinError'),
    lockBtn: document.getElementById('lockBtn'),
    latest: document.getElementById('latest'),
    addForm: document.getElementById('addForm'),
    weightInput: document.getElementById('weightInput'),
    list: document.getElementById('entryList'),
    status: document.getElementById('statusMsg'),
  };

  // ---- API ----
  function api(method, opts) {
    opts = opts || {};
    var headers = { 'x-weight-pin': pin || '' };
    var init = { method: method, headers: headers };
    if (opts.body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    var url = '/api/weight-entries' + (opts.query || '');
    return fetch(url, init).then(function (r) {
      if (r.status === 401) { throw { code: 401 }; }
      if (!r.ok) { return r.json().catch(function () { return {}; }).then(function (j) { throw { code: r.status, message: j.error }; }); }
      return r.json();
    });
  }

  // ---- Screens ----
  function showLock(err) {
    els.main.hidden = true;
    els.lock.hidden = false;
    els.pinError.hidden = !err;
    setTimeout(function () { els.pinInput && els.pinInput.focus(); }, 50);
  }
  function showMain() {
    els.lock.hidden = true;
    els.main.hidden = false;
    loadEntries();
  }

  function tryUnlock(candidate) {
    pin = candidate;
    els.pinBtn.disabled = true;
    // GET doubles as PIN verification.
    api('GET', { query: '?limit=1' }).then(function () {
      try { localStorage.setItem(PIN_KEY, pin); } catch (e) {}
      els.pinBtn.disabled = false;
      showMain();
    }).catch(function (e) {
      els.pinBtn.disabled = false;
      pin = null;
      try { localStorage.removeItem(PIN_KEY); } catch (er) {}
      if (e && e.code === 401) showLock(true);
      else { els.pinError.hidden = false; els.pinError.textContent = (e && e.message) || 'Could not reach server.'; els.lock.hidden = false; els.main.hidden = true; }
    });
  }

  // ---- Data / render ----
  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' +
           d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function renderLatest(entries) {
    if (!entries.length) {
      els.latest.innerHTML = '<div class="latest-card"><div class="latest-empty">No entries yet — add your first weight below.</div></div>';
      return;
    }
    var e = entries[0];
    var delta = '';
    if (entries.length > 1) {
      var diff = e.weight - entries[1].weight;
      var sign = diff > 0 ? '+' : '';
      delta = ' · ' + sign + diff.toFixed(1) + ' ' + e.unit + ' vs last';
    }
    els.latest.innerHTML =
      '<div class="latest-card">' +
        '<div><span class="latest-value">' + e.weight + '</span><span class="latest-unit">' + e.unit + '</span></div>' +
        '<div class="latest-meta">' + fmtDate(e.measuredAt) + delta + '</div>' +
      '</div>';
  }

  function renderList(entries) {
    els.list.innerHTML = '';
    entries.forEach(function (e) {
      var row = document.createElement('div');
      row.className = 'entry';
      row.innerHTML =
        '<span class="entry-w">' + e.weight + ' <span style="color:var(--muted);font-weight:400">' + e.unit + '</span></span>' +
        '<span class="entry-date">' + fmtDate(e.measuredAt) + '</span>' +
        '<button class="entry-del" title="Delete">✕</button>';
      row.querySelector('.entry-del').addEventListener('click', function () { removeEntry(e.id); });
      els.list.appendChild(row);
    });
  }

  function loadEntries() {
    els.status.textContent = 'Loading…';
    api('GET', { query: '?limit=200' }).then(function (data) {
      var entries = data.entries || [];
      renderLatest(entries);
      renderList(entries);
      els.status.textContent = entries.length ? '' : '';
    }).catch(handleErr);
  }

  function addEntry(weight) {
    els.status.textContent = 'Saving…';
    api('POST', { body: { weight: weight, unit: 'lb', source: 'manual' } }).then(function () {
      els.weightInput.value = '';
      loadEntries();
    }).catch(handleErr);
  }

  function removeEntry(id) {
    api('DELETE', { query: '?id=' + encodeURIComponent(id) }).then(loadEntries).catch(handleErr);
  }

  function handleErr(e) {
    if (e && e.code === 401) { pin = null; try { localStorage.removeItem(PIN_KEY); } catch (er) {} showLock(true); return; }
    els.status.textContent = (e && e.message) || 'Something went wrong.';
  }

  // ---- Events ----
  els.pinBtn.addEventListener('click', function () {
    var v = (els.pinInput.value || '').trim();
    if (v) tryUnlock(v);
  });
  els.pinInput.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { var v = (els.pinInput.value || '').trim(); if (v) tryUnlock(v); }
  });
  els.lockBtn.addEventListener('click', function () {
    pin = null; try { localStorage.removeItem(PIN_KEY); } catch (e) {}
    els.pinInput.value = '';
    showLock(false);
  });
  els.addForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var w = parseFloat(els.weightInput.value);
    if (!isNaN(w) && w > 0) addEntry(w);
  });

  // ---- Boot ----
  if (pin) tryUnlock(pin);
  else showLock(false);
})();
