// The pluggable data-source interface. Any source (mock now, real Rovo CLI later)
// implements start(onEvent) / stop(). Events follow the shape documented in
// AgentManager: spawn | status | job | mail | deliver | despawn.
//
// This thin base keeps the scene decoupled from where agent activity comes from.

export class AgentSource {
  /** @param {(event: object) => void} _onEvent */
  start(_onEvent) { throw new Error('AgentSource.start() not implemented'); }
  stop() {}

  // Optional capability: sendJob(job?) -> ?string
  //
  // A source implements this if work can be conjured on demand — which is what
  // the `t` shortcut drives. It is deliberately absent from this base class so
  // that it can be feature-detected: main.js only offers the shortcut when the
  // live source actually has it, so with a real feed (where inventing a job
  // would be a fiction) the binding doesn't exist and never appears in the help
  // panel. Returns the job that was posted, or null if it couldn't be.
}
