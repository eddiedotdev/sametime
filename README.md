# SameTime

**One message. Everyone's local time.**

SameTime is a small, self-hosted Slack utility. When you send a message containing a time, it edits that same message to use Slack's native date element, so each reader sees the time in their own timezone.

You type:

```text
Standup moves to tomorrow at 3 PM. Bring your notes.
```

A teammate three hours ahead reads:

```text
Standup moves to Tomorrow at 6:00 PM. Bring your notes. (edited)
```

- **Nothing for readers to install.** The conversion is rendered by Slack itself, on desktop, web, and mobile.
- **No extra noise.** SameTime edits your message in place. It posts no replies and no bot messages.
- **Your message stays yours.** Author, surrounding text, formatting, mentions, and thread placement are preserved. Slack shows its usual "edited" marker.
- **No server to expose.** It runs as a local Node.js process over Slack's Socket Mode, so there is no public URL or webhook.
- **Conservative by design.** If a message is ambiguous, SameTime leaves it alone.

> [!NOTE]
> SameTime is an early prototype. It supports one sender in one workspace per process, and has no settings UI or multi-user install flow.

## Contents

- [How it works](#how-it-works)
- [Supported times](#supported-times)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Safeguards and limits](#safeguards-and-limits)
- [Security](#security)
- [Development](#development)
- [Contributing](#contributing)

## How it works

1. SameTime connects to Slack over [Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/) with your [user token](https://docs.slack.dev/authentication/tokens/#user-tokens) and listens for your own new messages.
2. It looks for supported times and time ranges in the message and interprets them in your Slack profile timezone, anchored to the date the message was sent.
3. It refetches the message to confirm you have not edited it in the meantime.
4. It calls [`chat.update`](https://docs.slack.dev/reference/methods/chat.update/) once to replace each time with a [rich-text date element](https://docs.slack.dev/reference/block-kit/block-elements/date-element/). Slack then renders that element in each reader's timezone.

## Supported times

| You type | Interpreted as |
| --- | --- |
| `Meet at 3pm` | 3:00 PM on the day you sent the message |
| `Meet at 3:30 PM` | 3:30 PM on the day you sent the message |
| `Meet at 15:00` | 3:00 PM on the day you sent the message |
| `Today at 9:05` | 9:05 AM on the day you sent the message |
| `Tomorrow at 3 PM` | 3:00 PM on the following day |
| `Meet on 2026-10-02 at 3 PM` | 3:00 PM on that date |
| `Free 3-4 PM` | A range from 3:00 PM to 4:00 PM |
| `Tomorrow 3 PM to 5 PM` | A range from 3:00 PM to 5:00 PM on the following day |
| `Tomorrow at 3 PM or 5 PM` | Two times, both on the following day |
| `Call at 9:30, lunch at 12:30` | Two separate times, each converted |

Details worth knowing:

- Matching is case-insensitive and the word `at` is optional: `tomorrow 3pm` works. `from` works in its place: `today from 3-4 PM`.
- A time needs either AM/PM or minutes. `3pm`, `3 PM`, and `15:00` qualify; a bare `3` or `at 3` does not.
- A time with no date means the day you sent the message, even if that time has already passed. It never rolls forward to tomorrow.
- `today`, `tomorrow`, and bare times render as a relative day ("Today", "Tomorrow", "Yesterday", or a short date) from each reader's point of view. `YYYY-MM-DD` dates render as a numeric date.
- A range is written with a dash or with `to`, `until`, `till`, or `through`. Its start and end are converted separately, so a reader sees something like "Today at 6:00 PM-7:00 PM".
- In a range, a start without AM/PM borrows it from the end: `3-4 PM` starts at 3 PM. If that would put the start after the end, the start takes the other half of the day: `11-1 PM` starts at 11 AM.
- A range whose end is not later than its start runs past midnight: `11 PM - 1 AM` ends the next day.
- A message can contain several times. A time joined to the previous one by `or`, `and`, `&`, or a comma shares its date: in `tomorrow at 3 PM or 5 PM`, both are tomorrow. Any other time without a date means the day you sent the message.
- Slack controls the final display, including capitalization and 12- or 24-hour format. See Slack's [date formatting](https://docs.slack.dev/messaging/formatting-message-text/#date-formatting) reference.

### What gets skipped

SameTime converts every time in a message or none of them. It leaves a message untouched when it contains:

- a time whose date is unclear, such as the `5 PM` in `tomorrow at 3 PM. Done by 5 PM`
- a range that mixes clock styles (`3 PM-16:00`), ends on a bare number (`3 PM to 4`), or has the same start and end
- alternatives where only the last has AM/PM, such as `3 or 4 PM`
- an explicit timezone or offset, such as `3 PM EST` or `15:00 +02:00`
- a date form it does not understand, such as weekdays, `next week`, `10/2`, or `October 2`
- an invalid time, seconds (`3:00:15`), or a time that does not exist or occurs twice because of a daylight-saving change
- a URL, or a date that Slack has already localized
- the time inside code or a quote, or split across differently formatted text

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 22 or newer
- A Slack workspace where you are allowed to create and install apps

### 1. Create the Slack app

1. Open [api.slack.com/apps](https://api.slack.com/apps) and choose **Create New App** → **From a manifest**.
2. Select your workspace and paste the contents of [`slack-app-manifest.json`](slack-app-manifest.json). You can change the display name first.
3. Under **Basic Information** → **App-Level Tokens**, generate a token with the `connections:write` scope. It starts with `xapp-`.
4. Under **Install App**, install the app to your workspace and copy the **User OAuth Token**. It starts with `xoxp-`.

The manifest enables Socket Mode and requests these user scopes:

| Scope | Why it is needed |
| --- | --- |
| `chat:write` | Edit your own messages |
| `users:read` | Read your profile timezone |
| `channels:history`, `groups:history`, `im:history`, `mpim:history` | Receive and refetch your messages in public channels, private channels, DMs, and group DMs |

### 2. Install and configure

```sh
git clone https://github.com/eddiedotdev/sametime.git
cd sametime
npm ci
cp .env.example .env
chmod 600 .env
```

Edit `.env` and replace every value with your own. See [Configuration](#configuration).

### 3. Run

```sh
npm start
```

On startup SameTime prints one JSON line with `"status": "running"`. Send yourself a direct message such as `Test tomorrow at 3 PM`; within a moment the message should show the edited marker and a localized time.

Keep the process running while you use Slack. Stop it with `Ctrl-C`, and restart it after changing `.env`. It does not start automatically after a reboot, and you should run only one copy at a time.

## Configuration

All settings are environment variables, loaded from `.env`.

| Variable | Description |
| --- | --- |
| `SLACK_APP_TOKEN` | App-level token, starting with `xapp-` |
| `SLACK_USER_TOKEN` | Your User OAuth Token, starting with `xoxp-` |
| `SLACK_TEAM_ID` | Your workspace ID, starting with `T` |
| `SLACK_USER_ID` | Your member ID, starting with `U`. Must belong to the user token |
| `SLACK_CHANNEL_IDS` | Comma-separated conversation IDs to watch, or `*` alone for every supported conversation |
| `AUTO_LOCALIZE` | Must be exactly `true` to enable edits. Any other value makes SameTime ignore every message |

Finding your IDs:

- **Workspace and conversation IDs** appear in the Slack web URL: `https://app.slack.com/client/<workspace ID>/<conversation ID>`.
- **Member ID**: open your Slack profile, choose the **⋮** menu, then **Copy member ID**.

Start with a single conversation ID, such as your DM with yourself, and switch to `*` once you are happy with the behavior. SameTime refuses to start if `SLACK_CHANNEL_IDS` is empty, mixes `*` with IDs, or if the user token does not match the configured workspace and member.

## Safeguards and limits

- **Only your new messages.** SameTime ignores other people's messages, bot messages, edits, file shares and other message subtypes, and events from other workspaces.
- **No history rewriting.** A message must be sent after the process started and arrive within two minutes.
- **No double edits.** Duplicate events are ignored, and an already converted message cannot trigger another conversion.
- **Manual edits win.** SameTime refetches each message before writing and skips it if the text or blocks changed. Slack offers no atomic compare-and-update, so an edit made in the brief gap between that check and the write can still race.
- **Rate cap.** At most ten edits per minute.
- **No retries.** A failed edit leaves the message as you wrote it. Send a new message to try again.
- **Rich text only.** Conversion requires Slack rich-text blocks, which the standard Slack clients send.

Log output is one JSON line per event with a status (`localized`, `changed`, `rate-capped`, or `failed`) and the conversation ID and message timestamp. Message text and tokens are never logged.

## Security

The user token is sensitive: its scopes allow reading conversation history and editing your messages. Keep `.env` private and never commit it. `.env` is ignored by Git, and `chmod 600` restricts it to your user account. If a token leaks, revoke it from your app's settings page and generate a new one.

SameTime sends data only to Slack. It has no other network dependencies, no telemetry, and no storage.

## Development

```sh
npm test        # run the test suite with the Node.js test runner
npm run check   # syntax-check the source files
```

```text
src/
  main.js        configuration, Slack clients, startup
  listener.js    Socket Mode event handling and logging
  processor.js   eligibility checks, deduplication, rate cap
  localize.js    time parsing and rich-text replacement
test/            unit tests for each module
```

The tests cover parsing, daylight-saving boundaries, rich-text preservation, sender and workspace restrictions, conversation scopes, duplicate events, manual edits, and the Socket Mode listener. They do not exercise a live Slack workspace.

## Contributing

Issues and pull requests are welcome at [github.com/eddiedotdev/sametime](https://github.com/eddiedotdev/sametime).

- For anything larger than a small fix, open an issue first to discuss the approach.
- Add or update tests for behavior changes, and make sure `npm test` and `npm run check` pass.
- The parser is deliberately strict. When a new time format is ambiguous, prefer skipping the message over guessing.
- Never include real tokens, workspace IDs, or message content in issues, tests, or commits.
