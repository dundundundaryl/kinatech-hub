/* Kinatech Hub — Site Settings Loader
   Loads site-settings.json and applies colors instantly.
   Pages can listen for 'settingsLoaded' on document for image/contact updates. */
(function () {
  function applyColors(c) {
    if (!c) return;
    const r = document.documentElement;
    if (c.tan)       r.style.setProperty('--tan', c.tan);
    if (c.tanDark)   r.style.setProperty('--tan-dark', c.tanDark);
    if (c.tanLight)  r.style.setProperty('--tan-light', c.tanLight);
    if (c.tanFooter) r.style.setProperty('--tan-footer', c.tanFooter);
    if (c.bgAlt)     r.style.setProperty('--bg-alt', c.bgAlt);
    if (c.cardBg)    r.style.setProperty('--card-bg', c.cardBg);
  }

  function applyLogo(logo) {
    if (!logo) return;
    document.querySelectorAll('a.logo').forEach(function (a) {
      if (a.dataset.logoApplied === logo) return;
      a.dataset.logoApplied = logo;
      a.innerHTML =
        '<img src="' + logo + '" alt="Kinatech Hub" class="logo-img" ' +
        'style="height:44px;width:auto;max-width:170px;object-fit:contain;display:block">';
    });
  }

  // Apply cached colors + logo immediately (no flash on repeat visits)
  try {
    const cached = sessionStorage.getItem('kt_settings');
    if (cached) {
      const c = JSON.parse(cached);
      applyColors(c.colors);
      if (document.readyState !== 'loading') applyLogo(c.logo);
      else document.addEventListener('DOMContentLoaded', function () { applyLogo(c.logo); });
    }
  } catch (e) {}

  // Fetch fresh settings
  fetch('site-settings.json?v=' + Date.now())
    .then(r => r.json())
    .then(s => {
      applyColors(s.colors);
      applyLogo(s.logo);
      window.__siteSettings = s;
      try { sessionStorage.setItem('kt_settings', JSON.stringify(s)); } catch (e) {}
      document.dispatchEvent(new CustomEvent('settingsLoaded', { detail: s }));
    })
    .catch(() => {});
})();
