# OpenClaw on a server

*Where the Gateway and the checkout are not the same machine. One command at each end.*

The [ordinary install](openclaw.md#install-it) works from a checkout, so it only works
where the Gateway *is* that checkout. A Gateway on a server needs an artifact instead.

## In the checkout

```bash
npm run pack:openclaw     # -> dist/roving-office-openclaw-<version>.tgz
                          #    dist/aop-openclaw-server.sh
scp dist/roving-office-openclaw-*.tgz dist/aop-openclaw-server.sh <host>:
```

**Two files, because an artifact alone still leaves a dance to do by hand.** The script does
that dance, and it ships beside the tarball so there is nothing to remember on the far end.

## On the server

```bash
./aop-openclaw-server.sh roving-office-openclaw-0.13.0.tgz
openclaw gateway restart       # the plugin only loads at Gateway startup
```

That mints a fresh office on therovingoffice.com, installs the tarball, writes every
setting it needs — **including the conversation-access flag that a manual install so easily
misses** — and prints the office URL to open.

Its flags cover the things that vary:

```bash
./aop-openclaw-server.sh <tgz> --receiver http://office.internal:8080  # a receiver of your own
./aop-openclaw-server.sh <tgz> --keycard AB12CD34 --token <t>          # an office that exists
./aop-openclaw-server.sh <tgz> --scene build-box                       # name the room
```

**The tarball is a required argument** rather than the newest match in the directory,
because *which version is on that box* is the question that wastes the most time here — and
a script that picks a file for you is a script that can answer it wrong.

It refuses to run without `openclaw` on the PATH. Unlike the installers in the checkout,
which shrug and print the commands for elsewhere, this script has no meaning anywhere but
the Gateway host.

## Upgrading later is the same command

Ship a new tarball, run the script again, restart the Gateway.

**It keeps the office it already had.** The script used to mint a fresh one every run, which
was defensible while an office was disposable — a deploy lost them all anyway, so a new
keycard cost nothing that was not already gone.

It is not defensible now. An office survives a deploy holding its scene layout, its
furniture and its history, and it holds several named tokens rather than one that
re-minting would revoke. A second run is almost always somebody shipping a new build to a
box that is already wired up, and minting there would move that Gateway into an empty room
**while the room people had bookmarked went quiet.**

The **scene** is treated the same way: a room name somebody chose is not re-guessed from
the hostname on an upgrade.

## Or configure it by hand

The whole configuration, in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "roving-office": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "config": {
          "url": "https://your-office/office/AB12CD34/aop/v0/events",
          "token": "<write-token>",
          "scene": "build-box"
        }
      }
    }
  }
}
```

That grain is right for a Gateway: it outlives every shell, so an environment variable would
be the wrong place to tell it where to publish.

**One ordering is load-bearing if you do it by hand: install before you configure.**
Installing the plugin writes its own config entry and would discard settings made first.

## Read next

- [OpenClaw](openclaw.md) — the ordinary install, and the troubleshooting table
- [Sharing an office](../sharing-an-office.md) — what a hosted office does and does not keep
- The packer and the link-install are in the [developer docs](../../developer/adapters/openclaw.md)
