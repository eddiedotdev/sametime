import { localize } from './localize.js';

const CONVERSATION_ID = /^[CDG][A-Z0-9]+$/;
const CLOCK_SKEW_SECONDS = 5;
const MAX_EVENT_AGE_SECONDS = 120;
const SEEN_EVENT_LIMIT = 1000;
const EDITS_PER_MINUTE = 10;

export function getConversationScope(channelIds) {
  const invalid = new Error('Invalid conversation scope: use * alone or explicit conversation IDs');
  if (!Array.isArray(channelIds) || channelIds.length === 0) throw invalid;
  if (channelIds.length === 1 && channelIds[0] === '*') return 'all';
  if (!channelIds.every(id => typeof id === 'string' && CONVERSATION_ID.test(id))) throw invalid;
  return 'allowlist';
}

export function createProcessor({
  teamId,
  userId,
  channelIds,
  enabled,
  startedAt,
  clock = () => Date.now() / 1000,
  getZone,
  readMessage,
  update,
}) {
  const scope = getConversationScope(channelIds);
  const allowedChannels = new Set(channelIds);
  const seen = new Set();
  let editTimes = [];

  const isOwnNewMessage = event =>
    event?.type === 'message' &&
    event.user === userId &&
    typeof event.channel === 'string' &&
    CONVERSATION_ID.test(event.channel) &&
    (scope === 'all' || allowedChannels.has(event.channel)) &&
    !event.subtype &&
    !event.bot_id &&
    !event.edited;

  // Only messages sent after startup and received promptly; old replays are never edited.
  const isFresh = (ts, now) =>
    Number.isFinite(ts) && ts > startedAt && ts <= now + CLOCK_SKEW_SECONDS && now - ts <= MAX_EVENT_AGE_SECONDS;

  const isUnchanged = (current, event) =>
    current?.user === userId &&
    current.ts === event.ts &&
    !current.edited &&
    !current.bot_id &&
    !current.subtype &&
    current.text === event.text &&
    JSON.stringify(current.blocks) === JSON.stringify(event.blocks);

  const reserveEdit = now => {
    editTimes = editTimes.filter(time => now - time < 60);
    if (editTimes.length >= EDITS_PER_MINUTE) return false;
    editTimes.push(now);
    return true;
  };

  return async ({ team_id: eventTeamId, event }) => {
    if (!enabled || eventTeamId !== teamId || !isOwnNewMessage(event)) return 'ignored';
    const now = clock();
    if (!isFresh(Number(event.ts), now)) return 'ignored';

    const key = `${event.channel}:${event.ts}`;
    if (seen.has(key)) return 'duplicate';
    seen.add(key); // Reserve before awaiting, including while processing a retry.
    if (seen.size > SEEN_EVENT_LIMIT) seen.delete(seen.values().next().value);

    const zone = await getZone();
    if (!localize(event, zone)) return 'unsupported';

    // Refetch only this message, to avoid overwriting an intervening manual edit.
    const current = await readMessage(event);
    if (!isUnchanged(current, event)) return 'changed';
    const converted = localize(current, zone);
    if (!converted) return 'unsupported';
    if (!reserveEdit(now)) return 'rate-capped';

    // Omitting attachments and thread_ts preserves attachments and thread placement.
    await update({ channel: event.channel, ts: event.ts, ...converted });
    return 'localized';
  };
}
