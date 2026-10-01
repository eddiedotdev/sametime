const LOGGED_STATUSES = new Set(['localized', 'changed', 'rate-capped']);

const logJson = record => console.log(JSON.stringify(record));

export function attachListener(socket, processMessage, log = logJson) {
  socket.on('message', async ({ body, ack }) => {
    try {
      await ack();
      const status = await processMessage(body);
      if (LOGGED_STATUSES.has(status)) log({ status, channel: body.event.channel, ts: body.event.ts });
    } catch (error) {
      // Log only the error code; errors can carry request and response details.
      log({ status: 'failed', code: error.data?.error ?? error.code ?? 'unknown' });
    }
  });
}
