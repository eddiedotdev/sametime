import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachListener } from '../src/listener.js';

test('receives the SDK message event, acknowledges it, and passes the workspace envelope', async () => {
  const socket = new EventEmitter();
  const order = [];
  const body = { team_id: 'TTEST', event: { type: 'message', channel: 'DTEST', ts: '1' } };
  const processMessage = async value => {
    assert.equal(value, body);
    order.push('process');
    return 'localized';
  };
  attachListener(socket, processMessage, () => {});

  const [handler] = socket.listeners('message');
  assert.equal(typeof handler, 'function');
  await handler({ body, ack: async () => order.push('ack') });
  assert.deepEqual(order, ['ack', 'process']);
});
