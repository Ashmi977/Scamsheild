// Reads screenshots and QR codes on this device: jsQR for QR codes, Tesseract.js for text (OCR).
// Both libraries and the English language data are bundled in vendor/ and loaded only when needed.

const asset = path => (globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(path) : new URL(path, location.href).href);

const loaded = new Map();
function loadScript(path) {
    if (!loaded.has(path)) {
        loaded.set(path, new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = asset(path);
            s.onload = resolve;
            s.onerror = () => { loaded.delete(path); reject(new Error('Could not load ' + path)); };
            document.head.append(s);
        }));
    }
    return loaded.get(path);
}

/** Decodes an image file into a bitmap, rejecting things that are not images. */
export async function readImage(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error('That file is not an image. Use a PNG, JPG or WebP screenshot.');
    if (file.size > 15 * 1024 * 1024) throw new Error('That image is larger than 15 MB. Crop or resize it first.');
    try {
        return await createImageBitmap(file);
    } catch {
        throw new Error('The image could not be opened. Try saving it as PNG or JPG.');
    }
}

function canvasFor(bitmap, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { canvas, ctx };
}

/** Returns the text inside the first QR code found, or null. Tries a downscaled copy first for speed. */
export async function decodeQr(bitmap) {
    await loadScript('vendor/jsqr/jsQR.js');
    for (const side of [1000, 2000]) {
        const { canvas, ctx } = canvasFor(bitmap, side);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = globalThis.jsQR(data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
        if (code?.data) return code.data;
        if (Math.max(bitmap.width, bitmap.height) <= side) break;
    }
    return null;
}

/**
 * Parses a UPI payment link (upi://pay?pa=…&pn=…&am=…&tn=…), as found in payment QR codes.
 * Returns null when the text is not a UPI link.
 */
export function parseUpiLink(text) {
    const m = /^upi:\/\/(pay|mandate)\?(.*)$/is.exec(text.trim());
    if (!m) return null;
    const params = new URLSearchParams(m[2]);
    const get = key => (params.get(key) ?? '').trim();
    return { mandate: m[1].toLowerCase() === 'mandate', vpa: get('pa'), name: get('pn'), amount: get('am'), note: get('tn') };
}

/** Light text on a dark background (dark-mode screenshots) reads better inverted; small images read better enlarged. */
function prepareForOcr(bitmap) {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest < 1200 ? 2 : Math.min(1, 2400 / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 16) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (sum / (d.length / 16) < 110) {
        for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
        ctx.putImageData(image, 0, 0);
    }
    return canvas;
}

/**
 * Reads English text from the image. Takes a few seconds; onProgress receives 0–1.
 * Returns the recognized text with blank lines collapsed.
 */
export async function readText(bitmap, onProgress = () => { }) {
    await loadScript('vendor/tesseract/tesseract.min.js');
    const worker = await globalThis.Tesseract.createWorker('eng', 1, {
        workerPath: asset('vendor/tesseract/worker.min.js'),
        corePath: asset('vendor/tesseract/core'),
        langPath: asset('vendor/tesseract/lang'),
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: true,
        logger: m => { if (m.status === 'recognizing text') onProgress(m.progress); },
    });
    try {
        const { data } = await worker.recognize(prepareForOcr(bitmap));
        return data.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    } finally {
        await worker.terminate();
    }
}
