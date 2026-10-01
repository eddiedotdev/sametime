# Slack time-zone localizer proof of concept

A local Node process listens over Slack Socket Mode. When Eddie sends a **new** message with one supported time (and optionally a day/date), it edits that same message to use Slack's native rich-text date element. Each reader then sees the time in their own timezone. There are no conversion replies, browser extensions, or public server.

Installed app: **Time Zone Localizer POC** (`A0C63T7MF4L`) in **PixelTable** (`pixel-table.slack.com`, `T08JCP550E6`). The authorized user is Eddie (`U08J9KADTT7`). Live credentials are in the ignored `.env` file with permissions `0600`.

## Behavior

The process handles Eddie's own new messages throughout PixelTable: DMs, group DMs, public and private channels, and thread replies. For example:

```text
Meet tomorrow at 3 PM. Bring your notes.
```

The message is updated in place shortly after sending and shows Slack's edited marker. Teammates do not need to install the app to see the converted time.

Supported phrases (case-insensitive):

- `2026-10-02 at 3 PM` or `2026-10-02 at 3:00 PM`
- `2026-10-02 at 15:00`
- `today at 9 AM` or `tomorrow at 16:30`
- `today 3pm` or `tomorrow 3 PM` — `at` is optional
- `3pm`, `3 PM`, `3:30pm`, or `at 3pm` — no day means today
- `15:00` or `9:05` — a complete 24-hour clock with minutes
- `2026-10-02 3pm` or `2026-10-02 15:00`

The time is interpreted in the sender's Slack profile zone (`America/Phoenix` for Eddie). `today`, omitted days, and `tomorrow` are anchored to the original message's send date in that zone. A bare time earlier that day stays on that date; it never silently rolls forward to tomorrow. The date element has no fixed timezone, so Slack localizes it for each reader, including when conversion crosses midnight. Its fallback text includes the resolved date, time and source zone.

Display format:

- `today`/`tomorrow` and bare-time input use `{date_short_pretty} at {time}`. Readers see today, yesterday or tomorrow relative to their own current date, otherwise a short calendar date. The label can change across midnight and when read later.
- `YYYY-MM-DD` input uses `{date_num} at {time}`.
- Slack controls minutes, capitalization and 12/24-hour display. Its native client may render `Today` even when you typed lowercase `today` in the middle of a sentence. The documented date tokens provide no casing modifier, so preserving the exact case of the relative day is unsupported by this native renderer. The app preserves surrounding prose and keeps the native label correct for each reader rather than inserting a fixed sender-specific day word. `tomorrow at 6 PM` may show as `Tomorrow at 6:00 PM`.

The parser is deliberately small. It skips unqualified numbers such as `3` or `at 3`, slash dates, unsupported day/date hints (such as `next Friday`), explicit zones and offsets, multiple times, ranges, code, quotes, URLs, seconds, and times that do not exist or occur twice because of daylight saving. It does not guess a bare clock's day when other unsupported date wording is present. Ordinary numbers elsewhere in the message are not treated as additional times. The expression must sit in one rich-text text element; formatting that splits it is skipped.

## Run and stop

Node 22+ is required.

```sh
npm ci
npm test
npm run check
npm start
```

The background process's PID is in `.local/runtime.pid`. Stop it with:

```sh
kill "$(cat .local/runtime.pid)"
```

Then run `npm start` to restart it in your terminal. Do not run two copies. Logs in `.local/runtime.log` contain statuses and message identifiers, not message bodies or tokens. The process does not start automatically after a reboot.

## Configuration

`.env.example` lists every setting.

- `AUTO_LOCALIZE=true` enables edits. Set it to `false` and restart to disable them.
- `SLACK_CHANNEL_IDS=*` enables all supported conversations in the workspace, for Eddie only. To restrict testing, use comma-separated conversation IDs instead (for example `D08J9KAJ2VB`, Eddie's self-DM) and restart. An empty value, or `*` mixed with IDs, stops startup.

Only Eddie's user token is configured. Onboarding other senders and an App Home toggle are future work.

## App setup

`slack-app-manifest.json` recreates the app configuration, including its user scopes and events. Create the app from the manifest in Slack app administration, choose PixelTable, and install it. Generate an app-level token with only `connections:write` and save it as `SLACK_APP_TOKEN`. Save Eddie's User OAuth Token as `SLACK_USER_TOKEN`. Keep `.env` private and ignored.

Socket Mode is enabled, so no Request URL is needed. The process ignores every event outside the configured workspace and sender before reading a message or profile. In allowlist mode it also filters conversation IDs. Conversations that Slack does not deliver, or that Eddie's token cannot edit, are left untouched.

## Edit safeguards

- Only Eddie's new, unedited, normal messages sent after startup and received within 2 minutes qualify. Bot messages, edit events, old history and coworkers' messages are skipped.
- Duplicate events are reserved before any network call, so a retry cannot edit twice.
- A cap of 10 edits per minute limits accidental bursts.
- Native date elements and edit events cannot trigger another conversion.
- The app clones the blocks and replaces one text span, preserving styles, mentions and links. `chat.update` omits attachments and thread fields so Slack keeps them. File-share subtypes are skipped.
- Before editing, the app refetches the exact message and skips it if its text or blocks changed or it was already edited. Slack has no atomic compare-and-update, so a manual edit in the short gap between read and update could still race.
- SDK retries are disabled to avoid delayed overwrites. A failed edit leaves the message untouched; send a fresh message to try again. Workspace edit limits can also reject edits.

## Verification status

Live-verified in Eddie's self-DM; see `LIVE_TEST.md`. Eddie reports that the numeric-date version showed 3 PM in Phoenix and 6 PM for Emma on the East Coast, and that native relative-day capitalization appears in the client. The added bare-time and optional-`at` forms have automated coverage and await their manual re-test. No Slack UI interaction, live messages or historical edits were performed for this parsing refinement. Mobile rendering remains unverified; unit tests cover parsing and preservation of message structure, not native device rendering.

References: [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/), [user tokens](https://docs.slack.dev/authentication/tokens/#user-tokens), [chat.update](https://docs.slack.dev/reference/methods/chat.update/), [rich-text date element](https://docs.slack.dev/reference/block-kit/block-elements/date-element/), [date formatting](https://docs.slack.dev/messaging/formatting-message-text/#date-formatting).
# sametime
