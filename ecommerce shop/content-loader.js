/* Kinatech Hub — Site Content Loader + Inline Editor (text & images)
   • Loads content.json and applies text to [data-content] elements
   • If a GitHub token is in localStorage, injects a floating Edit button
   • In edit mode: text → contenteditable; images → 📷 upload overlay
   • Image uploads commit immediately to GitHub (no extra Publish needed)
   • Text Save commits content.json to GitHub */
(function () {
  'use strict';

  /* ── Utilities ────────────────────────────────── */
  function deepGet(obj, path) {
    return path.split('.').reduce(function (o, k) { return o && o[k]; }, obj);
  }
  function deepSet(obj, path, val) {
    var parts = path.split('.');
    var o = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!o[parts[i]]) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = val;
  }
  function gh() {
    return {
      token:  localStorage.getItem('kt_token')  || '',
      owner:  localStorage.getItem('kt_owner')  || '',
      repo:   localStorage.getItem('kt_repo')   || '',
      branch: localStorage.getItem('kt_branch') || 'main',
      prefix: localStorage.getItem('kt_prefix') || ''
    };
  }
  function ghApiUrl(g, relPath) {
    var full = g.prefix ? g.prefix + '/' + relPath : relPath;
    return 'https://api.github.com/repos/' + g.owner + '/' + g.repo +
      '/contents/' + encodeURIComponent(full).replace(/%2F/g, '/');
  }
  function authHeader(g) { return { 'Authorization': 'token ' + g.token }; }

  /* ── GitHub helpers ───────────────────────────── */
  async function ghCommit(relPath, content, message, retries) {
    retries = retries === undefined ? 3 : retries;
    var g = gh();
    var url = ghApiUrl(g, relPath);
    var sha = null;
    try {
      var r = await fetch(url + '?ref=' + g.branch, { headers: authHeader(g) });
      if (r.ok) sha = (await r.json()).sha;
    } catch (e) {}
    var body = {
      message: message,
      content: btoa(unescape(encodeURIComponent(content))),
      branch: g.branch
    };
    if (sha) body.sha = sha;
    var res = await fetch(url, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader(g)),
      body: JSON.stringify(body)
    });
    if (res.status === 409 && retries > 0) {
      await new Promise(function (r) { setTimeout(r, 600); });
      return ghCommit(relPath, content, message, retries - 1);
    }
    if (!res.ok) { var err = await res.json(); throw new Error(err.message || res.status); }
    return res.json();
  }

  async function ghFetchJson(relPath) {
    var g = gh();
    var url = ghApiUrl(g, relPath);
    var res = await fetch(url + '?ref=' + g.branch, { headers: authHeader(g) });
    if (!res.ok) throw new Error('Could not fetch ' + relPath);
    var file = await res.json();
    return { data: JSON.parse(atob(file.content.replace(/\n/g, ''))), sha: file.sha };
  }

  async function uploadImageFile(file) {
    var g = gh();
    var safeName = Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    var relPath = 'images/' + safeName;
    var base64 = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) { resolve(e.target.result.split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    var full = g.prefix ? g.prefix + '/' + relPath : relPath;
    var url = 'https://api.github.com/repos/' + g.owner + '/' + g.repo +
      '/contents/' + encodeURIComponent(full).replace(/%2F/g, '/');
    var res = await fetch(url, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader(g)),
      body: JSON.stringify({ message: 'Upload image via inline editor', content: base64, branch: g.branch })
    });
    if (!res.ok) { var err = await res.json(); throw new Error(err.message || res.status); }
    return relPath; // relative path for use in JSON files
  }

  /* ── Apply text content ───────────────────────── */
  var _content = {};
  var _original = {};

  function applyContent(c) {
    document.querySelectorAll('[data-content]').forEach(function (el) {
      var val = deepGet(c, el.dataset.content);
      if (val !== undefined && val !== null && val !== '') {
        el.textContent = val;
        _original[el.dataset.content] = val;
      }
    });
  }

  /* ── Image overlay ────────────────────────────── */
  function makeImgBtn(el) {
    var btn = document.createElement('button');
    btn.className = 'kt-img-btn';
    btn.style.cssText = [
      'position:absolute;top:8px;right:8px;z-index:20',
      'background:rgba(0,0,0,0.72);color:#fff;border:none',
      'padding:7px 12px;border-radius:8px;font-size:0.75rem;font-weight:600',
      'cursor:pointer;font-family:inherit;display:none',
      'display:flex;align-items:center;gap:5px;white-space:nowrap',
      'box-shadow:0 2px 10px rgba(0,0,0,0.35)'
    ].join(';');
    btn.innerHTML = '📷 ' + (el.dataset.imgLabel || 'Upload Image');
    return btn;
  }

  function ensureRelativePos(el) {
    var pos = window.getComputedStyle(el).position;
    if (pos === 'static') el.style.position = 'relative';
  }

  function attachImgUpload(el) {
    if (el.dataset.imgAttached) return;
    el.dataset.imgAttached = '1';
    ensureRelativePos(el);

    var btn = makeImgBtn(el);
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    el.appendChild(btn);
    el.appendChild(input);

    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      input.click();
    });

    input.addEventListener('change', function () {
      if (!input.files[0]) return;
      handleImgUpload(el, btn, input.files[0]);
      input.value = '';
    });
  }

  async function handleImgUpload(el, btn, file) {
    var key = el.dataset.imgKey;
    var origLabel = btn.innerHTML;
    btn.innerHTML = '⏳ Uploading…';
    btn.disabled = true;

    try {
      var imgPath = await uploadImageFile(file);

      if (key === 'hero') {
        /* ── Hero background ── */
        var f = await ghFetchJson('site-settings.json');
        if (!f.data.hero) f.data.hero = {};
        f.data.hero.image = imgPath;
        await ghCommit('site-settings.json', JSON.stringify(f.data, null, 2), 'Update hero image via inline editor');
        // Apply to DOM immediately
        var hero = document.getElementById('heroSection');
        if (hero) hero.style.backgroundImage = "url('" + imgPath + "')";
        var ph = document.querySelector('.hero-bg-placeholder');
        if (ph) ph.style.display = 'none';

      } else if (key.indexOf('cat-') === 0) {
        /* ── Category card image ── */
        var catId = key.replace('cat-', '');
        var f = await ghFetchJson('products.json');
        var cat = f.data.categories && f.data.categories.find(function (c) { return c.id === catId; });
        if (cat) cat.image = imgPath;
        await ghCommit('products.json', JSON.stringify(f.data, null, 2), 'Update category image via inline editor');
        // Apply to DOM immediately
        var existing = el.querySelector('img');
        if (existing) {
          existing.src = imgPath;
        } else {
          var img = document.createElement('img');
          img.src = imgPath;
          img.className = 'cat-product-img';
          img.alt = catId;
          el.innerHTML = '';
          el.appendChild(img);
          el.appendChild(btn); // re-attach button after innerHTML clear
          el.appendChild(input);
        }

      } else if (key.indexOf('home-ind-') === 0) {
        /* ── Home page Who-We-Serve card ── */
        var indId = key.replace('home-ind-', '');
        var f = await ghFetchJson('site-settings.json');
        if (!f.data.homeIndustryImages) f.data.homeIndustryImages = {};
        f.data.homeIndustryImages[indId] = imgPath;
        await ghCommit('site-settings.json', JSON.stringify(f.data, null, 2), 'Update home industry image via inline editor');
        // Apply to DOM immediately
        var ph = el.querySelector('.wws-img-placeholder');
        if (ph) {
          var img = document.createElement('img');
          img.className = 'wws-photo'; img.src = imgPath; img.alt = '';
          ph.replaceWith(img);
        } else {
          var existing = el.querySelector('.wws-photo');
          if (existing) existing.src = imgPath;
        }

      } else if (key.indexOf('ind-') === 0) {
        /* ── Who-We-Serve page industry image ── */
        var indId = key.replace('ind-', '');
        var f = await ghFetchJson('site-settings.json');
        if (!f.data.industryImages) f.data.industryImages = {};
        f.data.industryImages[indId] = imgPath;
        await ghCommit('site-settings.json', JSON.stringify(f.data, null, 2), 'Update industry image via inline editor');
        // Apply to DOM immediately
        var existing = el.querySelector('img');
        if (existing) { existing.src = imgPath; }
        else {
          var img = document.createElement('img');
          img.src = imgPath; img.alt = indId;
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          el.insertBefore(img, el.firstChild);
        }
      }

      btn.innerHTML = '✓ Saved';
      btn.style.background = 'rgba(39,174,96,0.88)';
      setTimeout(function () {
        btn.innerHTML = origLabel;
        btn.style.background = 'rgba(0,0,0,0.72)';
        btn.disabled = false;
      }, 2500);

    } catch (e) {
      btn.innerHTML = '⚠️ ' + e.message;
      btn.style.background = 'rgba(192,57,43,0.88)';
      setTimeout(function () {
        btn.innerHTML = origLabel;
        btn.style.background = 'rgba(0,0,0,0.72)';
        btn.disabled = false;
      }, 3500);
    }
  }

  /* ── Edit mode ────────────────────────────────── */
  function enterEditMode() {
    // Text
    document.querySelectorAll('[data-content]').forEach(function (el) {
      _original[el.dataset.content] = el.textContent;
      el.contentEditable = 'true';
      el.style.outline = '2px dashed #c9b89a';
      el.style.outlineOffset = '3px';
      el.style.borderRadius = '4px';
      el.style.cursor = 'text';
      el.style.minWidth = '20px';
    });
    // Images
    document.querySelectorAll('[data-img-key]').forEach(function (el) {
      attachImgUpload(el);
      var btn = el.querySelector('.kt-img-btn');
      if (btn) btn.style.display = 'flex';
    });
  }

  function exitEditMode(restore) {
    document.querySelectorAll('[data-content]').forEach(function (el) {
      if (restore && _original[el.dataset.content] !== undefined) {
        el.textContent = _original[el.dataset.content];
      }
      el.contentEditable = 'false';
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.borderRadius = '';
      el.style.cursor = '';
      el.style.minWidth = '';
    });
    document.querySelectorAll('.kt-img-btn').forEach(function (btn) {
      btn.style.display = 'none';
    });
  }

  /* ── Floating edit bar ────────────────────────── */
  function injectEditUI() {
    var bar = document.createElement('div');
    bar.id = 'kt-edit-bar';
    bar.style.cssText = [
      'position:fixed;bottom:24px;left:20px;z-index:9000',
      'display:flex;flex-direction:column;align-items:flex-start;gap:8px'
    ].join(';');

    var status = document.createElement('div');
    status.style.cssText = [
      'display:none;font-size:0.75rem;background:#fff;color:#555',
      'padding:6px 12px;border-radius:8px;border:1px solid #ddd',
      'box-shadow:0 2px 8px rgba(0,0,0,0.08);font-family:inherit'
    ].join(';');

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;align-items:center;';

    function mkBtn(label, bg, fg) {
      var b = document.createElement('button');
      b.innerHTML = label;
      b.style.cssText = [
        'background:' + bg + ';color:' + fg + ';border:none',
        'padding:9px 16px;border-radius:10px;font-size:0.8rem;font-weight:600',
        'cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(0,0,0,0.2)'
      ].join(';');
      return b;
    }

    var editBtn   = mkBtn('✏️ Edit Page', '#1a1a1a', '#fff');
    var saveBtn   = mkBtn('💾 Save Text', '#27ae60', '#fff');
    var cancelBtn = mkBtn('✕', '#fff', '#555');
    cancelBtn.style.border = '1.5px solid #ddd';
    cancelBtn.style.boxShadow = 'none';
    saveBtn.style.display   = 'none';
    cancelBtn.style.display = 'none';

    function showStatus(msg, color, duration) {
      status.textContent = msg;
      status.style.color = color || '#555';
      status.style.display = '';
      if (duration) setTimeout(function () { status.style.display = 'none'; }, duration);
    }

    editBtn.addEventListener('click', function () {
      enterEditMode();
      editBtn.style.display = 'none';
      saveBtn.style.display = '';
      cancelBtn.style.display = '';
      showStatus('Click any text to edit. Use 📷 buttons to swap images.');
    });

    cancelBtn.addEventListener('click', function () {
      exitEditMode(true);
      editBtn.style.display = '';
      saveBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
      status.style.display = 'none';
    });

    saveBtn.addEventListener('click', async function () {
      var g = gh();
      if (!g.token || !g.owner || !g.repo) {
        showStatus('⚠️ Sign into admin first.', '#c0392b');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      showStatus('⏳ Committing text changes…');

      var updated = JSON.parse(JSON.stringify(_content));
      document.querySelectorAll('[data-content]').forEach(function (el) {
        deepSet(updated, el.dataset.content, el.textContent.trim());
      });

      try {
        await ghCommit('content.json', JSON.stringify(updated, null, 2), 'Update site content via inline editor');
        _content = updated;
        exitEditMode(false);
        editBtn.style.display = '';
        saveBtn.style.display = 'none';
        cancelBtn.style.display = 'none';
        showStatus('✓ Text saved! Site updates in ~30s.', '#27ae60', 4000);
      } catch (e) {
        showStatus('⚠️ Error: ' + e.message, '#c0392b');
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '💾 Save Text';
      }
    });

    btnRow.appendChild(editBtn);
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    bar.appendChild(status);
    bar.appendChild(btnRow);
    document.body.appendChild(bar);
  }

  /* ── Boot ─────────────────────────────────────── */
  fetch('content.json?v=' + Date.now())
    .then(function (r) { return r.json(); })
    .then(function (c) {
      _content = c;
      window.__siteContent = c;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { applyContent(c); });
      } else {
        applyContent(c);
      }
      if (localStorage.getItem('kt_token')) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', injectEditUI);
        } else {
          injectEditUI();
        }
      }
    })
    .catch(function () {});
})();
