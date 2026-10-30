# ScamShield for Chrome

A browser version of the ScamShield desktop app. It checks SMS, WhatsApp, UPI-request and email messages, plus screenshots and QR codes, for explainable scam indicators. It uses the same 40 rules, weights, scam patterns and advice as the Java engine, ported to JavaScript.

All analysis runs inside the extension. Its content security policy allows connections only to the extension's own files (`connect-src 'self'`), so it cannot send anything over the network. It never contacts senders, links, accounts or payment systems.

## Install (developer mode)

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose this `chrome-extension` folder.
3. A welcome page opens. Pin ScamShield from the puzzle-piece menu.

## Features

- **Popup** (or **Alt+Shift+S**): choose a channel, add sender details, paste the message and press **Analyze**. You get a risk gauge, the warning signs with what matched, your message with those words highlighted, and advice. **Open in tab** gives a wider two-column view.
- **Right-click → Check with ScamShield** on selected text. The channel is chosen automatically on WhatsApp Web, Gmail, Outlook and Google Messages.
- **Screenshots and QR codes**:
  - Paste an image (Ctrl+V), drop it on the form, or choose a file in the full-tab view.
  - QR codes are decoded on the device (jsQR). UPI payment QR codes (`upi://pay?…`) are filled in as a *QR code / payment link* request, with the payee, amount and a reminder that a QR code can never be used to receive money.
  - Any other image is read with offline OCR (Tesseract.js, English).
- **Report tab** (next to History; a red dot appears after a high-risk result): works with or without an analysis. It shows the 1930 helpline, where to report for the channel, an evidence checklist and optional incident details (amount lost, date, transaction/UTR ID, bank or UPI app, what happened; never saved), then builds ready-to-paste complaint text: channel, sender details, score, warning signs and, optionally, the message itself. It also lists where to report: 1930, cybercrime.gov.in, Chakshu (Sanchar Saathi), your UPI app or your mail provider. It can copy the text or save it as .txt. Nothing is submitted for you. **Copy summary** gives a short warning to share with family.
- **Inline warnings** (off by default; switch on in Settings):
  - Badges appear next to risky incoming messages on **WhatsApp Web** and opened emails in **Gmail**. Gmail checks also include the real targets of links hidden behind link text.
  - Chrome asks for access to each site only when you turn it on, and turning it off removes that access.
  - The page script hands text to the extension's background worker. Nothing leaves the browser, and inline results are never saved to history.
- **Settings**:
  - Inline warnings and their minimum level.
  - **Trusted senders and websites** (SMS IDs, WhatsApp numbers, UPI IDs, email and link domains). A trusted entry skips only the sender or link-address checks; the message text is always checked.
  - Switch any rule off or change its points.
  - Theme (system, light or dark).
  - History on or off, clear history, reset.
- **Desktop dashboard** (off by default; Settings → Desktop dashboard): sends result summaries (never message text) to the ScamShield desktop app on this computer through Chrome's native messaging, so its Dashboard shows browser and desktop checks together. It includes a connection test and "Send existing history". Results wait in a queue while the app is unreachable. Setup is described in the main project README.
- **History**: a chart by risk level, totals per channel, filters and CSV export, with spreadsheet formula injection neutralized. It stores only the channel, score, risk level, pattern and indicator names, never the message text.

## Files

| Path | Purpose |
|---|---|
| `manifest.json` | Manifest V3. Permissions: `storage`, `contextMenus`, `scripting`, `nativeMessaging`; optional site access for WhatsApp Web and Gmail only. `key` fixes the extension ID (`bokllmmcjdifohieaphakkifcbmlpope`) so the desktop connector recognizes it |
| `dashboard.js` | Native-messaging link to the desktop dashboard, with a retry queue |
| `background.js` | Right-click menu, analysis for inline badges, registers the inline script only while it is enabled and granted |
| `content/inline.js` | Inline badges: site adapters for WhatsApp Web and Gmail, Shadow DOM UI |
| `popup.html/.css/.js` | Analyzer, image check, report and history UI |
| `options.html/.css/.js` | Settings and welcome page |
| `ui.css` | Shared design tokens, light and dark themes, controls |
| `settings.js`, `history.js`, `report.js`, `image-check.js`, `samples.js` | Settings storage, history and CSV, report text, QR and OCR, demo messages |
| `engine/` | Port of `com.scamshield.service`, plus `trusted.js` (extension-only trusted lists) |
| `vendor/` | Unmodified jsQR 1.4.0, Tesseract.js 5.1.1, tesseract.js-core 5.1.1 and English data (see `vendor/README.txt`) |

The inline adapters depend on WhatsApp Web's and Gmail's page structure (for example `.message-in`, `[data-pre-plain-text]`, `div.a3s`, `span.gD`). If those sites change their markup, the badges stop appearing until the selectors in `content/inline.js` are updated. Everything else keeps working.

## Tests

Run from the project root:

```powershell
node --test "extension-tests/*.test.mjs"   # dataset, engine, trusted lists, QR parsing, settings, report (no Java needed)
node extension-tests/parity.mjs            # JS vs Java on ~725 cases (needs the JAR and JAVA_HOME)
```

When you change a rule, change it in both engines, then run the parity check.

## Package for the Chrome Web Store

Run this from the `chrome-extension` folder after changing the `version` in `manifest.json`:

```powershell
tar.exe -a -c -f ..\dist\scamshield-chrome-<version>.zip manifest.json background.js popup.html popup.css popup.js options.html options.css options.js ui.css settings.js history.js report.js image-check.js samples.js dashboard.js engine content icons vendor
```

For the store listing, give these reasons for the permissions:
- `storage`: settings and history.
- `contextMenus`: the right-click check.
- `scripting`: adds inline badges only on sites the user enables.
- `nativeMessaging`: the optional link to the ScamShield desktop dashboard.

Also remove `key` from `manifest.json` before uploading; the store assigns its own ID.
- Optional site access: inline warnings on WhatsApp Web and Gmail.

Results are heuristic guidance, not proof. The dataset's 100% score is a regression check, not a real-world accuracy figure.
