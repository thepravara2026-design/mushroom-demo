const crypto = require('crypto');

const sseSubscribers = [];

function addSseSubscriber(req, res, user) {
  const id = crypto.randomBytes(8).toString('hex');
  const sub = {
    id, req, res, user,
  };
  sseSubscribers.push(sub);
  req.on('close', () => {
    const idx = sseSubscribers.findIndex((s) => s.id === id);
    if (idx !== -1) sseSubscribers.splice(idx, 1);
  });
  return sub;
}

function sendSseEvent(event, data, filterFn) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseSubscribers.forEach((sub) => {
    try {
      if (typeof filterFn === 'function' && !filterFn(sub)) return;
      sub.res.write(payload);
    } catch (e) {
      // ignore write errors; cleanup will remove closed connections
    }
  });
}

module.exports = { addSseSubscriber, sendSseEvent, sseSubscribers };
