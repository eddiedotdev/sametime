import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessor } from '../src/processor.js';

const now = Date.parse('2026-10-01T18:00Z') / 1000;
const event = {
  type: 'message',
  user: 'UEDDIE',
  channel: 'DTEST',
  ts: String(now + 1),
  text: 'tomorrow at 3 PM',
  blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'tomorrow at 3 PM' }] }] }],
};
const payload = message => ({ team_id: 'TTEST', event: message });

function setup(options = {}) {
  const updates = [];
  let current = structuredClone(event);
  const handle = createProcessor({
    teamId: 'TTEST',
    userId: 'UEDDIE',
    channelIds: ['DTEST'],
    enabled: true,
    startedAt: now,
    clock: () => now + 2,
    getZone: async () => 'America/Phoenix',
    readMessage: async () => current,
    update: async args => updates.push(args),
    ...options,
  });
  return { handle, updates, setCurrent: message => { current = message; } };
}

test('edits exactly the original allowed message once, retaining thread and attachments by omission', async () => {
  const { handle, updates } = setup();
  const threaded = { ...event, thread_ts: '123', attachments: [{ text: 'keep' }] };
  await handle(payload(threaded));
  await handle(payload(threaded));

  assert.equal(updates.length, 1);
  assert.equal(updates[0].channel, 'DTEST');
  assert.equal(updates[0].ts, event.ts);
  assert.equal('thread_ts' in updates[0], false);
  assert.equal('attachments' in updates[0], false);
});

test('rejects disabled, coworkers, nonallowlisted channels, other workspaces, historic and edit events', async () => {
  const { handle, updates } = setup();
  const rejected = [
    { ...event, user: 'UCOWORKER' },
    { ...event, channel: 'CPROD' },
    { ...event, ts: String(now - 1) },
    { ...event, subtype: 'message_changed' },
    { ...event, bot_id: 'B123' },
    { ...event, edited: { ts: '1' } },
  ];
  for (const message of rejected) await handle(payload(message));
  await handle({ ...payload(event), team_id: 'TOTHER' });
  await setup({ enabled: false }).handle(payload(event));
  assert.equal(updates.length, 0);
});

test('skips a message the user changed between event receipt and the edit', async () => {
  const { handle, updates, setCurrent } = setup();
  setCurrent({ ...event, text: 'changed by Eddie' });
  await handle(payload(event));
  assert.equal(updates.length, 0);
});

test('concurrent duplicates are suppressed before any asynchronous work', async () => {
  const { handle, updates } = setup();
  await Promise.all([handle(payload(event)), handle(payload(event))]);
  assert.equal(updates.length, 1);
});

test('does not edit a replay more than two minutes old', async () => {
  const { handle, updates } = setup({ clock: () => now + 300 });
  await handle(payload(event));
  assert.equal(updates.length, 0);
});

test('explicit wildcard enables Eddie in DMs, group DMs, public and private channels', async () => {
  const { handle, updates, setCurrent } = setup({ channelIds: ['*'] });
  const channels = ['DTEAMMATE', 'GPRIVATE', 'CGROUP', 'CPUBLIC'];
  for (const channel of channels) {
    const message = { ...event, channel };
    setCurrent(message);
    assert.equal(await handle(payload(message)), 'localized');
  }
  assert.deepEqual(updates.map(update => update.channel), channels);
});

test('global mode retains author, workspace, new-message and duplicate restrictions', async () => {
  const { handle, updates } = setup({ channelIds: ['*'] });
  const rejected = [
    { ...event, user: 'UCOWORKER' },
    { ...event, ts: String(now - 1) },
    { ...event, subtype: 'message_changed' },
    { ...event, edited: { ts: '1' } },
    { ...event, bot_id: 'B123' },
    { ...event, channel: undefined },
    { ...event, channel: 'invalid' },
  ];
  for (const message of rejected) await handle(payload(message));
  await handle({ ...payload(event), team_id: 'TOTHER' });
  assert.equal(updates.length, 0);

  await Promise.all([handle(payload(event)), handle(payload(event))]);
  assert.equal(updates.length, 1);
});

test('empty or mixed wildcard configuration does not enable global conversion', () => {
  assert.throws(() => setup({ channelIds: [] }), /conversation/i);
  assert.throws(() => setup({ channelIds: ['*', 'DTEST'] }), /conversation/i);
});
