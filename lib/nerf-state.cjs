const fs = require('node:fs');
const path = require('node:path');

// Outside the office registry: reaping a room must not end the server's game.
function createNerfState(file) {
  let enabled = false;
  try { enabled = JSON.parse(fs.readFileSync(file, 'utf8')).enabled === true; }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  const listeners = new Set();
  return {
    get enabled() { return enabled; },
    set(value) {
      if (value === enabled) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ enabled: value }), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
      enabled = value;
      for (const listener of listeners) listener(enabled);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(enabled);
      return () => listeners.delete(listener);
    },
  };
}

module.exports = { createNerfState };
