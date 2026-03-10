/**
 * Skart 2 Online — Internationalization (i18n) Module
 * Supports Hungarian (hu) and English (en)
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'skart-lang';
  const SUPPORTED_LANGS = ['hu', 'en'];
  const DEFAULT_LANG = 'hu';

  let currentLang = DEFAULT_LANG;
  let locales = {};

  /**
   * Load a locale JSON file
   */
  async function loadLocale(lang) {
    if (locales[lang]) return locales[lang];
    try {
      const resp = await fetch(`/locales/${lang}.json`);
      if (!resp.ok) throw new Error(`Failed to load locale: ${lang}`);
      locales[lang] = await resp.json();
      return locales[lang];
    } catch (err) {
      console.error(`[i18n] Error loading ${lang}:`, err);
      return null;
    }
  }

  /**
   * Get a nested translation key like "auth.login_title"
   */
  function t(key) {
    const data = locales[currentLang];
    if (!data) return key;
    const parts = key.split('.');
    let val = data;
    for (const p of parts) {
      val = val?.[p];
    }
    return val || key;
  }

  /**
   * Apply translations to all elements with data-i18n attribute
   */
  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translated = t(key);
      if (translated && translated !== key) {
        el.textContent = translated;
      }
    });

    // Update lang toggle buttons text
    const toggleLabel = t('_meta.toggle_label');
    document.querySelectorAll('#lang-toggle-auth, #lang-toggle-lobby').forEach(btn => {
      btn.textContent = toggleLabel;
    });

    // Update HTML lang attribute
    document.documentElement.lang = currentLang;
  }

  /**
   * Set language and apply
   */
  async function setLanguage(lang) {
    if (!SUPPORTED_LANGS.includes(lang)) lang = DEFAULT_LANG;
    await loadLocale(lang);
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    applyTranslations();
  }

  /**
   * Toggle between hu and en
   */
  async function toggle() {
    const next = currentLang === 'hu' ? 'en' : 'hu';
    await setLanguage(next);
  }

  /**
   * Initialize i18n on page load
   */
  async function init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    const lang = SUPPORTED_LANGS.includes(saved) ? saved : DEFAULT_LANG;
    // Preload both languages
    await Promise.all(SUPPORTED_LANGS.map(l => loadLocale(l)));
    await setLanguage(lang);
  }

  // Expose global API
  window.SkartI18n = {
    t,
    setLanguage,
    toggle,
    init,
    getCurrentLang: () => currentLang
  };
})();
