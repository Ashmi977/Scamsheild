# ScamShield — Session Handoff

## Project purpose

ScamShield is an individual college Java project: a Swing desktop app that analyzes SMS, WhatsApp, UPI-request and email messages for explainable scam indicators. It is offline and rule-based. It never contacts real senders, links, accounts or payment systems.

## Current status (2026-10-27, version 2)

- `mvn package` reports **BUILD SUCCESS**: **190 tests, 0 failures**.
- The executable JAR is `target/scamshield-1.0.0.jar`.
- The UI was checked visually on all four channels and on the history screen, using screenshots taken by an automated UI driver.
- A read-only check confirmed the new repository can read the existing local MySQL database. That database still has the **v1 table without `scam_type`**: run `database/migrate-v2.sql` as root, or rerun `scripts/setup-mysql.ps1`, so that new rows also store the scam pattern.

## What changed in version 2

- **Channels are now distinct.** `MessageInput` carries a `ChannelDetails` (a sealed interface with `Sms`, `WhatsApp`, `Upi` and `Email` records). `ChannelRules` adds sender, contact, UPI-request and email checks that only run for their own channel. Email is a new channel.
- **Rule catalogue.** `RuleDefinition` lists all 40 rules, each with its weight, group, scam pattern, channel, title and explanation. `RuleWeights` reads its defaults from it.
- **Engine:** sentence-level safety context, recognition of genuine OTP messages, Unicode normalization with offset mapping (`NormalizedText`), offline URL analysis (`UrlAnalyzer`) with a brand look-alike check against `BrandRegistry`, de-duplication of overlapping indicators, the likely `ScamType`, and channel-specific `RecommendationEngine` advice.
- **New scam patterns:** digital arrest, electricity disconnection, task jobs, investment, loans, family impersonation, "sent by mistake", small verification payments, secrecy requests, callback numbers and Hinglish phrasing.
- **UI:** channel selector with a detail form for each channel, samples for each channel, a risk gauge, indicator cards with evidence, highlighting of the matched text in the message, and a "What to do" tab. History gained filters, a chart, per-channel totals, CSV export (protected against spreadsheet formula injection) and tooltips.
- **Storage:** `InMemoryHistoryRepository` is used when MySQL isn't configured. `DatabaseHistoryRepository` detects whether the `scam_type` column exists, so it works with both the v1 and v2 schemas.
- **Launcher:** added `ScamShield.bat`.
- **Tests:** went from 15 to 190, including an 80-message labelled dataset (`src/test/resources/labelled-messages.txt`) with an evaluation report.

## Building

Maven is not on PATH. The verified command (offline, using the project-local repository):

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-27.0.1.0.3'
$p = (Get-Location).Path
& 'C:\Program Files\Apache\Maven\apache-maven-3.10.0\bin\mvn.cmd' -o "-Duser.home=$p\.maven-home" "-Dmaven.repo.local=$p\.maven-repository" package
```

## Running

- **Easiest:** double-click `ScamShield.bat` in the project root, or a desktop shortcut that points to it. It switches to the project folder, so `config\scamshield.properties` is always found. It uses JDK 27, falls back to `JAVA_HOME` and then to `javaw` on PATH, starts without a console window, and shows a message if the JAR or Java is missing. Tested launching from another directory.
- **Alternative:** the command in `command.txt`. It is PowerShell syntax (`& '…'`) and must be run **from the project root**. From any other folder the app still opens, but it can't find the MySQL config and falls back to in-memory history.
- The JAR is self-contained and includes the MySQL driver. Rebuild with `mvn package` only after code changes.

## Open items / suggested next steps

1. **Migrate the local database.** Run `database/migrate-v2.sql` as MySQL root, or rerun `scripts/setup-mysql.ps1`, so new history rows store the scam pattern. Until then, those rows show "Not recorded". It needs the root password, so it wasn't done in this session.
2. **Initialize git.** The project is not a repository yet; run `git init` and make a first commit. The `.gitignore` already excludes `target/`, the Maven caches, `.env` and `config/scamshield.properties`.
3. **Back up the old version.** A copy of the v1 sources was kept only in a temporary session folder. Make your own backup if you want to keep it.
4. **Presentation extras (optional).** Add UI screenshots to the README, and prepare a demo script using the built-in samples (each channel has scam and genuine examples).
5. **Maven on PATH (optional).** Add Maven to PATH so plain `mvn package` works. Offline builds can't run `mvn clean` because the clean plugin isn't cached; delete `target\` manually instead.

## Chrome extension (added 2026-10-27)

- `chrome-extension/` is a Manifest V3 extension: a JavaScript port of the engine plus a popup UI, a right-click "Check with ScamShield" menu and history in `chrome.storage.local`. To install it, open `chrome://extensions`, choose **Load unpacked** and select that folder. See `chrome-extension/README.md`.
- `extension-tests/`: `node --test "extension-tests/*.test.mjs"` (84 passing) and `node extension-tests/parity.mjs`, which compares Java and JS on 725 cases with 0 mismatches.
- Checked in headless Edge with the unpacked extension loaded: every channel, history, CSV export, dark/light mode and the right-click hand-off. Chrome 137+ ignores `--load-extension`, so automated runs need Edge or Chrome for Testing.
- **Rules now live in two places.** Any rule change must be made in both the Java and the JS engines, then run the parity check.
- **v1.1.0** added:
  - inline badges on WhatsApp Web and Gmail (optional per-site permission)
  - a settings page (rule weights and on/off switches, trusted senders and domains, theme, history toggle) and a welcome page
  - a screenshot and QR check (bundled jsQR and Tesseract.js, offline, about 11 MB in `vendor/`)
  - the report helper
  Trusted lists and the `QR_PAYMENT` UPI type exist only in the extension. 95 Node tests pass.
- The inline adapters were tested on mock pages that copy WhatsApp Web's and Gmail's markup, not on the live sites (that needs a signed-in account). Check them once on the real sites.
- **Java fix (same day):** `ScamAnalysisService` applied `SUPERSEDES` in `Map.of` order, which varies from run to run, so a message such as "Enter UPI PIN to receive your cashback" on a collect request could score 40 or 65. It now decides from the indicators present before any removal. A regression test was added, and there are now 191 Java tests.

## Desktop dashboard ↔ extension link (JAR 1.1.0, extension 1.3.0)

- The desktop app now opens on a **Dashboard** (`ui/DashboardPanel`, `dashboard/DashboardStats`). It combines browser checks with the MySQL/in-memory desktop history and refreshes live, polling the store every 2 s.
- **Connection** uses Chrome native messaging:
  - `native-host\scamshield-host.bat` runs `Main --native-host` (`bridge/NativeHost`).
  - The host stores summaries in `%LOCALAPPDATA%\ScamShield\extension-events.jsonl` and `extension-status.json`. Override the folder with `-Dscamshield.dataDir` or the `SCAMSHIELD_DATA_DIR` environment variable.
  - The message `text` is never accepted, even if sent.
- The extension has a fixed ID, `bokllmmcjdifohieaphakkifcbmlpope`, from the `key` in its manifest. The private key is in `keys/` and is git-ignored. Remove `key` before a Chrome Web Store upload.
- **Not yet done on this PC:** registering the connector. The automated session was not allowed to write to the registry. Run `powershell -ExecutionPolicy Bypass -File scripts\install-native-host.ps1` once, then switch it on in the extension's Settings → Desktop dashboard.
- **Verified:**
  - the host, started through the `.bat` exactly as Chrome starts it: replies framed correctly, text dropped
  - the extension in Edge: it queues results while not connected and shows setup guidance
  - the dashboard rendered with `--snapshot`
  - 203 Java tests and 97 Node tests pass; Java/JS parity shows 0 differences
- The JAR's file name changed to `target\scamshield-1.1.0.jar`. `ScamShield.bat`, `command.txt` and `parity.mjs` were updated to match.

## Adding a rule

1. Add an entry to `RuleDefinition`: weight, group, scam pattern (or null), channel (or null for all), title and explanation.
2. Put the detection in `TextRules` (patterns go in `TextPatterns`), `LinkRules` or `ChannelRules`.
3. If it overlaps an existing rule, add it to `SUPERSEDES` in `ScamAnalysisService`.
4. Add unit tests and at least one scam and one genuine line to the dataset file.
5. Mirror the change in `chrome-extension/engine/` and run `node extension-tests/parity.mjs`.

## Constraints to preserve

- Don't claim AI detection, live URL reputation or real sender verification.
- Results are heuristic guidance, not proof.
- Never store raw message text or evidence snippets in history.
- Keep real database passwords out of source control. `config/scamshield.properties` and `.env` are ignored.
- The dataset's 100% score is a regression check, not a real-world accuracy figure. Don't present it as one.
