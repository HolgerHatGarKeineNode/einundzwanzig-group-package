/**
 * **Die reine Adressbildung des media.-Profilverweises.**
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/medienProfil.test.ts
 *
 * Zwei Zusagen tragen diese Datei, und die erste ist die einzige, die still falsch sein
 * kann, ohne dass irgendwo etwas kaputtgeht:
 *
 *  1. **Ein UNVERIFIZIERTES NIP-05 landet nie im Link.** Das `nip05`-Feld eines kind 0
 *     ist eine Selbstauskunft. Trüge der Verweis sie ungeprüft, führte er auf eine
 *     fremde Person — sichtbar wäre daran nichts, denn der Link funktioniert ja. Der
 *     Test unten stellt genau diese Verwechslung nach: das Profil behauptet
 *     `satoshi@einundzwanzig.space`, die `.well-known` der Domain nennt einen anderen
 *     Schlüssel. Geprüft wird gegen die **echte** `verifiedNip05` aus `handles.ts`
 *     (unter `node --test` ladbar, am 2026-08-21 gemessen) — eine Nachbildung der
 *     Match-Regel prüfte hier nur sich selbst.
 *  2. **Die npub trägt immer.** Kein kind 0, kein NIP-05, hängender Handle-Load,
 *     Wurzelform `_@domain` — in jedem dieser Fälle muss ein gültiger Link entstehen.
 *
 * ── Die Adressen stehen als LITERAL da ────────────────────────────────────────────
 * Kein `${BASIS}/u/${id}` in einer Erwartung, sondern die fertige Zeichenkette. Ein
 * Vergleich gegen dieselben Bausteine, aus denen die Funktion baut, wäre das Symbol
 * gegen sich selbst und bliebe grün, während der Link auf `/user/` zeigt oder das `#`
 * verliert. Genau diese Klasse ist in P4 durch 1324 grüne Tests gelaufen
 * (`NIP05_WURZEL = '_'` → `'root'`).
 *
 * ── Mutationsproben (von Hand gefahren, 2026-08-21, jede bytegenau zurückgebaut) ───
 *
 * | Mutation                                                              | gemessen          |
 * |------------------------------------------------------------------------|-------------------|
 * | `medienProfil.ts`: `/u/${kennung}` → `/user/${kennung}`                 | **rot**, 10 Fälle |
 * | `medienProfil.ts`: `MEDIEN_NIP05_MUSTER.test(...)` → `nip05Verifiziert !== ''` | **rot**, 2 Fälle |
 * | `medienProfil.ts`: `isSafeExternalUrl(basis)` → `basis === ''`           | **rot**, 1 Fall   |
 * | `medienProfil.ts`: `replace(/\/+$/, '')` gestrichen                      | **rot**, 1 Fall   |
 * | `medienProfil.ts`: `PUBKEY_HEX.test(pubkey)` gestrichen (nur `try/catch`) | **rot**, 1 Fall   |
 * | `medienProfil.ts`: `PUBKEY_HEX` → `/^[0-9a-f]+$/i` (ohne Längengrenze)   | **rot**, 1 Fall   |
 *
 * **Die vorletzte ist der Grund, warum die Längenprüfung überhaupt existiert.** Sie war
 * beim ersten Anlauf kein Mutant, sondern der Zustand des Moduls: `npubEncode` wirft nur
 * bei ungerader Länge und Nicht-Hex, und lieferte für `''` klaglos `npub106246s`. Der
 * Test hat es gefunden, bevor die Fläche gebaut war.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as nip19 from 'nostr-tools/nip19'
import { verifiedNip05 } from './handles.ts'
import { MEDIEN_NIP05_MUSTER, medienProfilUrl } from './medienProfil.ts'

/**
 * Die Basis, wie sie `config/group.php` als Fallback ausliefert — **wörtlich**.
 *
 * Steht hier als Literal und nicht als Import aus der PHP-Seite (die es hier ohnehin
 * nicht gibt): das `#` ist der ganze Unterschied zwischen der Hash-Route der SPA und
 * einem Pfad, den ein Static-Host nicht kennt. Die PHP-Seite hält dieselbe Zeile als
 * Literal (`tests/Feature/MediaProfilLinkTest.php`).
 */
const BASIS = 'https://media.einundzwanzig.space/#'

/** Ein gültiger, fester Hex-Pubkey — 32 Byte, damit `npubEncode` ihn annimmt. */
const PUBKEY = 'acbcec4770cc8e5bfa02aa1a9a2ad07e0dbe4dd8a7fa2c6da0e4e2a6b0e7c1d9'

/** Seine npub — einmal gerechnet, damit die Erwartungen unten lesbar bleiben. */
const NPUB = nip19.npubEncode(PUBKEY)

// ── 1. Die Sicherheitsregel: unverifiziert ⇒ npub ────────────────────────────────

test('VERWECHSLUNG: Profil behauptet eine Adresse, die .well-known nennt einen ANDEREN Schlüssel', () => {
    // Der Angriff in seiner billigsten Form: jemand trägt `satoshi@einundzwanzig.space`
    // in sein eigenes kind 0 ein. Die Domain führt diesen Namen wirklich — nur eben für
    // jemand anderen. Ohne Verifikation zeigte unser Verweis auf DIESE andere Person.
    const fremderSchluessel = '1'.repeat(64)
    const profile = new Map([[PUBKEY, { nip05: 'satoshi@einundzwanzig.space' }]])
    const handles = new Map([['satoshi@einundzwanzig.space', { pubkey: fremderSchluessel }]])

    // Die echte Prüfung aus `handles.ts`, nicht ihre Nachbildung.
    const geprueft = verifiedNip05(PUBKEY, profile, handles)
    assert.equal(geprueft, '', 'verifiedNip05 hat einen FREMDEN Handle bestätigt — die Verwechslung wäre echt.')

    assert.equal(
        medienProfilUrl(BASIS, PUBKEY, geprueft),
        `https://media.einundzwanzig.space/#/u/${NPUB}`,
        'Der Verweis trägt eine fremde Adresse statt der npub.',
    )
})

test('BESTÄTIGT: nennt die .well-known genau diesen Schlüssel, trägt der Link die Adresse', () => {
    // Die Positivkontrolle zum Test darüber. Ohne sie wäre „liefert die npub" auch dann
    // grün, wenn `verifiedNip05` grundsätzlich nichts mehr bestätigt — und der ganze
    // NIP-05-Zweig dieser Fläche wäre tot, ohne dass ein Test es merkt.
    const profile = new Map([[PUBKEY, { nip05: 'dennis@einundzwanzig.space' }]])
    const handles = new Map([['dennis@einundzwanzig.space', { pubkey: PUBKEY }]])

    const geprueft = verifiedNip05(PUBKEY, profile, handles)
    assert.equal(geprueft, 'dennis@einundzwanzig.space')

    assert.equal(
        medienProfilUrl(BASIS, PUBKEY, geprueft),
        'https://media.einundzwanzig.space/#/u/dennis@einundzwanzig.space',
    )
})

test('Ein Profil OHNE nip05 ergibt die npub — nicht etwa gar keinen Link', () => {
    const geprueft = verifiedNip05(PUBKEY, new Map([[PUBKEY, {}]]), new Map())
    assert.equal(geprueft, '')
    assert.equal(medienProfilUrl(BASIS, PUBKEY, geprueft), `https://media.einundzwanzig.space/#/u/${NPUB}`)
})

test('Handle-Load hängt noch (leere handles-Map) — der Link steht trotzdem', () => {
    // Der häufigste Zustand überhaupt: das kind 0 ist da, die `.well-known` unterwegs.
    // Eine Fläche, die in diesem Moment KEINEN Link zeigt und ihn später nachschiebt,
    // wäre ein Ziel, das unter dem Finger erscheint.
    const geprueft = verifiedNip05(PUBKEY, new Map([[PUBKEY, { nip05: 'dennis@einundzwanzig.space' }]]), new Map())
    assert.equal(geprueft, '')
    assert.equal(medienProfilUrl(BASIS, PUBKEY, geprueft), `https://media.einundzwanzig.space/#/u/${NPUB}`)
})

test('Gar kein kind 0 — die npub hängt an nichts als am Pubkey', () => {
    assert.equal(
        medienProfilUrl(BASIS, PUBKEY, verifiedNip05(PUBKEY, new Map(), new Map())),
        `https://media.einundzwanzig.space/#/u/${NPUB}`,
    )
})

// ── 2. Die Wurzelform `_@domain` ─────────────────────────────────────────────────

test('WURZELFORM: `_@domain` kommt als nackte Domain an und fällt deshalb auf die npub', () => {
    // `verifiedNip05` liefert die ANZEIGEFORM (`displayNip05`): aus `_@einundzwanzig.space`
    // wird `einundzwanzig.space`, eine Zeichenkette ohne `@`. media. urteilt darüber
    // `invalid_format` (CreatorPage.vue:75, außerhalb des Projekts nachgestellt) — der
    // Verweis führte auf eine Fehlerseite. Die npub führt auf das Profil.
    const profile = new Map([[PUBKEY, { nip05: '_@einundzwanzig.space' }]])
    const handles = new Map([['_@einundzwanzig.space', { pubkey: PUBKEY }]])

    const geprueft = verifiedNip05(PUBKEY, profile, handles)
    assert.equal(geprueft, 'einundzwanzig.space', 'displayNip05 verhält sich anders als 2026-08-21 gemessen.')

    assert.equal(
        medienProfilUrl(BASIS, PUBKEY, geprueft),
        `https://media.einundzwanzig.space/#/u/${NPUB}`,
        'Eine nackte Domain als :identifier — media. antwortet darauf mit „Das ist keine Adresse".',
    )
})

// ── 3. Das Muster ist ENGER als das von media. ───────────────────────────────────

test('Eine „Adresse" mit Pfadanteil kommt nicht durch — auch wenn media. sie annähme', () => {
    // media.s eigenes Muster (`/^[^@\s]+@[^@\s]+\.[^@\s]+$/`) lässt `/`, `#`, `?` und `%`
    // zu. Dieser Wert bestünde es und schöbe einen zweiten Pfad in unsere URL. Er käme
    // nur durch eine bestätigende Domain herein — aber Unbedenklichkeit, die an der
    // Gutwilligkeit einer fremden Domain hängt, ist keine Zusage.
    for (const boesartig of [
        'a@b.c/#/u/npub1angreifer',
        'a@b.c?x=1',
        'a@b.c#frag',
        'a@b.c%2F..%2F',
        'a@b.c/../../evil',
        'a@b .c',
        '<script>@b.c',
    ]) {
        assert.equal(
            MEDIEN_NIP05_MUSTER.test(boesartig),
            false,
            `„${boesartig}" besteht das Muster — der Verweis trüge fremde Pfadanteile.`,
        )
        assert.equal(
            medienProfilUrl(BASIS, PUBKEY, boesartig),
            `https://media.einundzwanzig.space/#/u/${NPUB}`,
            `„${boesartig}" ist im Link gelandet, statt auf die npub zu fallen.`,
        )
    }
})

test('Gewöhnliche NIP-05-Adressen kommen durch — sonst wäre der Zweig tot', () => {
    // Positivkontrolle zum Test darüber: ein Muster, das ALLES ablehnt, bestünde ihn
    // ebenfalls. Diese acht sind die real gemessenen Formen der zwölf Board-Autoren
    // (2026-08-21) plus die Randformen des NIP-05-Zeichenvorrats.
    for (const gut of [
        'dennis@einundzwanzig.space',
        'johnny@einundzwanzig.space',
        'el-presidento-benito@einundzwanzig.space',
        'bitcoin21sepp@einundzwanzig.space',
        'sinautoshi@pareto.town',
        'chris@nostrings.news',
        'vor.name@sub.domain.co.uk',
        'a_b@x.io',
    ]) {
        assert.equal(MEDIEN_NIP05_MUSTER.test(gut), true, `„${gut}" wird abgelehnt — der NIP-05-Zweig ist tot.`)
        assert.equal(medienProfilUrl(BASIS, PUBKEY, gut), `https://media.einundzwanzig.space/#/u/${gut}`)
    }
})

// ── 4. Die Basis: leer heißt „kein Link" ─────────────────────────────────────────

test('Leere Basis ⇒ leerer Rückgabewert ⇒ die Zeile entfällt', () => {
    assert.equal(medienProfilUrl('', PUBKEY, 'dennis@einundzwanzig.space'), '')
})

test('Eine Basis, die kein http(s) ist, ergibt keinen Link', () => {
    // Der Wert ist betreibergesetzt, nicht nutzergesetzt — trotzdem geprüft: ein
    // `javascript:`-Präfix in einer `.env` wäre sonst ein `href`, das Code ausführt.
    for (const schlecht of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'nicht mal eine URL']) {
        assert.equal(medienProfilUrl(schlecht, PUBKEY, ''), '', `„${schlecht}" ist zu einem href geworden.`)
    }
})

test('Ein unbrauchbarer Pubkey ergibt keinen Link statt eines kaputten', () => {
    // **Die vier oberen wirft `npubEncode` NICHT** — am 2026-08-21 gemessen: es prüft
    // nur gerade Länge und Hex-Zeichenvorrat. `''` wird zu `npub106246s`, `'ab'` zu
    // `npub14vcr2qpt`, 62 und 66 Hexzeichen ebenso zu wohlgeformtem bech32. Ein
    // `try/catch` allein hätte sie alle als Links ausgeliefert. Deshalb steht davor eine
    // Längenprüfung, und deshalb stehen genau diese Werte hier.
    const nichtGeworfen = ['', 'ab', 'a'.repeat(62), 'a'.repeat(66)]
    const geworfen = ['nicht-hex', 'abc', 'z'.repeat(64)]

    for (const schlecht of [...nichtGeworfen, ...geworfen]) {
        assert.equal(medienProfilUrl(BASIS, schlecht, ''), '', `„${schlecht.slice(0, 12)}…" wurde zu einem Link.`)
        // Auch nicht mit gültiger Adresse: ohne npub gibt es keinen Rückfallweg, und ein
        // Link, der NUR bei bestätigtem NIP-05 existiert, erschiene sprunghaft.
        assert.equal(medienProfilUrl(BASIS, schlecht, 'dennis@einundzwanzig.space'), '')
    }

    // Die Messung selbst als Kontrolle: bricht sie weg, ist der Guard oben vielleicht
    // gar nicht mehr nötig — oder er deckt etwas anderes ab als gedacht.
    for (const wert of nichtGeworfen) {
        assert.doesNotThrow(
            () => nip19.npubEncode(wert),
            `npubEncode wirft jetzt bei „${wert.slice(0, 12)}…" — die Begründung der Längenprüfung stimmt nicht mehr.`,
        )
    }
})

// ── 5. Die Form der Basis ────────────────────────────────────────────────────────

test('Abschließende Schrägstriche werden abgeschnitten — eine `.env` schreibt sie mit', () => {
    assert.equal(
        medienProfilUrl('https://media.einundzwanzig.space/#/', PUBKEY, 'dennis@einundzwanzig.space'),
        'https://media.einundzwanzig.space/#/u/dennis@einundzwanzig.space',
    )
    assert.equal(
        medienProfilUrl('https://media.einundzwanzig.space///', PUBKEY, 'dennis@einundzwanzig.space'),
        'https://media.einundzwanzig.space/u/dennis@einundzwanzig.space',
    )
})

test('Die Basis trägt das ganze Präfix — ohne `#` entsteht der Klarpfad', () => {
    // **Das ist der Schalter, nicht ein Zufall.** media. beantwortet BEIDE Formen
    // (2026-08-21 gemessen: `/#/u/…` ist die Route der Hash-SPA, `/u/…` liefert
    // zusätzlich profilspezifische OG-Tags und leitet dann in die SPA). Welche gilt,
    // entscheidet eine `.env`-Zeile — nicht ein Code-Umbau.
    assert.equal(
        medienProfilUrl('https://media.einundzwanzig.space', PUBKEY, 'dennis@einundzwanzig.space'),
        'https://media.einundzwanzig.space/u/dennis@einundzwanzig.space',
    )
})
