const PROTEINS = ['all', 'beef', 'chicken', 'turkey', 'pork', 'lamb', 'eggs', 'duck', 'tofu'];
const CATEGORY_ORDER = ['Produce', 'Meat and Seafood', 'Dairy and Eggs', 'Pantry and Spices', 'Other'];

let recipes = [];
let states = {};
let selected = new Set();
let haveItems = new Set();
let shoppingData = null;

// ---- persistence ----
function loadSelected() {
  try { (JSON.parse(localStorage.getItem('cartSelected')) || []).forEach(function(x) { selected.add(x); }); } catch (e) {}
}
function persistSelected() {
  try { localStorage.setItem('cartSelected', JSON.stringify(Array.from(selected))); } catch (e) {}
}
function loadHave() {
  try { (JSON.parse(localStorage.getItem('pantryHave')) || []).forEach(function(x) { haveItems.add(x); }); } catch (e) {}
}
function persistHave() {
  try { localStorage.setItem('pantryHave', JSON.stringify(Array.from(haveItems))); } catch (e) {}
}

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

// ---- completed (cooked) marking ----
function renderDone(recipeId) {
  var b = document.createElement('button');
  b.className = 'done-btn' + ((states[recipeId] || {}).completed ? ' done' : '');
  b.dataset.recipeId = recipeId;
  b.title = 'Mark as cooked';
  b.textContent = '✓';
  b.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    var nv = !((states[recipeId] || {}).completed);
    states[recipeId] = Object.assign({}, states[recipeId] || {}, { completed: nv });
    updateAllDone(recipeId);
    saveCompleted(recipeId, nv);
  });
  return b;
}
function updateAllDone(recipeId) {
  var c = !!(states[recipeId] || {}).completed;
  document.querySelectorAll('.done-btn[data-recipe-id="' + recipeId + '"]').forEach(function(b) { b.classList.toggle('done', c); });
  document.querySelectorAll('a.meal-row[data-recipe-id="' + recipeId + '"]').forEach(function(r) { r.classList.toggle('done', c); });
}
function saveCompleted(recipeId, val) {
  fetch('/api/recipe-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipeId: recipeId, completed: val }),
  }).then(function(res) {
    return res.json().then(function(data) {
      if (!res.ok) throw new Error(data.error || 'Failed');
      states[recipeId] = Object.assign({}, states[recipeId] || {}, data.state);
      updateAllDone(recipeId);
    });
  }).catch(function() {
    states[recipeId] = Object.assign({}, states[recipeId] || {}, { completed: !val });
    updateAllDone(recipeId);
  });
}

// ---- shopping-cart selection ----
function renderSelect(recipeId) {
  var b = document.createElement('button');
  b.className = 'sel-box' + (selected.has(recipeId) ? ' on' : '');
  b.dataset.recipeId = recipeId;
  b.title = 'Add to shopping list';
  b.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    if (selected.has(recipeId)) selected.delete(recipeId); else selected.add(recipeId);
    persistSelected();
    updateAllSelect(recipeId);
    updateCartBar();
  });
  return b;
}
function updateAllSelect(recipeId) {
  var on = selected.has(recipeId);
  document.querySelectorAll('.sel-box[data-recipe-id="' + recipeId + '"]').forEach(function(b) { b.classList.toggle('on', on); });
  document.querySelectorAll('a.meal-row[data-recipe-id="' + recipeId + '"]').forEach(function(r) { r.classList.toggle('selected', on); });
}
function clearSelection() {
  var ids = Array.from(selected);
  selected.clear();
  persistSelected();
  ids.forEach(updateAllSelect);
  updateCartBar();
}

function makeRow(recipe, position) {
  var a = document.createElement('a');
  a.className = 'meal-row' + ((states[recipe.id] || {}).completed ? ' done' : '') + (selected.has(recipe.id) ? ' selected' : '');
  a.href = recipeUrl(recipe.id);
  a.dataset.protein = getProtein(recipe.id);
  a.dataset.recipeId = recipe.id;
  a.appendChild(renderSelect(recipe.id));
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
  ratings.appendChild(renderDone(recipe.id));
  a.appendChild(name);
  a.appendChild(ratings);
  return a;
}

// ---- sticky cart bar ----
function ensureCartBar() {
  var bar = document.getElementById('cartBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'cartBar';
    bar.className = 'cart-bar';
    bar.hidden = true;
    var info = document.createElement('span');
    info.className = 'cart-info';
    info.id = 'cartInfo';
    var actions = document.createElement('span');
    actions.className = 'cart-actions';
    var clr = document.createElement('button');
    clr.className = 'cart-clear';
    clr.textContent = 'Clear';
    clr.addEventListener('click', clearSelection);
    var build = document.createElement('button');
    build.className = 'cart-build';
    build.textContent = 'Build Shopping List';
    build.addEventListener('click', buildAndShowShopping);
    actions.appendChild(clr);
    actions.appendChild(build);
    bar.appendChild(info);
    bar.appendChild(actions);
    document.body.appendChild(bar);
  }
  return bar;
}
function updateCartBar() {
  var bar = ensureCartBar();
  var n = selected.size;
  bar.hidden = n === 0;
  document.body.classList.toggle('has-cart-bar', n > 0);
  var info = document.getElementById('cartInfo');
  if (info) info.textContent = n + ' meal' + (n === 1 ? '' : 's') + ' selected';
}

// ---- shopping list view ----
function cleanForSearch(text) {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,.*$/, '')
    .replace(/^[\d\/.\s–-]+/, '')
    .replace(/^(lbs?|oz|ounces?|pounds?|cups?|tbsp|tablespoons?|tsp|teaspoons?|cloves?|cans?|bags?|g|kg|ml|slices?|sprigs?|heads?|bunch|pinch)\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function walmartUrl(text) {
  var q = cleanForSearch(text) || text;
  return 'https://www.walmart.com/search?q=' + encodeURIComponent(q);
}
function haveKey(s) { return s.toLowerCase().replace(/\s+/g, ' ').trim(); }

function buildAndShowShopping() {
  var ids = Array.from(selected);
  if (!ids.length) { showView('shopping'); return; }
  showView('shopping');
  var el = document.getElementById('viewShopping');
  el.innerHTML = '<p class="loading-msg">Building your list…</p>';
  fetch('/api/shopping-list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipeIds: ids }),
  }).then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) throw new Error(data.error);
      shoppingData = data;
      renderShopping(el, data);
    })
    .catch(function() { el.innerHTML = '<p class="loading-msg">Could not build the list.</p>'; });
}

function renderShopping(el, data) {
  el.innerHTML = '';
  var card = document.createElement('div');
  card.className = 'shop-card';
  el.appendChild(card);
  var head = document.createElement('div');
  head.className = 'shop-head';
  var title = document.createElement('div');
  title.className = 'shop-title';
  title.textContent = 'Shopping List';
  var sub = document.createElement('div');
  sub.className = 'shop-sub';
  sub.textContent = (data.selected || []).length + ' meals · ' + (data.selected || []).join(', ');
  head.appendChild(title);
  head.appendChild(sub);
  card.appendChild(head);

  var toolbar = document.createElement('div');
  toolbar.className = 'shop-toolbar';
  var prog = document.createElement('span');
  prog.className = 'shop-progress';
  prog.id = 'shopProgress';
  var wm = document.createElement('a');
  wm.className = 'shop-walmart';
  wm.href = 'https://www.walmart.com/';
  wm.target = '_blank';
  wm.rel = 'noopener';
  wm.textContent = 'Open Walmart ↗';
  toolbar.appendChild(prog);
  toolbar.appendChild(wm);
  card.appendChild(toolbar);

  var container = document.createElement('div');
  container.className = 'shop-cats';
  function addCat(map, needed) {
    CATEGORY_ORDER.forEach(function(cat) {
      var items = (map[cat] || []);
      if (!items.length) return;
      var group = document.createElement('div');
      group.className = 'shop-cat';
      var lbl = document.createElement('div');
      lbl.className = 'shop-cat-label';
      lbl.textContent = needed ? cat + ' · as needed' : cat;
      group.appendChild(lbl);
      items.forEach(function(text) {
        var row = document.createElement('div');
        row.className = 'shop-item' + (haveItems.has(haveKey(text)) ? ' have' : '');
        var chk = document.createElement('button');
        chk.className = 'have-box';
        chk.title = 'I already have this';
        chk.addEventListener('click', function() { toggleHave(text, row); });
        var t = document.createElement('span');
        t.className = 'shop-item-text';
        t.textContent = text;
        var lk = document.createElement('a');
        lk.className = 'shop-item-link';
        lk.href = walmartUrl(text);
        lk.target = '_blank';
        lk.rel = 'noopener';
        lk.title = 'Search on Walmart';
        lk.textContent = '🔍';
        row.appendChild(chk);
        row.appendChild(t);
        row.appendChild(lk);
        group.appendChild(row);
      });
      container.appendChild(group);
    });
  }
  addCat(data.consolidated || {}, false);
  addCat(data.asNeeded || {}, true);
  card.appendChild(container);
  updateShopProgress();
}
function toggleHave(text, row) {
  var k = haveKey(text);
  if (haveItems.has(k)) { haveItems.delete(k); row.classList.remove('have'); }
  else { haveItems.add(k); row.classList.add('have'); }
  persistHave();
  updateShopProgress();
}
function updateShopProgress() {
  var total = document.querySelectorAll('#viewShopping .shop-item').length;
  var have = document.querySelectorAll('#viewShopping .shop-item.have').length;
  var p = document.getElementById('shopProgress');
  if (p) p.textContent = (total - have) + ' to buy · ' + have + ' already have';
}
function renderShoppingPlaceholder() {
  var el = document.getElementById('viewShopping');
  el.innerHTML = '<div class="shop-empty"><p>No meals selected yet.</p>'
    + '<p>Go to <strong>Meal Plan</strong> or <strong>Browse All</strong>, tap the checkbox on each meal you want to shop for, then tap <strong>Build Shopping List</strong>.</p></div>';
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
  var shop = document.getElementById('viewShopping');
  if (shop) shop.hidden = name !== 'shopping';
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.view === name);
  });
}

function openView(name) {
  showView(name);
  if (name === 'shopping' && !shoppingData) {
    if (selected.size) buildAndShowShopping();
    else renderShoppingPlaceholder();
  }
}

document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() { openView(tab.dataset.view); });
});

function init() {
  loadSelected();
  loadHave();
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
    updateCartBar();
    showView('mealplan');
  }).catch(function(err) {
    var msg = document.getElementById('loadingMsg');
    if (msg) msg.textContent = 'Failed to load recipes.';
    console.error(err);
  });
}

init();
