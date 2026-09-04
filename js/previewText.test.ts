/**
 * Der Vorschautext — die Regel selbst UND die vier Flächen, die sie anwenden.
 *
 * Diese Datei bewacht einen Fehler, der viermal dieselbe Auslassung war: `bodyWithoutQuote`
 * gab den Rohtext weiter, und niemand ersetzte darin die NIP-19-Kennungen. Sie ist deshalb
 * zweigeteilt — Teil A prüft die Regel (`previewText.ts`), Teil B prüft, dass jede der vier
 * Flächen sie tatsächlich ruft. Teil A allein hätte den ursprünglichen Fehler nicht gesehen:
 * die Funktion, die es richtig machte (`withShortRefTokens`), gab es die ganze Zeit — sie
 * wurde an vier Stellen nur nicht gerufen.
 *
 * **Alle Kennungen sind echt** (`nostr-tools/nip19`). Eine erfundene bech32-Attrappe prüft
 * nichts: das Muster hat Längenschranken, und `nip19.decode` prüft eine Prüfsumme —
 * gegen `'b'.repeat(58)` wäre jede Zusage hier wertlos (das Alphabet kennt kein `b`).
 *
 * Ausführen: node --test --experimental-strip-types packages/einundzwanzig-group/js/previewText.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as nip19 from 'nostr-tools/nip19'
import { type TrustedEvent } from '@welshman/util'
import { REF_DECODE_CAP } from './nostrEventLink.ts'
import { previewBody, readableRefTokens, type NameResolver } from './previewText.ts'
import { computeUpdates, type UpdateInput } from './updates.ts'
import { replyPreview } from './feeds.ts'
import { pinnedEntry } from './roomPins.ts'
import { roomSearchRow } from './roomSearch.ts'
import { roomKey, type ReadState } from './readState.ts'

const JS_DIR = dirname(fileURLToPath(import.meta.url))

const ME = 'a'.repeat(63) + '1'
const AUTOR = 'b'.repeat(63) + '2'
const ZITIERT = 'c'.repeat(63) + '3'
const EVENT_ID = 'd'.repeat(63) + '4'

const NPUB_ME = nip19.npubEncode(ME)
const NPROFILE_ME = nip19.nprofileEncode({ pubkey: ME, relays: ['wss://relay.example/'] })
const NEVENT = nip19.neventEncode({ id: EVENT_ID, relays: ['wss://relay.example/'], author: ZITIERT })
const NOTE = nip19.noteEncode(EVENT_ID)
const NADDR = nip19.naddrEncode({ identifier: 'mein-artikel', pubkey: AUTOR, kind: 30023, relays: ['wss://relay.example/'] })

const SATZ = 'Ja, ist wirklich beeindruckend, was hier entsteht'

/**
 * Trägt die Zeichenkette eine rohe Kennung?
 *
 * 30 Zeichen ist die Grenze, weil jede Kurzform darunter liegt: `shortenEntity` schneidet
 * bei 16, `displayPubkey` liefert 14. Ein zusammenhängender bech32-Lauf von 30 Zeichen kann
 * damit nur eine ungekürzte Kennung sein.
 */
const traegtRoheKennung = (text: string): boolean => /(?:note|npub|nevent|nprofile|naddr)1[0-9a-z]{30,}/.test(text)

const ereignis = (content: string, over: Partial<TrustedEvent> = {}): TrustedEvent =>
    ({
        id: EVENT_ID,
        kind: 9,
        created_at: 1_700_000_000,
        pubkey: AUTOR,
        tags: [['h', 'raum']],
        content,
        sig: '',
        ...over,
    }) as TrustedEvent

/** Resolver, der genau einen Namen kennt — alles andere ist ein Profil-Miss. */
const kennt = (pubkey: string, name: string): NameResolver => (pk) => (pk === pubkey ? name : '')

/** Resolver, der nie einen Namen hat. */
const kenntNichts: NameResolver = () => ''

// ═══════════════════════════════════════════════════════════════════════════════════
// A — die Regel
// ═══════════════════════════════════════════════════════════════════════════════════

describe('previewText: die Regel', () => {
    test('Erwähnung mit kind 0 → der Name, keine Kennung', () => {
        const text = readableRefTokens(`nostr:${NPUB_ME} kannst du das ansehen?`, kennt(ME, 'Alice'))
        assert.equal(text, '@Alice kannst du das ansehen?')
        assert.equal(traegtRoheKennung(text), false)
    })

    test('nprofile wird genauso aufgelöst wie npub — der Schlüssel steckt im TLV', () => {
        const text = readableRefTokens(`Hallo nostr:${NPROFILE_ME}!`, kennt(ME, 'Alice'))
        assert.equal(text, 'Hallo @Alice!')
    })

    /** DoD: die Fehlerrichtung. Kurzform, nicht leer, kein Wurf. */
    test('FEHLERRICHTUNG Profil-Miss: Kurzform statt Kennung — und niemals leer', () => {
        const text = readableRefTokens(`nostr:${NPUB_ME} kannst du das ansehen?`, kenntNichts)
        assert.equal(traegtRoheKennung(text), false)
        assert.match(text, /^npub1[0-9a-z]{11}…/, 'die gekürzte Kennung soll erkennbar bleiben')
        assert.ok(text.includes('kannst du das ansehen?'), 'der Satz bleibt vollständig stehen')
        assert.notEqual(text.trim(), '', 'eine leere Vorschau wäre eine andere Nachricht')
    })

    test('FEHLERRICHTUNG: ein Resolver, der wirft, reisst die Ableitung nicht mit', () => {
        const boeser: NameResolver = () => {
            throw new Error('Store kaputt')
        }
        const text = readableRefTokens(`nostr:${NPUB_ME} hallo`, boeser)
        assert.equal(traegtRoheKennung(text), false)
        assert.ok(text.includes('hallo'))
    })

    test('FEHLERRICHTUNG: kaputte Prüfsumme → Kurzform, kein Wurf', () => {
        const kaputt = NPUB_ME.slice(0, -1) + (NPUB_ME.endsWith('q') ? 'p' : 'q')
        const text = readableRefTokens(`nostr:${kaputt} hallo`, kennt(ME, 'Alice'))
        assert.equal(traegtRoheKennung(text), false)
        assert.ok(text.includes('hallo'))
    })

    test('Ereignis-Kennungen (nevent/note/naddr) werden gekürzt — auch naddr, das REF_TOKEN nicht kennt', () => {
        for (const kennung of [NEVENT, NOTE, NADDR]) {
            const text = readableRefTokens(`siehe nostr:${kennung} dort`, kenntNichts)
            assert.equal(traegtRoheKennung(text), false, `nicht gekürzt: ${kennung.slice(0, 12)}…`)
            assert.ok(text.startsWith('siehe ') && text.endsWith(' dort'), `Text ringsum beschädigt: ${text}`)
        }
    })

    test('Namen sind Fremdtext: ein Profil, das sich `nostr:npub…` nennt, bekommt kein Loch', () => {
        const boshaft = kennt(ME, `X\nnostr:${NPUB_ME} Y`)
        const text = readableRefTokens(`nostr:${NPUB_ME} hallo`, boshaft)
        assert.equal(traegtRoheKennung(text), false, 'der Name hat die Kennung zurückgeschmuggelt')
        assert.equal(text.includes('\n'), false, 'ein Zeilenumbruch sprengt die einzeilige Vorschau')
    })

    test(`Dekodier-Deckel: nach ${REF_DECODE_CAP} Fehlschlägen keine Namen mehr — roh bleibt trotzdem nichts`, () => {
        const kaputt = NPUB_ME.slice(0, -1) + (NPUB_ME.endsWith('q') ? 'p' : 'q')
        const viele = Array.from({ length: REF_DECODE_CAP + 1 }, () => `nostr:${kaputt}`).join(' ')
        const text = readableRefTokens(`${viele} nostr:${NPUB_ME} ende`, kennt(ME, 'Alice'))
        assert.equal(traegtRoheKennung(text), false)
        assert.equal(text.includes('@Alice'), false, 'jenseits des Deckels wird nicht mehr aufgelöst')
        assert.ok(text.endsWith('ende'))
    })

    test('Text ohne Referenz bleibt Zeichen für Zeichen stehen', () => {
        assert.equal(readableRefTokens(SATZ, kenntNichts), SATZ)
    })

    test('GRENZE, bewusst: nacktes bech32 ohne `nostr:` wird nicht angefasst (NIP-21 verlangt das Präfix)', () => {
        const text = readableRefTokens(`${NPUB_ME} hallo`, kennt(ME, 'Alice'))
        assert.ok(text.startsWith(NPUB_ME), 'die Grenze ist dieselbe wie in nostrEventLink.ts — hier festgehalten, nicht behoben')
    })
})

describe('previewText: das vorangestellte Zitat fällt ohne Bedingung', () => {
    const inhalt = `nostr:${NEVENT}\n\n${SATZ}`

    test('OHNE q-Tag (fremder Client, e-Tag) — der Fall aus der Meldung', () => {
        const ev = ereignis(inhalt, { tags: [['e', EVENT_ID, 'wss://relay.example/', 'reply'], ['h', 'raum']] })
        assert.equal(previewBody(ev, kenntNichts), SATZ)
    })

    test('MIT q-Tag (eigener Verfasser) — unverändert richtig', () => {
        const ev = ereignis(inhalt, { tags: [['q', EVENT_ID, 'wss://relay.example/', ZITIERT], ['h', 'raum']] })
        assert.equal(previewBody(ev, kenntNichts), SATZ)
    })

    test('NIE LEER: eine Nachricht, die nur aus dem Zitat besteht, behält einen Hinweis', () => {
        const ev = ereignis(`nostr:${NEVENT}`)
        const text = previewBody(ev, kenntNichts)
        assert.notEqual(text.trim(), '')
        assert.equal(traegtRoheKennung(text), false)
    })
})

// ═══════════════════════════════════════════════════════════════════════════════════
// B — die vier Flächen
// ═══════════════════════════════════════════════════════════════════════════════════

const URL = 'wss://relay.example/'
const H = 'raum'
const NOW = 1_700_000_000
const updateInput = (over: Partial<UpdateInput> = {}): UpdateInput => ({
    url: URL,
    joined: [H],
    events: [],
    comments: [],
    state: { [roomKey(URL, H)]: NOW - 3600 } as ReadState,
    me: ME,
    roomNames: { [H]: 'Allgemein' },
    profiles: new Map(),
    now: NOW,
    ...over,
})

describe('Fläche 1 — Benachrichtigungs-Liste (updates.ts, /updates)', () => {
    /**
     * Der häufigste Fall, und er braucht KEIN fehlendes Tag: `updatesMentionsPubkey` macht
     * eine Zeile genau dann zur Erwähnung, wenn der eigene npub wörtlich im Text steht.
     * Jede solche Zeile trug damit zwangsläufig mindestens 69 rohe Zeichen.
     */
    test('Erwähnungs-Zeile: der Name statt des eigenen npub', () => {
        const ev = ereignis(`nostr:${NPUB_ME} kannst du das ansehen?`, { created_at: NOW - 60 })
        const [item] = computeUpdates(updateInput({ events: [ev], profiles: new Map([[ME, { name: 'Alice' }]]) as never }))
        assert.equal(item.type, 'mention')
        assert.equal(item.snippet, '@Alice kannst du das ansehen?')
        assert.equal(traegtRoheKennung(item.snippet), false)
    })

    test('Erwähnungs-Zeile ohne kind 0: Kurzform, nicht leer', () => {
        const ev = ereignis(`nostr:${NPUB_ME} kannst du das ansehen?`, { created_at: NOW - 60 })
        const [item] = computeUpdates(updateInput({ events: [ev] }))
        assert.equal(traegtRoheKennung(item.snippet), false)
        assert.ok(item.snippet.includes('kannst du das ansehen?'))
        assert.notEqual(item.snippet.trim(), '')
    })

    test('Zitat-Antwort ohne q-Tag: der Präfix fällt, der Satz steht vorn', () => {
        const ev = ereignis(`nostr:${NEVENT}\n\n${SATZ}`, {
            created_at: NOW - 60,
            tags: [['e', EVENT_ID, URL, 'reply'], ['h', H]],
        })
        const [item] = computeUpdates(updateInput({ events: [ev] }))
        assert.equal(item.snippet, SATZ)
    })
})

describe('Fläche 2 — Antwort-Vorschau (feeds.ts replyPreview)', () => {
    test('die zitierte Nachricht erscheint ohne rohe Kennung', () => {
        const quoted = ereignis(`nostr:${NPUB_ME} schau mal`)
        const preview = replyPreview(quoted, kennt(ME, 'Alice'))
        assert.equal(preview?.text, '@Alice schau mal')
    })

    /**
     * Die Reihenfolge IST die Zusage: `snippet` kappt bei 120 Zeichen. Wird erst gekappt und
     * dann bereinigt, überlebt eine Kennung, die über die Kappung hinausragt, als
     * verstümmelter Rest — genau der Fehler, den `feeds.ts:2043` noch trägt.
     *
     * **Die Füll-Länge ist gerechnet, nicht geraten.** Der erste Entwurf nahm 100 Zeichen;
     * die Kennung begann damit bei 107 und war nach der Kappung nur noch 13 Zeichen lang —
     * unter jeder Nachweisschwelle. Der Test blieb unter der Rückbau-Mutation GRÜN und
     * bewies nichts. Mit 40 Zeichen beginnt sie bei 47, und 73 ihrer Zeichen überleben die
     * Kappung: genug, um sie als Kennung zu erkennen.
     */
    test('bereinigen VOR kürzen: eine Kennung an der 120-Zeichen-Grenze bleibt nicht stehen', () => {
        const fuell = 'a'.repeat(40)
        const roh = `${fuell} nostr:${NEVENT} ende`
        assert.ok(
            traegtRoheKennung(roh.slice(0, 120)),
            'KALIBRIERUNG: der Aufbau muss die Kennung ÜBER die Kappung hinausragen lassen — sonst prüft der Fall nichts',
        )
        const preview = replyPreview(ereignis(roh), kenntNichts)
        assert.equal(traegtRoheKennung(preview?.text ?? ''), false)
    })

    test('ohne zitierte Nachricht bleibt die Vorschau null', () => {
        assert.equal(replyPreview(undefined, kenntNichts), null)
    })
})

describe('Fläche 3 — Pin-Leiste (roomPins.ts pinnedEntry)', () => {
    test('die angepinnte Nachricht erscheint ohne rohe Kennung', () => {
        const entry = pinnedEntry('pin1', '', ereignis(`nostr:${NPUB_ME} schau mal`))
        assert.equal(traegtRoheKennung(entry.text), false)
        assert.ok(entry.text.includes('schau mal'))
    })

    test('fehlt die Nachricht noch, bleibt der Text leer — unveränderter Platzhalter-Zustand', () => {
        const entry = pinnedEntry('pin1', '', undefined)
        assert.equal(entry.text, '')
        assert.equal(entry.resolved, false)
    })
})

describe('Fläche 4 — Raum-Suche (roomSearch.ts roomSearchRow)', () => {
    test('die Trefferzeile zeigt keine rohe Kennung', () => {
        const row = roomSearchRow(ereignis(`nostr:${NPUB_ME} schau mal`))
        assert.equal(traegtRoheKennung(row.text), false)
        assert.ok(row.text.includes('schau mal'))
    })

    test('der Heuhaufen ist der Anzeigetext — das Zitat einer Antwort zählt nicht mit', () => {
        const row = roomSearchRow(
            ereignis(`nostr:${NEVENT}\n\n${SATZ}`, { tags: [['e', EVENT_ID, URL, 'reply'], ['h', H]] }),
        )
        assert.equal(row.text, SATZ)
    })
})

// ═══════════════════════════════════════════════════════════════════════════════════
// C — der Verdrahtungs-Riegel
// ═══════════════════════════════════════════════════════════════════════════════════

/**
 * **Warum ein Quelltext-Riegel neben den Verhaltenstests steht.**
 *
 * Der ursprüngliche Fehler war kein falsches Verhalten einer Funktion, sondern eine
 * FEHLENDE Aufrufstelle: `withShortRefTokens` gab es seit dem 2026-08-11, drei Flächen
 * riefen es, die vierte nicht — und kein Verhaltenstest der drei sah das. Ein Riegel, der
 * die Verdrahtung selbst prüft, sieht es.
 *
 * Er ersetzt die Verhaltenstests nicht: er weiss nicht, ob der Aufruf das Richtige tut.
 * Er weiss nur, dass er da ist.
 */
describe('Verdrahtung: alle vier Flächen rufen dieselbe Regel', () => {
    const FLAECHEN = [
        ['updates.ts', 'Benachrichtigungs-Liste'],
        ['feeds.ts', 'Antwort-Vorschau'],
        ['roomPins.ts', 'Pin-Leiste'],
        ['roomSearch.ts', 'Raum-Suche'],
    ] as const

    for (const [datei, flaeche] of FLAECHEN) {
        test(`${datei} (${flaeche}) importiert previewBody und ruft es`, () => {
            const quelle = readFileSync(join(JS_DIR, datei), 'utf8')
            assert.match(
                quelle,
                /import \{[^}]*\bpreviewBody\b[^}]*\} from '\.\/previewText\.ts'/,
                `${datei} importiert previewBody nicht mehr — die Fläche fällt auf den Rohtext zurück`,
            )
            assert.ok(
                quelle.includes('previewBody('),
                `${datei} ruft previewBody nicht mehr — die Fläche fällt auf den Rohtext zurück`,
            )
        })
    }

    test('KALIBRIERUNG: der Riegel liest wirklich Dateien — ein erfundener Name findet nichts', () => {
        const quelle = readFileSync(join(JS_DIR, 'updates.ts'), 'utf8')
        assert.equal(quelle.includes('previewBodyGibtEsNicht('), false)
        assert.ok(quelle.length > 1_000, 'updates.ts kam leer an — dann bewiese der Riegel oben nichts')
    })
})
