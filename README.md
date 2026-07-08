# einundzwanzig/group

> 🚧 **Work in Progress** — kein stabiler Stand, keine Garantien.

Wiederverwendbares **Laravel-Package**: Nostr-Community-Chat (Spaces, Räume, Directory,
Login) für **EINUNDZWANZIG**. Baut auf NIP-29-Gruppen; das Nostr-SDK (welshman) läuft
client-seitig im Browser, Signing bleibt immer im Browser — der private Key verlässt nie
das Gerät. Extrahiert aus dem Haupt-Client
[einundzwanzig-group](https://github.com/HolgerHatGarKeineNode/einundzwanzig-group).

- **Composer-Paket:** `einundzwanzig/group`
- **Namespace:** `Einundzwanzig\Group\` · **Provider:** `Einundzwanzig\Group\GroupServiceProvider` (Auto-Discovery)
- **Stack:** Laravel 13 · Livewire 4 · Flux UI · welshman (`@welshman/*`)

## Einbinden

In die `composer.json` des Ziel-Projekts:

```json
{
    "repositories": [
        { "type": "vcs", "url": "git@github.com:HolgerHatGarKeineNode/einundzwanzig-group-package.git" }
    ],
    "require": { "einundzwanzig/group": "dev-master" }
}
```

```bash
composer update einundzwanzig/group
```

Der Provider wird per Laravel-Auto-Discovery registriert (Routen, Views `group::*`,
Layout `group::einundzwanzig`).

## Lokale Entwicklung (Symlink-Weiche)

Wird dieses Repo im Ziel-Projekt nach `packages/einundzwanzig-group/` **geklont** und dort ein
`path`-Repository (vor dem `vcs`-Eintrag) mit `"symlink": true` gesetzt, bindet Composer
den lokalen Ordner als Symlink ein — Änderungen sind sofort live, ohne Tag/Release. Fehlt
der Ordner, zieht Composer automatisch `dev-master` von hier. Details im Haupt-Repo unter
`CONTRIBUTING.md`.

> Der Composer-`version` ist bewusst **nicht** gesetzt: die Version wird aus dem Branch
> abgeleitet (`dev-master`), damit dieselbe Version sowohl den lokalen Symlink als auch
> den GitHub-Fallback erfüllt.

## Branch

Entwicklung läuft auf **`master`** (nicht `main`).
