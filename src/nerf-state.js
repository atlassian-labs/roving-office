/** One server-wide game, independent of the office or scene currently mounted. */
export async function connectNerfState({ onChange, fetcher = fetch, EventSourceClass = EventSource } = {}) {
  const response = await fetcher('/api/nerf-war');
  if (!response.ok) throw new Error('Could not read the shared Nerf game');
  let enabled = (await response.json()).enabled === true;
  const apply = (value) => { enabled = value; onChange?.(enabled); };
  apply(enabled);
  const source = new EventSourceClass('/api/nerf-war/stream');
  source.addEventListener('nerf-war', (event) => {
    try {
      const state = JSON.parse(event.data);
      if (typeof state.enabled === 'boolean') apply(state.enabled);
    } catch { /* Ignore malformed events; the next snapshot repairs state. */ }
  });
  return {
    get enabled() { return enabled; },
    async set(value) {
      const result = await fetcher('/api/nerf-war', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: value }),
      });
      if (!result.ok) throw new Error('Could not change the shared Nerf game');
      apply((await result.json()).enabled === true);
    },
    close() { source.close(); },
  };
}
