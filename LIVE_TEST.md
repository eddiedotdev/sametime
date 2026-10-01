# Live verification — October 1, 2026

All times below are America/Phoenix. Only clearly marked test messages in Eddie's self-DM were created or edited. Existing ops messages and coworkers' messages were not edited.

## App and authorization

- Created and installed `Time Zone Localizer POC` (`A0C63T7MF4L`) for PixelTable (`T08JCP550E6`).
- `auth.test` confirmed the user token belongs to Eddie (`U08J9KADTT7`) and this workspace.
- `users.info` confirmed Eddie's profile zone is `America/Phoenix`.
- Generated a `connections:write` app-level token; Socket Mode connected successfully.

## Desktop-authored in-place edit

At **7:22:11 AM**, sent from Slack desktop:

```text
[Time-zone POC test] Meet on 2026-10-02 at 3:00 PM. Surrounding text stays.
```

Message timestamp: `1790864531.876449`; conversation: `D08J9KAJ2VB`.

Read the exact message, preserved its rich-text block structure, and called `chat.update` using Eddie's user token with an inline native date element. Slack returned `ok: true`, the same channel, and the same message timestamp.

Slack desktop's accessibility tree and screenshot showed one original message with surrounding text intact and an edited marker. The visible date/time remained `2026-10-02 at 3:00 PM` in Phoenix. This proves native desktop rendering and human-message edit acceptance; it does not by itself prove a second timezone.

Private local evidence: `.local/proof-original.json`, `.local/proof-update.json`, `.local/desktop-proof.png`.

## Automatic new-message flow

The first desktop automatic test at **7:24:59 AM** remained unchanged because the listener was subscribed to `events_api`. The installed SDK emits `message` for Events API message payloads. The listener was fixed and a regression test added. The unchanged test message remains in the self-DM as evidence of that failed attempt.

After correction, at **7:27:21 AM**, typed and sent normally in an isolated Chrome Slack self-DM tab:

```text
[Time-zone POC automatic retry] Tomorrow at 3 PM. Same message.
```

Message timestamp: `1790864841.792399`.

The running process logged one `localized` result. The browser visibly changed the same message to:

```text
[Time-zone POC automatic retry] 2026-10-02 at 3:00 PM. Same message. (edited)
```

API readback confirmed Eddie's authorship and the original timestamp. The rich-text date element has timestamp `1790978400` (2026-10-02 22:00 UTC), format `{date_num} at {time}`, fallback `2026-10-02 15:00 America/Phoenix`, and no fixed timezone. The app posted no reply or extra conversion message.

Private local evidence: `.local/proof-automatic.json`, `.local/automatic-proof.png`, `.local/runtime.log`.

## Remaining verification

- Automatic browser send/receive and native desktop rendering are verified separately. A fresh desktop send through the corrected listener has not been checked yet.
- Mobile rendering and another reader/device timezone are unverified. No second account or device was used and the Mac's timezone was not changed.
- Thread placement, mentions/styles, safety filters and DST behavior have automated tests. Channel/group-DM/file-share/attachment behavior is not claimed as live-verified.
- This is a sender-specific local POC. Multiple sender authorizations and a Slack settings UI are not implemented. Eddie's conversation scope was subsequently expanded as recorded below.

## Eddie's workspace-wide conversation scope — October 1, 2026

At Eddie's request, the test-only self-DM restriction was removed by setting `SLACK_CHANNEL_IDS=*`. This explicit wildcard applies to Eddie's own new outgoing messages in all supported PixelTable conversations. The configured workspace (`T08JCP550E6`) and sender (`U08J9KADTT7`) checks remain mandatory. Empty scopes and wildcard/ID mixtures are rejected; explicit ID allowlists remain available for testing.

Automated tests cover conversion in DM, group/private/public conversation IDs and retaining the coworker, other-workspace, history, edit-event and duplicate safeguards in global mode. The existing local process was restarted after checks passed, and its startup record reports `conversationScope: all`, `channelIds: ["*"]`, and `autoLocalize: true`.

No Slack UI interaction or live messages were performed for this expansion. Eddie will test with his teammate manually. The original live evidence above remains limited to the self-DM; second-device timezone and mobile rendering remain unverified.

## Credential cleanup requiring Eddie

An early app-administration accessibility capture exposed an unused legacy verification token and an initial app-level token. The initial app-level token was revoked immediately and replaced with a token saved directly to private `.env` without displaying it. User OAuth credentials were also saved privately.

Attempting to regenerate the unused legacy verification token reached Slack's password-confirmation page. That browser tab is left open for Eddie. The legacy token is not used by this Socket Mode prototype, and there is no public HTTP endpoint. Its rotation remains unfinished pending authentication; the exposure should not be described as fully resolved.
