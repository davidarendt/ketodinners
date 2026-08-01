// The Almanac — weight tracker. Vanilla JS port of reference/dashboard.jsx,
// backed by our Supabase-scoped API with username+passcode accounts.
(function () {
  var API = '/api';
  var TOKEN_KEY = 'almanacToken';
  var SHOWALL_KEY = 'almanacShowAll';

  var token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}
  var user = null;
  var entries = [];      // [{ id, date:'YYYY-MM-DD', weight, source }]
  var win = 7;
  var showAll = false;
  try { showAll = localStorage.getItem(SHOWALL_KEY) === '1'; } catch (e) {}

  var authScreen = document.getElementById('authScreen');
  var dashScreen = document.getElementById('dashScreen');

  // Optional body-composition metrics (keys match the API).
  var METRICS = [
    { key: 'bodyFatPct', label: 'Body fat', unit: '%', step: '0.1' },
    { key: 'waist', label: 'Waist', unit: 'in', step: '0.1' },
    { key: 'muscleMass', label: 'Muscle mass', unit: 'lb', step: '0.1' },
    { key: 'bodyWaterPct', label: 'Body water', unit: '%', step: '0.1' },
    { key: 'visceralFat', label: 'Visceral fat', unit: '', step: '0.1' },
    { key: 'bmi', label: 'BMI', unit: '', step: '0.1' },
  ];

  // ----------------------------------------------------------- date helpers
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function parseDate(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function fmtShort(s) { var d = parseDate(s); return MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function fmtETA(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function dayDiff(a, b) { return Math.round((b - a) / 86400000); }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ----------------------------------------------------------- stats (ported)
  function computeRolling(list, windowDays) {
    return list.map(function (e) {
      var eDate = parseDate(e.date);
      var start = new Date(eDate); start.setDate(start.getDate() - (windowDays - 1));
      var inWin = list.filter(function (x) { var xd = parseDate(x.date); return xd >= start && xd <= eDate; });
      var avg = inWin.reduce(function (s, x) { return s + x.weight; }, 0) / inWin.length;
      return { date: e.date, weight: e.weight, rolling: avg };
    });
  }
  function findRollingAtDaysAgo(rollingData, daysAgo) {
    if (!rollingData.length) return null;
    var latest = parseDate(rollingData[rollingData.length - 1].date);
    var target = new Date(latest); target.setDate(target.getDate() - daysAgo);
    var best = null;
    for (var i = 0; i < rollingData.length; i++) {
      if (parseDate(rollingData[i].date) <= target) best = rollingData[i]; else break;
    }
    return best;
  }
  function rateColor(r) {
    var lost = -r;
    if (lost > 1.5) return 'var(--good)';
    if (lost > 0.5) return 'var(--caution)';
    if (lost > -0.5) return 'var(--warning)';
    return 'var(--alert)';
  }

  function computeModel() {
    var sorted = entries.slice().filter(function (e) { return e.date && typeof e.weight === 'number'; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
    var roll7 = computeRolling(sorted, 7);
    var rolling = computeRolling(sorted, win);
    var goal = user && user.goalWeight ? Number(user.goalWeight) : 175;

    var stats = null;
    if (roll7.length >= 2) {
      var first = roll7[0], latest = roll7[roll7.length - 1];
      var totalLost = first.weight - latest.rolling;
      var pctLost = (totalLost / first.weight) * 100;
      var days = dayDiff(parseDate(first.date), parseDate(latest.date));
      var overallRate = days > 0 ? (totalLost / days) * 7 : 0;
      var trends = [7, 14, 21, 28].map(function (p) {
        var past = findRollingAtDaysAgo(roll7, p);
        if (!past || past.date === latest.date) return { period: p, valid: false };
        var delta = latest.rolling - past.rolling;
        var actual = dayDiff(parseDate(past.date), parseDate(latest.date));
        var rate = actual > 0 ? (delta / actual) * 7 : 0;
        return { period: p, valid: true, pastAvg: past.rolling, pastDate: past.date, delta: delta, rate: rate };
      });
      stats = { first: first, latest: latest, totalLost: totalLost, pctLost: pctLost, days: days, overallRate: overallRate, trends: trends };
    }

    var projection = null;
    if (stats && goal && goal > 0) {
      var current = stats.latest.rolling;
      var remaining = current - goal;
      var totalNeeded = stats.first.weight - goal;
      var pctComplete = totalNeeded > 0 ? Math.min(100, Math.max(0, (stats.totalLost / totalNeeded) * 100)) : 0;
      if (remaining <= 0) {
        projection = { reached: true, remaining: 0, pctComplete: 100, scenarios: [] };
      } else {
        var latestDate = parseDate(stats.latest.date);
        var scen = function (label, rate) {
          if (!rate || rate <= 0) return { label: label, invalid: true };
          var weeks = remaining / rate;
          var eta = new Date(latestDate); eta.setDate(eta.getDate() + Math.round(weeks * 7));
          return { label: label, rate: rate, weeks: weeks, eta: eta };
        };
        var t14 = stats.trends.find(function (t) { return t.period === 14; });
        var t28 = stats.trends.find(function (t) { return t.period === 28; });
        projection = {
          reached: false, remaining: remaining, pctComplete: pctComplete,
          scenarios: [
            scen('14-day pace', t14 && t14.valid ? -t14.rate : 0),
            scen('28-day pace', t28 && t28.valid ? -t28.rate : 0),
            scen('Overall pace', stats.overallRate),
          ],
        };
      }
    }

    var status;
    if (!stats) status = { level: 'unknown', label: 'Building', detail: 'Need more data' };
    else {
      var t14b = stats.trends.find(function (t) { return t.period === 14; });
      if (!t14b || !t14b.valid) status = { level: 'unknown', label: 'Building', detail: 'Need 14+ days' };
      else {
        var lost = -t14b.delta;
        if (lost > 1.5) status = { level: 'good', label: 'On Track', detail: 'Down ' + lost.toFixed(1) + ' lbs over 14 days' };
        else if (lost > 0.5) status = { level: 'caution', label: 'Slowing', detail: 'Down ' + lost.toFixed(1) + ' lbs over 14 days' };
        else if (lost > -0.5) status = { level: 'warning', label: 'Plateau Watch', detail: 'Net ' + lost.toFixed(1) + ' lbs over 14 days' };
        else status = { level: 'alert', label: 'Reversed', detail: 'Up ' + (-lost).toFixed(1) + ' lbs over 14 days' };
      }
    }

    var chartData = rolling.map(function (r) { return { date: r.date, daily: r.weight, rolling: parseFloat(r.rolling.toFixed(2)) }; });
    var roll7Map = {}; roll7.forEach(function (r) { roll7Map[r.date] = r.rolling; });
    return { sorted: sorted, stats: stats, projection: projection, status: status, chartData: chartData, roll7Map: roll7Map, goal: goal };
  }

  var STATUS_COLOR = { good: 'var(--good)', caution: 'var(--caution)', warning: 'var(--warning)', alert: 'var(--alert)', unknown: 'var(--t-label)' };

  // ----------------------------------------------------------- render
  var lastModel = null;
  function render() {
    var m = computeModel();
    lastModel = m;
    var s = m.stats, proj = m.projection, st = m.status, goal = m.goal;
    var h = '';

    // masthead
    h += '<div class="masthead"><div><div class="wordmark">The Almanac</div><div class="tagline">A Record of Mass &amp; Trend</div></div>' +
         '<div class="daycount">Day ' + (s ? s.days : 0) + '</div></div>';

    // hero
    if (s) {
      h += '<div class="hero"><div class="hero-label">7-Day Trailing Average</div>' +
           '<div class="hero-row"><div class="hero-num">' + s.latest.rolling.toFixed(1) + '</div><div class="hero-unit">lbs</div></div>' +
           '<div class="hero-sub"><span class="k">latest </span><span class="v">' + s.latest.weight.toFixed(1) + '</span>' +
           '<span class="k"> · start </span><span class="v">' + s.first.weight.toFixed(1) + '</span></div>' +
           '<div class="hero-delta">−' + s.totalLost.toFixed(1) + ' lbs · ' + s.pctLost.toFixed(1) + '%' +
           '<span class="rate">at ' + s.overallRate.toFixed(2) + ' lbs/wk</span></div></div>';
    }

    // status
    var sc = STATUS_COLOR[st.level];
    h += '<div class="status" style="border-color:color-mix(in srgb,' + sc + ' 20%, transparent)">' +
         '<div class="status-top"><span class="status-dot" style="background:' + sc + '"></span>' +
         '<span class="status-name" style="color:' + sc + '">Status — ' + esc(st.label) + '</span></div>' +
         '<div class="status-detail">' + esc(st.detail) + '</div></div>';

    // goal projection
    if (s) {
      h += '<div class="section"><div class="section-label">Goal Projection</div>' +
           '<div class="goal-card"><div class="goal-top">' +
           '<div class="goal-block"><div class="mini-label">target</div>' +
           '<input id="goalInput" class="goal-input" type="number" step="0.5" value="' + goal + '"><span class="goal-unit">lbs</span></div>' +
           '<div class="goal-remaining"><div class="mini-label">remaining</div>' +
           '<div class="val">' + (proj ? (proj.reached ? '0.0' : proj.remaining.toFixed(1)) : '—') + '</div></div></div>' +
           '<div class="progress"><div class="progress-track"><div class="progress-fill" style="width:' + (proj ? proj.pctComplete : 0) + '%"></div></div>' +
           '<div class="progress-scale"><span class="edge">' + s.first.weight.toFixed(0) + '</span>' +
           '<span class="pct">' + (proj ? proj.pctComplete.toFixed(1) : '0.0') + '% complete</span>' +
           '<span class="edge">' + goal.toFixed(0) + '</span></div></div></div>';

      if (proj && !proj.reached) {
        h += '<div class="table"><div class="thead eta-grid"><div>at this pace</div><div class="num">lbs/wk</div><div class="num">weeks</div><div class="num">eta</div></div>';
        proj.scenarios.forEach(function (sc2) {
          h += '<div class="trow eta-grid"><div class="lead">' + esc(sc2.label) + '</div>';
          if (sc2.invalid) h += '<div class="invalid">no recent loss to project</div>';
          else h += '<div class="num muted">−' + sc2.rate.toFixed(2) + '</div><div class="num muted">' + Math.ceil(sc2.weeks) + '</div>' +
                    '<div class="num" style="color:var(--good-dim)">' + fmtETA(sc2.eta) + '</div>';
          h += '</div>';
        });
        h += '</div>';
      }
      h += '</div>';
    }

    // trend comparison
    if (s) {
      h += '<div class="section"><div class="section-label">Trend Comparison</div>' +
           '<div class="table"><div class="thead trend-grid"><div>window</div><div class="num">avg then</div><div class="num">change</div><div class="num">lbs/wk</div></div>';
      s.trends.forEach(function (t) {
        h += '<div class="trow trend-grid"><div><div class="lead">−' + t.period + 'd</div>' +
             (t.valid ? '<div class="sub">' + fmtShort(t.pastDate) + '</div>' : '') + '</div>' +
             '<div class="num muted">' + (t.valid ? t.pastAvg.toFixed(2) : '—') + '</div>' +
             '<div class="num" style="color:' + (t.valid ? rateColor(t.rate) : 'var(--t-label)') + '">' + (t.valid ? (t.delta > 0 ? '+' : '') + t.delta.toFixed(2) : '—') + '</div>' +
             '<div class="num" style="color:' + (t.valid ? rateColor(t.rate) : 'var(--t-label)') + '">' + (t.valid ? (t.rate > 0 ? '+' : '') + t.rate.toFixed(2) : '—') + '</div></div>';
      });
      h += '</div></div>';
    }

    // chart
    if (m.chartData.length >= 2) {
      h += '<div class="section"><div class="chart-head"><div class="section-label" style="margin-bottom:0">Trend Chart</div>' +
           '<div class="win-toggle">' + [7, 14, 21].map(function (w) {
             return '<button class="win-btn' + (win === w ? ' active' : '') + '" data-win="' + w + '">' + w + 'd</button>';
           }).join('') + '</div></div><div class="chart-box" id="chartBox"></div></div>';
    }

    // composition (only metrics that have data)
    var compRows = METRICS.map(function (mt) {
      var series = m.sorted.filter(function (e) { return e[mt.key] != null; });
      if (!series.length) return null;
      var latest = series[series.length - 1][mt.key];
      var prev = series.length > 1 ? series[series.length - 2][mt.key] : null;
      var delta = prev != null ? latest - prev : null;
      return { label: mt.label, unit: mt.unit, latest: latest, delta: delta };
    }).filter(Boolean);
    if (compRows.length) {
      h += '<div class="section"><div class="section-label">Composition</div><div class="table">' +
           '<div class="thead comp-grid"><div>metric</div><div class="num">latest</div><div class="num">change</div></div>';
      compRows.forEach(function (c) {
        var u = c.unit ? ' ' + c.unit : '';
        h += '<div class="trow comp-grid"><div class="lead">' + esc(c.label) + '</div>' +
             '<div class="num muted">' + c.latest.toFixed(1) + u + '</div>' +
             '<div class="num faint">' + (c.delta != null ? (c.delta > 0 ? '+' : '') + c.delta.toFixed(1) : '—') + '</div></div>';
      });
      h += '</div></div>';
    }

    // log form
    h += '<div class="section"><div class="section-label">Log Entry</div>' +
         '<form id="logForm">' +
         '<div class="log-row">' +
         '<label class="log-field date"><span class="field-label">date</span><input id="logDate" class="field-input" type="date" value="' + todayISO() + '"></label>' +
         '<label class="log-field weight"><span class="field-label">weight (lbs)</span><input id="logWeight" class="field-input" type="number" step="0.1" inputmode="decimal" placeholder="—"></label>' +
         '<button class="btn" type="submit">Save</button></div>' +
         '<button type="button" class="more-toggle" id="moreToggle">+ Body composition &amp; note</button>' +
         '<div class="more-panel" id="morePanel" hidden><div class="metric-grid">' +
         METRICS.map(function (mt) {
           return '<label class="metric-field"><span class="field-label">' + mt.label + (mt.unit ? ' (' + mt.unit + ')' : '') + '</span>' +
                  '<input class="field-input metric-input" data-metric="' + mt.key + '" type="number" step="' + mt.step + '" inputmode="decimal" placeholder="—"></label>';
         }).join('') +
         '</div><label class="metric-field note"><span class="field-label">note</span><input id="logNote" class="field-input" type="text" placeholder="optional"></label></div>' +
         '</form>' +
         '<div class="import"><button class="import-toggle" id="importToggle" type="button">Import history</button>' +
         '<div class="import-panel" id="importPanel" hidden>' +
         '<p class="import-hint">Paste JSON or CSV (one “date, weight” per line), or choose a file.</p>' +
         '<textarea id="importText" class="import-text" spellcheck="false" placeholder=\'{"entries":[{"date":"2026-01-04","weight":244}]}\'></textarea>' +
         '<div class="import-actions"><input type="file" id="importFile" class="import-file" accept=".json,.csv,.txt"><button class="btn" id="importRun" type="button">Import</button></div>' +
         '<p class="import-result" id="importResult"></p></div></div>' +
         '</div>';

    // entries list
    h += '<div class="section"><div class="section-label">Recent Entries</div>';
    if (!m.sorted.length) {
      h += '<div class="empty">No entries yet. Log your first weight above.</div>';
    } else {
      var desc = m.sorted.slice().reverse();
      var shown = showAll ? desc : desc.slice(0, 14);
      h += '<div class="entries">';
      shown.forEach(function (e) {
        var avg = m.roll7Map[e.date];
        h += '<div class="entry-item"><div class="entry-row"><span class="entry-date">' + fmtShort(e.date) + '</span>' +
             '<span class="entry-raw">' + e.weight.toFixed(1) + '</span>' +
             '<span class="entry-avg">' + (avg != null ? avg.toFixed(1) : '—') + '</span>' +
             '<button class="entry-del" data-id="' + esc(e.id || '') + '" data-date="' + esc(e.date) + '" title="Delete">✕</button></div>' +
             (e.note ? '<div class="entry-note">' + esc(e.note) + '</div>' : '') + '</div>';
      });
      h += '</div>';
      if (desc.length > 14) h += '<button class="entries-more" id="entriesMore">' + (showAll ? 'Show less' : 'Show all ' + desc.length) + '</button>';
    }
    h += '</div>';

    // settings
    h += settingsHtml();

    // footer
    h += '<div class="footer">Numbers shown unfiltered.</div>';

    dashScreen.innerHTML = h;
    wireDashEvents();
    if (m.chartData.length >= 2) renderChart(m);
  }

  // ----------------------------------------------------------- SVG chart
  function renderChart(m) {
    var box = document.getElementById('chartBox');
    if (!box) return;
    var w = box.clientWidth || 600, H = 288;
    var padL = 40, padR = 12, padT = 8, padB = 22;
    var plotW = w - padL - padR, plotH = H - padT - padB;
    var data = m.chartData;
    var vals = [];
    data.forEach(function (d) { vals.push(d.daily, d.rolling); });
    var yMin = Math.min.apply(null, vals), yMax = Math.max.apply(null, vals);
    var pad = (yMax - yMin) * 0.08 || 1; yMin -= pad; yMax += pad;
    var n = data.length;
    var X = function (i) { return padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW); };
    var Y = function (v) { return padT + (yMax - v) / (yMax - yMin) * plotH; };

    var svg = '<svg width="' + w + '" height="' + H + '" viewBox="0 0 ' + w + ' ' + H + '">';
    // horizontal gridlines + y labels
    for (var g = 0; g <= 4; g++) {
      var gv = yMax - g * (yMax - yMin) / 4, gy = Y(gv);
      svg += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + gy.toFixed(1) + '" stroke="#292524" stroke-dasharray="2 4"/>';
      svg += '<text x="' + (padL - 6) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end" fill="#78716c" font-size="10" font-family="ui-monospace,JetBrains Mono,monospace">' + gv.toFixed(0) + '</text>';
    }
    // x-axis line
    svg += '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (w - padR) + '" y2="' + (padT + plotH) + '" stroke="#44403c"/>';
    // x labels
    var interval = Math.max(1, Math.floor(n / 6));
    for (var i = 0; i < n; i += interval) {
      svg += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" fill="#78716c" font-size="10" font-family="ui-monospace,JetBrains Mono,monospace">' + fmtShort(data[i].date) + '</text>';
    }
    // goal line (only if within domain, matching Recharts auto-domain behavior)
    if (m.goal >= yMin && m.goal <= yMax) {
      var gyL = Y(m.goal);
      svg += '<line x1="' + padL + '" y1="' + gyL.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + gyL.toFixed(1) + '" stroke="#d4a056" stroke-width="1" stroke-dasharray="3 4"/>';
      svg += '<text x="' + (w - padR) + '" y="' + (gyL - 4).toFixed(1) + '" text-anchor="end" fill="#d4a056" font-size="10" font-family="ui-monospace,JetBrains Mono,monospace">goal ' + m.goal + '</text>';
    }
    // daily line
    var dp = data.map(function (d, i) { return X(i).toFixed(1) + ',' + Y(d.daily).toFixed(1); }).join(' ');
    svg += '<polyline points="' + dp + '" fill="none" stroke="#57534e" stroke-width="1"/>';
    // rolling line
    var rp = data.map(function (d, i) { return X(i).toFixed(1) + ',' + Y(d.rolling).toFixed(1); }).join(' ');
    svg += '<polyline points="' + rp + '" fill="none" stroke="#a3d9a5" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>';
    svg += '</svg>';
    box.innerHTML = svg;
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (lastModel && lastModel.chartData.length >= 2) renderChart(lastModel); }, 150);
  });

  // ----------------------------------------------------------- API
  function api(method, path, opts) {
    opts = opts || {};
    var headers = { 'Authorization': 'Bearer ' + (token || '') };
    var init = { method: method, headers: headers };
    if (opts.body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(API + path + (opts.query || ''), init).then(function (res) {
      if (res.status === 401) { logout(); throw { code: 401 }; }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw { code: res.status, message: data.error };
        return data;
      });
    });
  }

  function loadData() {
    return api('GET', '/weight-entries', { query: '?limit=5000' }).then(function (data) {
      entries = data.entries || [];
      user = data.user || user;
      win = (user && user.prefs && [7, 14, 21].indexOf(user.prefs.window) >= 0) ? user.prefs.window : 7;
    });
  }

  function reload() { return loadData().then(render); }

  // ----------------------------------------------------------- import
  function normDate(s) {
    s = String(s || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return m[3] + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
    var d = new Date(s);
    if (!isNaN(d.getTime())) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return null;
  }
  function parseImportText(text) {
    text = (text || '').trim();
    if (!text) return [];
    var rows = [];
    if (text[0] === '{' || text[0] === '[') {
      var data = null; try { data = JSON.parse(text); } catch (e) {}
      // NB: on an Array, `.entries` is Array.prototype.entries (a truthy function),
      // so check Array.isArray explicitly rather than truthiness.
      var arr = data && Array.isArray(data.entries) ? data.entries : (Array.isArray(data) ? data : []);
      arr.forEach(function (el) {
        if (Array.isArray(el)) rows.push({ date: el[0], weight: el[1] });
        else if (el && typeof el === 'object') rows.push({ date: el.date, weight: el.weight });
      });
    } else {
      text.split(/\r?\n/).forEach(function (line) {
        line = line.trim(); if (!line) return;
        var parts = line.split(/[,\t]/);
        if (parts.length < 2) return;
        if (/date/i.test(parts[0]) && /weight|lb|kg/i.test(parts[1])) return; // header
        rows.push({ date: parts[0], weight: parts[1] });
      });
    }
    var out = [];
    rows.forEach(function (r) {
      var date = normDate(r.date), weight = parseFloat(r.weight);
      if (date && isFinite(weight) && weight > 0) out.push({ date: date, weight: weight, source: 'import' });
    });
    return out;
  }
  function doImport() {
    var res = document.getElementById('importResult');
    var rows = parseImportText(document.getElementById('importText').value);
    if (!rows.length) { res.textContent = 'No valid rows found.'; return; }
    res.textContent = 'Importing ' + rows.length + '…';
    api('POST', '/weight-entries', { body: { entries: rows } }).then(function (data) {
      toast('Imported ' + (data.added || 0) + ' entries.');
      return reload();
    }).catch(function (e) { if (e.code !== 401) res.textContent = e.message || 'Import failed.'; });
  }

  function saveGoal(goal) { api('PATCH', '/weight-entries', { body: { goalWeight: goal } }).catch(function () {}); }
  function saveWindow(w) {
    var prefs = Object.assign({}, (user && user.prefs) || {}, { window: w });
    if (user) user.prefs = prefs;
    api('PATCH', '/weight-entries', { body: { prefs: prefs } }).catch(function () {});
  }

  // ----------------------------------------------------------- events
  function wireDashEvents() {
    var goalInput = document.getElementById('goalInput');
    if (goalInput) goalInput.addEventListener('change', function () {
      var g = parseFloat(goalInput.value); if (isNaN(g) || g <= 0) return;
      user.goalWeight = g; saveGoal(g); render();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.win-btn'), function (b) {
      b.addEventListener('click', function () { win = parseInt(b.dataset.win, 10); saveWindow(win); render(); });
    });
    var logForm = document.getElementById('logForm');
    if (logForm) logForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var date = document.getElementById('logDate').value;
      var wt = parseFloat(document.getElementById('logWeight').value);
      if (!date || isNaN(wt) || wt <= 0) { toast('Enter a valid date and weight.'); return; }
      var body = { date: date, weight: wt };
      Array.prototype.forEach.call(document.querySelectorAll('.metric-input'), function (inp) {
        var v = (inp.value || '').trim();
        if (v !== '' && !isNaN(parseFloat(v))) body[inp.dataset.metric] = parseFloat(v);
      });
      var note = document.getElementById('logNote');
      if (note && note.value.trim()) body.note = note.value.trim();
      api('POST', '/weight-entries', { body: body })
        .then(function () { toast('Saved.'); return reload(); })
        .catch(function (e) { if (e.code !== 401) toast(e.message || 'Save failed.'); });
    });
    var moreToggle = document.getElementById('moreToggle');
    if (moreToggle) moreToggle.addEventListener('click', function () {
      var p = document.getElementById('morePanel'); if (p) p.hidden = !p.hidden;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.entry-del'), function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.id;
        if (!id) { toast('Cannot delete this entry.'); return; }
        if (!confirm('Delete the entry for ' + fmtShort(b.dataset.date) + '?')) return;
        api('DELETE', '/weight-entries', { query: '?id=' + encodeURIComponent(id) })
          .then(function () { return reload(); })
          .catch(function (e) { if (e.code !== 401) toast(e.message || 'Delete failed.'); });
      });
    });
    var more = document.getElementById('entriesMore');
    if (more) more.addEventListener('click', function () {
      showAll = !showAll; try { localStorage.setItem(SHOWALL_KEY, showAll ? '1' : '0'); } catch (e) {}
      render();
    });
    var importToggle = document.getElementById('importToggle');
    if (importToggle) importToggle.addEventListener('click', function () {
      var p = document.getElementById('importPanel'); if (p) p.hidden = !p.hidden;
    });
    var importFile = document.getElementById('importFile');
    if (importFile) importFile.addEventListener('change', function () {
      var f = importFile.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { var ta = document.getElementById('importText'); if (ta) ta.value = r.result; };
      r.readAsText(f);
    });
    var importRun = document.getElementById('importRun');
    if (importRun) importRun.addEventListener('click', doImport);

    var remToggle = document.getElementById('remToggle');
    if (remToggle) remToggle.addEventListener('click', function () {
      if ((user.prefs || {}).reminderEnabled) disableReminders(); else enableReminders();
    });
    var remTime = document.getElementById('remTime');
    if (remTime) remTime.addEventListener('change', function () {
      if (/^\d{2}:\d{2}$/.test(remTime.value)) updateReminderTime(remTime.value);
    });
    var copyKey = document.getElementById('copyKey');
    if (copyKey) copyKey.addEventListener('click', function () {
      var k = (user && user.apiKey) || '';
      if (navigator.clipboard) navigator.clipboard.writeText(k).then(function () { toast('Key copied.'); }, function () { toast('Copy failed.'); });
      else toast('Key: ' + k);
    });
    var genKey = document.getElementById('genKey');
    if (genKey) genKey.addEventListener('click', regenApiKey);
    var regenKey = document.getElementById('regenKey');
    if (regenKey) regenKey.addEventListener('click', function () {
      if (confirm('Regenerate your sync key? The old key stops working immediately.')) regenApiKey();
    });
    var exportCsv = document.getElementById('exportCsv');
    if (exportCsv) exportCsv.addEventListener('click', exportCSV);

    var signOut = document.getElementById('signOut');
    if (signOut) signOut.addEventListener('click', logout);
  }

  // ----------------------------------------------------------- settings + actions
  function settingsHtml() {
    var prefs = (user && user.prefs) || {};
    var remEnabled = !!prefs.reminderEnabled;
    var remTime = prefs.reminderTime || '07:00';
    var apiKey = (user && user.apiKey) || '';
    var origin = location.origin;
    var pushOk = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
    var s = '<div class="section"><div class="section-label">Settings</div>';

    s += '<div class="setting-card"><div class="setting-row"><span class="setting-name">Weigh-in reminder</span>' +
         '<button class="toggle-btn' + (remEnabled ? ' on' : '') + '" id="remToggle" type="button">' + (remEnabled ? 'On' : 'Off') + '</button></div>' +
         '<div class="setting-sub" id="remTimeRow"' + (remEnabled ? '' : ' hidden') + '><span class="field-label">remind me at</span>' +
         '<input id="remTime" class="field-input time" type="time" value="' + remTime + '"></div>' +
         '<p class="setting-hint">' + (pushOk ? 'Reminders need this app installed to your home screen (iPhone: Share → Add to Home Screen, then open from the icon).' : 'This browser can’t send notifications — install the app to your home screen and open it from there.') + '</p></div>';

    s += '<div class="setting-card"><div class="setting-name">Apple Health sync</div>' +
         '<p class="setting-hint">Send your latest Apple Health weight here with an iOS Shortcut.</p>';
    if (apiKey) s += '<div class="key-row"><code class="key" id="apiKey">' + esc(apiKey) + '</code><button class="mini-btn" id="copyKey" type="button">Copy</button></div>';
    else s += '<button class="mini-btn" id="genKey" type="button">Generate sync key</button>';
    s += '<div class="key-row"><span class="field-label">endpoint</span><code class="key small">' + esc(origin) + '/api/weight-ingest</code></div>' +
         '<details class="shortcut-steps"><summary>Shortcut setup</summary><ol>' +
         '<li>Shortcuts app → new shortcut.</li>' +
         '<li><b>Find Health Samples</b>: type <b>Body Mass</b>, sort by <b>Date</b> (newest first), limit <b>1</b>.</li>' +
         '<li><b>Get Contents of URL</b>: the endpoint above, method <b>POST</b>, header <code>Content-Type: application/json</code>, JSON body with <code>key</code> = your key and <code>weight</code> = the Health sample.</li>' +
         '<li>Run to test, then add a daily <b>Automation</b> to sync automatically.</li></ol>' +
         (apiKey ? '<button class="mini-btn danger" id="regenKey" type="button">Regenerate key</button>' : '') + '</details></div>';

    s += '<div class="setting-card actions-row"><button class="mini-btn" id="exportCsv" type="button">Export CSV</button>' +
         '<button class="mini-btn" id="signOut" type="button">Sign out' + (user ? ' · ' + esc(user.username) : '') + '</button></div>';
    return s + '</div>';
  }

  function urlBase64ToUint8Array(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function currentTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { return null; } }

  function enableReminders() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      toast('Install to your home screen first, then open from the icon.'); return;
    }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { toast('Notifications not allowed.'); return; }
      return navigator.serviceWorker.ready.then(function (reg) {
        return api('GET', '/weight-push').then(function (cfg) {
          if (!cfg.publicKey) { toast('Push not configured on server.'); throw { code: 0 }; }
          return reg.pushManager.getSubscription().then(function (existing) {
            return existing || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.publicKey) });
          });
        }).then(function (sub) {
          var t = document.getElementById('remTime');
          var time = (t && t.value) || '07:00';
          return api('POST', '/weight-push', { body: { subscription: sub.toJSON(), reminderTime: time, tz: currentTz() } });
        }).then(function (res) {
          user.prefs = Object.assign({}, user.prefs, { reminderEnabled: true, reminderTime: res.reminder.time, tz: res.reminder.tz });
          toast('Reminders on.'); render();
        });
      });
    }).catch(function (e) { if (e && e.code !== 401) toast('Could not enable reminders.'); });
  }

  function disableReminders() {
    var done = function () { user.prefs = Object.assign({}, user.prefs, { reminderEnabled: false }); render(); };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          var endpoint = sub ? sub.endpoint : null;
          return (sub ? sub.unsubscribe() : Promise.resolve()).then(function () {
            return api('DELETE', '/weight-push', { body: { endpoint: endpoint } });
          });
        });
      }).then(done).catch(done);
    } else { api('DELETE', '/weight-push', { body: {} }).then(done).catch(done); }
    toast('Reminders off.');
  }

  function updateReminderTime(time) {
    api('POST', '/weight-push', { body: { reminderTime: time, tz: currentTz() } }).then(function () {
      user.prefs = Object.assign({}, user.prefs, { reminderTime: time });
      toast('Reminder time updated.');
    }).catch(function () {});
  }

  function exportCSV() {
    var header = 'date,weight,body_fat_pct,waist,muscle_mass,body_water_pct,visceral_fat,bmi,note';
    var asc = entries.slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    var lines = [header];
    asc.forEach(function (e) {
      var cells = [e.date, e.weight, e.bodyFatPct, e.waist, e.muscleMass, e.bodyWaterPct, e.visceralFat, e.bmi,
        e.note ? '"' + String(e.note).replace(/"/g, '""') + '"' : ''];
      lines.push(cells.map(function (c) { return c == null ? '' : c; }).join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'almanac-weight.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function regenApiKey() {
    api('PATCH', '/weight-entries', { body: { newApiKey: true } }).then(function (data) {
      if (data.user) { user.apiKey = data.user.apiKey; render(); toast('New sync key generated.'); }
    }).catch(function (e) { if (e.code !== 401) toast('Could not generate key.'); });
  }

  // ----------------------------------------------------------- toast
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  // ----------------------------------------------------------- auth
  var authMode = 'login';
  var authForm = document.getElementById('authForm');
  var authUser = document.getElementById('authUser');
  var authPass = document.getElementById('authPass');
  var authError = document.getElementById('authError');
  var authSubmit = document.getElementById('authSubmit');

  Array.prototype.forEach.call(document.querySelectorAll('.auth-tab'), function (tab) {
    tab.addEventListener('click', function () {
      authMode = tab.dataset.mode;
      Array.prototype.forEach.call(document.querySelectorAll('.auth-tab'), function (t) { t.classList.toggle('active', t === tab); });
      authSubmit.textContent = authMode === 'register' ? 'Create account' : 'Sign in';
      authPass.setAttribute('autocomplete', authMode === 'register' ? 'new-password' : 'current-password');
      authError.hidden = true;
    });
  });

  authForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var username = (authUser.value || '').trim();
    var passcode = authPass.value || '';
    authError.hidden = true;
    authSubmit.disabled = true;
    fetch(API + '/weight-auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: authMode, username: username, passcode: passcode }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        authSubmit.disabled = false;
        if (!res.ok) { authError.textContent = data.error || 'Something went wrong.'; authError.hidden = false; return; }
        token = data.token; user = data.user;
        try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
        win = (user.prefs && [7, 14, 21].indexOf(user.prefs.window) >= 0) ? user.prefs.window : 7;
        loadData().then(showDash).catch(function () { showDash(); });
      });
    }).catch(function () { authSubmit.disabled = false; authError.textContent = 'Could not reach the server.'; authError.hidden = false; });
  });

  function logout() {
    token = null; user = null; entries = [];
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    showAuth();
  }

  // ----------------------------------------------------------- screens / boot
  function showAuth() { dashScreen.hidden = true; authScreen.hidden = false; setTimeout(function () { authUser && authUser.focus(); }, 50); }
  function showDash() { authScreen.hidden = true; dashScreen.hidden = false; render(); }

  if (token) {
    loadData().then(showDash).catch(function (e) { if (e && e.code === 401) return; showAuth(); });
  } else {
    showAuth();
  }

  // Dev-only hook for local rendering without a backend (localhost only).
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    window.__almanacDev = function (mockEntries, mockUser) {
      user = mockUser || { username: 'demo', goalWeight: 175, prefs: {} };
      entries = mockEntries || []; token = 'dev'; win = 7;
      showDash();
    };
  }
})();
