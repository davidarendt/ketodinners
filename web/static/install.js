// Install helper — a friendly, dismissible bottom sheet that walks you through
// adding the site to your home screen. Android/Chrome gets a one-tap native
// install; iOS Safari gets the Share -> Add to Home Screen steps.
(function () {
  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isIOSSafari = isIOS && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  var isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;

  var DISMISS_KEY = 'installPromptDismissed';
  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
  }
  function setDismissed() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
  }

  // Capture Chrome/Android's install event as early as possible.
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!isStandalone && !dismissed()) maybeShow('android');
  });

  window.addEventListener('appinstalled', function () {
    setDismissed();
    hide();
  });

  var shownFor = null;
  function maybeShow(kind) {
    if (isStandalone || dismissed() || shownFor) return;
    shownFor = kind;
    setTimeout(function () { render(kind); }, 900);
  }

  var SHARE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
    '<path fill="currentColor" d="M12 2.5l3.5 3.5-1.1 1.1L12.8 5.9V15h-1.6V5.9L9.6 7.1 8.5 6 12 2.5z"/>' +
    '<path fill="currentColor" d="M6 10h2v9h8v-9h2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9z"/></svg>';
  var PLUS_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
    '<rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path fill="currentColor" d="M11.2 8h1.6v3.2H16v1.6h-3.2V16h-1.6v-3.2H8v-1.6h3.2z"/></svg>';

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }

  function hide() {
    var sheet = document.getElementById('installSheet');
    var back = document.getElementById('installBackdrop');
    if (sheet) { sheet.classList.remove('show'); setTimeout(function () { sheet.remove(); }, 250); }
    if (back) { back.classList.remove('show'); setTimeout(function () { back.remove(); }, 250); }
  }

  function closeAndRemember() {
    setDismissed();
    hide();
  }

  function render(kind) {
    if (document.getElementById('installSheet')) return;

    var body, actions;
    if (kind === 'android') {
      body =
        '<p class="install-lead">Add Keto Dinners to your home screen for a full-screen, app-like experience.</p>';
      actions =
        '<button class="install-btn-primary" id="installGo">Install app</button>' +
        '<button class="install-btn-ghost" id="installNo">Not now</button>';
    } else if (kind === 'ios-safari') {
      body =
        '<p class="install-lead">Add Keto Dinners to your home screen so it opens like an app.</p>' +
        '<ol class="install-steps">' +
        '<li><span class="install-step-ico">' + SHARE_ICON + '</span> Tap the <b>Share</b> button in Safari’s toolbar.</li>' +
        '<li><span class="install-step-ico">' + PLUS_ICON + '</span> Choose <b>Add to Home Screen</b>.</li>' +
        '<li><span class="install-step-num">3</span> Tap <b>Add</b> — the icon appears on your home screen.</li>' +
        '</ol>';
      actions = '<button class="install-btn-primary" id="installNo">Got it</button>';
    } else { // ios-other
      body =
        '<p class="install-lead">To install this app, open <b>ketodinners</b> in <b>Safari</b>, then tap ' +
        'Share → Add to Home Screen. (iPhone only lets Safari add home-screen apps.)</p>';
      actions = '<button class="install-btn-primary" id="installNo">Got it</button>';
    }

    var backdrop = el('<div id="installBackdrop" class="install-backdrop"></div>');
    var sheet = el(
      '<div id="installSheet" class="install-sheet" role="dialog" aria-label="Install app">' +
        '<div class="install-head">' +
          '<img class="install-icon" src="/icons/icon-192.png" alt="">' +
          '<div class="install-titles"><div class="install-title">Install Keto Dinners</div>' +
          '<div class="install-sub">Free · No app store needed</div></div>' +
          '<button class="install-x" id="installX" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="install-body">' + body + '</div>' +
        '<div class="install-actions">' + actions + '</div>' +
      '</div>'
    );

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    requestAnimationFrame(function () {
      backdrop.classList.add('show');
      sheet.classList.add('show');
    });

    backdrop.addEventListener('click', closeAndRemember);
    var x = document.getElementById('installX');
    if (x) x.addEventListener('click', closeAndRemember);
    var no = document.getElementById('installNo');
    if (no) no.addEventListener('click', closeAndRemember);

    var go = document.getElementById('installGo');
    if (go) {
      go.addEventListener('click', function () {
        if (!deferredPrompt) { hide(); return; }
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () {
          deferredPrompt = null;
          closeAndRemember();
        });
      });
    }
  }

  // iOS never fires beforeinstallprompt, so decide on load.
  if (!isStandalone && !dismissed() && isIOS) {
    window.addEventListener('load', function () {
      maybeShow(isIOSSafari ? 'ios-safari' : 'ios-other');
    });
  }
})();
