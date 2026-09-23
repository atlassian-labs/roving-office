// The seam between this plugin and the rest of the repo — and the only file that
// `npm run pack:openclaw` rewrites.
//
// Two modules are genuinely shared with the hook adapters, and sharing them is the
// point rather than an accident:
//
//   aop-core.cjs      which office a directory belongs to, where that office is, how
//                     much may be said about it, and the POST itself
//   tool-classes.cjs  the fallback reasoning for a tool nobody has classified yet
//
// A machine must not answer "which room does this repo walk into" one way for a hook
// and another way for the bridge, so there is one copy and both read it.
//
// **In a checkout** those live up in `bin/`, which is why the plugin is installed with
// `--link`: a copy of `openclaw-plugin/` alone would not carry them.
//
// **In a packed artifact** there is no `bin/` — a tarball handed to an OpenClaw server
// has to stand alone. So the packer vendors both files into `vendor/` and replaces
// *this file* with one that requires them from there. One seam, swapped wholesale, so
// no source file is ever regex-rewritten and the packed plugin is byte-identical to the
// checkout everywhere else.
//
// If you add another dependency on the repo, add it here, or the packed artifact will
// import a path that does not exist on the server it lands on.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const core = require('../../bin/lib/aop-core.cjs');
export const toolClasses = require('../../bin/mappers/lib/tool-classes.cjs');
