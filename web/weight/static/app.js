// The Almanac — weight & body-composition tracker. Vanilla JS, inline-SVG charts.
(function () {
  var API = '/api', TOKEN_KEY = 'almanacToken', PREFS_KEY = 'almanacPrefsLocal';
  var MONO = 'ui-monospace,JetBrains Mono,monospace';
  var DISP = 'Instrument Serif,Georgia,serif';

  // metric definitions (keys match the API)
  var METRICS = [
    { key: 'weight',       label: 'Weight',        unit: 'lb',  dec: 1, goodDown: true,  primary: true },
    { key: 'bodyFatPct',   label: 'Body Fat',      unit: '%',   dec: 1, goodDown: true },
    { key: 'muscleMass',   label: 'Muscle Mass',   unit: 'lb',  dec: 1, goodDown: false },
    { key: 'bodyWaterPct', label: 'Body Water',    unit: '%',   dec: 1, goodDown: false },
    { key: 'visceralFat',  label: 'Visceral Fat',  unit: '',    dec: 0, goodDown: true },
    { key: 'bmi',          label: 'BMI',           unit: '',    dec: 1, goodDown: true },
    { key: 'metabolicAge', label: 'Metabolic Age', unit: 'yrs', dec: 0, goodDown: true },
  ];
  function metricDef(k) { for (var i = 0; i < METRICS.length; i++) if (METRICS[i].key === k) return METRICS[i]; return METRICS[0]; }

  // state
  var token = null; try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}
  var user = null, entries = [], section = 'dashboard';
  var win = 7, trendMetric = 'weight', trendRange = 90, trendWin = 7, showAll = false;
  var local = {}; try { local = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) {}
  if (local.win) win = local.win;

  var authScreen = document.getElementById('authScreen');
  var appEl = document.getElementById('app');
  var screenEl = document.getElementById('screen');
  var appTitle = document.getElementById('appTitle');

  // ---------------------------------------------------------- date/format
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function parseDate(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function isoOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmtShort(s) { var d = parseDate(s); return MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function fmtETA(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function dayDiff(a, b) { return Math.round((b - a) / 86400000); }
  function todayISO() { return isoOf(new Date()); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function signed(v, d) { return (v > 0 ? '+' : '') + v.toFixed(d); }

  // ---------------------------------------------------------- data / stats
  function sortedAll() {
    return entries.filter(function (e) { return e.date && typeof e.weight === 'number'; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
  }
  function rollingSeries(key, w) {
    var s = sortedAll().filter(function (e) { return e[key] != null; }).map(function (e) { return { date: e.date, value: Number(e[key]) }; });
    return s.map(function (e) {
      var ed = parseDate(e.date), start = new Date(ed); start.setDate(start.getDate() - (w - 1));
      var inWin = s.filter(function (x) { var xd = parseDate(x.date); return xd >= start && xd <= ed; });
      return { date: e.date, value: e.value, rolling: inWin.reduce(function (a, x) { return a + x.value; }, 0) / inWin.length };
    });
  }
  function latestRolling(key, w) { var r = rollingSeries(key, w); return r.length ? r[r.length - 1].rolling : null; }
  function findRollingAtDaysAgo(r, daysAgo) {
    if (!r.length) return null;
    var latest = parseDate(r[r.length - 1].date), t = new Date(latest); t.setDate(t.getDate() - daysAgo);
    var best = null;
    for (var i = 0; i < r.length; i++) { if (parseDate(r[i].date) <= t) best = r[i]; else break; }
    return best;
  }
  function goal() { return user && user.goalWeight ? Number(user.goalWeight) : 175; }

  function weightStats() {
    var r7 = rollingSeries('weight', 7);
    if (r7.length < 2) return null;
    var first = r7[0], latest = r7[r7.length - 1];
    var totalLost = first.value - latest.rolling;
    var pctLost = (totalLost / first.value) * 100;
    var days = dayDiff(parseDate(first.date), parseDate(latest.date));
    var overallRate = days > 0 ? (totalLost / days) * 7 : 0;
    var trends = [7, 14, 21, 28].map(function (p) {
      var past = findRollingAtDaysAgo(r7, p);
      if (!past || past.date === latest.date) return { period: p, valid: false };
      var delta = latest.rolling - past.rolling, actual = dayDiff(parseDate(past.date), parseDate(latest.date));
      return { period: p, valid: true, pastAvg: past.rolling, pastDate: past.date, delta: delta, rate: actual > 0 ? (delta / actual) * 7 : 0 };
    });
    return { first: first, latest: latest, totalLost: totalLost, pctLost: pctLost, days: days, overallRate: overallRate, trends: trends };
  }
  function projection(st, g) {
    if (!st || !g || g <= 0) return null;
    var current = st.latest.rolling, remaining = current - g, totalNeeded = st.first.value - g;
    var pctComplete = totalNeeded > 0 ? Math.min(100, Math.max(0, (st.totalLost / totalNeeded) * 100)) : 0;
    if (remaining <= 0) return { reached: true, remaining: 0, pctComplete: 100, scenarios: [] };
    var latestDate = parseDate(st.latest.date);
    var scen = function (label, rate) {
      if (!rate || rate <= 0) return { label: label, invalid: true };
      var weeks = remaining / rate, eta = new Date(latestDate); eta.setDate(eta.getDate() + Math.round(weeks * 7));
      return { label: label, rate: rate, weeks: weeks, eta: eta };
    };
    var t14 = st.trends.find(function (t) { return t.period === 14; });
    var t28 = st.trends.find(function (t) { return t.period === 28; });
    return { reached: false, remaining: remaining, pctComplete: pctComplete, scenarios: [
      scen('14-day pace', t14 && t14.valid ? -t14.rate : 0),
      scen('28-day pace', t28 && t28.valid ? -t28.rate : 0),
      scen('Overall pace', st.overallRate),
    ] };
  }
  function statusOf(st) {
    if (!st) return { level: 'unknown', label: 'Building', detail: 'Need more data' };
    var t14 = st.trends.find(function (t) { return t.period === 14; });
    if (!t14 || !t14.valid) return { level: 'unknown', label: 'Building', detail: 'Need 14+ days' };
    var lost = -t14.delta;
    if (lost > 1.5) return { level: 'good', label: 'On Track', detail: 'Down ' + lost.toFixed(1) + ' lbs over 14 days' };
    if (lost > 0.5) return { level: 'caution', label: 'Slowing', detail: 'Down ' + lost.toFixed(1) + ' lbs over 14 days' };
    if (lost > -0.5) return { level: 'warning', label: 'Plateau Watch', detail: 'Net ' + lost.toFixed(1) + ' lbs over 14 days' };
    return { level: 'alert', label: 'Reversed', detail: 'Up ' + (-lost).toFixed(1) + ' lbs over 14 days' };
  }
  var STCOLOR = { good: 'var(--good)', caution: 'var(--caution)', warning: 'var(--warning)', alert: 'var(--alert)', unknown: 'var(--t-label)' };

  function loggedDates() { var s = new Set(); sortedAll().forEach(function (e) { s.add(e.date); }); return s; }
  function currentStreak() {
    var dates = loggedDates(); if (!dates.size) return 0;
    var s = sortedAll(), d = parseDate(s[s.length - 1].date), n = 0;
    while (dates.has(isoOf(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function countSince(days) { var cut = new Date(); cut.setDate(cut.getDate() - days); return sortedAll().filter(function (e) { return parseDate(e.date) >= cut; }).length; }

  // metric latest + change over a lookback (in that metric's rolling-7)
  function metricSummary(key) {
    var r = rollingSeries(key, 7);
    if (!r.length) return null;
    var latest = r[r.length - 1].rolling;
    var past = findRollingAtDaysAgo(r, 30);
    var delta = past && past.date !== r[r.length - 1].date ? latest - past.rolling : null;
    return { latest: latest, delta: delta, series: r.map(function (x) { return x.rolling; }) };
  }

  // ---------------------------------------------------------- SVG charts
  function lineChart(data, opts) {
    opts = opts || {};
    var W = 320, H = opts.height || 168, padL = 30, padR = 8, padT = 10, padB = 20;
    var pw = W - padL - padR, ph = H - padT - padB, dec = opts.dec != null ? opts.dec : 0;
    var vals = []; data.forEach(function (d) { if (d.daily != null) vals.push(d.daily); if (d.rolling != null) vals.push(d.rolling); });
    if (vals.length < 2) return '<div class="empty">Not enough data yet.</div>';
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), pad = (mx - mn) * 0.08 || 1; mn -= pad; mx += pad;
    var n = data.length;
    var X = function (i) { return padL + (n === 1 ? pw / 2 : (i / (n - 1)) * pw); };
    var Y = function (v) { return padT + (mx - v) / (mx - mn) * ph; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';
    for (var g = 0; g <= 3; g++) {
      var gv = mx - g * (mx - mn) / 3, gy = Y(gv);
      s += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '" stroke="#292524" stroke-dasharray="2 3"/>';
      s += '<text x="' + (padL - 4) + '" y="' + (gy + 2.8).toFixed(1) + '" text-anchor="end" fill="#78716c" font-size="8" font-family="' + MONO + '">' + gv.toFixed(dec) + '</text>';
    }
    [0, Math.floor(n / 2), n - 1].forEach(function (i, k) {
      if (i < 0 || i >= n) return;
      s += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="' + (k === 0 ? 'start' : k === 2 ? 'end' : 'middle') + '" fill="#78716c" font-size="8" font-family="' + MONO + '">' + fmtShort(data[i].date) + '</text>';
    });
    if (opts.goal != null && opts.goal >= mn && opts.goal <= mx) {
      var gyl = Y(opts.goal);
      s += '<line x1="' + padL + '" y1="' + gyl.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gyl.toFixed(1) + '" stroke="#d4a056" stroke-width="1" stroke-dasharray="3 3"/>';
      s += '<text x="' + (W - padR) + '" y="' + (gyl - 3).toFixed(1) + '" text-anchor="end" fill="#d4a056" font-size="8" font-family="' + MONO + '">goal ' + opts.goal + '</text>';
    }
    if (opts.showDaily !== false) {
      var dp = data.map(function (d, i) { return d.daily != null ? X(i).toFixed(1) + ',' + Y(d.daily).toFixed(1) : null; }).filter(Boolean).join(' ');
      s += '<polyline points="' + dp + '" fill="none" stroke="#57534e" stroke-width="0.8"/>';
    }
    var rp = data.map(function (d, i) { return d.rolling != null ? X(i).toFixed(1) + ',' + Y(d.rolling).toFixed(1) : null; }).filter(Boolean).join(' ');
    s += '<polyline points="' + rp + '" fill="none" stroke="' + (opts.color || '#a3d9a5') + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>';
    return s + '</svg>';
  }

  function progressRing(pct) {
    pct = Math.max(0, Math.min(100, pct || 0));
    var S = 92, r = 38, c = S / 2, C = 2 * Math.PI * r, off = C * (1 - pct / 100);
    return '<svg viewBox="0 0 ' + S + ' ' + S + '" width="92" height="92">' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="#292524" stroke-width="7"/>' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="#34d399" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 ' + c + ' ' + c + ')"/>' +
      '<text x="' + c + '" y="' + (c - 1) + '" text-anchor="middle" dominant-baseline="middle" fill="#f5f5f4" font-size="21" font-family="' + DISP + '">' + Math.round(pct) + '</text>' +
      '<text x="' + c + '" y="' + (c + 14) + '" text-anchor="middle" fill="#78716c" font-size="7" font-family="' + MONO + '" letter-spacing="1">PERCENT</text></svg>';
  }

  function sparkline(values, color) {
    if (!values || values.length < 2) return '';
    var W = 100, H = 24, mn = Math.min.apply(null, values), mx = Math.max.apply(null, values), pad = (mx - mn) * 0.12 || 1; mn -= pad; mx += pad;
    var pts = values.map(function (v, i) { return ((i / (values.length - 1)) * W).toFixed(1) + ',' + (H - (v - mn) / (mx - mn) * H).toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="24" preserveAspectRatio="none"><polyline points="' + pts + '" fill="none" stroke="' + (color || '#a3d9a5') + '" stroke-width="1.4"/></svg>';
  }

  function barChart(bars) {
    var W = 320, H = 132, padL = 30, padR = 8, padT = 10, padB = 20, pw = W - padL - padR, ph = H - padT - padB;
    var vals = bars.map(function (b) { return b.value; }).filter(function (v) { return v != null; });
    if (vals.length < 2) return '<div class="empty">Not enough data yet.</div>';
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), pad = (mx - mn) * 0.12 || 1; mn -= pad; mx += pad;
    var n = bars.length, bw = (pw / n) * 0.6;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';
    for (var g = 0; g <= 2; g++) { var gv = mx - g * (mx - mn) / 2, gy = padT + g * ph / 2;
      s += '<text x="' + (padL - 4) + '" y="' + (gy + 2.8).toFixed(1) + '" text-anchor="end" fill="#78716c" font-size="8" font-family="' + MONO + '">' + gv.toFixed(0) + '</text>'; }
    bars.forEach(function (b, i) {
      if (b.value == null) return;
      var x = padL + (i + 0.5) * (pw / n), h = (b.value - mn) / (mx - mn) * ph, y = padT + ph - h;
      s += '<rect x="' + (x - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="1" fill="rgba(163,217,165,0.5)"/>';
      if (i % Math.max(1, Math.ceil(n / 6)) === 0) s += '<text x="' + x.toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" fill="#78716c" font-size="8" font-family="' + MONO + '">' + b.label + '</text>';
    });
    return s + '</svg>';
  }

  function heatmap(dateSet) {
    var weeks = 18, cell = 11, gap = 3, W = weeks * (cell + gap) - gap, H = 7 * (cell + gap) - gap;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(today); start.setDate(start.getDate() - (weeks * 7 - 1));
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="auto" preserveAspectRatio="xMinYMin meet">';
    var d = new Date(start);
    for (var i = 0; i < weeks * 7; i++) {
      var col = Math.floor(i / 7), row = i % 7, has = dateSet.has(isoOf(d));
      var x = col * (cell + gap), y = row * (cell + gap);
      s += '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="2" fill="' + (has ? '#34d399' : '#232020') + '"' + (has ? '' : ' stroke="#292524" stroke-width="0.5"') + '/>';
      d.setDate(d.getDate() + 1);
    }
    return s + '</svg>';
  }

  // ---------------------------------------------------------- sections
  function renderDashboard() {
    var st = weightStats(), g = goal(), proj = projection(st, g), status = statusOf(st);
    var h = '';
    if (!st) {
      h = '<div class="empty">No entries yet. Log your first weight in the <b>Log</b> tab, or import your history in <b>Settings</b>.</div>';
      screenEl.innerHTML = h; return;
    }
    // hero
    var deltaColor = st.totalLost >= 0 ? 'var(--good)' : 'var(--alert)';
    h += '<div class="hero"><div class="hero-label">7-Day Trailing Average</div>' +
      '<div class="hero-row"><div class="hero-num">' + st.latest.rolling.toFixed(1) + '</div><div class="hero-unit">lbs</div></div>' +
      '<div class="hero-sub"><span class="k">latest </span><span class="v">' + st.latest.value.toFixed(1) + '</span>' +
      '<span class="k"> · start </span><span class="v">' + st.first.value.toFixed(1) + '</span></div>' +
      '<div class="hero-delta" style="color:' + deltaColor + '">' + (st.totalLost >= 0 ? '−' : '+') + Math.abs(st.totalLost).toFixed(1) + ' lbs · ' + st.pctLost.toFixed(1) + '%' +
      '<span style="color:var(--t-label)"> at ' + st.overallRate.toFixed(2) + ' lbs/wk</span></div></div>';

    // goal strip with ring
    if (proj) {
      var etaText = '';
      if (proj.reached) etaText = 'Goal reached.';
      else { var sc = proj.scenarios.find(function (x) { return !x.invalid; }); etaText = sc ? 'Goal <b>' + fmtETA(sc.eta) + '</b> at recent pace' : 'No recent loss to project'; }
      h += '<div class="goal-strip"><div class="ring-wrap">' + progressRing(proj.pctComplete) + '</div>' +
        '<div class="goal-strip-info"><div class="big">' + (proj.reached ? '0.0' : proj.remaining.toFixed(1)) + '</div>' +
        '<div class="lbl">lbs to goal · ' + g + '</div><div class="eta">' + etaText + '</div></div></div>';
    }

    // milestone tiles
    var streak = currentStreak(), l30 = countSince(30);
    h += '<div class="tiles" style="margin-bottom:24px">' +
      tile(Math.abs(st.totalLost).toFixed(1), 'lbs', 'Total ' + (st.totalLost >= 0 ? 'lost' : 'gained'), '', '') +
      tile(st.overallRate.toFixed(2), '', 'Overall lbs/wk', '', '') +
      tile(streak, '', 'Day streak', '', '') +
      tile(l30, '', 'Weigh-ins · 30d', '', '') +
      '</div>';

    // status
    var sc2 = STCOLOR[status.level];
    h += '<div class="status" style="border-color:color-mix(in srgb,' + sc2 + ' 22%, transparent)">' +
      '<div class="status-top"><span class="status-dot" style="background:' + sc2 + '"></span>' +
      '<span class="status-name" style="color:' + sc2 + '">Status — ' + esc(status.label) + '</span></div>' +
      '<div class="status-detail">' + esc(status.detail) + '</div></div>';

    // weight chart
    var chartData = rollingSeries('weight', win).map(function (r) { return { date: r.date, daily: r.value, rolling: parseFloat(r.rolling.toFixed(2)) }; });
    h += '<div class="section"><div class="chart-head"><div class="section-label" style="margin-bottom:0">Weight Trend</div>' +
      '<div class="pills">' + [7, 14, 21].map(function (w) { return '<button class="pill' + (win === w ? ' active' : '') + '" data-win="' + w + '">' + w + 'd</button>'; }).join('') + '</div></div>' +
      '<div class="chart-box">' + lineChart(chartData, { goal: g, dec: 0, color: '#a3d9a5' }) + '</div>' +
      '<div class="legend"><span><i style="background:#57534e"></i>daily</span><span><i style="background:#a3d9a5"></i>' + win + '-day avg</span><span><i style="background:#d4a056"></i>goal</span></div></div>';

    // consistency heatmap
    h += '<div class="section"><div class="section-label">Consistency · last 18 weeks</div>' +
      '<div class="card">' + heatmap(loggedDates()) + '</div></div>';

    // body composition mini-cards
    var comp = METRICS.filter(function (m) { return m.key !== 'weight'; }).map(function (m) {
      var s = metricSummary(m.key); return s ? { m: m, s: s } : null;
    }).filter(Boolean);
    if (comp.length) {
      h += '<div class="section"><div class="section-label">Body Composition</div><div class="mini-grid">';
      comp.forEach(function (c) {
        var deltaHtml = '';
        if (c.s.delta != null) {
          var good = c.m.goodDown ? c.s.delta < 0 : c.s.delta > 0;
          var col = Math.abs(c.s.delta) < 0.05 ? 'var(--t-label)' : (good ? 'var(--good)' : 'var(--alert)');
          deltaHtml = '<span class="mini-delta" style="color:' + col + '">' + signed(c.s.delta, c.m.dec) + ' · 30d</span>';
        }
        h += '<div class="mini"><div class="mini-top"><span class="mini-label">' + c.m.label + '</span></div>' +
          '<div class="mini-val">' + c.s.latest.toFixed(c.m.dec) + (c.m.unit ? '<span class="u">' + c.m.unit + '</span>' : '') + '</div>' +
          '<div class="mini-spark">' + sparkline(c.s.series, c.m.goodDown ? '#a3d9a5' : '#6ee7b7') + '</div>' + deltaHtml + '</div>';
      });
      h += '</div></div>';
    }

    h += '<div class="footer">Numbers shown unfiltered.</div>';
    screenEl.innerHTML = h;
    wireWinPills();
  }
  function tile(val, unit, label, subHtml) {
    return '<div class="tile"><div class="tile-val">' + val + (unit ? '<span class="u">' + unit + '</span>' : '') + '</div>' +
      '<div class="tile-label">' + label + '</div>' + (subHtml ? '<div class="tile-sub">' + subHtml + '</div>' : '') + '</div>';
  }
  function wireWinPills() {
    Array.prototype.forEach.call(screenEl.querySelectorAll('.pill[data-win]'), function (b) {
      b.addEventListener('click', function () { win = parseInt(b.dataset.win, 10); saveLocal(); renderDashboard(); });
    });
  }

  function renderTrends() {
    var m = metricDef(trendMetric);
    var full = rollingSeries(trendMetric, trendWin);
    // filter by range
    var data = full;
    if (trendRange && trendRange < 100000) { var cut = new Date(); cut.setDate(cut.getDate() - trendRange); data = full.filter(function (r) { return parseDate(r.date) >= cut; }); }
    var chartData = data.map(function (r) { return { date: r.date, daily: r.value, rolling: parseFloat(r.rolling.toFixed(2)) }; });
    var h = '';
    // metric picker
    h += '<div class="section"><div class="section-label">Metric</div><div class="pill-scroll">' +
      METRICS.map(function (mm) { return '<button class="pill' + (trendMetric === mm.key ? ' active' : '') + '" data-metric="' + mm.key + '">' + mm.label + '</button>'; }).join('') + '</div></div>';
    // range picker
    var ranges = [['30d', 30], ['90d', 90], ['6mo', 182], ['1y', 365], ['All', 100000]];
    h += '<div class="section"><div class="chart-head"><div class="pills">' +
      ranges.map(function (r) { return '<button class="pill' + (trendRange === r[1] ? ' active' : '') + '" data-range="' + r[1] + '">' + r[0] + '</button>'; }).join('') + '</div>' +
      '<div class="pills">' + [1, 7, 14].map(function (w) { return '<button class="pill' + (trendWin === w ? ' active' : '') + '" data-twin="' + w + '">' + (w === 1 ? 'raw' : w + 'd') + '</button>'; }).join('') + '</div></div>';

    if (chartData.length < 2) {
      h += '<div class="empty">Not enough ' + m.label.toLowerCase() + ' data in this range.</div></div>';
      screenEl.innerHTML = h; wireTrendControls(); return;
    }
    var latest = chartData[chartData.length - 1].rolling, firstV = chartData[0].rolling, chg = latest - firstV;
    var good = m.goodDown ? chg < 0 : chg > 0;
    h += '<div class="chart-box">' + lineChart(chartData, { dec: m.dec, color: m.goodDown ? '#a3d9a5' : '#6ee7b7', showDaily: trendWin > 1 }) + '</div>' +
      '<div class="legend"><span><i style="background:' + (m.goodDown ? '#a3d9a5' : '#6ee7b7') + '"></i>' + (trendWin === 1 ? 'raw' : trendWin + '-day avg') + '</span></div></div>';

    // stats for range
    h += '<div class="tiles" style="margin-bottom:20px">' +
      tile(latest.toFixed(m.dec), m.unit, 'Current (' + (trendWin === 1 ? 'raw' : trendWin + 'd') + ')') +
      tile((chg >= 0 ? '+' : '') + chg.toFixed(m.dec), m.unit, 'Change · range', '') +
      tile(Math.min.apply(null, chartData.map(function (d) { return d.daily; })).toFixed(m.dec), m.unit, 'Low') +
      tile(Math.max.apply(null, chartData.map(function (d) { return d.daily; })).toFixed(m.dec), m.unit, 'High') +
      '</div>';

    // weekly averages bar chart (weight only most useful, but works for any)
    var weekly = weeklyAverages(trendMetric, 12);
    if (weekly.length >= 2) {
      h += '<div class="section"><div class="section-label">Weekly Average · ' + m.label + '</div>' +
        '<div class="chart-box">' + barChart(weekly) + '</div></div>';
    }
    screenEl.innerHTML = h; wireTrendControls();
  }
  function weeklyAverages(key, weeksBack) {
    var s = sortedAll().filter(function (e) { return e[key] != null; });
    if (!s.length) return [];
    var byWeek = {};
    s.forEach(function (e) {
      var d = parseDate(e.date); var monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      var k = isoOf(monday);
      (byWeek[k] = byWeek[k] || []).push(Number(e[key]));
    });
    var keys = Object.keys(byWeek).sort().slice(-weeksBack);
    return keys.map(function (k) { var arr = byWeek[k]; return { label: fmtShort(k), value: arr.reduce(function (a, b) { return a + b; }, 0) / arr.length }; });
  }
  function wireTrendControls() {
    Array.prototype.forEach.call(screenEl.querySelectorAll('.pill[data-metric]'), function (b) { b.addEventListener('click', function () { trendMetric = b.dataset.metric; renderTrends(); }); });
    Array.prototype.forEach.call(screenEl.querySelectorAll('.pill[data-range]'), function (b) { b.addEventListener('click', function () { trendRange = parseInt(b.dataset.range, 10); renderTrends(); }); });
    Array.prototype.forEach.call(screenEl.querySelectorAll('.pill[data-twin]'), function (b) { b.addEventListener('click', function () { trendWin = parseInt(b.dataset.twin, 10); renderTrends(); }); });
  }

  function renderGoal() {
    var st = weightStats(), g = goal(), proj = projection(st, g);
    var h = '<div class="section"><div class="section-label">Goal Projection</div>';
    if (!st) { h += '<div class="empty">Log a few weigh-ins to see your projection.</div></div>'; screenEl.innerHTML = h; return; }
    h += '<div class="goal-card"><div class="goal-top">' +
      '<div><div class="mini-label2">target</div><input id="goalInput" class="goal-input" type="number" step="0.5" value="' + g + '"><span class="goal-unit">lbs</span></div>' +
      '<div class="goal-remaining"><div class="mini-label2">remaining</div><div class="val">' + (proj ? (proj.reached ? '0.0' : proj.remaining.toFixed(1)) : '—') + '</div></div></div>' +
      '<div class="progress"><div class="progress-track"><div class="progress-fill" style="width:' + (proj ? proj.pctComplete : 0) + '%"></div></div>' +
      '<div class="progress-scale"><span class="edge">' + st.first.value.toFixed(0) + '</span><span class="pct">' + (proj ? proj.pctComplete.toFixed(1) : '0.0') + '% complete</span><span class="edge">' + g.toFixed(0) + '</span></div></div></div>';

    if (proj && !proj.reached) {
      h += '<div class="table"><div class="thead eta-grid"><div>at this pace</div><div class="num">lbs/wk</div><div class="num">weeks</div><div class="num">eta</div></div>';
      proj.scenarios.forEach(function (sc) {
        h += '<div class="trow eta-grid"><div class="lead">' + esc(sc.label) + '</div>';
        if (sc.invalid) h += '<div class="invalid">no recent loss to project</div>';
        else h += '<div class="num muted">−' + sc.rate.toFixed(2) + '</div><div class="num muted">' + Math.ceil(sc.weeks) + '</div><div class="num" style="color:var(--good-dim)">' + fmtETA(sc.eta) + '</div>';
        h += '</div>';
      });
      h += '</div>';
    } else if (proj && proj.reached) { h += '<div class="empty">You\'ve reached your goal. Set a new target above.</div>'; }
    h += '</div>';

    // trend comparison table
    h += '<div class="section"><div class="section-label">Trend Comparison</div><div class="table">' +
      '<div class="thead trend-grid"><div>window</div><div class="num">avg then</div><div class="num">change</div><div class="num">lbs/wk</div></div>';
    st.trends.forEach(function (t) {
      var col = function (r) { var l = -r; return l > 1.5 ? 'var(--good)' : l > 0.5 ? 'var(--caution)' : l > -0.5 ? 'var(--warning)' : 'var(--alert)'; };
      h += '<div class="trow trend-grid"><div><div class="lead">−' + t.period + 'd</div>' + (t.valid ? '<div class="sub">' + fmtShort(t.pastDate) + '</div>' : '') + '</div>' +
        '<div class="num muted">' + (t.valid ? t.pastAvg.toFixed(2) : '—') + '</div>' +
        '<div class="num" style="color:' + (t.valid ? col(t.rate) : 'var(--t-label)') + '">' + (t.valid ? signed(t.delta, 2) : '—') + '</div>' +
        '<div class="num" style="color:' + (t.valid ? col(t.rate) : 'var(--t-label)') + '">' + (t.valid ? signed(t.rate, 2) : '—') + '</div></div>';
    });
    h += '</div></div>';
    screenEl.innerHTML = h;
    var gi = document.getElementById('goalInput');
    if (gi) gi.addEventListener('change', function () { var v = parseFloat(gi.value); if (isNaN(v) || v <= 0) return; user.goalWeight = v; saveGoal(v); renderGoal(); });
  }

  function renderLog() {
    var m = sortedAll();
    var h = '<div class="section"><div class="section-label">Log Entry</div>' +
      '<form id="logForm"><div class="log-row">' +
      '<label class="log-field date"><span class="field-label">date</span><input id="logDate" class="field-input" type="date" value="' + todayISO() + '"></label>' +
      '<label class="log-field weight"><span class="field-label">weight (lbs)</span><input id="logWeight" class="field-input" type="number" step="0.1" inputmode="decimal" placeholder="—"></label>' +
      '<button class="btn" type="submit">Save</button></div>' +
      '<button type="button" class="more-toggle" id="moreToggle">+ Body composition &amp; note</button>' +
      '<div class="more-panel" id="morePanel" hidden><div class="metric-grid">' +
      METRICS.filter(function (mm) { return mm.key !== 'weight'; }).map(function (mm) {
        return '<label class="metric-field"><span class="field-label">' + mm.label + (mm.unit ? ' (' + mm.unit + ')' : '') + '</span><input class="field-input metric-input" data-metric="' + mm.key + '" type="number" step="0.1" inputmode="decimal" placeholder="—"></label>';
      }).join('') +
      '</div><label class="metric-field"><span class="field-label">note</span><input id="logNote" class="field-input" type="text" placeholder="optional"></label></div></form></div>';

    // recent entries
    h += '<div class="section"><div class="section-label">Recent Entries</div>';
    if (!m.length) h += '<div class="empty">No entries yet.</div>';
    else {
      var roll7 = {}; rollingSeries('weight', 7).forEach(function (r) { roll7[r.date] = r.rolling; });
      var desc = m.slice().reverse(), shown = showAll ? desc : desc.slice(0, 14);
      h += '<div class="entries">';
      shown.forEach(function (e) {
        h += '<div class="entry-item"><div class="entry-row"><span class="entry-date">' + fmtShort(e.date) + '</span>' +
          '<span class="entry-raw">' + e.weight.toFixed(1) + '</span>' +
          '<span class="entry-avg">' + (roll7[e.date] != null ? roll7[e.date].toFixed(1) : '—') + '</span>' +
          '<button class="entry-del" data-id="' + esc(e.id || '') + '" data-date="' + esc(e.date) + '">✕</button></div>' +
          (e.note ? '<div class="entry-note">' + esc(e.note) + '</div>' : '') + '</div>';
      });
      h += '</div>';
      if (desc.length > 14) h += '<button class="entries-more" id="entriesMore">' + (showAll ? 'Show less' : 'Show all ' + desc.length) + '</button>';
    }
    h += '</div>';

    // import / export
    h += '<div class="section"><div class="import"><button class="import-toggle" id="importToggle" type="button">Import history</button>' +
      '<div class="import-panel" id="importPanel" hidden><p class="import-hint">Paste JSON or CSV (date, weight), or choose a file.</p>' +
      '<textarea id="importText" class="import-text" spellcheck="false" placeholder=\'{"entries":[{"date":"2026-01-04","weight":244}]}\'></textarea>' +
      '<div class="import-actions"><input type="file" id="importFile" class="import-file" accept=".json,.csv,.txt"><button class="btn" id="importRun" type="button">Import</button></div>' +
      '<p class="import-result" id="importResult"></p></div></div>' +
      '<div class="actions-row" style="margin-top:14px"><button class="mini-btn" id="exportCsv" type="button">Export CSV</button></div></div>';

    screenEl.innerHTML = h;
    wireLog();
  }

  function renderSettings() {
    var prefs = (user && user.prefs) || {}, remEnabled = !!prefs.reminderEnabled, remTime = prefs.reminderTime || '07:00';
    var apiKey = (user && user.apiKey) || '', origin = location.origin;
    var pushOk = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
    var h = '<div class="section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><div class="section-label" style="margin-bottom:0">Settings</div><button class="settings-done" id="settingsDone">Done</button></div>';

    h += '<div class="setting-card"><div class="setting-row"><span class="setting-name">Weigh-in reminder</span>' +
      '<button class="toggle-btn' + (remEnabled ? ' on' : '') + '" id="remToggle" type="button">' + (remEnabled ? 'On' : 'Off') + '</button></div>' +
      '<div class="setting-sub" id="remTimeRow"' + (remEnabled ? '' : ' hidden') + '><span class="field-label">remind me at</span><input id="remTime" class="field-input time" type="time" value="' + remTime + '"></div>' +
      '<p class="setting-hint">' + (pushOk ? 'Reminders need this app installed to your home screen (iPhone: Share → Add to Home Screen, then open from the icon).' : 'This browser can’t send notifications — install the app to your home screen.') + '</p></div>';

    h += '<div class="setting-card"><div class="setting-name">Apple Health sync</div>' +
      '<p class="setting-hint">Send your latest Apple Health weight here with an iOS Shortcut.</p>';
    if (apiKey) h += '<div class="key-row"><code class="key" id="apiKey">' + esc(apiKey) + '</code><button class="mini-btn" id="copyKey" type="button">Copy</button></div>';
    else h += '<button class="mini-btn" id="genKey" type="button">Generate sync key</button>';
    h += '<div class="key-row"><span class="field-label">endpoint</span><code class="key small">' + esc(origin) + '/api/weight-ingest</code></div>' +
      '<details class="shortcut-steps"><summary>Shortcut setup</summary><ol>' +
      '<li>Shortcuts → new shortcut.</li><li><b>Find Health Samples</b>: type <b>Weight</b>, sort by Date (newest), limit 1.</li>' +
      '<li><b>Get Contents of URL</b>: the endpoint above, POST, header <code>Content-Type: application/json</code>, JSON body <code>key</code>=your key, <code>weight</code>=the sample.</li>' +
      '<li>Run to test; add a daily Automation.</li></ol>' + (apiKey ? '<button class="mini-btn danger" id="regenKey" type="button">Regenerate key</button>' : '') + '</details></div>';

    h += '<div class="setting-card actions-row"><button class="mini-btn" id="signOut" type="button">Sign out' + (user ? ' · ' + esc(user.username) : '') + '</button></div>';
    h += '<div class="footer">Numbers shown unfiltered.</div></div>';
    screenEl.innerHTML = h;
    wireSettings();
  }

  // ---------------------------------------------------------- nav
  var TITLES = { dashboard: 'Dashboard', trends: 'Trends', goal: 'Goal', log: 'Log', settings: 'Settings' };
  function showSection(name) {
    section = name;
    if (appTitle) appTitle.textContent = TITLES[name] || '';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.classList.toggle('active', t.dataset.section === name); });
    if (screenEl) screenEl.scrollTop = 0; window.scrollTo(0, 0);
    render();
  }
  function render() {
    if (section === 'dashboard') renderDashboard();
    else if (section === 'trends') renderTrends();
    else if (section === 'goal') renderGoal();
    else if (section === 'log') renderLog();
    else if (section === 'settings') renderSettings();
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () { showSection(tab.dataset.section); });
  });
  document.getElementById('gearBtn').addEventListener('click', function () { showSection('settings'); });

  // ---------------------------------------------------------- api / persistence
  function api(method, path, opts) {
    opts = opts || {};
    var headers = { 'Authorization': 'Bearer ' + (token || '') }, init = { method: method, headers: headers };
    if (opts.body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(API + path + (opts.query || ''), init).then(function (res) {
      if (res.status === 401) { logout(); throw { code: 401 }; }
      return res.json().catch(function () { return {}; }).then(function (data) { if (!res.ok) throw { code: res.status, message: data.error }; return data; });
    });
  }
  function loadData() {
    return api('GET', '/weight-entries', { query: '?limit=5000' }).then(function (data) {
      entries = data.entries || []; user = data.user || user;
      if (user && user.prefs && [7, 14, 21].indexOf(user.prefs.window) >= 0) win = user.prefs.window;
    });
  }
  function reload() { return loadData().then(render); }
  function saveLocal() { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ win: win })); } catch (e) {} }
  function saveGoal(g) { api('PATCH', '/weight-entries', { body: { goalWeight: g } }).catch(function () {}); }

  // ---------------------------------------------------------- log events
  function wireLog() {
    var form = document.getElementById('logForm');
    if (form) form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var date = document.getElementById('logDate').value, wt = parseFloat(document.getElementById('logWeight').value);
      if (!date || isNaN(wt) || wt <= 0) { toast('Enter a valid date and weight.'); return; }
      var body = { date: date, weight: wt };
      Array.prototype.forEach.call(document.querySelectorAll('.metric-input'), function (inp) { var v = (inp.value || '').trim(); if (v !== '' && !isNaN(parseFloat(v))) body[inp.dataset.metric] = parseFloat(v); });
      var note = document.getElementById('logNote'); if (note && note.value.trim()) body.note = note.value.trim();
      api('POST', '/weight-entries', { body: body }).then(function () { toast('Saved.'); return reload(); }).catch(function (e) { if (e.code !== 401) toast(e.message || 'Save failed.'); });
    });
    var mt = document.getElementById('moreToggle');
    if (mt) mt.addEventListener('click', function () { var p = document.getElementById('morePanel'); if (p) p.hidden = !p.hidden; });
    Array.prototype.forEach.call(screenEl.querySelectorAll('.entry-del'), function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.id; if (!id) { toast('Cannot delete this entry.'); return; }
        if (!confirm('Delete the entry for ' + fmtShort(b.dataset.date) + '?')) return;
        api('DELETE', '/weight-entries', { query: '?id=' + encodeURIComponent(id) }).then(reload).catch(function (e) { if (e.code !== 401) toast(e.message || 'Delete failed.'); });
      });
    });
    var more = document.getElementById('entriesMore');
    if (more) more.addEventListener('click', function () { showAll = !showAll; renderLog(); });
    var it = document.getElementById('importToggle');
    if (it) it.addEventListener('click', function () { var p = document.getElementById('importPanel'); if (p) p.hidden = !p.hidden; });
    var ifile = document.getElementById('importFile');
    if (ifile) ifile.addEventListener('change', function () { var f = ifile.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { var ta = document.getElementById('importText'); if (ta) ta.value = r.result; }; r.readAsText(f); });
    var irun = document.getElementById('importRun'); if (irun) irun.addEventListener('click', doImport);
    var ex = document.getElementById('exportCsv'); if (ex) ex.addEventListener('click', exportCSV);
  }
  function normDate(s) { s = String(s || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return m[3] + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0'); var d = new Date(s); if (!isNaN(d.getTime())) return isoOf(d); return null; }
  function parseImportText(text) {
    text = (text || '').trim(); if (!text) return [];
    var rows = [];
    if (text[0] === '{' || text[0] === '[') {
      var data = null; try { data = JSON.parse(text); } catch (e) {}
      var arr = data && Array.isArray(data.entries) ? data.entries : (Array.isArray(data) ? data : []);
      arr.forEach(function (el) { if (Array.isArray(el)) rows.push({ date: el[0], weight: el[1] }); else if (el && typeof el === 'object') rows.push({ date: el.date, weight: el.weight }); });
    } else {
      text.split(/\r?\n/).forEach(function (line) { line = line.trim(); if (!line) return; var parts = line.split(/[,\t]/); if (parts.length < 2) return; if (/date/i.test(parts[0]) && /weight|lb|kg/i.test(parts[1])) return; rows.push({ date: parts[0], weight: parts[1] }); });
    }
    var out = [], seen = {};
    rows.forEach(function (r) { var date = normDate(r.date), weight = parseFloat(r.weight); if (date && isFinite(weight) && weight > 0) { seen[date] = { date: date, weight: weight, source: 'import' }; } });
    for (var k in seen) out.push(seen[k]);
    return out;
  }
  function doImport() {
    var res = document.getElementById('importResult'), rows = parseImportText(document.getElementById('importText').value);
    if (!rows.length) { res.textContent = 'No valid rows found.'; return; }
    res.textContent = 'Importing ' + rows.length + '…';
    api('POST', '/weight-entries', { body: { entries: rows } }).then(function (data) { toast('Imported ' + (data.added || 0) + ' entries.'); return reload(); }).catch(function (e) { if (e.code !== 401) res.textContent = e.message || 'Import failed.'; });
  }
  function exportCSV() {
    var header = 'date,weight,body_fat_pct,muscle_mass,body_water_pct,visceral_fat,bmi,metabolic_age,note';
    var asc = sortedAll(), lines = [header];
    asc.forEach(function (e) {
      var c = [e.date, e.weight, e.bodyFatPct, e.muscleMass, e.bodyWaterPct, e.visceralFat, e.bmi, e.metabolicAge, e.note ? '"' + String(e.note).replace(/"/g, '""') + '"' : ''];
      lines.push(c.map(function (x) { return x == null ? '' : x; }).join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'almanac-weight.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------------------------------------------------------- settings events
  function wireSettings() {
    var done = document.getElementById('settingsDone'); if (done) done.addEventListener('click', function () { showSection('dashboard'); });
    var remToggle = document.getElementById('remToggle');
    if (remToggle) remToggle.addEventListener('click', function () { if ((user.prefs || {}).reminderEnabled) disableReminders(); else enableReminders(); });
    var remTime = document.getElementById('remTime'); if (remTime) remTime.addEventListener('change', function () { if (/^\d{2}:\d{2}$/.test(remTime.value)) updateReminderTime(remTime.value); });
    var copyKey = document.getElementById('copyKey'); if (copyKey) copyKey.addEventListener('click', function () { var k = (user && user.apiKey) || ''; if (navigator.clipboard) navigator.clipboard.writeText(k).then(function () { toast('Key copied.'); }, function () { toast('Copy failed.'); }); else toast('Key: ' + k); });
    var genKey = document.getElementById('genKey'); if (genKey) genKey.addEventListener('click', regenApiKey);
    var regenKey = document.getElementById('regenKey'); if (regenKey) regenKey.addEventListener('click', function () { if (confirm('Regenerate your sync key? The old key stops working.')) regenApiKey(); });
    var signOut = document.getElementById('signOut'); if (signOut) signOut.addEventListener('click', logout);
  }
  function urlB64(b64) { var pad = '='.repeat((4 - b64.length % 4) % 4); var s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/'); var raw = atob(s); var a = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i); return a; }
  function currentTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { return null; } }
  function enableReminders() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { toast('Install to your home screen first.'); return; }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { toast('Notifications not allowed.'); return; }
      return navigator.serviceWorker.ready.then(function (reg) {
        return api('GET', '/weight-push').then(function (cfg) {
          if (!cfg.publicKey) { toast('Push not configured.'); throw { code: 0 }; }
          return reg.pushManager.getSubscription().then(function (ex) { return ex || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(cfg.publicKey) }); });
        }).then(function (sub) {
          var t = document.getElementById('remTime'); var time = (t && t.value) || '07:00';
          return api('POST', '/weight-push', { body: { subscription: sub.toJSON(), reminderTime: time, tz: currentTz() } });
        }).then(function (r) { user.prefs = Object.assign({}, user.prefs, { reminderEnabled: true, reminderTime: r.reminder.time, tz: r.reminder.tz }); toast('Reminders on.'); renderSettings(); });
      });
    }).catch(function (e) { if (e && e.code !== 401) toast('Could not enable reminders.'); });
  }
  function disableReminders() {
    var done = function () { user.prefs = Object.assign({}, user.prefs, { reminderEnabled: false }); renderSettings(); };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription().then(function (sub) { var ep = sub ? sub.endpoint : null; return (sub ? sub.unsubscribe() : Promise.resolve()).then(function () { return api('DELETE', '/weight-push', { body: { endpoint: ep } }); }); }); }).then(done).catch(done);
    } else { api('DELETE', '/weight-push', { body: {} }).then(done).catch(done); }
    toast('Reminders off.');
  }
  function updateReminderTime(time) { api('POST', '/weight-push', { body: { reminderTime: time, tz: currentTz() } }).then(function () { user.prefs = Object.assign({}, user.prefs, { reminderTime: time }); toast('Reminder time updated.'); }).catch(function () {}); }
  function regenApiKey() { api('PATCH', '/weight-entries', { body: { newApiKey: true } }).then(function (data) { if (data.user) { user.apiKey = data.user.apiKey; renderSettings(); toast('New sync key generated.'); } }).catch(function (e) { if (e.code !== 401) toast('Could not generate key.'); }); }

  // ---------------------------------------------------------- toast
  var toastTimer = null;
  function toast(msg) { var t = document.getElementById('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.classList.add('show'); if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800); }

  // ---------------------------------------------------------- auth
  var authMode = 'login';
  var authForm = document.getElementById('authForm'), authUser = document.getElementById('authUser'), authPass = document.getElementById('authPass'), authError = document.getElementById('authError'), authSubmit = document.getElementById('authSubmit');
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
    var username = (authUser.value || '').trim(), passcode = authPass.value || '';
    authError.hidden = true; authSubmit.disabled = true;
    fetch(API + '/weight-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: authMode, username: username, passcode: passcode }) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) {
        authSubmit.disabled = false;
        if (!res.ok) { authError.textContent = data.error || 'Something went wrong.'; authError.hidden = false; return; }
        token = data.token; user = data.user; try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
        loadData().then(showApp).catch(showApp);
      }); })
      .catch(function () { authSubmit.disabled = false; authError.textContent = 'Could not reach the server.'; authError.hidden = false; });
  });
  function logout() { token = null; user = null; entries = []; try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} showAuth(); }

  // ---------------------------------------------------------- boot / screens
  function showAuth() { appEl.hidden = true; authScreen.hidden = false; setTimeout(function () { authUser && authUser.focus(); }, 50); }
  function showApp() { authScreen.hidden = true; appEl.hidden = false; showSection('dashboard'); }
  if (token) { loadData().then(showApp).catch(function (e) { if (e && e.code === 401) return; showAuth(); }); }
  else showAuth();

  // Dev hook (localhost only) for rendering with mock data.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    window.__almanacDev = function (mockEntries, mockUser) { user = mockUser || { username: 'demo', goalWeight: 175, prefs: {} }; entries = mockEntries || []; token = 'dev'; showApp(); };
  }
})();
