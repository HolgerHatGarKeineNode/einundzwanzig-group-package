# einundzwanzig/group

> 🚧 **Work in progress** — not a stable state, no guarantees.

Reusable **Laravel package**: Nostr community chat (spaces, rooms, directory, login) for
**EINUNDZWANZIG**. Built on NIP-29 groups; the Nostr SDK (welshman) runs client-side in the
browser, signing always stays in the browser — the private key never leaves the device.
Extracted from the main client
[einundzwanzig-group](https://github.com/HolgerHatGarKeineNode/einundzwanzig-group).

- **Composer package:** `einundzwanzig/group`
- **Namespace:** `Einundzwanzig\Group\` · **Provider:** `Einundzwanzig\Group\GroupServiceProvider` (auto-discovery)
- **Stack:** Laravel 13 · Livewire 4 · Flux UI · welshman (`@welshman/*`)

## Push state for native hosts (`pushSyncState`)

When the package runs inside a native shell (TWENTY ONE Companion, Android), that shell can
poll the chat in the background and post notifications — without Play Services and without a
push server. To do so it needs the login and the room membership, and **only the client
knows those**.

That is why `pushSyncState` (`js/groups.ts`) writes `{ relay, rooms, names }` of the active
space to `localStorage['pushSync']` and fires a `push-sync` event. The host picks both up (in
the Companion: `partials/push-sync.blade.php`) and hands them to the native worker. `names`
(room id → display name) is only used for the notification title — the name lives in the
39000 event and is unknown outside the client.

The event is mandatory, not a nicety: membership (39002) only streams in **after** the page
has been built — anything that reads once on load sees an empty room list. Without a native
host the state is simply unused.

## Installing

> **This package requires a paid Flux Pro licence.** Its views use Flux Pro components —
> `flux:tab*` (16 usages), `flux:tabs` (4) and `flux:command*` (9). Without Flux Pro the package
> will not install. See *Flux Pro* below before you start.

In the `composer.json` of the target project:

```json
{
    "repositories": [
        { "type": "vcs", "url": "git@github.com:HolgerHatGarKeineNode/einundzwanzig-group-package.git" },
        { "type": "composer", "url": "https://composer.fluxui.dev" }
    ],
    "require": { "einundzwanzig/group": "dev-master" }
}
```

```bash
composer update einundzwanzig/group
```

### Flux Pro

`livewire/flux` and `livewire/flux-pro` (both `^2.15`) are declared in this package's `require`,
so Composer refuses the install instead of rendering broken views at runtime. Two things Composer
cannot do for you, because **a repository declared inside a dependency is ignored** — only the
root project's `repositories` count:

1. Add the `https://composer.fluxui.dev` repository to the target project (see the JSON above).
2. Provide the licence credentials, e.g.
   `composer config --auth http-basic.composer.fluxui.dev <email> <licence-key>`.
   This writes `auth.json` — **make sure it is git-ignored** before you run it.

Buy a licence at <https://fluxui.dev>.

The provider is registered via Laravel auto-discovery (routes, `group::*` views, the
`group::einundzwanzig` layout).

## Local development (symlink switch)

If this repo is **cloned** into the target project at `packages/einundzwanzig-group/` and a
`path` repository (before the `vcs` entry) is set with `"symlink": true`, Composer binds the
local directory as a symlink — changes are live immediately, without a tag or release. If the
directory is missing, Composer pulls `dev-master` from here automatically. Details in the main
repo under `CONTRIBUTING.md`.

> The Composer `version` is deliberately **not** set: the version is derived from the branch
> (`dev-master`), so that the same version satisfies both the local symlink and the GitHub
> fallback.

## Branch

Development happens on **`master`** (not `main`).
