// Link to the ScamShield desktop dashboard through Chrome's native messaging (no network involved).
// Only result summaries are sent: channel, score, risk level, pattern and warning-sign names, never message text.
// Events that cannot be delivered (desktop app not installed, JAR missing…) wait in a small queue and are retried.

export const HOST = 'com.scamshield.dashboard';
const QUEUE = 'dashboardQueue';
const MAX_QUEUE = 500;
const SITE_LABEL = { WHATSAPP: 'WhatsApp Web', EMAIL: 'Gmail' };

/** Builds the event the desktop app stores. `origin`: popup, context-menu, image, inline or history-sync. */
export function eventFrom(result, origin, { id = crypto.randomUUID(), at = new Date().toISOString(), site = '' } = {}) {
    return {
        id, at, origin, site: origin === 'inline' ? (SITE_LABEL[result.source] ?? site) : site,
        source: result.source, score: result.score, category: result.category, scamType: result.scamType,
        indicators: result.indicators.map(i => i.title).join(' | '),
    };
}

function browserName() {
    const brands = navigator.userAgentData?.brands?.map(b => b.brand) ?? [];
    if (brands.some(b => /Edge/i.test(b))) return 'Edge';
    if (brands.some(b => /Chrome/i.test(b))) return 'Chrome';
    return /Edg\//.test(navigator.userAgent) ? 'Edge' : 'Chrome';
}

async function send(message) {
    const reply = await chrome.runtime.sendNativeMessage(HOST, message);
    if (!reply?.ok) throw new Error(reply?.error ?? 'The desktop app did not answer.');
    return reply;
}

/** Turns Chrome's error text into advice the user can act on. */
export function explain(error) {
    const text = String(error?.message ?? error);
    if (/not found|Specified native messaging host/i.test(text)) return 'The desktop app is not connected yet. Run scripts\\install-native-host.ps1 in the ScamShield project folder, then try again.';
    if (/Access to the specified native messaging host is forbidden/i.test(text)) return 'The desktop app does not accept this extension ID. Run scripts\\install-native-host.ps1 again.';
    if (/exited|Error when communicating/i.test(text)) return 'The desktop app could not start. Check that it is built (target\\scamshield-1.1.0.jar) and that Java is installed.';
    return text;
}

/** Introduces the extension to the desktop app and checks the connection. */
export async function hello(settings) {
    return send({
        type: 'hello',
        extension: { version: chrome.runtime.getManifest().version, browser: browserName(), inline: settings.inline, saveHistory: settings.saveHistory },
    });
}

/** Queues events and tries to deliver everything waiting. Resolves to the number delivered (0 when the app is unreachable). */
export async function deliver(events = []) {
    const { [QUEUE]: waiting = [] } = await chrome.storage.local.get(QUEUE);
    const queue = [...waiting, ...events].slice(-MAX_QUEUE);
    if (queue.length === 0) return 0;
    try {
        for (let i = 0; i < queue.length; i += 500) await send({ type: 'events', events: queue.slice(i, i + 500) });
        await chrome.storage.local.set({ [QUEUE]: [] });
        return queue.length;
    } catch {
        await chrome.storage.local.set({ [QUEUE]: queue });
        return 0;
    }
}

export async function pendingCount() {
    const { [QUEUE]: waiting = [] } = await chrome.storage.local.get(QUEUE);
    return waiting.length;
}

/** Converts saved browser history (already message-free) into dashboard events; ids are stable so resending is harmless. */
export function historyEvents(items) {
    return items.map(i => ({
        id: `history-${i.id}-${Date.parse(i.at)}`, at: i.at, origin: 'history-sync', site: '',
        source: i.source, score: i.score, category: i.category, scamType: i.scamType, indicators: i.indicators ?? '',
    }));
}
