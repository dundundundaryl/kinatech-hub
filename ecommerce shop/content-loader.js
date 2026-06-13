/* Kinatech Hub — Site Content Loader + Inline Editor
   Save  → localStorage drafts (persists across pages)
   Publish → commits all drafts to GitHub at once */
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
  function deepMerge(base, overlay) {
    var result = JSON.parse(JSON.stringify(base));
    Object.keys(overlay || {}).forEach(function (k) {
      if (overlay[k] && typeof overlay[k] === 'object' && result[k] && typeof result[k] === 'object') {
        Object.keys(overlay[k]).forEach(function (k2) { result[k][k2] = overlay[k][k2]; });
      } else {
        result[k] = overlay[k];
      }
    });
    return result;
  }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      // cache:'no-store' + cache-buster: avoid a stale SHA right after a prior commit
      var r = await fetch(url + '?ref=' + g.branch + '&_=' + Date.now(), {
        headers: authHeader(g), cache: 'no-store'
      });
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
    var res = await fetch(url + '?ref=' + g.branch + '&_=' + Date.now(), {
      headers: authHeader(g), cache: 'no-store'
    });
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
    return relPath;
  }

  // Upload an image binary that's already encoded as base64 (used at Publish time
  // for images that were staged into a draft rather than committed immediately).
  async function ghPutBinary(relPath, base64, message) {
    var g = gh();
    var full = g.prefix ? g.prefix + '/' + relPath : relPath;
    var url = 'https://api.github.com/repos/' + g.owner + '/' + g.repo +
      '/contents/' + encodeURIComponent(full).replace(/%2F/g, '/');
    var sha = null; // staged names are unique, but check anyway so re-publish is safe
    try {
      var r = await fetch(url + '?ref=' + g.branch + '&_=' + Date.now(), {
        headers: authHeader(g), cache: 'no-store'
      });
      if (r.ok) sha = (await r.json()).sha;
    } catch (e) {}
    var body = { message: message, content: base64, branch: g.branch };
    if (sha) body.sha = sha;
    var res = await fetch(url, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader(g)),
      body: JSON.stringify(body)
    });
    if (!res.ok) { var err = await res.json(); throw new Error(err.message || res.status); }
    return relPath;
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) { resolve(e.target.result.split(',')[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ── Image draft staging ──────────────────────────
     Image changes are staged into localStorage (just like text edits) and only
     committed to GitHub when the user presses Publish. */
  function getImagesDraft() { return getDraft('kt_images_draft') || {}; }
  function stageImageDraft(key, entry) {
    var d = getImagesDraft();
    d[key] = entry;
    try {
      localStorage.setItem('kt_images_draft', JSON.stringify(d));
    } catch (e) {
      throw new Error('Image too large to stage — publish your current changes first, or use a smaller image.');
    }
  }

  /* ── Draft management ─────────────────────────── */
  function getDraft(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function setDraft(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function hasDrafts() {
    return !!(localStorage.getItem('kt_content_draft') ||
              localStorage.getItem('kt_products_draft') ||
              localStorage.getItem('kt_wws_draft') ||
              localStorage.getItem('kt_categories_draft') ||
              localStorage.getItem('kt_images_draft'));
  }
  function updateDraftBar() {
    var pubBtn = document.getElementById('kt-publish-btn');
    if (pubBtn) pubBtn.style.display = hasDrafts() ? '' : 'none';
  }

  /* ── Apply content ────────────────────────────── */
  var _content = {};
  var _editOriginals = {};   // captured at enterEditMode for Cancel

  function applyContent(c) {
    document.querySelectorAll('[data-content]').forEach(function (el) {
      var val = deepGet(c, el.dataset.content);
      if (val !== undefined && val !== null && val !== '') el.textContent = val;
    });
  }

  function applyProductsDraft() {
    var draft = getDraft('kt_products_draft');
    if (!draft) return;
    Object.keys(draft).forEach(function (pid) {
      var changes = draft[pid];
      // Products page cards
      var card = document.querySelector('[data-product-id="' + pid + '"]');
      if (card) {
        if (changes.name !== undefined) {
          var el = card.querySelector('[data-product-field="name"]');
          if (el) el.textContent = changes.name;
        }
        if (changes.description !== undefined) {
          var el = card.querySelector('[data-product-field="description"]');
          if (el) el.textContent = changes.description;
        }
      }
      // Product detail page (data-detail-id / data-detail-field)
      if (changes.name !== undefined) {
        var nameEl = document.querySelector('[data-detail-id="' + pid + '"][data-detail-field="name"]');
        if (nameEl) nameEl.textContent = changes.name;
      }
      if (changes.description !== undefined) {
        var descEl = document.querySelector('[data-detail-id="' + pid + '"][data-detail-field="description"]');
        if (descEl) descEl.textContent = changes.description;
      }
    });
  }

  function applyWwsDraft() {
    var draft = getDraft('kt_wws_draft');
    if (!draft) return;
    Object.keys(draft).forEach(function (id) {
      var changes = draft[id];
      if (changes.heading !== undefined) {
        var el = document.querySelector('[data-wws-id="' + id + '"][data-wws-field="heading"]');
        if (el) el.textContent = changes.heading;
      }
      if (changes.desc !== undefined) {
        var el = document.querySelector('[data-wws-id="' + id + '"][data-wws-field="desc"]');
        if (el) el.textContent = changes.desc;
      }
      if (changes.recommended !== undefined) {
        var ul = document.querySelector('[data-wws-id="' + id + '"][data-wws-field="recommended"]');
        if (ul) {
          var items = String(changes.recommended).split('\n')
            .map(function (s) { return s.trim(); }).filter(Boolean);
          ul.innerHTML = items.map(function (t) { return '<li>' + escHtml(t) + '</li>'; }).join('');
        }
      }
    });
  }

  function applyCategoriesDraft() {
    var draft = getDraft('kt_categories_draft');
    if (!draft) return;
    Object.keys(draft).forEach(function (catId) {
      var changes = draft[catId];
      if (changes.label !== undefined) {
        var el = document.querySelector('[data-cat-id="' + catId + '"][data-cat-field="label"]');
        if (el) el.textContent = changes.label;
      }
      if (changes.description !== undefined) {
        var el = document.querySelector('[data-cat-id="' + catId + '"][data-cat-field="description"]');
        if (el) el.textContent = changes.description;
      }
    });
  }

  // products.html and product-detail.html call this after dynamically rendering cards
  window.__ktApplyDrafts = function () {
    applyProductsDraft();
    applyWwsDraft();
    applyCategoriesDraft();
  };

  /* ── Image overlay ────────────────────────────── */
  function imgBtnCSS(bg, fg) {
    return [
      'background:' + bg + ';color:' + fg + ';border:none',
      'padding:7px 12px;border-radius:8px;font-size:0.75rem;font-weight:600',
      'cursor:pointer;font-family:inherit',
      'display:flex;align-items:center;gap:5px;white-space:nowrap',
      'box-shadow:0 2px 10px rgba(0,0,0,0.35)'
    ].join(';');
  }

  function ensureRelativePos(el) {
    var pos = window.getComputedStyle(el).position;
    if (pos === 'static') el.style.position = 'relative';
  }

  function hasExistingImage(el) {
    var key = el.dataset.imgKey || '';
    if (key === 'hero') return !!(el.style.backgroundImage && el.style.backgroundImage !== 'none' && el.style.backgroundImage !== '');
    return !!el.querySelector('img');
  }

  function attachImgUpload(el) {
    if (el.dataset.imgAttached) return;
    el.dataset.imgAttached = '1';
    ensureRelativePos(el);

    // Button container — push below fixed nav for the hero section
    var btnTop = el.dataset.imgKey === 'hero' ? '76px' : '8px';
    var wrap = document.createElement('div');
    wrap.className = 'kt-img-btns';
    wrap.style.cssText = 'position:absolute;top:' + btnTop + ';right:8px;z-index:20;display:none;gap:5px;align-items:center;';

    var uploadBtn = document.createElement('button');
    uploadBtn.style.cssText = imgBtnCSS('rgba(0,0,0,0.72)', '#fff');
    uploadBtn.innerHTML = '📷 Upload';

    var removeBtn = document.createElement('button');
    removeBtn.style.cssText = imgBtnCSS('rgba(192,57,43,0.82)', '#fff');
    removeBtn.innerHTML = '✕ Remove';

    wrap.appendChild(uploadBtn);
    wrap.appendChild(removeBtn);

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    // Keep fileInput inside wrap so _ktCatBlock (which allows .kt-img-btns clicks)
    // also allows the programmatic fileInput.click() that the Upload button triggers.
    wrap.appendChild(fileInput);
    el.appendChild(wrap);

    function refreshRemove() {
      removeBtn.style.display = hasExistingImage(el) ? 'flex' : 'none';
    }
    refreshRemove();

    uploadBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fileInput.click(); });
    fileInput.addEventListener('change', function () {
      if (!fileInput.files[0]) return;
      handleImgUpload(el, uploadBtn, fileInput.files[0], removeBtn, wrap, fileInput, refreshRemove);
      fileInput.value = '';
    });
    removeBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      handleImgRemove(el, removeBtn, refreshRemove);
    });
  }

  /* Update the DOM to show an image preview for a given key (no commits). */
  function applyImgPreview(key, el, src) {
    if (key === 'hero') {
      var hero = document.getElementById('heroSection');
      if (hero) hero.style.backgroundImage = "url('" + src + "')";
      var ph = document.querySelector('.hero-bg-placeholder');
      if (ph) ph.style.display = 'none';

    } else if (key.indexOf('cat-') === 0) {
      var existing = el.querySelector('img');
      if (existing) {
        existing.src = src;
      } else {
        var ph2 = el.querySelector('[class*="placeholder"]');
        if (ph2) ph2.remove();
        var img = document.createElement('img');
        img.src = src; img.className = 'cat-product-img'; img.alt = key.replace('cat-', '');
        el.insertBefore(img, el.firstChild);
      }

    } else if (key.indexOf('home-ind-') === 0) {
      var ph3 = el.querySelector('.wws-img-placeholder');
      if (ph3) {
        var img2 = document.createElement('img');
        img2.className = 'wws-photo'; img2.src = src; img2.alt = '';
        ph3.replaceWith(img2);
      } else {
        var existing2 = el.querySelector('.wws-photo');
        if (existing2) existing2.src = src;
      }

    } else if (key.indexOf('ind-') === 0) {
      var existing3 = el.querySelector('img');
      if (existing3) {
        existing3.src = src;
      } else {
        var ph4 = el.querySelector('.industry-img-placeholder');
        if (ph4) ph4.remove();
        var img3 = document.createElement('img');
        img3.src = src; img3.alt = key.replace('ind-', '');
        img3.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        el.insertBefore(img3, el.firstChild);
      }
    }
  }

  /* Update the DOM to reflect a removed image for a given key (no commits). */
  function applyImgRemovePreview(key, el) {
    if (key === 'hero') {
      var hero = document.getElementById('heroSection');
      if (hero) hero.style.backgroundImage = '';
      var ph = document.querySelector('.hero-bg-placeholder');
      if (ph) ph.style.display = '';
    } else {
      var img = el.querySelector('img, .wws-photo');
      if (img) img.remove();
    }
  }

  /* On page load, overlay any staged (unpublished) image changes so the admin
     sees their pending edits across page navigations, just like text drafts. */
  function applyImagesDraft() {
    var d = getDraft('kt_images_draft');
    if (!d) return;
    Object.keys(d).forEach(function (key) {
      var entry = d[key];
      var el = document.querySelector('[data-img-key="' + key.replace(/"/g, '\\"') + '"]');
      if (!el) return;
      if (entry.action === 'remove') {
        applyImgRemovePreview(key, el);
      } else if (entry.action === 'upload') {
        applyImgPreview(key, el, 'data:' + (entry.mime || 'image/png') + ';base64,' + entry.base64);
      }
    });
  }

  // Stage an image upload as a draft — committed to GitHub only on Publish.
  async function handleImgUpload(el, uploadBtn, file, removeBtn, wrap, fileInput, refreshRemove) {
    var key = el.dataset.imgKey;
    uploadBtn.innerHTML = '⏳ Loading…';
    uploadBtn.disabled = true;

    try {
      var base64 = await fileToBase64(file);
      var safeName = Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var relPath = 'images/' + safeName;

      stageImageDraft(key, { action: 'upload', relPath: relPath, base64: base64, mime: file.type || 'image/png' });

      // Instant preview from a blob URL (no waiting on any commit)
      applyImgPreview(key, el, URL.createObjectURL(file));

      uploadBtn.innerHTML = '✓ Staged';
      uploadBtn.style.background = 'rgba(39,174,96,0.88)';
      refreshRemove();
      updateDraftBar();
      setTimeout(function () {
        uploadBtn.innerHTML = '📷 Upload';
        uploadBtn.style.background = 'rgba(0,0,0,0.72)';
        uploadBtn.disabled = false;
      }, 2500);

    } catch (e) {
      console.error('Image stage failed:', e);
      uploadBtn.title = e.message;
      uploadBtn.innerHTML = '⚠️ Failed';
      uploadBtn.style.background = 'rgba(192,57,43,0.88)';
      setTimeout(function () {
        uploadBtn.innerHTML = '📷 Upload';
        uploadBtn.title = '';
        uploadBtn.style.background = 'rgba(0,0,0,0.72)';
        uploadBtn.disabled = false;
      }, 3500);
    }
  }

  // Stage an image removal as a draft — committed to GitHub only on Publish.
  async function handleImgRemove(el, removeBtn, refreshRemove) {
    var key = el.dataset.imgKey;
    var origLabel = removeBtn.innerHTML;
    removeBtn.innerHTML = '⏳';
    removeBtn.disabled = true;

    try {
      stageImageDraft(key, { action: 'remove' });
      applyImgRemovePreview(key, el);

      removeBtn.innerHTML = '✓ Removed';
      removeBtn.style.background = 'rgba(39,174,96,0.88)';
      refreshRemove();
      updateDraftBar();
      setTimeout(function () {
        removeBtn.innerHTML = origLabel;
        removeBtn.style.background = 'rgba(192,57,43,0.82)';
        removeBtn.disabled = false;
        refreshRemove(); // hide if still no image
      }, 2000);

    } catch (e) {
      console.error('Image remove stage failed:', e);
      removeBtn.title = e.message;          // full message on hover (button clips long text)
      removeBtn.innerHTML = '⚠️ Failed';
      setTimeout(function () { removeBtn.innerHTML = origLabel; removeBtn.title = ''; removeBtn.disabled = false; }, 3500);
    }
  }

  /* ── Edit mode ────────────────────────────────── */
  var _editStyle = {
    outline: '2px dashed #c9b89a',
    outlineOffset: '3px',
    borderRadius: '4px',
    cursor: 'text',
    minWidth: '20px'
  };

  function applyEditStyle(el) {
    Object.assign(el.style, _editStyle);
    el.contentEditable = 'true';
  }
  function clearEditStyle(el) {
    el.contentEditable = 'false';
    el.style.outline = '';
    el.style.outlineOffset = '';
    el.style.borderRadius = '';
    el.style.cursor = '';
    el.style.minWidth = '';
  }

  var _inEditMode = false;

  function enterEditMode() {
    _inEditMode = true;
    _editOriginals = {};

    function capture(el, key) {
      _editOriginals[key] = el.textContent;
      applyEditStyle(el);
    }

    // 1) Generic content.json fields
    document.querySelectorAll('[data-content]').forEach(function (el) {
      capture(el, 'c:' + el.dataset.content);
    });

    // 2) Product card fields (products.html)
    //    Also attach _ktStopBubble so clicks on these don't bubble to card's onclick
    document.querySelectorAll('[data-product-id] [data-product-field]').forEach(function (el) {
      var card = el.closest('[data-product-id]');
      var pid = card ? card.dataset.productId : '';
      capture(el, 'p:' + pid + ':' + el.dataset.productField);
      el._ktStopBubble = function (e) { e.stopPropagation(); };
      el.addEventListener('click', el._ktStopBubble);
    });

    // 3) WWS fields — 'recommended' ul gets textarea injection instead of contenteditable
    document.querySelectorAll('[data-wws-id][data-wws-field]').forEach(function (el) {
      var field = el.dataset.wwsField;
      var id = el.dataset.wwsId;

      if (field === 'recommended') {
        // Capture current li items as newline-separated text
        var items = Array.prototype.map.call(
          el.querySelectorAll('li'),
          function (li) { return li.textContent.trim(); }
        ).join('\n');
        _editOriginals['w:' + id + ':recommended'] = items;
        // Hide ul and inject a textarea in its place
        el.style.display = 'none';
        var ta = document.createElement('textarea');
        ta.className = 'kt-rec-textarea';
        ta.dataset.ktRecId = id;
        ta.value = items;
        ta.placeholder = 'One item per line';
        ta.style.cssText = [
          'width:100%;min-height:70px;border:2px dashed #c9b89a;border-radius:4px',
          'padding:8px 10px;font-family:inherit;font-size:0.88rem;resize:vertical',
          'margin-bottom:12px;outline:none;box-sizing:border-box;display:block'
        ].join(';');
        el.insertAdjacentElement('afterend', ta);
        return;
      }

      capture(el, 'w:' + id + ':' + field);
    });

    // 4) Category card fields (index.html)
    //    _ktCatBlock on the <a> prevents navigation; we always preventDefault there.
    document.querySelectorAll('[data-cat-id][data-cat-field]').forEach(function (el) {
      capture(el, 'cat:' + el.dataset.catId + ':' + el.dataset.catField);
    });

    // 5) Product detail page fields (product-detail.html — no card onclick to block)
    document.querySelectorAll('[data-detail-field]').forEach(function (el) {
      var id = el.dataset.detailId || '';
      capture(el, 'd:' + id + ':' + el.dataset.detailField);
    });

    // 6) Block product card onclick navigation (capture phase)
    document.querySelectorAll('[data-product-id]').forEach(function (card) {
      card._ktEditBlock = function (e) {
        if (!e.target.closest('[contenteditable="true"]')) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      };
      card.addEventListener('click', card._ktEditBlock, true);
      card.style.cursor = 'default';
    });

    // 7) Block cat-card <a> navigation (capture phase, always preventDefault)
    document.querySelectorAll('a.cat-card').forEach(function (a) {
      a._ktCatBlock = function (e) {
        // Image upload/remove buttons: let the event through untouched.
        // Calling preventDefault() here would cancel the hidden file input's
        // click() default action, so the file picker would never open.
        if (e.target.closest('.kt-img-btns')) return;
        e.preventDefault(); // stop anchor navigation
        // Allow clicks on text fields; stop everything else
        if (!e.target.closest('[data-cat-id][data-cat-field]')) {
          e.stopImmediatePropagation();
        }
      };
      a.addEventListener('click', a._ktCatBlock, true);
      a.style.cursor = 'default';
    });

    // 8) Show image upload buttons
    document.querySelectorAll('[data-img-key]').forEach(function (el) {
      attachImgUpload(el);
      var wrap = el.querySelector('.kt-img-btns');
      if (wrap) wrap.style.display = 'flex';
    });
  }

  function exitEditMode(restore) {
    _inEditMode = false;

    // 1) Generic content.json fields
    document.querySelectorAll('[data-content]').forEach(function (el) {
      if (restore) {
        var orig = _editOriginals['c:' + el.dataset.content];
        if (orig !== undefined) el.textContent = orig;
      }
      clearEditStyle(el);
    });

    // 2) Product card fields
    document.querySelectorAll('[data-product-id] [data-product-field]').forEach(function (el) {
      if (restore) {
        var card = el.closest('[data-product-id]');
        var pid = card ? card.dataset.productId : '';
        var orig = _editOriginals['p:' + pid + ':' + el.dataset.productField];
        if (orig !== undefined) el.textContent = orig;
      }
      clearEditStyle(el);
      if (el._ktStopBubble) { el.removeEventListener('click', el._ktStopBubble); delete el._ktStopBubble; }
    });

    // 3) WWS fields (non-recommended)
    document.querySelectorAll('[data-wws-id][data-wws-field]').forEach(function (el) {
      if (el.dataset.wwsField === 'recommended') return; // handled in 3b
      if (restore) {
        var orig = _editOriginals['w:' + el.dataset.wwsId + ':' + el.dataset.wwsField];
        if (orig !== undefined) el.textContent = orig;
      }
      clearEditStyle(el);
    });

    // 3b) Recommended textareas → update ul innerHTML, restore ul visibility, remove textarea
    document.querySelectorAll('.kt-rec-textarea').forEach(function (ta) {
      var id = ta.dataset.ktRecId;
      var ul = document.querySelector('[data-wws-id="' + id + '"][data-wws-field="recommended"]');
      if (ul) {
        var rawText = restore
          ? (_editOriginals['w:' + id + ':recommended'] || '')
          : ta.value;
        var items = rawText.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        ul.innerHTML = items.map(function (t) { return '<li>' + escHtml(t) + '</li>'; }).join('');
        ul.style.display = '';
      }
      ta.remove();
    });

    // 4) Category card fields
    document.querySelectorAll('[data-cat-id][data-cat-field]').forEach(function (el) {
      if (restore) {
        var orig = _editOriginals['cat:' + el.dataset.catId + ':' + el.dataset.catField];
        if (orig !== undefined) el.textContent = orig;
      }
      clearEditStyle(el);
    });

    // 5) Product detail page fields
    document.querySelectorAll('[data-detail-field]').forEach(function (el) {
      if (restore) {
        var id = el.dataset.detailId || '';
        var orig = _editOriginals['d:' + id + ':' + el.dataset.detailField];
        if (orig !== undefined) el.textContent = orig;
      }
      clearEditStyle(el);
    });

    // 6) Restore product card click navigation
    document.querySelectorAll('[data-product-id]').forEach(function (card) {
      if (card._ktEditBlock) {
        card.removeEventListener('click', card._ktEditBlock, true);
        delete card._ktEditBlock;
      }
      card.style.cursor = '';
    });

    // 7) Restore cat-card navigation
    document.querySelectorAll('a.cat-card').forEach(function (a) {
      if (a._ktCatBlock) {
        a.removeEventListener('click', a._ktCatBlock, true);
        delete a._ktCatBlock;
      }
      a.style.cursor = '';
    });

    // 8) Hide image upload buttons
    document.querySelectorAll('.kt-img-btns').forEach(function (wrap) {
      wrap.style.display = 'none';
    });
  }

  /* ── Save to localStorage ─────────────────────── */
  function saveToLocal() {
    // 1) content.json fields
    var updatedContent = JSON.parse(JSON.stringify(_content));
    document.querySelectorAll('[data-content]').forEach(function (el) {
      deepSet(updatedContent, el.dataset.content, el.textContent.trim());
    });
    setDraft('kt_content_draft', updatedContent);
    _content = updatedContent;

    // 2) Product card text fields — only save products whose text actually changed
    var productsDraft = getDraft('kt_products_draft') || {};

    document.querySelectorAll('[data-product-id]').forEach(function (card) {
      var pid = card.dataset.productId;
      var nameEl = card.querySelector('[data-product-field="name"]');
      var descEl = card.querySelector('[data-product-field="description"]');
      var curName = nameEl ? nameEl.textContent.trim() : undefined;
      var curDesc = descEl ? descEl.textContent.trim() : undefined;
      var origName = _editOriginals['p:' + pid + ':name'];
      var origDesc = _editOriginals['p:' + pid + ':description'];
      var nameChanged = curName !== undefined && curName !== origName;
      var descChanged = curDesc !== undefined && curDesc !== origDesc;
      if (!nameChanged && !descChanged) return;
      if (!productsDraft[pid]) productsDraft[pid] = {};
      if (nameChanged) productsDraft[pid].name = curName;
      if (descChanged) productsDraft[pid].description = curDesc;
    });

    // 2b) Product detail page fields
    document.querySelectorAll('[data-detail-field]').forEach(function (el) {
      var id = el.dataset.detailId || '';
      var field = el.dataset.detailField;
      var cur = el.textContent.trim();
      var orig = _editOriginals['d:' + id + ':' + field];
      if (cur === orig) return;
      if (!productsDraft[id]) productsDraft[id] = {};
      productsDraft[id][field] = cur;
    });

    if (Object.keys(productsDraft).length) setDraft('kt_products_draft', productsDraft);

    // 3) WWS text fields — only save industries whose text actually changed
    var wwsDraft = getDraft('kt_wws_draft') || {};

    document.querySelectorAll('[data-wws-id][data-wws-field]').forEach(function (el) {
      var id = el.dataset.wwsId, field = el.dataset.wwsField;
      if (field === 'recommended') return; // handled via textarea below
      var cur = el.textContent.trim();
      var orig = _editOriginals['w:' + id + ':' + field];
      if (cur === orig) return;
      if (!wwsDraft[id]) wwsDraft[id] = {};
      wwsDraft[id][field] = cur;
    });

    // Collect recommended from active textareas (still present before exitEditMode runs)
    document.querySelectorAll('.kt-rec-textarea').forEach(function (ta) {
      var id = ta.dataset.ktRecId;
      var cur = ta.value;
      var orig = _editOriginals['w:' + id + ':recommended'] || '';
      if (cur === orig) return;
      if (!wwsDraft[id]) wwsDraft[id] = {};
      wwsDraft[id].recommended = cur;
    });

    if (Object.keys(wwsDraft).length) setDraft('kt_wws_draft', wwsDraft);

    // 4) Category text fields — only save categories whose text actually changed
    var categoriesDraft = getDraft('kt_categories_draft') || {};

    document.querySelectorAll('[data-cat-id][data-cat-field]').forEach(function (el) {
      var catId = el.dataset.catId, field = el.dataset.catField;
      var cur = el.textContent.trim();
      var orig = _editOriginals['cat:' + catId + ':' + field];
      if (cur === orig) return;
      if (!categoriesDraft[catId]) categoriesDraft[catId] = {};
      categoriesDraft[catId][field] = cur;
    });

    if (Object.keys(categoriesDraft).length) setDraft('kt_categories_draft', categoriesDraft);
  }

  /* ── Publish all drafts to GitHub ────────────── */
  async function publishDrafts() {
    var contentDraft    = getDraft('kt_content_draft');
    var productsDraft   = getDraft('kt_products_draft');
    var wwsDraft        = getDraft('kt_wws_draft');
    var categoriesDraft = getDraft('kt_categories_draft');
    var imagesDraft     = getDraft('kt_images_draft') || {};

    // Route staged image changes to the file that holds their reference.
    // Category images live in products.json; everything else in site-settings.json.
    var imgKeys      = Object.keys(imagesDraft);
    var prodImgKeys  = imgKeys.filter(function (k) { return k.indexOf('cat-') === 0; });
    var settingsImgKeys = imgKeys.filter(function (k) { return k.indexOf('cat-') !== 0; });

    // Upload all staged image binaries (unique new paths → no SHA conflicts).
    async function pushStagedBinaries(keys) {
      for (var i = 0; i < keys.length; i++) {
        var entry = imagesDraft[keys[i]];
        if (entry && entry.action === 'upload') {
          await ghPutBinary(entry.relPath, entry.base64, 'Upload image via inline editor');
        }
      }
    }

    var tasks = [];

    if (contentDraft) {
      tasks.push(
        ghCommit('content.json', JSON.stringify(contentDraft, null, 2), 'Update site content via inline editor')
          .then(function () { localStorage.removeItem('kt_content_draft'); })
      );
    }

    // Combine product/category text + category images into ONE products.json commit
    if (productsDraft || categoriesDraft || prodImgKeys.length) {
      tasks.push((async function () {
        await pushStagedBinaries(prodImgKeys);
        var f = await ghFetchJson('products.json');
        if (productsDraft) {
          Object.keys(productsDraft).forEach(function (pid) {
            var changes = productsDraft[pid];
            var product = f.data.products && f.data.products.find(function (p) { return p.id === pid; });
            if (!product) return;
            if (changes.name        !== undefined) product.name        = changes.name;
            if (changes.description !== undefined) product.description = changes.description;
          });
        }
        if (categoriesDraft) {
          Object.keys(categoriesDraft).forEach(function (catId) {
            var changes = categoriesDraft[catId];
            var cat = f.data.categories && f.data.categories.find(function (c) { return c.id === catId; });
            if (!cat) return;
            if (changes.label       !== undefined) cat.label       = changes.label;
            if (changes.description !== undefined) cat.description = changes.description;
          });
        }
        prodImgKeys.forEach(function (k) {
          var entry = imagesDraft[k];
          var catId = k.replace('cat-', '');
          var cat = f.data.categories && f.data.categories.find(function (c) { return c.id === catId; });
          if (!cat) return;
          if (entry.action === 'upload') cat.image = entry.relPath;
          else if (entry.action === 'remove') delete cat.image;
        });
        await ghCommit('products.json', JSON.stringify(f.data, null, 2), 'Update products/categories via inline editor');
        localStorage.removeItem('kt_products_draft');
        localStorage.removeItem('kt_categories_draft');
      })());
    }

    // Combine industry text + hero/industry images into ONE site-settings.json commit
    if (wwsDraft || settingsImgKeys.length) {
      tasks.push((async function () {
        await pushStagedBinaries(settingsImgKeys);
        var f = await ghFetchJson('site-settings.json');
        if (wwsDraft) {
          if (!f.data.industryContent) f.data.industryContent = {};
          Object.keys(wwsDraft).forEach(function (id) {
            var changes = wwsDraft[id];
            if (!f.data.industryContent[id]) f.data.industryContent[id] = {};
            if (changes.heading     !== undefined) f.data.industryContent[id].heading     = changes.heading;
            if (changes.desc        !== undefined) f.data.industryContent[id].desc        = changes.desc;
            if (changes.recommended !== undefined) f.data.industryContent[id].recommended = changes.recommended;
          });
        }
        settingsImgKeys.forEach(function (k) {
          var entry = imagesDraft[k];
          if (k === 'hero') {
            if (!f.data.hero) f.data.hero = {};
            if (entry.action === 'upload') f.data.hero.image = entry.relPath;
            else delete f.data.hero.image;
          } else if (k.indexOf('home-ind-') === 0) {
            var hid = k.replace('home-ind-', '');
            if (!f.data.homeIndustryImages) f.data.homeIndustryImages = {};
            if (entry.action === 'upload') f.data.homeIndustryImages[hid] = entry.relPath;
            else delete f.data.homeIndustryImages[hid];
          } else if (k.indexOf('ind-') === 0) {
            var iid = k.replace('ind-', '');
            if (!f.data.industryImages) f.data.industryImages = {};
            if (entry.action === 'upload') f.data.industryImages[iid] = entry.relPath;
            else delete f.data.industryImages[iid];
          }
        });
        await ghCommit('site-settings.json', JSON.stringify(f.data, null, 2), 'Update site settings via inline editor');
        localStorage.removeItem('kt_wws_draft');
      })());
    }

    if (!tasks.length) throw new Error('No unpublished changes.');
    await Promise.all(tasks);
    localStorage.removeItem('kt_images_draft');
  }

  /* ── Floating edit bar ────────────────────────── */
  function injectEditUI() {
    var bar = document.createElement('div');
    bar.id = 'kt-edit-bar';
    bar.style.cssText = 'position:fixed;bottom:24px;left:20px;z-index:9000;display:flex;flex-direction:column;align-items:flex-start;gap:8px;';

    var status = document.createElement('div');
    status.style.cssText = [
      'display:none;font-size:0.75rem;background:#fff;color:#555',
      'padding:6px 12px;border-radius:8px;border:1px solid #ddd',
      'box-shadow:0 2px 8px rgba(0,0,0,0.08);font-family:inherit;max-width:300px'
    ].join(';');

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';

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

    var editBtn    = mkBtn('✏️ Edit Page',  '#1a1a1a', '#fff');
    var saveBtn    = mkBtn('💾 Save',       '#27ae60', '#fff');
    var publishBtn = mkBtn('📤 Publish',    '#2980b9', '#fff');
    var cancelBtn  = mkBtn('✕',             '#fff',    '#555');
    publishBtn.id = 'kt-publish-btn';
    cancelBtn.style.border = '1.5px solid #ddd';
    cancelBtn.style.boxShadow = 'none';

    // Edit mode buttons hidden initially
    saveBtn.style.display   = 'none';
    cancelBtn.style.display = 'none';

    function showStatus(msg, color, duration) {
      status.textContent = msg;
      status.style.color = color || '#555';
      status.style.display = '';
      if (duration) setTimeout(function () { status.style.display = 'none'; }, duration);
    }

    // Enter edit mode
    editBtn.addEventListener('click', function () {
      enterEditMode();
      editBtn.style.display    = 'none';
      publishBtn.style.display = 'none';
      saveBtn.style.display    = '';
      cancelBtn.style.display  = '';
      showStatus('Click any text to edit. Use 📷 to swap images.');
    });

    // Cancel — undo this session's edits
    cancelBtn.addEventListener('click', function () {
      exitEditMode(true);
      editBtn.style.display   = '';
      saveBtn.style.display   = 'none';
      cancelBtn.style.display = 'none';
      status.style.display    = 'none';
      updateDraftBar();
    });

    // Save to localStorage
    saveBtn.addEventListener('click', function () {
      if (!localStorage.getItem('kt_token')) { showStatus('⚠️ Sign into admin first.', '#c0392b'); return; }
      saveToLocal();
      exitEditMode(false);
      editBtn.style.display   = '';
      saveBtn.style.display   = 'none';
      cancelBtn.style.display = 'none';
      showStatus('✓ Saved! Press 📤 Publish when ready.', '#27ae60', 5000);
      updateDraftBar();
    });

    // Publish to GitHub
    publishBtn.addEventListener('click', async function () {
      var g = gh();
      if (!g.token || !g.owner || !g.repo) { showStatus('⚠️ Sign into admin first.', '#c0392b'); return; }
      publishBtn.disabled = true;
      publishBtn.innerHTML = '⏳ Publishing…';
      showStatus('⏳ Committing to GitHub…');
      try {
        await publishDrafts();
        showStatus('✓ Published! Live in ~30s.', '#27ae60', 5000);
      } catch (e) {
        showStatus('⚠️ ' + e.message, '#c0392b');
      } finally {
        publishBtn.disabled = false;
        publishBtn.innerHTML = '📤 Publish';
        updateDraftBar();
      }
    });

    btnRow.appendChild(editBtn);
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(publishBtn);
    btnRow.appendChild(cancelBtn);
    bar.appendChild(status);
    bar.appendChild(btnRow);
    document.body.appendChild(bar);

    updateDraftBar();
  }

  /* ── Boot ─────────────────────────────────────── */
  fetch('content.json?v=' + Date.now())
    .then(function (r) { return r.json(); })
    .then(function (c) {
      // Overlay any local draft over server content
      var draft = getDraft('kt_content_draft');
      _content = draft ? deepMerge(c, draft) : c;
      window.__siteContent = _content;

      function boot() {
        applyContent(_content);
        applyWwsDraft();
        applyImagesDraft(); // overlay staged (unpublished) image previews
        // Re-apply drafts after settingsLoaded fires (settings-loader may overwrite industry text/images)
        document.addEventListener('settingsLoaded', function () {
          applyWwsDraft();
          applyImagesDraft();
        });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
      } else {
        boot();
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
