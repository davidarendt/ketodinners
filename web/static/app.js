const WEEKS = {
  1: { bg: '#1F4E79', label: 'Week 1 \u2014 Mediterranean & American' },
  2: { bg: '#375623', label: 'Week 2 \u2014 Korean & Bold' },
  3: { bg: '#843C0C', label: 'Week 3 \u2014 Comfort & Global' },
  4: { bg: '#4A235A', label: 'Week 4 \u2014 Global Tour' },
  5: { bg: '#7B241C', label: 'Week 5 \u2014 Smoky & Rich' },
  6: { bg: '#0D6E54', label: 'Week 6 \u2014 Finish Strong' },
  7: { bg: '#1F4E79', label: 'Week 7 \u2014 Italian & Global' },
  8: { bg: '#843C0C', label: 'Week 8 \u2014 Mexican & Bold' },
  9: { bg: '#375623', label: 'Week 9 \u2014 Smoky & Hearty' },
  10: { bg: '#4A235A', label: 'Week 10 \u2014 Mediterranean & Rich' },
  11: { bg: '#7B241C', label: 'Week 11 \u2014 Global & Bold' },
  12: { bg: '#0D6E54', label: 'Week 12 \u2014 Finish Strong' },
};

const PROTEINS = ['all', 'beef', 'chicken', 'turkey', 'pork', 'lamb', 'eggs', 'duck', 'tofu'];

let recipes = [];
let states = {};

function recipeUrl(id) {
  return '/recipes/' + id;
}

function getProtein(id) {
  if (/frittata|shakshuka|baked-egg|bacon-egg|eggs-en-cocotte|egg-scramble|egg-fried|quiche|egg-bake/.test(id)) return 'eggs';
  if (/duck/.test(id)) return 'duck';
  if (/tofu/.test(id)) return 'tofu';
  if (/lamb/.test(id)) return 'lamb';
  if (/kielbasa|andouille|pulled-pork|pork|chorizo/.test(id)) return 'pork';
  if (/turkey/.test(id)) return 'turkey';
  if (/chicken/.test(id)) return 'chicken';
  if (/beef|steak|bulgogi|smash-burger|chuck/.test(id)) return 'beef';
  return 'other';
}

function weeksAgo(isoDate) {
  if (!isoDate) return '';
  var weeks = Math.floor((Date.now() - new Date(isoDate).getTime()) / 604800000);
  if (weeks < 1) return 'this week';
  return weeks + 'w ago';
}

function renderCooked(recipeId) {
  var state = states[recipeId] || {};
  var wrap = document.createElement('span');
  wrap.className = 'cooked-wrap';
  wrap.dataset.recipeId = recipeId;
  var ago = document.createElement('span');
  ago.className = 'cooked-ago';
  ago.textContent = state.completedAt ? weeksAgo(state.completedAt) : '';
  var btn = document.createElement('button');
  btn.className = 'cooked-btn' + (state.completed ? ' done' : '');
  btn.title = state.completed ? 'Mark as not cooked' : 'Mark as cooked';
  btn.textContent = '\u2713';
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    var newVal = !(states[recipeId] || {}).completed;
    states[recipeId] = Object.assign({}, states[recipeId] || {}, { completed: newVal });
    if (newVal) states[recipeId].completedAt = new Date().toISOString();
    updateAllCooked(recipeId);
    saveCompleted(recipeId, newVal);
  });
  wrap.appendChild(ago);
  wrap.appendChild(btn);
  return wrap;
}

function updateAllCooked(recipeId) {
  var state = states[recipeId] || {};
  document.querySelectorAll('.cooked-wrap[data-recipe-id="' + recipeId + '"]').forEach(function(wrap) {
    var btn = wrap.querySelector('.cooked-btn');
    var ago = wrap.querySelector('.cooked-ago');
    btn.classList.toggle('done', !!state.completed);
    btn.title = state.completed ? 'Mark as not cooked' : 'Mark as cooked';
    ago.textContent = state.completedAt ? weeksAgo(state.completedAt) : '';
  });
  updateAllTeddy(recipeId);
}

function saveCompleted(recipeId, completed) {
  var prev = Object.assign({}, states[recipeId] || {});
  fetch('/api/recipe-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipeId: recipeId, completed: completed }),
  }).then(function(res) {
    return res.json().then(function(data) {
      if (!res.ok) throw new Error(data.error || 'Failed');
      states[recipeId] = Object.assign({}, states[recipeId] || {}, data.state);
      updateAllCooked(recipeId);
    });
  }).catch(function() {
    states[recipeId] = prev;
    updateAllCooked(recipeId);
  });
}

function renderStars(recipeId) {
  const rating = (states[recipeId] || {}).rating || 0;
  const wrap = document.createElement('span');
  wrap.className = 'stars';
  wrap.dataset.recipeId = recipeId;
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement('button');
    btn.className = 'star' + (i <= rating ? ' lit' : '');
    btn.textContent = '\u2605';
    btn.title = 'Rate ' + i + ' star' + (i > 1 ? 's' : '');
    const val = i;
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const current = (states[recipeId] || {}).rating || 0;
      saveRating(recipeId, current === val ? 0 : val);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

function updateStars(wrap, rating) {
  wrap.querySelectorAll('.star').forEach(function(btn, idx) {
    var wasLit = btn.classList.contains('lit');
    var nowLit = idx < rating;
    btn.classList.toggle('lit', nowLit);
    if (nowLit && !wasLit) {
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
    }
  });
}

function updateAllStars(recipeId, rating) {
  document.querySelectorAll('.stars[data-recipe-id="' + recipeId + '"]').forEach(function(wrap) {
    updateStars(wrap, rating);
  });
}

function saveRating(recipeId, rating) {
  const prev = (states[recipeId] || {}).rating || 0;
  updateAllStars(recipeId, rating);
  fetch('/api/recipe-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipeId: recipeId, rating: rating }),
  }).then(function(res) {
    return res.json().then(function(data) {
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      states[recipeId] = Object.assign({}, states[recipeId] || {}, data.state);
      updateAllStars(recipeId, (data.state || {}).rating || 0);
    });
  }).catch(function() {
    updateAllStars(recipeId, prev);
  });
}

function renderTeddy(recipeId) {
  var state = states[recipeId] || {};
  var btn = document.createElement('button');
  btn.className = 'teddy-btn' + (state.teddyApproved ? ' approved' : '');
  btn.dataset.recipeId = recipeId;
  btn.title = state.teddyApproved ? 'Teddy approved — click to clear' : 'Teddy approved?';
  btn.textContent = 'T';
  if (!state.completed) btn.disabled = true;
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    var newVal = !(states[recipeId] || {}).teddyApproved;
    states[recipeId] = Object.assign({}, states[recipeId] || {}, { teddyApproved: newVal || null });
    updateAllTeddy(recipeId);
    saveTeddy(recipeId, newVal || null);
  });
  return btn;
}

function updateAllTeddy(recipeId) {
  var state = states[recipeId] || {};
  document.querySelectorAll('.teddy-btn[data-recipe-id="' + recipeId + '"]').forEach(function(btn) {
    btn.classList.toggle('approved', !!state.teddyApproved);
    btn.disabled = !state.completed;
    btn.title = state.teddyApproved ? 'Teddy approved — click to clear' : 'Teddy approved?';
  });
}

function saveTeddy(recipeId, val) {
  var prev = (states[recipeId] || {}).teddyApproved;
  fetch('/api/recipe-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipeId: recipeId, teddyApproved: val }),
  }).then(function(res) {
    return res.json().then(function(data) {
      if (!res.ok) throw new Error(data.error || 'Failed');
      states[recipeId] = Object.assign({}, states[recipeId] || {}, data.state);
      updateAllTeddy(recipeId);
    });
  }).catch(function() {
    states[recipeId] = Object.assign({}, states[recipeId] || {}, { teddyApproved: prev });
    updateAllTeddy(recipeId);
  });
}

var EASE_LABELS = ['', 'Easy', 'Med', 'Hard'];

function renderEase(recipeId) {
  var ease = (states[recipeId] || {}).ease || 0;
  var wrap = document.createElement('span');
  wrap.className = 'ease';
  wrap.dataset.recipeId = recipeId;
  for (var i = 1; i <= 3; i++) {
    var btn = document.createElement('button');
    btn.className = 'ease-btn' + (i === ease ? ' lit' : '');
    btn.textContent = EASE_LABELS[i];
    btn.title = EASE_LABELS[i];
    var val = i;
    btn.addEventListener('click', (function(v) {
      return function(e) {
        e.preventDefault();
        var current = (states[recipeId] || {}).ease || 0;
        saveEase(recipeId, current === v ? null : v);
      };
    })(val));
    wrap.appendChild(btn);
  }
  return wrap;
}

function updateAllEase(recipeId, ease) {
  document.querySelectorAll('.ease[data-recipe-id="' + recipeId + '"]').forEach(function(wrap) {
    wrap.querySelectorAll('.ease-btn').forEach(function(btn, idx) {
      btn.classList.toggle('lit', idx + 1 === ease);
    });
  });
}

function saveEase(recipeId, ease) {
  var prev = (states[recipeId] || {}).ease || 0;
  states[recipeId] = Object.assign({}, states[recipeId] || {}, { ease: ease });
  updateAllEase(recipeId, ease);
  fetch('/api/recipe-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipeId: recipeId, ease: ease }),
  }).then(function(res) {
    return res.json().then(function(data) {
      if (!res.ok) throw new Error(data.error || 'Failed');
      states[recipeId] = Object.assign({}, states[recipeId] || {}, data.state);
      updateAllEase(recipeId, (data.state || {}).ease || 0);
    });
  }).catch(function() {
    states[recipeId] = Object.assign({}, states[recipeId] || {}, { ease: prev });
    updateAllEase(recipeId, prev);
  });
}

function makeRow(recipe) {
  var a = document.createElement('a');
  a.className = 'meal-row';
  a.href = recipeUrl(recipe.id);
  a.dataset.protein = getProtein(recipe.id);
  var name = document.createElement('span');
  name.className = 'mname';
  name.textContent = recipe.title;
  a.appendChild(name);
  a.appendChild(renderCooked(recipe.id));
  a.appendChild(renderTeddy(recipe.id));
  a.appendChild(renderEase(recipe.id));
  a.appendChild(renderStars(recipe.id));
  return a;
}

function renderMealPlan() {
  var el = document.getElementById('viewMealplan');
  el.innerHTML = '';
  var weekMap = {};
  recipes.forEach(function(r) {
    var ws = r.weeks && r.weeks.length ? r.weeks : (r.week ? [r.week] : [0]);
    ws.forEach(function(w) {
      if (!weekMap[w]) weekMap[w] = [];
      weekMap[w].push(r);
    });
  });
  var weeks = Object.keys(weekMap).map(Number).sort(function(a, b) { return a - b; });
  weeks.forEach(function(w) {
    var info = WEEKS[w] || { bg: '#1C2B3A', label: 'Week ' + w };
    var card = document.createElement('div');
    card.className = 'week-card';
    var header = document.createElement('div');
    header.className = 'week-header';
    header.style.background = info.bg;
    header.textContent = info.label;
    var list = document.createElement('div');
    list.className = 'meal-list';
    weekMap[w].forEach(function(r) { list.appendChild(makeRow(r)); });
    card.appendChild(header);
    card.appendChild(list);
    el.appendChild(card);
  });
}

function applyBrowseFilter(list, protein) {
  list.querySelectorAll('a.meal-row').forEach(function(row) {
    row.style.display = (protein === 'all' || row.dataset.protein === protein) ? '' : 'none';
  });
}

function renderBrowse() {
  var el = document.getElementById('viewBrowse');
  el.innerHTML = '';

  var header = document.createElement('div');
  header.className = 'browse-header';
  header.textContent = 'All Recipes';

  var filterBar = document.createElement('div');
  filterBar.className = 'filter-bar';

  var list = document.createElement('div');
  list.className = 'meal-list';
  recipes.slice().sort(function(a, b) { return a.title.localeCompare(b.title); }).forEach(function(r) {
    list.appendChild(makeRow(r));
  });

  PROTEINS.forEach(function(p) {
    var btn = document.createElement('button');
    btn.className = 'filter-btn' + (p === 'all' ? ' active' : '');
    btn.textContent = p === 'all' ? 'All' : p.charAt(0).toUpperCase() + p.slice(1);
    btn.addEventListener('click', function() {
      filterBar.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      applyBrowseFilter(list, p);
    });
    filterBar.appendChild(btn);
  });

  el.appendChild(header);
  el.appendChild(filterBar);
  el.appendChild(list);
}

function showView(name) {
  document.getElementById('viewMealplan').hidden = name !== 'mealplan';
  document.getElementById('viewBrowse').hidden = name !== 'browse';
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.view === name);
  });
}

document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() { showView(tab.dataset.view); });
});

function init() {
  Promise.all([
    fetch('/api/recipes').then(function(r) { return r.json(); }),
    fetch('/api/recipe-states').then(function(r) { return r.ok ? r.json() : { states: {} }; }).catch(function() { return { states: {} }; }),
  ]).then(function(results) {
    recipes = results[0].recipes || [];
    states = results[1].states || {};
    var msg = document.getElementById('loadingMsg');
    if (msg) msg.remove();
    renderMealPlan();
    renderBrowse();
    showView('mealplan');
  }).catch(function(err) {
    var msg = document.getElementById('loadingMsg');
    if (msg) msg.textContent = 'Failed to load recipes.';
    console.error(err);
  });
}

init();
