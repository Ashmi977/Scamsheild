// Background service worker:
// - the "Check with ScamShield" right-click menu,
// - analysis for the inline warnings on WhatsApp Web and Gmail (the page script never runs the engine itself),
// - registering those page scripts only while the user has them switched on and has granted the site.
// Text passed to the analyzer page goes through session storage (memory only) and is removed once read.
// - forwarding result summaries to the ScamShield desktop dashboard when the user has switched that on.
import { analyze, createInput } from './engine/analyzer.js';
import { INLINE_SITES, loadSettings, onSettingsChanged, weightsFor } from './settings.js';
import { deliver, eventFrom, explain, hello, historyEvents, pendingCount } from './dashboard.js';
import { loadHistory } from './history.js';

const MENU_ID = 'scamshield-check';
const INLINE_SCRIPT = 'content/inline.js';

/** Picks the channel from the site the text was selected on; null keeps the user's last choice. */
function guessSource(pageUrl) {
    let host = '';
    try { host = new URL(pageUrl).hostname; } catch { return null; }
    if (host === 'web.whatsapp.com') return 'WHATSAPP';
    if (host === 'messages.google.com') return 'SMS';
    if (['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'mail.yahoo.com', 'mail.proton.me', 'mail.zoho.in', 'mail.zoho.com'].includes(host)) return 'EMAIL';
    return null;
}

/** Hands text (and optional channel details) to the analyzer page and shows it. */
async function openAnalyzer(pending, preferPopup) {
    await chrome.storage.session.set({ pending });
    if (preferPopup) {
        try { await chrome.action.openPopup(); return; } catch { /* not available here: fall back to a tab */ }
    }
    await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?mode=tab') });
}

// ---------------------------------------------------------------- Inline warnings

let settingsCache = null;
const currentSettings = async () => (settingsCache ??= await loadSettings());
onSettingsChanged(s => {
    settingsCache = s;
    syncInlineScripts();
    // Keep the dashboard's view of the extension (version, inline sites) current; deliver anything queued.
    if (s.dashboard) hello(s).then(() => deliver()).catch(() => { });
});

// ---------------------------------------------------------------- Desktop dashboard

async function recordForDashboard(result, origin, options) {
    if (!(await currentSettings()).dashboard) return;
    await deliver([eventFrom(result, origin, options)]);
}

async function testDashboard() {
    const settings = await currentSettings();
    try {
        const reply = await hello(settings);
        const delivered = await deliver();
        return { ok: true, app: reply.app, version: reply.version, events: reply.events + delivered, pending: await pendingCount() };
    } catch (e) {
        return { ok: false, error: explain(e), pending: await pendingCount() };
    }
}

/** Registers or removes the page script for each site so it matches the user's settings and granted access. */
async function syncInlineScripts() {
    const settings = await currentSettings();
    const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map(s => s.id));
    for (const [source, site] of Object.entries(INLINE_SITES)) {
        const wanted = settings.inline[source] && await chrome.permissions.contains({ origins: site.origins });
        if (wanted && !registered.has(site.scriptId)) {
            await chrome.scripting.registerContentScripts([{ id: site.scriptId, matches: site.origins, js: [INLINE_SCRIPT], runAt: 'document_idle' }]);
            // Pages that are already open get the script now instead of after a reload.
            for (const tab of await chrome.tabs.query({ url: site.origins })) {
                chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [INLINE_SCRIPT] }).catch(() => { });
            }
        } else if (!wanted && registered.has(site.scriptId)) {
            await chrome.scripting.unregisterContentScripts({ ids: [site.scriptId] });
        }
    }
}

const RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type === 'scamshield:analyze') {
        (async () => {
            const settings = await currentSettings();
            if (!settings.inline[message.source]) return sendResponse({ ok: false, disabled: true });
            try {
                const result = analyze(createInput(message.source, message.text, message.details), weightsFor(settings), settings.trusted);
                const show = RANK[result.category] >= RANK[settings.inlineMinLevel];
                sendResponse({ ok: true, result, show });
                // The id comes from the message's hash, so a message re-checked after a page reload is counted once.
                if (show && /^[a-z0-9:]{1,40}$/.test(message.key ?? '')) {
                    recordForDashboard(result, 'inline', { id: `inline-${message.source}-${message.key}` }).catch(() => { });
                }
            } catch (e) {
                sendResponse({ ok: false, error: e.message });
            }
        })();
        return true;
    }
    if (message?.type === 'scamshield:open') {
        openAnalyzer({ text: message.text, source: message.source, details: message.details ?? null, via: 'inline' }, false).then(() => sendResponse({ ok: true }));
        return true;
    }
    if (message?.type === 'scamshield:record') {
        const origins = ['popup', 'context-menu', 'image'];
        if (message.result && origins.includes(message.origin)) recordForDashboard(message.result, message.origin).catch(() => { });
        sendResponse({ ok: true });
        return false;
    }
    if (message?.type === 'scamshield:dashboard-test') {
        testDashboard().then(sendResponse);
        return true;
    }
    if (message?.type === 'scamshield:dashboard-sync') {
        (async () => {
            const test = await testDashboard();
            if (!test.ok) return sendResponse(test);
            const items = await loadHistory();
            const sent = await deliver(historyEvents(items));
            sendResponse({ ok: true, sent, total: items.length });
        })();
        return true;
    }
    if (message?.type === 'scamshield:sync-inline') {
        syncInlineScripts().then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: e.message }));
        return true;
    }
    return false;
});

chrome.permissions.onRemoved.addListener(() => syncInlineScripts());
chrome.runtime.onStartup.addListener(async () => {
    syncInlineScripts();
    const settings = await currentSettings();
    if (settings.dashboard) hello(settings).then(() => deliver()).catch(() => { });
});

// ---------------------------------------------------------------- Install & right-click menu

chrome.runtime.onInstalled.addListener(details => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Check with ScamShield', contexts: ['selection'] });
    syncInlineScripts();
    if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html?welcome=1') });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || !info.selectionText) return;
    openAnalyzer({ text: info.selectionText, source: guessSource(info.pageUrl ?? tab?.url ?? ''), details: null, via: 'context-menu' }, true);
});
