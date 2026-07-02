const fs = require('fs');
const path = require('path');
const { fetchRecipeOverrides } = require('./_lib/supabase');

function rawHtmlDir() {
  const fromCwd = path.resolve(process.cwd(), 'recipes', 'raw-html');
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(__dirname, '..', '..', 'recipes', 'raw-html');
}

function sanitizeSlug(raw) {
  return (raw || '').replace(/[^a-z0-9-]/gi, '');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescHtml(str) {
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function cleanPersonalLabels(html) {
  // Remove time, servings, David/Anne, and Teddy meta spans
  html = html.replace(/<span>(?:⏱|🍽|🍷|👦)[^<]*<\/span>/g, '');
  // Remove empty meta div if nothing remains
  html = html.replace(/<div class="meta">\s*<\/div>/g, '');
  // Remove notes that are David/Anne-only callouts
  html = html.replace(/<div class="note">(?:→ )?David[^<]*<\/div>/g, '');
  // Remove David/Anne and Teddy Approved tag pills
  html = html.replace(/<span class="tag">(?:David[^<]*|Teddy Approved)<\/span>/g, '');
  return html;
}

function applyOverrides(html, override) {
  if (override.title) {
    html = html.replace(/<title>[^<]*<\/title>/, '<title>' + escHtml(override.title) + '</title>');
    html = html.replace(/(<h1[^>]*>)[^<]*(<\/h1>)/, '$1' + escHtml(override.title) + '$2');
  }
  if (override.description) {
    html = html.replace(/(<p class="desc">)[\s\S]*?(<\/p>)/, '$1' + escHtml(override.description) + '$2');
  }
  if (override.image) {
    html = html.replace(
      /(<div class="hero">\s*<img[^>]* src=")[^"]*(")/,
      '$1' + override.image.replace(/"/g, '&quot;') + '$2'
    );
  }
  if (override.ingredients && override.ingredients.length > 0) {
    const ingItems = override.ingredients.map(item =>
      `<div class="ing-item"><span class="dot">·</span>${escHtml(item)}</div>`
    ).join('');
    html = html.replace(
      /(<div class="sec-label">Ingredients<\/div>)[\s\S]*?(<\/div>\s*<div>\s*<div class="sec-label">Instructions)/,
      '$1\n    <div class="ing-group">\n      ' + ingItems + '\n    </div>\n  $2'
    );
  }
  if (override.instructions && override.instructions.length > 0) {
    const stepsHtml = override.instructions.map((step, i) => {
      const colonIdx = step.indexOf(': ');
      let titleHtml = '';
      let text = step;
      if (colonIdx > 0 && colonIdx <= 50) {
        titleHtml = `\n        <div class="step-title">${escHtml(step.slice(0, colonIdx))}</div>`;
        text = step.slice(colonIdx + 2);
      }
      return `    <div class="step">\n      <div class="step-num">${i + 1}</div>\n      <div class="step-content">${titleHtml}\n        <div class="step-text">${escHtml(text)}</div>\n      </div>\n    </div>`;
    }).join('\n  \n  ');
    html = html.replace(
      /(<div class="sec-label">Instructions<\/div>)[\s\S]*?(\s*<\/div>\s*<\/div>\s*<div class="notes-box">)/,
      '$1\n  ' + stepsHtml + '\n  $2'
    );
  }
  return html;
}

const MOBILE_STYLES = `<style>
@media(max-width:480px){
  .hero{height:300px}
  .hero-content{padding:16px 20px}
  .hero h1{font-size:clamp(22px,7vw,34px)}
  .stat{padding:12px 6px}
  .sv{font-size:19px}
  .body{padding:28px 0 40px}
  .two{gap:28px}
  .step{grid-template-columns:32px 1fr;gap:10px}
  .step-num{width:32px;height:32px;font-size:14px}
  .desc{font-size:15px}
  .notes-box{padding:18px 20px}
  .meta{gap:12px;font-size:12px;flex-wrap:wrap}
}
</style>`;

function editPanel(slug, current) {
  return `<style>
#edit-fab{position:fixed;bottom:24px;right:24px;width:44px;height:44px;border-radius:50%;background:#1C2B3A;color:#fff;border:none;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);z-index:999;opacity:.65;transition:opacity .2s}
#edit-fab:hover{opacity:1}
#edit-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center}
#edit-modal.open{display:flex}
#edit-box{background:#fff;border-radius:6px;padding:28px 32px;width:100%;max-width:500px;margin:16px;box-shadow:0 8px 32px rgba(0,0,0,.2);max-height:90vh;overflow-y:auto}
#edit-box h2{font-family:'Playfair Display',serif;font-size:20px;color:#1C2B3A;margin-bottom:20px}
.ef-label{font-size:11px;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:#6B5E4E;margin-bottom:6px;display:block}
.ef-input,.ef-textarea{width:100%;border:1px solid #d8cfc3;border-radius:4px;padding:9px 12px;font-family:'DM Sans',sans-serif;font-size:14px;color:#2C2416;margin-bottom:16px;outline:none;box-sizing:border-box}
.ef-input:focus,.ef-textarea:focus{border-color:#C4622D}
.ef-textarea{resize:vertical;min-height:80px;line-height:1.5}
.ef-or{text-align:center;font-size:11px;color:#bbb;margin:-6px 0 12px;letter-spacing:.5px}
.ef-file-label{display:inline-block;padding:7px 14px;border:1px solid #d8cfc3;border-radius:4px;cursor:pointer;font-size:12px;color:#6B5E4E;background:#faf6ee;font-family:'DM Sans',sans-serif;margin-bottom:16px}
#ef-file{display:none}
#ef-fname{font-size:12px;color:#6B5E4E;margin-left:8px;vertical-align:middle}
#ef-preview{display:none;margin-bottom:16px;border-radius:4px;overflow:hidden}
#ef-preview img{width:100%;height:80px;object-fit:cover;display:block}
.ef-row{display:flex;gap:10px;justify-content:flex-end;margin-top:4px;align-items:center}
.ef-btn{padding:9px 20px;border-radius:4px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500}
.ef-cancel{background:none;border:1px solid #d8cfc3;color:#6B5E4E}
.ef-save{background:#C4622D;color:#fff}
#edit-status{font-size:12px;color:#C4622D;margin-right:auto}
</style>
<button id="edit-fab" title="Edit recipe">&#9998;</button>
<div id="edit-modal">
  <div id="edit-box">
    <h2>Edit Recipe</h2>
    <label class="ef-label">Title</label>
    <input class="ef-input" id="ef-title" type="text" value="${escHtml(current.title)}">
    <label class="ef-label">Description</label>
    <textarea class="ef-textarea" id="ef-desc">${escHtml(current.description)}</textarea>
    <label class="ef-label">Hero Image</label>
    <input class="ef-input" id="ef-image" type="url" placeholder="https://... paste a URL" value="${escHtml(current.image)}">
    <div class="ef-or">— or upload a file —</div>
    <label class="ef-file-label" for="ef-file">Choose image</label>
    <input type="file" id="ef-file" accept="image/*">
    <span id="ef-fname"></span>
    <div id="ef-preview"><img id="ef-preview-img" src="" alt="preview"></div>
    <label class="ef-label">Ingredients <span style="font-weight:normal;text-transform:none;letter-spacing:0;font-size:11px;color:#aaa">(one per line)</span></label>
    <textarea class="ef-textarea" id="ef-ingredients" style="min-height:180px">${escHtml(current.ingredients)}</textarea>
    <label class="ef-label">Instructions <span style="font-weight:normal;text-transform:none;letter-spacing:0;font-size:11px;color:#aaa">(one per line · "Step Title: text" or just text)</span></label>
    <textarea class="ef-textarea" id="ef-instructions" style="min-height:180px">${escHtml(current.instructions)}</textarea>
    <div class="ef-row">
      <span id="edit-status"></span>
      <button class="ef-btn ef-cancel" id="ef-cancel">Cancel</button>
      <button class="ef-btn ef-save" id="ef-save">Save</button>
    </div>
  </div>
</div>
<script>
(function(){
  var fab = document.getElementById('edit-fab');
  var modal = document.getElementById('edit-modal');
  var status = document.getElementById('edit-status');
  fab.addEventListener('click', function(){ modal.classList.add('open'); });
  document.getElementById('ef-cancel').addEventListener('click', function(){ modal.classList.remove('open'); status.textContent=''; });
  modal.addEventListener('click', function(e){ if(e.target===modal){ modal.classList.remove('open'); status.textContent=''; }});
  document.getElementById('ef-file').addEventListener('change', function(){
    var file = this.files[0];
    if(!file) return;
    document.getElementById('ef-fname').textContent = file.name;
    document.getElementById('ef-image').value = '';
    var reader = new FileReader();
    reader.onload = function(e){
      document.getElementById('ef-preview-img').src = e.target.result;
      document.getElementById('ef-preview').style.display = '';
    };
    reader.readAsDataURL(file);
  });
  function doSave(imageUrl) {
    var title = document.getElementById('ef-title').value.trim();
    var desc = document.getElementById('ef-desc').value.trim();
    var ingText = document.getElementById('ef-ingredients').value.trim();
    var instText = document.getElementById('ef-instructions').value.trim();
    var ingredients = ingText ? ingText.split('\\n').map(function(s){return s.trim();}).filter(Boolean) : null;
    var instructions = instText ? instText.split('\\n').map(function(s){return s.trim();}).filter(Boolean) : null;
    var btn = document.getElementById('ef-save');
    fetch('/api/recipe-edit', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({recipeId:'${slug}',title:title,description:desc||null,image:imageUrl||null,ingredients:ingredients,instructions:instructions})
    }).then(function(r){ return r.json(); }).then(function(data){
      if(data.error){ status.textContent=data.error; btn.disabled=false; return; }
      status.textContent='Saved!';
      setTimeout(function(){ location.reload(); },600);
    }).catch(function(){ status.textContent='Error saving.'; btn.disabled=false; });
  }
  document.getElementById('ef-save').addEventListener('click', function(){
    var btn = this;
    var title = document.getElementById('ef-title').value.trim();
    if(!title){ status.textContent='Title is required.'; return; }
    btn.disabled = true;
    var file = document.getElementById('ef-file').files[0];
    var imageUrl = document.getElementById('ef-image').value.trim() || null;
    if(file){
      status.textContent = 'Processing image\u2026';
      var reader = new FileReader();
      reader.onload = function(e){
        var img = new Image();
        img.onload = function(){
          var maxDim = 2000;
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, maxDim / Math.max(w, h));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          var base64 = dataUrl.split(',')[1];
          status.textContent = 'Uploading image\u2026';
          fetch('/api/recipe-upload',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({filename:file.name,contentType:'image/jpeg',data:base64})
          }).then(function(r){ return r.json(); }).then(function(data){
            if(data.error){ status.textContent=data.error; btn.disabled=false; return; }
            status.textContent='Saving\u2026';
            doSave(data.url);
          }).catch(function(){ status.textContent='Upload failed.'; btn.disabled=false; });
        };
        img.onerror = function(){ status.textContent='Could not read image.'; btn.disabled=false; };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    } else {
      status.textContent='Saving\u2026';
      doSave(imageUrl);
    }
  });
})();
</script>`;
}

exports.handler = async function(event) {
  const pathStr = event.path || '';
  const raw = pathStr.replace(/^\/recipes\//, '').replace(/\.html$/i, '').replace(/\/$/, '');
  const slug = sanitizeSlug(raw);

  if (!slug) {
    return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<h1>Not found</h1>' };
  }

  const dir = rawHtmlDir();
  const file = path.join(dir, slug + '.html');

  if (!fs.existsSync(file)) {
    return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<h1>Recipe not found</h1>' };
  }

  let html = fs.readFileSync(file, 'utf8');
  html = cleanPersonalLabels(html);

  // Fetch and apply any saved overrides
  let override = {};
  try {
    const overrides = await fetchRecipeOverrides([slug]);
    override = overrides[slug] || {};
  } catch (_) {}
  html = applyOverrides(html, override);

  // Extract current values for the edit panel (unescape HTML entities)
  const titleMatch = html.match(/<h1[^>]*>([^<]*)<\/h1>/);
  const descMatch = html.match(/<p class="desc">([\s\S]*?)<\/p>/);
  const imgMatch = html.match(/<div class="hero">\s*<img[^>]* src="([^"]*)"/);
  const ingItemMatches = [...html.matchAll(/<div class="ing-item"><span class="dot">·<\/span>(.*?)<\/div>/g)];
  const stepTitles = [...html.matchAll(/<div class="step-title">(.*?)<\/div>/g)].map(m => unescHtml(m[1]));
  const stepTexts = [...html.matchAll(/<div class="step-text">(.*?)<\/div>/g)].map(m => unescHtml(m[1]));
  const current = {
    title: unescHtml(titleMatch ? titleMatch[1] : slug),
    description: unescHtml(descMatch ? descMatch[1] : ''),
    image: unescHtml(imgMatch ? imgMatch[1] : ''),
    ingredients: ingItemMatches.map(m => unescHtml(m[1])).join('\n'),
    instructions: stepTexts.map((text, i) => stepTitles[i] ? `${stepTitles[i]}: ${text}` : text).join('\n'),
  };

  const mealimeLink = `<div style="max-width:860px;margin:0 auto;padding:0 20px 32px"><div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(0,0,0,.08);text-align:right"><a href="/mealime/${slug}" style="color:#C4622D;font-size:13px;text-decoration:none;font-family:'DM Sans',sans-serif;letter-spacing:.3px">View Mealime Import Page \u2192</a></div></div>`;

  const backBtn = `<a href="/" style="position:absolute;top:16px;left:20px;z-index:10;color:rgba(255,255,255,.85);font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;text-decoration:none;letter-spacing:.3px;display:flex;align-items:center;gap:6px;text-shadow:0 1px 4px rgba(0,0,0,.4)">&#8592; All Recipes</a>`;
  html = html.replace(/(<div class="hero">)/, '$1' + backBtn);
  html = html.replace('</head>', MOBILE_STYLES + '\n</head>');
  html = html.replace('</body>', mealimeLink + '\n' + editPanel(slug, current) + '\n</body>');

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
};
