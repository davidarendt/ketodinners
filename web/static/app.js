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
  if (/kielbasa|andouille|pulled-pork|pork|chorizo|sausage/.test(id)) return 'pork';
  if (/turkey/.test(id)) return 'turkey';
  if (/chicken/.test(id)) return 'chicken';
  if (/beef|steak|bulgogi|smash-burger|chuck/.test(id)) return 'beef';
  return 'other';
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
  btn.title = state.teddyApproved ? 'Kid Friendly — click to clear' : 'Kid Friendly?';
  btn.textContent = 'K';
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
    btn.title = state.teddyApproved ? 'Kid Friendly — click to clear' : 'Kid Friendly?';
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
    btn.className = 'ease-btn ease-' + i + (i === ease ? ' lit' : '');
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

function makeRow(recipe, position) {
  var a = document.createElement('a');
  a.className = 'meal-row';
  a.href = recipeUrl(recipe.id);
  a.dataset.protein = getProtein(recipe.id);
  if (position) {
    var num = document.createElement('span');
    num.className = 'mnum';
    num.textContent = position;
    a.appendChild(num);
  }
  var name = document.createElement('span');
  name.className = 'mname';
  name.textContent = recipe.title;
  var ratings = document.createElement('span');
  ratings.className = 'row-ratings';
  ratings.appendChild(renderTeddy(recipe.id));
  ratings.appendChild(renderEase(recipe.id));
  ratings.appendChild(renderStars(recipe.id));
  a.appendChild(name);
  a.appendChild(ratings);
  return a;
}

function renderMealPlan() {
  var el = document.getElementById('viewMealplan');
  el.innerHTML = '';
  var seq = [];
  recipes.forEach(function(r) {
    (r.positions || []).forEach(function(p) { seq.push({ pos: p, recipe: r }); });
  });
  seq.sort(function(a, b) { return a.pos - b.pos; });
  var card = document.createElement('div');
  card.className = 'week-card meal-card-full';
  var list = document.createElement('div');
  list.className = 'meal-list';
  seq.forEach(function(item) { list.appendChild(makeRow(item.recipe, item.pos)); });
  card.appendChild(list);
  el.appendChild(card);
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
    var countEl = document.getElementById('dinnerCount');
    if (countEl) countEl.textContent = recipes.reduce(function(sum, r) { return sum + (r.positions ? r.positions.length : 0); }, 0);
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
