import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { attachListener } from './listener.js';
import { createProcessor, getConversationScope } from './processor.js';

const REQUIRED_ENV = ['SLACK_APP_TOKEN', 'SLACK_USER_TOKEN', 'SLACK_TEAM_ID', 'SLACK_USER_ID', 'SLACK_CHANNEL_IDS'];
const PROFILE_CACHE_MS = 60_000;

// SDK logs can include credentials and response bodies, so print only a generic error.
const quietLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {
    console.error('Slack transport error; credentials and response bodies omitted.');
  },
  getLevel() {
    return 'error';
  },
  setLevel() {},
  setName() {},
};

function readConfig(env) {
  for (const key of REQUIRED_ENV) {
    if (!env[key]) throw new Error(`Missing ${key}; see .env.example`);
  }
  if (!/^T[A-Z0-9]+$/.test(env.SLACK_TEAM_ID) || !/^U[A-Z0-9]+$/.test(env.SLACK_USER_ID)) {
    throw new Error('Invalid workspace or sender');
  }
  return {
    appToken: env.SLACK_APP_TOKEN,
    userToken: env.SLACK_USER_TOKEN,
    teamId: env.SLACK_TEAM_ID,
    userId: env.SLACK_USER_ID,
    channelIds: env.SLACK_CHANNEL_IDS.split(',').map(id => id.trim()).filter(Boolean),
    autoLocalize: env.AUTO_LOCALIZE === 'true',
  };
}

function cachedProfileZone(web, userId) {
  let profile;
  return async () => {
    if (!profile || Date.now() - profile.fetchedAt > PROFILE_CACHE_MS) {
      const result = await web.users.info({ user: userId });
      profile = { zone: result.user.tz, fetchedAt: Date.now() };
    }
    return profile.zone;
  };
}

async function readExactMessage(web, event) {
  const args = { channel: event.channel, oldest: event.ts, latest: event.ts, inclusive: true, limit: 100 };
  const isReply = event.thread_ts && event.thread_ts !== event.ts;
  const result = isReply
    ? await web.conversations.replies({ ...args, ts: event.thread_ts })
    : await web.conversations.history({ ...args, limit: 1 });
  return result.messages?.find(message => message.ts === event.ts);
}

const config = readConfig(process.env);
const conversationScope = getConversationScope(config.channelIds);

// No retries: a delayed write could overwrite a manual edit made in the meantime.
const web = new WebClient(config.userToken, { logger: quietLogger, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true });
const socket = new SocketModeClient({ appToken: config.appToken, logger: quietLogger });
const startedAt = Date.now() / 1000;

const auth = await web.auth.test();
if (auth.team_id !== config.teamId || auth.user_id !== config.userId) {
  throw new Error('Token does not belong to the configured workspace and sender');
}

const processMessage = createProcessor({
  teamId: config.teamId,
  userId: config.userId,
  channelIds: config.channelIds,
  enabled: config.autoLocalize,
  startedAt,
  getZone: cachedProfileZone(web, config.userId),
  readMessage: event => readExactMessage(web, event),
  update: async args => {
    await web.chat.update(args);
  },
});

attachListener(socket, processMessage);
socket.on('error', () => console.error('Socket Mode error; awaiting reconnect.'));
await socket.start();

console.log(JSON.stringify({
  status: 'running',
  teamId: config.teamId,
  userId: config.userId,
  conversationScope,
  channelIds: config.channelIds,
  autoLocalize: config.autoLocalize,
  pid: process.pid,
}));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await socket.disconnect();
    process.exit(0);
  });
}
