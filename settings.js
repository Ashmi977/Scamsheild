// User settings in chrome.storage.local, shared by the popup, the options page and the background worker.
import { CATEGORIES, RULES } from './engine/catalog.js';
import { defaultWeights } from './engine/analyzer.js';
import { normalizeTrusted } from './engine/trusted.js';

const KEY = 'settings';

/** Sites where inline warnings can be switched on. Access to each is requested only when the user enables it. */
export const INLINE_SITES = {
    WHATSAPP: { label: 'WhatsApp Web', scriptId: 'scamshield-inline-whatsapp', origins: ['https://web.whatsapp.com/*'] },
    EMAIL: { label: 'Gmail', scriptId: 'scamshield-inline-gmail', origins: ['https://mail.google.com/*'] },
};

export const DEFAULT_SETTINGS = Object.freeze({
    theme: 'auto',
    saveHistory: true,
    inline: { WHATSAPP: false, EMAIL: false },
    inlineMinLevel: 'MEDIUM',
    weights: {},
    trusted: normalizeTrusted(),
    dashboard: false,
});

/** Fills in missing fields and drops invalid values, so older or hand-edited settings never break the UI. */
export function normalizeSettings(raw = {}) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const weights = {};
    for (const [code, value] of Object.entries(s.weights ?? {})) {
        const n = Number(value);
        if (RULES[code] && Number.isInteger(n) && n >= 0 && n <= 100 && n !== RULES[code].weight) weights[code] = n;
    }
    return {
        theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto',
        saveHistory: s.saveHistory !== false,
        inline: { WHATSAPP: s.inline?.WHATSAPP === true, EMAIL: s.inline?.EMAIL === true },
        inlineMinLevel: CATEGORIES.includes(s.inlineMinLevel) && s.inlineMinLevel !== 'LOW' ? s.inlineMinLevel : 'MEDIUM',
        weights,
        trusted: normalizeTrusted(s.trusted),
        dashboard: s.dashboard === true,
    };
}

export async function loadSettings() {
    if (!globalThis.chrome?.storage) return normalizeSettings();
    const { [KEY]: raw } = await chrome.storage.local.get(KEY);
    return normalizeSettings(raw);
}

export async function saveSettings(settings) {
    const clean = normalizeSettings(settings);
    if (globalThis.chrome?.storage) await chrome.storage.local.set({ [KEY]: clean });
    return clean;
}

/** Calls back with fresh settings whenever another page changes them. */
export function onSettingsChanged(callback) {
    globalThis.chrome?.storage?.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[KEY]) callback(normalizeSettings(changes[KEY].newValue));
    });
}

export const weightsFor = settings => defaultWeights(settings.weights);

/** Applies the theme choice to <html>; "auto" follows the operating system. */
export function applyTheme(theme) {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
}
