/**
 * **Zwei Restposten aus P6b, und der Riegel, der sie hält (2026-08-27).**
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/rahmenSchriftUndKanalzaehler.test.ts
 *
 * ── A. Eine Schriftfamilie auf den Rahmenflächen ────────────────────────────────────
 *
 * Das Haus hat sich auf **Inconsolata** festgelegt (`--font-sans` in `theme.css`,
 * Nutzerentscheid 2026-08-26). Tailwind liefert `--font-mono` selbst mit und das Haus
 * überschreibt es nicht — die Klasse `font-mono` stellt hier also nicht „monospace" her
 * (der Rumpf IST schon eine Zellenschrift), sondern zieht eine ZWEITE Familie ein.
 * Gemessen an einem Chromium gegen das gebaute Bundle mit
 * `CSS.getPlatformFontsForNode`: mit der Klasse rendert die Glyphe in **Liberation
 * Mono** (7,201 px Dickte bei 12 px), ohne sie in **Inconsolata** (6,000 px) — +20,0 %,
 * an 200 Ziffern in einer Zeile gemessen, damit die Rundung der Einzelmessung nicht
 * mitspricht.
 *
 * **Warum die Sonde die Kommentare wegwirft — und warum genau das der Anlass war.**
 * Der Plan zu P6b schrieb „`grep` = 0 in den rahmen-eigenen Dateien". Über den ROHEN
 * Quelltext gemessen ist das falsch: die elf Dateien unten tragen zusammen 22 Treffer,
 * und **alle 22** stehen in Begründungs-Prosa („KEIN `font-mono`"). Umgekehrt hatte
 * `⚡spaces.blade.php` acht echte Träger in `class`-Attributen, die der Plan nicht sah.
 * Beide Fehler haben dieselbe Wurzel: ein Grep über Blade misst Prosa und Markup in
 * einem Topf. Dieselbe Behandlung wie in `articleAuthorMarkup.test.ts`.
 *
 * ── B. Der Kanäle-Zähler im Reiterstreifen ─────────────────────────────────────────
 *
 * P6b stellte ihn zurück, weil die Zahl „in einer ANDEREN Alpine-Insel" liegt. Das
 * stimmt weiterhin und ist nachgemessen: `channelCount` sitzt auf
 * `WorkspaceRoomsState` (Insel `nostrWorkspaceRooms`), und diese Insel ist ein
 * NACHFAHRE des Reiterstreifens — Alpine-Scope fliesst nur abwärts. Die Zahl wird
 * deshalb per Ereignis nach oben gereicht. Sie wird nach wie vor an genau einer Stelle
 * gerechnet (`buildWorkspaceModel`) und an genau einer gehalten; dieser Riegel prüft
 * beides, damit aus der Weitergabe nicht doch ein zweiter Datenweg wird.
 *
 * ── Bauform: findet eine Sonde ihren Gegenstand nicht, WIRFT sie ───────────────────
 *
 * Eine Sonde, die bei unlesbarer Eingabe „nichts gefunden" meldet, ist fail-open und
 * sähe nach dem nächsten Umbau wie ein bestandener Test aus. Zusätzlich fährt jeder
 * Lauf eine **Negativkontrolle**: die Sonde bekommt eine künstlich eingebaute
 * Verletzung vorgelegt und muss sie finden. Meldet sie dort grün, ist die Sonde kaputt
 * und nicht die Fläche.
 *
 * ── Mutationsproben (von Hand gefahren, 2026-08-27, jede bytegenau zurückgebaut) ───
 *
 * | Mutation                                                                 | gemessen        |
 * |--------------------------------------------------------------------------|-----------------|
 * | `unread-badge`: `font-mono` wieder in die Pillen-Klassenliste              | **rot**, 1 Fall |
 * | `⚡spaces`: `font-mono` wieder an den Länder-Zähler                        | **rot**, 1 Fall |
 * | `unread-badge`: `tabular-nums` gestrichen                                 | **rot**, 1 Fall |
 * | `⚡forge`: `<template x-if>` samt `flux:badge` aus dem Kanäle-Reiter        | **rot**, 2 Fälle|
 * | `⚡forge`: `size="sm"` am Kanäle-Badge → `size="lg"`                       | **rot**, 1 Fall |
 * | `⚡forge`: `x-effect`-Meldung an der Kanal-Sektion gestrichen              | **rot**, 2 Fälle|
 * | `⚡forge`: `x-on:forge-kanalbestand` an der Insel-Wurzel gestrichen        | **rot**, 1 Fall |
 * | `forge.ts`: `kanalbestand: null` → `kanalbestand: 0`                      | **rot**, 1 Fall |
 * | `bridge.ts`: `this.channelCount = model.channelCount` → `= this.rows.length` | **rot**, 1 Fall |
 * | Sondenprobe: Kommentar-Entferner ausgehängt (roher Quelltext gemessen)     | **rot**, 3 Fälle|
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const JS = import.meta.dirname
const VIEWS = join(JS, '..', 'resources', 'views')
const FORGE = join(VIEWS, '⚡forge.blade.php')
const FORGE_TS = join(JS, 'forge.ts')
const BRIDGE_TS = join(JS, 'bridge.ts')
const MODELL_TS = join(JS, 'workspaceModel.ts')

/**
 * Die Rahmenflächen aus dem Gitea-Plan — die Rail und die drei Seiten, die sie trägt,
 * dazu die zwei GETEILTEN Bauteile, die auf ihnen rendern.
 *
 * `unread-badge` und `nostr-avatar` stehen hier, obwohl sie auch ausserhalb rendern
 * (Chat, Artikel, `⚡directory`, `profile-card`): sie sind der Grund, warum der
 * Restposten ein eigener Vorgang war. Wer sie ändert, ändert alle Flächen mit.
 */
const RAHMENFLAECHEN = [
    join(VIEWS, 'components', 'desktop-rail.blade.php'),
    join(VIEWS, 'components', 'rail-group.blade.php'),
    join(VIEWS, 'components', 'rail-room-row.blade.php'),
    join(VIEWS, 'components', 'rail-forge-row.blade.php'),
    join(VIEWS, 'components', 'rail-skelett.blade.php'),
    join(VIEWS, 'components', 'room-tile.blade.php'),
    join(VIEWS, 'components', 'unread-badge.blade.php'),
    join(VIEWS, 'components', 'nostr-avatar.blade.php'),
    FORGE,
    join(VIEWS, '⚡forge-repo.blade.php'),
    join(VIEWS, '⚡spaces.blade.php'),
]

/** Quelltext, **werfend** bei fehlender oder leerer Datei. */
const lies = (pfad: string): string => {
    const roh = readFileSync(pfad, 'utf8')
    if (roh.trim() === '') {
        throw new Error(`${pfad} ist leer — die Sonde misst nichts mehr.`)
    }

    return roh
}

/** Blade-Quelltext **ohne Kommentare** — die Prosa erklärt hier die Abwesenheit. */
const ohneKommentare = (quelle: string): string => quelle.replace(/\{\{--[\s\S]*?--\}\}/g, '')

const liesBlade = (pfad: string): string => {
    const quelle = ohneKommentare(lies(pfad))
    if (quelle.trim() === '') {
        throw new Error(`${pfad} besteht nur aus Kommentaren — die Sonde misst nichts mehr.`)
    }

    return quelle
}

/** Treffer von `font-mono`, ohne die CSS-Variable `--font-mono` mitzuzählen. */
const monoTreffer = (quelle: string): number => (quelle.match(/(?<!-)\bfont-mono\b/g) ?? []).length

/**
 * Der Rumpf EINES Reiters — **werfend**, wenn es ihn nicht mehr gibt.
 *
 * Am Namen angesetzt und am nächsten `</flux:tab>` begrenzt. Ein Schnitt „ab hier N
 * Zeilen" träfe nach dem nächsten Umbau den Nachbarreiter mit voller Überzeugung — und
 * genau das ist hier der teure Fehler: der Repo-Reiter trägt bereits ein `flux:badge`,
 * eine unscharfe Sonde wäre also über den Kanäle-Reiter fail-open.
 */
const reiterRumpf = (name: string): string => {
    const quelle = liesBlade(FORGE)
    const ab = quelle.indexOf(`<flux:tab name="${name}"`)
    if (ab < 0) {
        throw new Error(`Reiter "${name}" steht nicht mehr in ⚡forge.blade.php — die Sonde misst nichts mehr.`)
    }
    const bis = quelle.indexOf('</flux:tab>', ab)
    if (bis < 0) {
        throw new Error(`Kein Ende des Reiters "${name}" gefunden — die Sonde misst nichts mehr.`)
    }

    return quelle.slice(ab, bis)
}

/** Das `flux:badge`-Tag eines Reiters — **werfend**, wenn keines darin steht. */
const badgeTag = (name: string): string => {
    const rumpf = reiterRumpf(name)
    const treffer = rumpf.match(/<flux:badge\b[^>]*\/>/)
    if (!treffer) {
        throw new Error(`Reiter "${name}" trägt kein <flux:badge …/> — die Sonde misst nichts mehr.`)
    }

    return treffer[0]
}

/** Ein Attributwert aus einem Tag — **werfend**, wenn das Attribut fehlt. */
const attribut = (tag: string, name: string): string => {
    const treffer = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
    if (!treffer) {
        throw new Error(`Attribut ${name} fehlt in: ${tag}`)
    }

    return treffer[1]
}

// ── Die Schranke zuerst ────────────────────────────────────────────────────────────

test('die Sonden finden ihre Gegenstaende ueberhaupt — sonst ist alles darunter wertlos', () => {
    for (const pfad of RAHMENFLAECHEN) {
        assert.ok(liesBlade(pfad).length > 500, `${pfad} ist verdächtig klein.`)
    }
    assert.ok(lies(FORGE_TS).length > 5_000, 'forge.ts ist verdächtig klein.')
    assert.ok(lies(BRIDGE_TS).length > 5_000, 'bridge.ts ist verdächtig klein.')
    assert.ok(lies(MODELL_TS).length > 1_000, 'workspaceModel.ts ist verdächtig klein.')
    assert.ok(reiterRumpf('repos').length > 50, 'Der Repo-Reiter ist verdächtig kurz.')
    assert.ok(reiterRumpf('workspaces').length > 50, 'Der Kanäle-Reiter ist verdächtig kurz.')
})

// ── A. Eine Schriftfamilie ─────────────────────────────────────────────────────────

test('A: die Sonde findet einen font-mono-Verstoss, den es gibt (Negativkontrolle je Lauf)', () => {
    for (const pfad of RAHMENFLAECHEN) {
        const echt = liesBlade(pfad)
        const manipuliert = echt.replace('class="', 'class="font-mono ')
        assert.notEqual(
            manipuliert,
            echt,
            `Kalibrierung fehlgeschlagen: kein class-Attribut in ${pfad} gefunden — die Negativkontrolle greift ins Leere.`,
        )
        assert.equal(
            monoTreffer(manipuliert),
            monoTreffer(echt) + 1,
            `Die Sonde übersieht einen eingebauten font-mono-Träger in ${pfad}.`,
        )
    }
})

test('A: der Kommentar-Entferner ist die tragende Hälfte der Sonde', () => {
    // Kalibriert an einem künstlichen Fall, nicht an einer echten Datei: eine
    // aufgeräumte Prosa dürfte den Riegel nicht rot machen.
    assert.equal(monoTreffer(ohneKommentare('{{-- KEIN `font-mono` hier --}}<span class="x">')), 0)
    assert.equal(monoTreffer(ohneKommentare('<span class="font-mono">')), 1)
    // Und die CSS-Variable ist kein Träger.
    assert.equal(monoTreffer('--font-mono: ui-monospace'), 0)
})

test('A: keine der elf Rahmenflaechen traegt font-mono in ihrem Markup', () => {
    const verstoesse = RAHMENFLAECHEN.filter((pfad) => monoTreffer(liesBlade(pfad)) > 0)
    assert.deepEqual(
        verstoesse,
        [],
        'font-mono zieht auf diesen Rahmenflächen eine zweite Schriftfamilie ein (Liberation Mono statt Inconsolata, +20,0 % Dickte).',
    )
})

test('A: tabular-nums bleibt an der Ungelesen-Pille — es schaltet eine Ziffernform, keine Familie', () => {
    const badge = liesBlade(join(VIEWS, 'components', 'unread-badge.blade.php'))
    assert.match(badge, /tabular-nums/, 'Die Ziffernform der Pille ist mit der Familie mitgefallen.')
})

// ── B. Der Kanäle-Zähler ───────────────────────────────────────────────────────────

test('B: der Kanaele-Reiter traegt eine Zahl in der Bauform des Nachbarreiters', () => {
    const kanaele = badgeTag('workspaces')
    const repos = badgeTag('repos')

    // Nicht gegen ein Literal geprüft, sondern gegen den Nachbarn: ändert jemand die
    // Hausform am Repo-Reiter, muss der Kanäle-Reiter mitziehen. Ein eingefrorenes
    // "sm" hielte hier zwei Reiter fest, die auseinandergelaufen sind.
    assert.equal(attribut(kanaele, 'size'), attribut(repos, 'size'), 'Die zwei Reiter tragen verschieden grosse Zahlen.')
    assert.equal(attribut(kanaele, 'class'), attribut(repos, 'class'), 'Die zwei Reiter setzen ihre Zahl verschieden ab.')
    assert.match(attribut(kanaele, 'x-text'), /^\$num\(/, 'Die Zahl läuft nicht durch die Hausformatierung $num().')
})

test('B: beide Reiter schweigen, solange der Bestand nicht steht', () => {
    // Bei 0 und beim Laden steht KEINE Ziffer. Der Repo-Reiter macht das über
    // `settled()`, der Kanäle-Reiter über das `null` der Sendeseite — `null > 0` ist
    // in JS `false`. Geprüft wird, dass beide überhaupt ein Tor haben.
    for (const name of ['repos', 'workspaces']) {
        assert.match(
            reiterRumpf(name),
            /<template x-if="[^"]+">/,
            `Reiter "${name}" zeigt seine Zahl ungetort — eine "0" oder eine wachsende Ladezahl wäre die Folge.`,
        )
    }
    assert.match(
        reiterRumpf('workspaces'),
        /x-if="kanalbestand > 0"/,
        'Das Tor des Kanäle-Reiters fragt nicht mehr den gemeldeten Bestand ab.',
    )
    assert.equal(null! > 0, false, 'Die Annahme hinter dem Tor: "noch unbekannt" ergibt keine Ziffer.')
})

test('B: die Zahl kommt per Ereignis von unten — Sender und Empfaenger stehen beide', () => {
    const forge = liesBlade(FORGE)

    // Sender: an der Kanal-Sektion, die die Insel mit der Zahl trägt.
    const sektion = forge.match(/<section[^>]*data-forge-workspaces[^>]*>/)
    assert.ok(sektion, 'Die Kanal-Sektion steht nicht mehr — die Sonde misst nichts mehr.')
    assert.match(sektion[0], /x-data="nostrWorkspaceRooms"/, 'Die Sektion trägt die Kanal-Insel nicht mehr.')
    assert.match(
        sektion[0],
        /x-effect="\$dispatch\('forge-kanalbestand', loading \? null : channelCount\)"/,
        'Die Kanal-Sektion meldet ihren Bestand nicht mehr nach oben.',
    )

    // Empfänger: an der Wurzel der Forge-Insel. Das Ereignis blubbert, die Sektion ist
    // ein Nachfahre — es braucht kein `.window` und darf auch keins bekommen.
    const wurzel = forge.match(/<div[^>]*x-data="nostrForge\([^>]*>/)
    assert.ok(wurzel, 'Die Wurzel der Forge-Insel steht nicht mehr — die Sonde misst nichts mehr.')
    assert.match(
        wurzel[0],
        /x-on:forge-kanalbestand="kanalbestand = \$event\.detail"/,
        'Die Forge-Insel hört den gemeldeten Bestand nicht mehr.',
    )
    assert.doesNotMatch(
        wurzel[0],
        /forge-kanalbestand\.window/,
        '`.window` würde das Ereignis jeder anderen Insel im Dokument zustellen.',
    )
})

test('B: kanalbestand faengt bei null an, nicht bei 0', () => {
    const forgeTs = lies(FORGE_TS)
    assert.match(forgeTs, /kanalbestand: number \| null/, 'Das Feld führt "unbekannt" nicht mehr als eigenen Wert.')
    assert.match(
        forgeTs,
        /kanalbestand: null,/,
        'Startwert 0 hiesse: "dieser Workspace hat keine Kanäle" — eine Aussage, die beim Laden niemand treffen kann.',
    )
})

test('B: die Zahl wird an EINER Stelle gerechnet und an EINER gehalten — kein zweiter Datenweg', () => {
    // Gerechnet: nur im Modell, aus den Zeilen, die wirklich in der Liste liegen.
    assert.match(lies(MODELL_TS), /channelCount: channels\.length,/, 'Das Modell rechnet den Bestand nicht mehr selbst.')

    // Gehalten: die Insel übernimmt den fertigen Wert, sie leitet ihn nicht neu ab.
    assert.match(
        lies(BRIDGE_TS),
        /this\.channelCount = model\.channelCount/,
        'Die Kanal-Insel füllt ihren Bestand nicht mehr aus dem einen Modell.',
    )

    // Und das Markup rechnet gar nichts: `channelCount` darf im Blade genau einmal
    // vorkommen — in der Meldung nach oben. Ein zweites Vorkommen wäre die Form, in
    // der ein zweiter Datenweg entsteht (P6a: "beides zusammen oder keines").
    assert.equal(
        (liesBlade(FORGE).match(/channelCount/g) ?? []).length,
        1,
        '⚡forge.blade.php fasst den Kanalbestand mehr als einmal an — genau so entsteht die zweite Wahrheit.',
    )
})
