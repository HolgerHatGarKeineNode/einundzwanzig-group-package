/**
 * Pure-Tests für den Schreibpfad der Artikelfläche (P7).
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleWrite.test.ts
 *
 * Drei Fragen, und alle drei entscheiden über etwas Unwiderrufliches:
 *  1. Gehört dieser Kommentar überhaupt zu DIESEM Artikel? (`#A` vs. `#a` vs. `#e`)
 *  2. Habe ICH schon reagiert — und welches Ereignis nimmt der Toggle zurück?
 *  3. Darf dieser Entwurf abgeschickt werden, und wenn nein, mit welchem Grund?
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    ARTIKEL_REAKTION,
    KOMMENTAR_MAX_ZEICHEN,
    artikelKommentare,
    eigeneReaktion,
    kommentarSperre,
} from './articleWrite.ts'

const ADRESSE = '30023:aa11bb22:mein-artikel'
const FREMD = '30023:cc33dd44:fremder-artikel'

type Roh = { id: string; kind: number; pubkey?: string; content?: string; created_at?: number; tags: string[][] }

/** Minimales `TrustedEvent` — die geprüften Funktionen lesen nur diese Felder. */
const ev = (e: Roh) =>
    ({
        id: e.id,
        kind: e.kind,
        pubkey: e.pubkey ?? 'autor',
        content: e.content ?? '',
        created_at: e.created_at ?? 1_700_000_000,
        tags: e.tags,
        sig: '',
    }) as never

// ── Die Konstanten, gegen LITERALE ─────────────────────────────────────────────────
//
// Hausregel: nie das Symbol gegen sich selbst. Eine Konstante, die nur gegen ihren
// eigenen Import geprüft wird, lässt jede Änderung durch — im Haus belegt an
// `NIP05_WURZEL = '_'` → `'root'`, 1324/1324 grün.

test('ARTIKEL_REAKTION ist "+" — die NIP-25-Form für Zustimmung', () => {
    assert.equal(ARTIKEL_REAKTION, '+')
})

test('KOMMENTAR_MAX_ZEICHEN ist 5000', () => {
    assert.equal(KOMMENTAR_MAX_ZEICHEN, 5000)
})

// ── artikelKommentare ──────────────────────────────────────────────────────────────

test('ein Kommentar, der den Artikel NUR im grossen A nennt, zählt mit', () => {
    // Der Fall, an dem ein `#a`-only-Filter stumm leer bliebe: eine Antwort auf einen
    // Kommentar trägt im kleinen `a` den ELTERNKOMMENTAR. 7 der 64 vorhandenen
    // Artikel-Kommentare sind so gebaut (gemessen 2026-08-21 über drei Relays).
    const kommentare = artikelKommentare({
        ereignisse: [ev({ id: 'k1', kind: 1111, content: 'Antwort im Baum', tags: [['A', ADRESSE], ['a', FREMD]] })],
        adresse: ADRESSE,
        adresseVonId: new Map(),
    })

    assert.deepEqual(kommentare.map((k) => k.id), ['k1'])
})

test('ein Kommentar an einem FREMDEN Artikel zählt hier nicht', () => {
    const kommentare = artikelKommentare({
        ereignisse: [ev({ id: 'k1', kind: 1111, tags: [['A', FREMD], ['a', FREMD]] })],
        adresse: ADRESSE,
        adresseVonId: new Map(),
    })

    assert.deepEqual(kommentare, [])
})

test('ein Kommentar per e-Tag auf eine geladene Fassung zählt mit', () => {
    const kommentare = artikelKommentare({
        ereignisse: [ev({ id: 'k1', kind: 1111, tags: [['e', 'fassung-1']] })],
        adresse: ADRESSE,
        adresseVonId: new Map([['fassung-1', ADRESSE]]),
    })

    assert.deepEqual(kommentare.map((k) => k.id), ['k1'])
})

test('andere Kinds an derselben Adresse sind KEINE Kommentare', () => {
    // Reaktionen (7) und Zap-Quittungen (9735) liegen im selben `$sekundaer`-Array —
    // die Ableitung reicht alle drei Kinds herein.
    const kommentare = artikelKommentare({
        ereignisse: [
            ev({ id: 'r1', kind: 7, tags: [['a', ADRESSE]] }),
            ev({ id: 'z1', kind: 9735, tags: [['a', ADRESSE]] }),
            ev({ id: 'k1', kind: 1111, tags: [['A', ADRESSE]] }),
        ],
        adresse: ADRESSE,
        adresseVonId: new Map(),
    })

    assert.deepEqual(kommentare.map((k) => k.id), ['k1'])
})

test('jüngste zuletzt — chronologisch aufsteigend wie ein Gesprächsverlauf', () => {
    const kommentare = artikelKommentare({
        ereignisse: [
            ev({ id: 'spaet', kind: 1111, created_at: 300, tags: [['A', ADRESSE]] }),
            ev({ id: 'frueh', kind: 1111, created_at: 100, tags: [['A', ADRESSE]] }),
            ev({ id: 'mitte', kind: 1111, created_at: 200, tags: [['A', ADRESSE]] }),
        ],
        adresse: ADRESSE,
        adresseVonId: new Map(),
    })

    assert.deepEqual(kommentare.map((k) => k.id), ['frueh', 'mitte', 'spaet'])
})

test('gleiche Sekunde → stabile Reihenfolge über die Event-Id (die Liste springt nicht)', () => {
    const gebaut = (reihenfolge: string[]) =>
        artikelKommentare({
            ereignisse: reihenfolge.map((id) => ev({ id, kind: 1111, created_at: 100, tags: [['A', ADRESSE]] })),
            adresse: ADRESSE,
            adresseVonId: new Map(),
        }).map((k) => k.id)

    // Zwei verschiedene EINGANGSreihenfolgen, ein Ergebnis: sonst wechselte die Liste
    // bei jedem Emit die Reihenfolge, weil `repository.query` keine zusagt.
    assert.deepEqual(gebaut(['bbb', 'aaa']), ['aaa', 'bbb'])
    assert.deepEqual(gebaut(['aaa', 'bbb']), ['aaa', 'bbb'])
})

test('Inhalt und Autor werden unverändert durchgereicht', () => {
    const [k] = artikelKommentare({
        ereignisse: [ev({ id: 'k1', kind: 1111, pubkey: 'leser', content: 'Guter Text!', created_at: 42, tags: [['A', ADRESSE]] })],
        adresse: ADRESSE,
        adresseVonId: new Map(),
    })

    assert.deepEqual(k, { id: 'k1', pubkey: 'leser', content: 'Guter Text!', createdAt: 42 })
})

// ── eigeneReaktion ─────────────────────────────────────────────────────────────────

test('ohne angemeldeten Pubkey gibt es keine eigene Reaktion', () => {
    // `''` darf nicht mit einem leeren Autorfeld zusammenfallen — ein Vergleich, der nur
    // zufällig nichts trifft, ist kein Riegel.
    assert.equal(
        eigeneReaktion({
            ereignisse: [ev({ id: 'r1', kind: 7, pubkey: '', tags: [['a', ADRESSE]] })],
            adresse: ADRESSE,
            adresseVonId: new Map(),
            meinPubkey: '',
        }),
        null,
    )
})

test('die eigene Reaktion wird gefunden, die fremde nicht', () => {
    const meine = eigeneReaktion({
        ereignisse: [
            ev({ id: 'fremd', kind: 7, pubkey: 'jemand', content: '+', tags: [['a', ADRESSE]] }),
            ev({ id: 'meine', kind: 7, pubkey: 'ich', content: '+', tags: [['a', ADRESSE]] }),
        ],
        adresse: ADRESSE,
        adresseVonId: new Map(),
        meinPubkey: 'ich',
    })

    assert.deepEqual(meine, { id: 'meine', content: '+' })
})

test('eine eigene Reaktion an einem FREMDEN Artikel zählt hier nicht', () => {
    assert.equal(
        eigeneReaktion({
            ereignisse: [ev({ id: 'r1', kind: 7, pubkey: 'ich', tags: [['a', FREMD]] })],
            adresse: ADRESSE,
            adresseVonId: new Map(),
            meinPubkey: 'ich',
        }),
        null,
    )
})

test('bei zwei eigenen Reaktionen gewinnt die JÜNGSTE — der Toggle nimmt die aktuelle zurück', () => {
    const meine = eigeneReaktion({
        ereignisse: [
            ev({ id: 'alt', kind: 7, pubkey: 'ich', created_at: 100, tags: [['a', ADRESSE]] }),
            ev({ id: 'neu', kind: 7, pubkey: 'ich', created_at: 200, tags: [['a', ADRESSE]] }),
        ],
        adresse: ADRESSE,
        adresseVonId: new Map(),
        meinPubkey: 'ich',
    })

    assert.equal(meine?.id, 'neu')
})

// ── kommentarSperre ────────────────────────────────────────────────────────────────

const sperre = (teil: Partial<Parameters<typeof kommentarSperre>[0]>) =>
    kommentarSperre({ entwurf: 'Text', angemeldet: true, laeuft: false, ...teil })

test('ein gültiger Entwurf ist nicht gesperrt', () => {
    assert.equal(sperre({}), '')
})

test('ein laufender Vorgang schlägt alles andere — kein zweiter Publish', () => {
    assert.equal(sperre({ laeuft: true, entwurf: '', angemeldet: false }), 'laeuft')
})

test('abgemeldet ist ein eigener Grund, kein „leer"', () => {
    assert.equal(sperre({ angemeldet: false }), 'abgemeldet')
})

test('ein Entwurf aus Leerzeichen und Umbrüchen ist LEER', () => {
    // Der Relay nähme ihn klaglos an, und er stünde danach für immer da.
    assert.equal(sperre({ entwurf: '   \n\t  ' }), 'leer')
})

test('genau an der Grenze ist noch erlaubt, ein Zeichen darüber nicht', () => {
    assert.equal(sperre({ entwurf: 'x'.repeat(KOMMENTAR_MAX_ZEICHEN) }), '')
    assert.equal(sperre({ entwurf: 'x'.repeat(KOMMENTAR_MAX_ZEICHEN + 1) }), 'zu-lang')
})

// ── Das Schreibziel — ein Invariant, den KEIN Verhaltenstest fangen kann ──────────────
//
// `ARTIKEL_SCHREIB_RELAY()` liefert den Board und ausdrücklich nicht die Metrik-Relais.
// Der Grund steht bei der Funktion: beim Lesen hält `darfAuthBekommen` deren
// NIP-42-Challenges zurück, damit der Pubkey des Nutzers nicht hinausgeht. Ein signiertes
// kind 7 an `nos.lol` übergäbe genau das — der Riegel beim Lesen und diese eine Zeile beim
// Schreiben tragen dieselbe Zusage gemeinsam.
//
// **Warum als Quelltext-Sonde und nicht als Verhaltenstest:** `tests/e2e/support/serverEnv.ts`
// setzt `NOSTR_BOARD_URL` und `NOSTR_ARTICLE_METRIC_RELAYS` auf DIESELBE Loopback-Adresse.
// Eine Mutation, die das Schreibziel auf ein Metrik-Relay legt, schriebe im E2E an dieselbe
// URL — und die ganze Suite bliebe grün. Der gefährlichere Ausfall ist der unsichtbare;
// dass `''` (Mutation M7) drei E2E-Fälle rot macht, ist der harmlosere.
//
// Dieselbe Bauform wie der `shouldAuth`-Strukturtest in `authPolicyScope.test.ts`, und aus
// demselben Grund: `longformFeed.ts` ist unter `node --test` nicht ladbar (welshman-Stores).
const feedQuelle = (): string => {
    const quelle = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'longformFeed.ts'), 'utf8')
    // Fail-closed: eine leere oder falsche Datei bestünde jedes `match`.
    assert.ok(quelle.length > 5_000, `longformFeed.ts wirkt zu kurz (${quelle.length} Zeichen) — liest der Test die richtige Datei?`)
    return quelle.replace(/\s+/g, ' ')
}

test('das Schreibziel ist der BOARD — nicht die Metrik-Relais, aus denen P6 liest', () => {
    const quelle = feedQuelle()

    // Auf die ANWEISUNG gemustert, nicht auf den Namen: ein `indexOf('BOARD_URL')` fände
    // ihn auch im Docblock darüber, der ausführlich erklärt, warum es der Board ist.
    assert.match(
        quelle,
        /export const ARTIKEL_SCHREIB_RELAY = \(\): string => BOARD_URL/,
        'ARTIKEL_SCHREIB_RELAY liefert nicht mehr BOARD_URL — ein signiertes Ereignis an einen '
            + 'Metrik-Relay übergibt den Pubkey, den darfAuthBekommen beim LESEN zurückhält. '
            + 'Herleitung im Docblock der Funktion.',
    )

    // Die Gegenrichtung: die Metrik-Liste darf im Schreibziel nicht vorkommen. Fängt auch
    // eine Erweiterung der Form `[BOARD_URL, ...SEKUNDAER_RELAYS]`.
    //
    // **Der Schnitt endet am Semikolon oder am nächsten `export`, NICHT an `[^\n]*`.**
    // `feedQuelle()` faltet den Weißraum, es gibt danach gar keine Zeilenumbrüche mehr —
    // `[^\n]*` fing deshalb den gesamten Dateirest (gemessen: 3 539 von 47 938 Zeichen).
    // Die gemeinte Mutation hätte es weiter gefangen, aber jeder künftige Docblock in
    // diesem Rest, der `damus` oder `METRIK` nennt, hätte die Sonde grundlos rot gemacht —
    // und ein Test, der grundlos rot wird, wird entschärft statt gelesen.
    const anweisung = /export const ARTIKEL_SCHREIB_RELAY = \([^)]*\)[^=]*=> ([^;]*?)(?: \/\*\*|export |$)/.exec(feedQuelle())
    assert.ok(anweisung, 'ARTIKEL_SCHREIB_RELAY ist nicht mehr auffindbar — diese Sonde misst dann nichts')
    // Schranke gegen einen erneut zu weiten Schnitt: die Anweisung ist eine Zeile Code.
    assert.ok(
        anweisung[1].length < 200,
        `der Schnitt umfasst ${anweisung[1].length} Zeichen statt einer Anweisung — er ist zu weit und misst dann den halben Docblock mit`,
    )
    assert.doesNotMatch(
        anweisung[1],
        /SEKUNDAER_RELAYS|METRIK|nos\.lol|damus/,
        `das Schreibziel nennt einen Metrik-Relay: ${anweisung[1]}`,
    )
})

test('alle drei Schreibfunktionen holen ihr Ziel aus ARTIKEL_SCHREIB_RELAY', () => {
    const quelle = feedQuelle()

    // Ohne diese Zeile könnte eine der drei ihr Ziel künftig woanders herholen, während der
    // Test oben weiter grün bliebe — die Funktion wäre dann richtig und ungenutzt.
    const treffer = quelle.match(/const url = ARTIKEL_SCHREIB_RELAY\(\)/g) ?? []
    assert.equal(
        treffer.length,
        3,
        `${treffer.length} statt 3 Schreibfunktionen holen ihr Ziel aus ARTIKEL_SCHREIB_RELAY — `
            + 'reagiereAufArtikel, nimmArtikelReaktionZurueck und kommentiereArtikel müssen alle drei dort fragen.',
    )
})
