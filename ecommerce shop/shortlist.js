/* ══ Kinatech Inquiry List ══
   Shared across all pages.
   Injects floating widget on non-contact pages.
   On contact.html: just exposes the API for pre-fill.
*/
(function () {
  const KEY = 'kt_shortlist';

  /* ── Storage ── */
  function getList() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function saveList(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  }
  function addItem(item) {
    const list = getList();
    if (!list.find(x => x.id === item.id)) { list.push(item); saveList(list); }
    refreshWidget();
  }
  function removeItem(id) {
    saveList(getList().filter(x => x.id !== id));
    refreshWidget();
  }
  function clearList() { saveList([]); refreshWidget(); }
  function isInList(id) { return getList().some(x => x.id === id); }

  /* ── Toggle from a button (uses data attributes to avoid escaping issues) ── */
  function slToggle(btn) {
    const id = btn.dataset.slId;
    if (isInList(id)) {
      removeItem(id);
    } else {
      addItem({
        id,
        model:         btn.dataset.slModel || '',
        name:          btn.dataset.slName  || '',
        categoryLabel: btn.dataset.slCat   || ''
      });
    }
  }
  window.slToggle = slToggle;

  /* ── Send inquiry → contact.html ── */
  function sendInquiry() {
    window.location.href = 'contact.html';
  }

  /* ── Refresh widget UI ── */
  let panelOpen = false;

  function refreshWidget() {
    const list = getList();

    // Update FAB
    const fab = document.getElementById('sl-fab');
    if (fab) {
      fab.classList.toggle('sl-hidden', list.length === 0);
      const badge = document.getElementById('sl-badge');
      if (badge) badge.textContent = list.length;
    }

    // Update panel list
    const listEl = document.getElementById('sl-list');
    if (listEl) {
      if (list.length === 0) {
        panelOpen = false;
        document.getElementById('sl-panel')?.classList.remove('open');
        listEl.innerHTML = '<p style="color:#bbb;font-size:0.82rem;text-align:center;padding:20px 0">No products added yet.</p>';
      } else {
        listEl.innerHTML = list.map(item => `
          <div class="sl-item">
            <div class="sl-item-info">
              <div class="sl-model">${item.model}</div>
              <div class="sl-name">${item.name}</div>
              <div class="sl-cat">${item.categoryLabel || ''}</div>
            </div>
            <button class="sl-remove" onclick="event.stopPropagation();window.Shortlist.removeItem('${item.id}')" title="Remove">×</button>
          </div>`).join('');
      }
    }

    // Update all add-to-inquiry buttons on the page
    document.querySelectorAll('[data-sl-id]').forEach(btn => {
      const inList = isInList(btn.dataset.slId);
      btn.dataset.active = inList ? '1' : '0';
      const label = btn.dataset.slLabel || '+ Add to Inquiry';
      if (inList) {
        btn.innerHTML = '<span class="sl-lbl-full">✓ In Inquiry List</span><span class="sl-lbl-mini">✓</span>';
      } else {
        btn.textContent = label;
      }
    });
  }

  /* ── Toggle panel ── */
  function togglePanel() {
    panelOpen = !panelOpen;
    document.getElementById('sl-panel')?.classList.toggle('open', panelOpen);
  }

  /* ── Inject widget HTML + CSS ── */
  function injectWidget() {
    if (document.getElementById('sl-fab')) return;

    const style = document.createElement('style');
    style.textContent = `
      #sl-fab {
        position: fixed; bottom: 28px; right: 28px; z-index: 400;
        background: #1a1a1a; color: #fff;
        border: none; border-radius: 40px;
        padding: 11px 18px 11px 14px;
        font-family: 'Inter', sans-serif; font-size: 0.85rem; font-weight: 600;
        cursor: pointer; display: flex; align-items: center; gap: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.22);
        transition: transform 0.2s, opacity 0.3s;
      }
      #sl-fab:hover { transform: translateY(-2px); }
      #sl-fab.sl-hidden { opacity: 0; pointer-events: none; transform: translateY(8px); }
      #sl-badge {
        background: #c9b89a; color: #1a1a1a;
        font-size: 0.7rem; font-weight: 700;
        min-width: 18px; height: 18px; border-radius: 9px; padding: 0 4px;
        display: inline-flex; align-items: center; justify-content: center;
      }
      #sl-panel {
        position: fixed; bottom: 86px; right: 28px; z-index: 400;
        background: #fff; border-radius: 16px;
        box-shadow: 0 8px 40px rgba(0,0,0,0.16);
        width: 300px; max-height: 68vh; overflow: hidden;
        display: flex; flex-direction: column;
        transform: translateY(14px); opacity: 0; pointer-events: none;
        transition: transform 0.22s ease, opacity 0.22s ease;
        font-family: 'Inter', sans-serif;
      }
      #sl-panel.open { transform: translateY(0); opacity: 1; pointer-events: all; }
      #sl-head {
        padding: 14px 18px 10px; border-bottom: 1px solid #f0ece6;
        display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
      }
      #sl-head strong { font-size: 0.88rem; }
      #sl-clear { font-size: 0.72rem; color: #bbb; background: none; border: none; cursor: pointer; font-family: inherit; }
      #sl-clear:hover { color: #c0392b; }
      #sl-list { flex: 1; overflow-y: auto; padding: 6px 18px; }
      .sl-item { display: flex; align-items: flex-start; gap: 8px; padding: 9px 0; border-bottom: 1px solid #f5f0ea; }
      .sl-item:last-child { border-bottom: none; }
      .sl-item-info { flex: 1; min-width: 0; }
      .sl-model { font-size: 0.65rem; font-weight: 700; color: #bbb; text-transform: uppercase; letter-spacing: 0.04em; }
      .sl-name { font-size: 0.85rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sl-cat { font-size: 0.7rem; color: #bbb; }
      .sl-remove { background: none; border: none; cursor: pointer; color: #ccc; font-size: 1.15rem; padding: 0 3px; line-height: 1; flex-shrink: 0; margin-top: 2px; }
      .sl-remove:hover { color: #c0392b; }
      #sl-foot { padding: 12px 18px; border-top: 1px solid #f0ece6; flex-shrink: 0; }
      #sl-send {
        width: 100%; padding: 11px; border: none; border-radius: 8px;
        background: #1a1a1a; color: #fff;
        font-family: 'Inter', sans-serif; font-size: 0.85rem; font-weight: 600;
        cursor: pointer; transition: opacity 0.18s;
      }
      #sl-send:hover { opacity: 0.82; }
      [data-sl-id] { transition: background 0.18s, color 0.18s, border-color 0.18s; }
      [data-sl-id][data-active="1"] { background: #f0f7ee !important; color: #2a7a2a !important; border-color: #a8d8a8 !important; }
      .sl-lbl-mini { display: none; }
      @media (max-width: 480px) {
        #sl-panel { width: calc(100vw - 32px); right: 16px; }
        #sl-fab { right: 16px; bottom: 16px; }
        [data-sl-id][data-active="1"] {
          min-width: 0 !important; width: auto !important;
          flex: 0 0 auto !important;
          padding: 7px 13px !important;
          align-self: center;
        }
        [data-sl-id][data-active="1"] .sl-lbl-full { display: none; }
        [data-sl-id][data-active="1"] .sl-lbl-mini {
          display: inline-flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 0.95rem; line-height: 1;
        }
      }
    `;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'sl-fab';
    fab.className = 'sl-hidden';
    fab.setAttribute('aria-label', 'Inquiry list');
    fab.onclick = togglePanel;
    fab.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>Inquiry List&nbsp;<span id="sl-badge">0</span>`;
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'sl-panel';
    panel.innerHTML = `
      <div id="sl-head">
        <strong>Your Inquiry List</strong>
        <button id="sl-clear" onclick="window.Shortlist.clearList()">Clear all</button>
      </div>
      <div id="sl-list"></div>
      <div id="sl-foot">
        <button id="sl-send" onclick="window.Shortlist.sendInquiry()">Send Inquiry →</button>
      </div>`;
    document.body.appendChild(panel);

    // Close on outside click.
    // Use 'mousedown' (not 'click'): clicking the × re-renders the list via
    // innerHTML, which detaches the clicked button before a 'click' handler
    // runs — making it look like an outside click and wrongly closing the panel.
    // mousedown fires before that re-render, so the target is still inside the panel.
    document.addEventListener('mousedown', e => {
      if (!panelOpen) return;
      if (panel.contains(e.target) || e.target === fab || fab.contains(e.target)) return;
      panelOpen = false;
      panel.classList.remove('open');
    });

    refreshWidget();
  }

  // ESC closes panel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panelOpen) {
      panelOpen = false;
      document.getElementById('sl-panel')?.classList.remove('open');
    }
  });

  /* ── Expose API ── */
  window.Shortlist = { getList, addItem, removeItem, clearList, isInList, togglePanel, sendInquiry, refreshWidget };

  /* ── Init on DOM ready ── */
  document.addEventListener('DOMContentLoaded', () => {
    const isContact = window.location.pathname.includes('contact');
    if (!isContact) {
      injectWidget();
    }
  });
})();
