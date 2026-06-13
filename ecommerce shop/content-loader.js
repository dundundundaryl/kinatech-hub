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
    return relPath;
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
              localStorage.getItem('kt_wws_draft'));
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
      var card = document.querySelector('[data-product-id="' + pid + '"]');
      if (!card) return;
      if (changes.name) { var el = card.querySelector('[data-product-field="name"]'); if (el) el.textContent = changes.name; }
      if (changes.description) { var el = card.querySelector('[data-product-field="description"]'); if (el) el.textContent = changes.description; }
    });
  }

  function applyWwsDraft() {
    var draft = getDraft('kt_wws_draft');
    if (!draft) return;
    Object.keys(draft).forEach(function (id) {
      var changes = draft[id];
      if (changes.heading) { var el = document.querySelector('[data-wws-id="' + id + '"][data-wws-field="heading"]'); if (el) el.textContent = changes.heading; }
      if (changes.desc)    { var el = document.querySelector('[data-wws-id="' + id + '"][data-wws-field="desc"]');    if (el) el.textContent = changes.desc;    }
    });
  }

  // Products.html calls this after dynamically rendering cards
  window.__ktApplyDrafts = function () {
    applyProductsDraft();
    applyWwsDraft();
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

    // Button container
    var wrap = document.createElement('div');
    wrap.className = 'kt-img-btns';
    wrap.style.cssText = 'position:absolute;top:8px;right:8px;z-index:20;display:none;gap:5px;align-items:center;';

    var uploadBtn = document.createElement('button');
    uploadBtn.style.cssText = imgBtnCSS('rgba(0,0,0,0.72)', '#fff');
    uploadBtn.innerHTML = '📷 ' + (el.dataset.imgLabel || 'Upload');

    var removeBtn = document.createElement('button');
    removeBtn.style.cssText = imgBtnCSS('rgba(192,57,43,0.82)', '#fff');
    removeBtn.innerHTML = '✕ Remove';

    wrap.appendChild(uploadBtn);
    wrap.appendChild(removeBtn);

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

    el.appendChild(wrap);
    el.appendChild(fileInput);

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

  async function handleImgUpload(el, uploadBtn, file, removeBtn, wrap, fileInput, refreshRemove) {
    var key = el.dataset.imgKey;
    var origLabel = uploadBtn.innerHTML;
    uploadBtn.innerHTML = '⏳ Uploading…';
    uploadBtn.disabled = true;

    try {
      var imgPath = await uploadImageFile(file);

      if (key === 'hero') {
        var f = await ghFetchJson('site-settings.json');
        if (!f.data.hero) f.data.hero = {};
        f.data.hero.image = imgPath;
        await ghCommit('site-settings.json', JSON.stringify(f.data, null, 2), 'Update hero image via inline editor');
        var hero = document.getElementById('heroSection');
        if (hero) hero.style.backgroundImage = "url('" + imgPath + "')";
        var ph = document.querySelector('.hero-bg-placeholder');
        if (ph) ph.style.display = 'none';

      } else if (key.indexOf('cat-') === 0) {
        var catId = key.replace('cat-', '');
        var f = await ghFetchJson('products.json');
        var cat = f.data.categories && f.data.categories.find(function (c) { return c.id === catId; });
        if (cat) cat.image = imgPath;
        await ghCommit('products.json', JSON.stringify(f.data, null, 2), 'Update category image via inline editor');
        var existing = el.querySelector('img');
        if (existing) {
          existing.src = imgPath;
        } else {
          var ph = el.querySelector('[class*="placeholder"]');
          if (ph) ph.remove();
          var img = document.createElement('img');
          img.src = imgPath; img.className = 'cat-product-img'; img.alt = catId;
          el.insertBefore(img, el.firstChild);
        }

      } else if (key.indexOf('home-ind-') === 0) {
        var indId = key.replace('home-ind-', '');
        var f = await ghFetchJson('site-settings.json');
        if (!f.data.homeIndustryImages) f.data.homeIndustryImages = {};
        f.data.homeIndustryImages[indId] = imgPath;
        await ghCommit('site-settings.json', JSON.stringify(f.data, null, 2), 'Update home industry image via inline editor');
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
        var indId = key.replace('ind-', '');
        var f = await ghFetchJson('site-settings.json');
        if (!f.data.industryImages) f.data.industryImages = {};
        f.data.industryImages[indId] = imgPath;
        await ghCommit('site-settings.json', JSON.stringify(f.data, null, 2), 'Update industry image via inline editor');
        var existing = el.querySelector('img');
        if (existing) {
          existing.src = imgPath;
        } else {
          var ph = el.querySelector('.industry-img-placeholder');
          if (ph) ph.remove();
          var img = document.createElement('img');
          img.src = imgPath; img.alt = indId;
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          el.insertBefore(img, el.firstChild);
        }
      }

      uploadBtn.innerHTML = '✓ Saved';
      uploadBtn.style.background = 'rgba(39,174,96,0.88)';
      refreshRemove();
      setTimeout(function () {
        uploadBtn.innerHTML = origLabel;
        uploadBtn.style.background = 'rgba(0,0,0,0.72)';
        uploadBtn.disabled = false;
      }, 2500);

    } catch (e) {
      uploadBtn.innerHTML = '⚠️ ' + e.message;
      uploadBtn.style.background = 'rgba(192,57,43,0.88)';
      setTimeout(function () {
        uploadBtn.innerHTML = origLabel;
        uploadBtn.style.background = 'rgba(0,0,0,0.72)';
        uploadBtn.disabled = false;
      }, 3500);
    }
  }

  async function handleImgRemove(el, removeBtn, refreshRemove) {
    var key = el.dataset.imgKey;
    var origLabel = removeBtn.innerHTML;
    removeBtn.innerHTML = '⏳';
    removeBtn.disabled = true;

    try {
      if (key === 'hero') {
        var f = await ghFetchJson('site-settings.json');
        if (f.data.hero) delete f.data.hero.image;
        await ghCommit('site-settings.json', JSON.stringify(f.data, null, 2), 'Remove hero image via inline editor');
        var hero = document.getElementById('heroSection');
        if (hero) hero.style.backgroundImage = '';

      } else if (key.indexOf('cat-') === 0) {
        var catId = key.replace('cat-', '');
        var f = await ghFetchJson('products.json');
        var cat = f.data.categories && f.data.categories.find(function (c) { return c.id === catId; });
        if (cat) delete cat.image;
        await ghCommit('products.json', JSON.stringify(f.data, null, 2), 'Remove category image via inline editor');
        var img = el.querySelector('img');
        if (img) img.remove();

      } else if (key.indexOf('home-ind-') === 0) {
        var indId = key.replace('home-ind-', '');
        var f = await ghFetchJson('site-settings.json');
        if (f.data.homeIndustryImages) delete f.data.homeIndustryImages[indId];
        await ghCommit('site-settings.json', JSON.stringify(f.data, null, 2), 'Remove home industry image via inline editor');
        var img = el.querySelector('.wws-photo');
        if (img) img.remove();

      } else if (key.indexOf('ind-') === 0) {
        var indId = key.replace('ind-', '');
        var f = await ghFetchJson('site-settings.json');
        if (f.data.industryImages) delete f.data.industryImages[indId];
        await ghCommit('site-settings.json', JSON.stringify(f.data, null, 2), 'Remove industry image via inline editor');
        var img = el.querySelector('img');
        if (img) img.remove();
      }

      removeBtn.innerHTML = '✓ Removed';
      removeBtn.style.background = 'rgba(39,174,96,0.88)';
      refreshRemove();
      setTimeout(function () {
        removeBtn.innerHTML = origLabel;
        removeBtn.style.background = 'rgba(192,57,43,0.82)';
        removeBtn.disabled = false;
        refreshRemove(); // hide if still no image
      }, 2000);

    } catch (e) {
      removeBtn.innerHTML = '⚠️ ' + e.message;
      setTimeout(function () { removeBtn.innerHTML = origLabel; removeBtn.disabled = false; }, 3500);
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
    document.querySelectorAll('[data-content]').forEach(function (el) {
      capture(el, 'c:' + el.dataset.content);
    });
    document.querySelectorAll('[data-product-id] [data-product-field]').forEach(function (el) {
      var card = el.closest('[data-product-id]');
      var pid = card ? card.dataset.productId : '';
      capture(el, 'p:' + pid + ':' + el.dataset.productField);
    });
    document.querySelectorAll('[data-wws-id][data-wws-field]').forEach(function (el) {
      capture(el, 'w:' + el.dataset.wwsId + ':' + el.dataset.wwsField);
    });
    // Block product card navigation so clicking editable text doesn't redirect
    document.querySelectorAll('[data-product-id]').forEach(function (card) {
      card._ktEditBlock = function (e) {
        // Allow clicks on contenteditable fields to pass through; block everything else
        if (!e.target.closest('[contenteditable="true"]')) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      };
      card.addEventListener('click', card._ktEditBlock, true);
      card.style.cursor = 'default';
    });
    // Images
    document.querySelectorAll('[data-img-key]').forEach(function (el) {
      attachImgUpload(el);
      var wrap = el.querySelector('.kt-img-btns');
      if (wrap) wrap.style.display = 'flex';
    });
  }

  function exitEditMode(restore) {
    _inEditMode = false;
    document.querySelectorAll('[data-content]').forEach(function (el) {
      if (restore) { var orig = _editOriginals['c:' + el.dataset.content]; if (orig !== undefined) el.textContent = orig; }
      clearEditStyle(el);
    });
    document.querySelectorAll('[data-product-id] [data-product-field]').forEach(function (el) {
      if (restore) {
        var card = el.closest('[data-product-id]');
        var pid = card ? card.dataset.productId : '';
        var orig = _editOriginals['p:' + pid + ':' + el.dataset.productField];
        if (orig !== undefined) el.textContent = orig;
      }
      clearEditStyle(el);
    });
    document.querySelectorAll('[data-wws-id][data-wws-field]').forEach(function (el) {
      if (restore) { var orig = _editOriginals['w:' + el.dataset.wwsId + ':' + el.dataset.wwsField]; if (orig !== undefined) el.textContent = orig; }
      clearEditStyle(el);
    });
    // Restore product card click navigation
    document.querySelectorAll('[data-product-id]').forEach(function (card) {
      if (card._ktEditBlock) {
        card.removeEventListener('click', card._ktEditBlock, true);
        delete card._ktEditBlock;
      }
      card.style.cursor = '';
    });
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

    // 2) Product text fields — only save products whose text actually changed
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
    if (Object.keys(productsDraft).length) setDraft('kt_products_draft', productsDraft);

    // 3) WWS text fields — only save industries whose text actually changed
    var wwsDraft = getDraft('kt_wws_draft') || {};
    document.querySelectorAll('[data-wws-id][data-wws-field]').forEach(function (el) {
      var id = el.dataset.wwsId, field = el.dataset.wwsField;
      var cur = el.textContent.trim();
      var orig = _editOriginals['w:' + id + ':' + field];
      if (cur === orig) return;
      if (!wwsDraft[id]) wwsDraft[id] = {};
      wwsDraft[id][field] = cur;
    });
    if (Object.keys(wwsDraft).length) setDraft('kt_wws_draft', wwsDraft);
  }

  /* ── Publish all drafts to GitHub ────────────── */
  async function publishDrafts() {
    var contentDraft   = getDraft('kt_content_draft');
    var productsDraft  = getDraft('kt_products_draft');
    var wwsDraft       = getDraft('kt_wws_draft');

    var tasks = [];

    if (contentDraft) {
      tasks.push(
        ghCommit('content.json', JSON.stringify(contentDraft, null, 2), 'Update site content via inline editor')
          .then(function () { localStorage.removeItem('kt_content_draft'); })
      );
    }

    if (productsDraft) {
      tasks.push(
        ghFetchJson('products.json').then(async function (f) {
          Object.keys(productsDraft).forEach(function (pid) {
            var changes = productsDraft[pid];
            var product = f.data.products && f.data.products.find(function (p) { return p.id === pid; });
            if (!product) return;
            if (changes.name !== undefined)        product.name        = changes.name;
            if (changes.description !== undefined) product.description = changes.description;
          });
          await ghCommit('products.json', JSON.stringify(f.data, null, 2), 'Update product text via inline editor');
          localStorage.removeItem('kt_products_draft');
        })
      );
    }

    if (wwsDraft) {
      tasks.push(
        ghFetchJson('site-settings.json').then(async function (f) {
          if (!f.data.industryContent) f.data.industryContent = {};
          Object.keys(wwsDraft).forEach(function (id) {
            var changes = wwsDraft[id];
            if (!f.data.industryContent[id]) f.data.industryContent[id] = {};
            if (changes.heading !== undefined) f.data.industryContent[id].heading = changes.heading;
            if (changes.desc    !== undefined) f.data.industryContent[id].desc    = changes.desc;
          });
          await ghCommit('site-settings.json', JSON.stringify(f.data, null, 2), 'Update industry content via inline editor');
          localStorage.removeItem('kt_wws_draft');
        })
      );
    }

    if (!tasks.length) throw new Error('No unpublished changes.');
    await Promise.all(tasks);
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
        // Re-apply WWS draft after settingsLoaded fires (settings-loader may overwrite industry text)
        document.addEventListener('settingsLoaded', function () {
          applyWwsDraft();
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
