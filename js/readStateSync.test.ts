/**
 * Der Netz-Pfad des Lesestands (P6) — geprüft wird, was ohne Relay prüfbar ist: die
 * reinen Bausteine, an denen der Sync hängt.
 *
 * Drei Eigenschaften, deren Bruch nicht auffällt, sondern still Schaden anrichtet:
 *   1. Der Vergleich „habe ich das schon publiziert?" läuft über kanonisches JSON.
 *      Hinge er an der Einfüge-Reihenfolge, publizierte jedes Wasserzeichen dieselbe
 *      Karte erneut — eine Event-Flut an die Outbox, die niemand sieht.
 *   2. Ein fremder oder kaputter Event-Inhalt endet in einer LEEREN Karte, nie in einem
 *      Wurf und nie in vergifteten Werten (ein `NaN` überlebte jeden späteren `Math.max`).
 *   3. Publish-Erfolg ist per Relay zu lesen: ≥ 1 akzeptierendes Relay = gespeichert.
 *      Ein First-Failure-Urteil ließe einen erfolgreichen Sync wie einen Ausfall aussehen
 *      und den Stand ewig neu senden.
 *
 * Ausführen: node --test --experimental-strip-types packages/einundzwanzig-group/js/readStateSync.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Nip01Signer } from '@welshman/signer'
import {
    PUBLISH_DEBOUNCE_MS,
    parseReadStateContent,
    readStateJson,
    summarizeReadStatePublish,
    syncRelays,
} from './readStateSync.ts'
import {
    ALL_KEY,
    PUBLISHED_READ_STATE_CAP,
    READ_STATE_CAP,
    publishableReadState,
    roomKey,
    type ReadState,
} from './readState.ts'

// ── Kanonisches JSON ───────────────────────────────────────────────────────

test('readStateJson ist reihenfolge-unabhaengig', () => {
    const a: ReadState = { 'r:x|b': 2, [ALL_KEY]: 1, 't:c': 3 }
    const b: ReadState = { 't:c': 3, 'r:x|b': 2, [ALL_KEY]: 1 }
    assert.equal(readStateJson(a), readStateJson(b))
})

test('readStateJson unterscheidet echte Aenderungen', () => {
    assert.notEqual(readStateJson({ 'r:x|a': 1 }), readStateJson({ 'r:x|a': 2 }))
    assert.notEqual(readStateJson({ 'r:x|a': 1 }), readStateJson({ 'r:x|a': 1, 't:z': 1 }))
    assert.equal(readStateJson({}), '{}')
})

// ── Empfangener Inhalt ─────────────────────────────────────────────────────

test('parseReadStateContent liest eine gueltige Karte', () => {
    assert.deepEqual(parseReadStateContent(JSON.stringify({ [ALL_KEY]: 10, 'r:x|a': 20 })), { [ALL_KEY]: 10, 'r:x|a': 20 })
})

test('parseReadStateContent wirft nie — kaputt, fremd oder leer ergibt eine leere Karte', () => {
    assert.deepEqual(parseReadStateContent(undefined), {}, 'fehlgeschlagene Entschluesselung')
    assert.deepEqual(parseReadStateContent(''), {}, 'leerer Inhalt')
    assert.deepEqual(parseReadStateContent('{kein json'), {}, 'kaputtes JSON')
    assert.deepEqual(parseReadStateContent('"nur ein String"'), {}, 'JSON, aber kein Objekt')
    assert.deepEqual(parseReadStateContent('[1,2,3]'), {}, 'Array ohne brauchbare Keys')
})

test('parseReadStateContent laesst nur endliche positive Zahlen durch', () => {
    const raw = JSON.stringify({ gut: 5, null: 0, negativ: -1, text: 'x', komma: 7.9, lang: 1 })
    const parsed = parseReadStateContent(raw.replace('"lang"', `"${'x'.repeat(300)}"`))
    assert.deepEqual(parsed, { gut: 5, komma: 7 }, 'gekappt auf ganze Sekunden, Rest verworfen')
})

// ── Publish-Ergebnis ───────────────────────────────────────────────────────

test('summarizeReadStatePublish liest jedes Relay einzeln — ein Reject ist kein Ausfall', () => {
    const results = summarizeReadStatePublish({
        'wss://a/': { relay: 'wss://a/', status: 'success' },
        'wss://b/': { relay: 'wss://b/', status: 'failure', detail: 'blocked: not a member' },
        'wss://c/': { relay: 'wss://c/', status: 'timeout' },
    })

    assert.equal(results.length, 3)
    assert.deepEqual(results[0], { url: 'wss://a/', ok: true, reason: '' })
    assert.deepEqual(results[1], { url: 'wss://b/', ok: false, reason: 'blocked: not a member' })
    assert.deepEqual(results[2], { url: 'wss://c/', ok: false, reason: 'timeout' }, 'ohne Detail traegt der Status den Grund')
    assert.ok(
        results.some((r) => r.ok),
        'ein akzeptierendes Relay genuegt — genau das entscheidet, ob der Stand als publiziert gilt',
    )
})

test('summarizeReadStatePublish: kein Relay akzeptiert ⇒ nichts gilt als publiziert', () => {
    const results = summarizeReadStatePublish({ 'wss://a/': { relay: 'wss://a/', status: 'aborted' } })
    assert.equal(
        results.some((r) => r.ok),
        false,
    )
})

// ── Zielrelays (Outbox + Space) ────────────────────────────────────────────
//
// Mit Nur-Outbox waere der Sync fuer jeden Nutzer OHNE kind-10002 still inaktiv
// (`Router.FromUser()` faellt bewusst auf nichts zurueck). Der Space-Relay ist deshalb
// gleichberechtigtes Ziel — und er ist der einzige Grund, warum der Pfad im E2E
// ueberhaupt erreichbar ist: der Test-zooid laeuft auf `ws://localhost:…`, was der
// Router aus seinen eigenen Listen herausfiltert, ein explizit uebergebenes Relay aber
// nicht.

test('syncRelays nimmt Outbox UND Space', () => {
    assert.deepEqual(syncRelays(['wss://a.example/', 'wss://b.example/'], 'wss://space.example/'), [
        'wss://a.example/',
        'wss://b.example/',
        'wss://space.example/',
    ])
})

test('syncRelays dedupliziert — ein Space, der auch in der Relayliste steht, wird EINMAL angeschrieben', () => {
    assert.deepEqual(syncRelays(['wss://space.example/', 'wss://a.example/'], 'wss://space.example/'), [
        'wss://space.example/',
        'wss://a.example/',
    ])
    // Auch ueber die Normalisierung hinweg (fehlender Slash, Grossschreibung).
    assert.deepEqual(syncRelays(['wss://Space.example'], 'wss://space.example/'), ['wss://space.example/'])
})

test('syncRelays traegt jede Haelfte auch allein', () => {
    assert.deepEqual(syncRelays([], 'wss://space.example/'), ['wss://space.example/'], 'kein kind-10002 ⇒ nur Space')
    assert.deepEqual(syncRelays(['wss://a.example/'], ''), ['wss://a.example/'], 'kein Space ⇒ nur Outbox')
    assert.deepEqual(syncRelays([], ''), [], 'nichts von beidem ⇒ leer, der Aufrufer bricht fail-soft ab')
})

test('syncRelays wirft Unbrauchbares weg, laesst den lokalen Test-Relay aber durch', () => {
    assert.deepEqual(syncRelays(['', 'kein-relay', 'https://example.com/'], ''), [], 'nur ws/wss zaehlt')
    assert.deepEqual(syncRelays([], 'ws://localhost:3335/'), ['ws://localhost:3335/'], 'der E2E-zooid muss durch')
})

// ── Ereignisgroesse (gemessen, nicht geschaetzt) ───────────────────────────
//
// Die ANZAHL der Events ist unkritisch: kind 30078 ist adressierbar, zooid leitet
// `IsReplaceable() || IsAddressable()` auf `ReplaceEvent` um (`zooid/events.go:353`) —
// mit festem `d`-Tag liegt genau EIN Event pro Nutzer und Relay. Die GROESSE ist die
// Frage, und sie entscheidet ueber `PUBLISHED_READ_STATE_CAP`. Deshalb steht hier eine
// echte nip44-Verschluesselung mit einem ephemeren Schluessel und keine Schaetzung.

const RELAY = 'wss://group.einundzwanzig.space/'
const hex64 = (n: number): string => n.toString(16).padStart(64, '0')
const byteLength = (s: string): number => new TextEncoder().encode(s).length

const fullRoomMap = (count: number): ReadState => {
    const state: ReadState = { [ALL_KEY]: 1_700_000_000 }
    for (let i = 0; i < count; i++) {
        state[roomKey(RELAY, hex64(i))] = 1_700_000_000 + i
    }
    return state
}

const encryptedSize = async (state: ReadState): Promise<number> => {
    const signer = Nip01Signer.ephemeral()
    const content = await signer.nip44.encrypt(await signer.getPubkey(), readStateJson(state))
    return byteLength(content)
}

test('die UNGEDECKELTE Karte waere zu gross fuer verbreitete Relays', async () => {
    const state = fullRoomMap(READ_STATE_CAP - 1) // + `all` = READ_STATE_CAP Keys
    const klartext = byteLength(readStateJson(state))
    const content = await encryptedSize(state)

    // Gemessen 2026-07-23: 56 405 B Klartext, 76 548 B content. Der Test haelt die
    // Groessenordnung fest, nicht die exakte Zahl (Zeitstempel-Stellen wandern).
    assert.ok(klartext > 50_000, `Klartext ${klartext} B`)
    assert.ok(content > 70_000, `content ${content} B — genau deshalb wird die Projektion gedeckelt`)
    assert.ok(content > 65_536, 'ueber der strfry-Default-Obergrenze von 64 KB')
})

test('die GEDECKELTE Karte bleibt weit unter jeder Relay-Obergrenze', async () => {
    const payload = publishableReadState(fullRoomMap(READ_STATE_CAP - 1), null)
    const content = await encryptedSize(payload)

    assert.equal(Object.keys(payload).length, PUBLISHED_READ_STATE_CAP + 1)
    // Gemessen 2026-07-23: ~23 KB. 32 KB ist die Schwelle mit Luft nach oben; reisst
    // sie jemand, ist der Deckel zu hoch oder der Key-Raum breiter geworden.
    assert.ok(content < 32_768, `content ${content} B muss unter 32 KB bleiben`)
})

// ── Drossel ────────────────────────────────────────────────────────────────

test('die Publish-Drossel ist deutlich groeber als der lokale IDB-Flush (2 s)', () => {
    assert.ok(PUBLISH_DEBOUNCE_MS >= 10_000, 'sonst wird aus jedem Wasserzeichen ein Relay-Write plus Signatur')
    assert.ok(PUBLISH_DEBOUNCE_MS <= 60_000, 'zu grob hiesse: das Zweitgeraet haengt spuerbar hinterher')
})
