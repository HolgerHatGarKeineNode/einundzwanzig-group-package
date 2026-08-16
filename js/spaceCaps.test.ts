/**
 * Die Relay-Weiche mit **eingesetztem** Loader: kein Netz, kein Relay, keine echten
 * Sekunden. Geprüft wird genau das, was in der Fläche still bricht:
 *
 *   1. Der Startwert ist `'unknown'` — nicht `false`, nicht `'other'`. Wer hier
 *      zweiwertig antwortet, hat die Mount-Falle aus `spaceIsBuzz()` nachgebaut.
 *   2. Der Wert zieht nach, wenn das NIP-11-Doc eintrifft.
 *   3. Ein einzelner Fehlversuch zementiert `'unknown'` NICHT. Das ist die
 *      eigentliche Falle: `loadRelay` merkt sich die URL und liefert danach ohne
 *      erneuten Fetch, `fetchRelay` schreibt nur bei Erfolg — ohne aktive
 *      Wiederholung bliebe die Weiche für den Rest der Sitzung stehen.
 *   4. Sind alle Versuche verbraucht, steht `'other'` — ein Aufrufer kann einen
 *      sichtbaren Hinweis zeigen statt ein Skeleton ewig weiterzudrehen.
 *
 * Ausführen: node --experimental-strip-types --test packages/einundzwanzig-group/js/spaceCaps.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writable, type Readable } from 'svelte/store'
import {
    RETRY_BACKOFF_MS,
    hasWorkspace,
    makeSpaceKindStore,
    workspaceUrlFrom,
    type RelayInfoLike,
    type SpaceKind,
    type SpaceKindDeps,
} from './spaceCaps.ts'

const URL_UNTER_TEST = 'wss://buzz.einundzwanzig.space/'
const BUZZ: RelayInfoLike = { software: 'https://github.com/block/buzz' }
const ZOOID: RelayInfoLike = { software: 'https://github.com/coracle-social/zooid' }

/** Alle offenen Mikrotasks abarbeiten lassen (die Fake-Wartezeit löst sofort auf). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Fake-Loader. `script` ist die Folge der Antworten von `forceLoad`:
 * `undefined` = Fehlversuch. Ein Erfolg schreibt zusätzlich in den Doc-Store —
 * genau wie `fetchRelay` in `relaysByUrl` (`relays.js:33-38`).
 *
 * **Kein Wurf im Fehlerfall, sondern ein aufgelöstes `undefined`** — das ist das
 * gemessene Verhalten von `forceLoadRelay` (leerer `catch` in `fetchRelay`), und
 * der Test bildet es nach, statt eine bequemere Ablehnung zu erfinden.
 */
const makeFakes = (script: (RelayInfoLike | undefined)[]) => {
    const doc = writable<RelayInfoLike | undefined>(undefined)
    const loads: string[] = []
    const delays: number[] = []
    let next = 0

    const deps: SpaceKindDeps = {
        relayInfo: () => doc as Readable<RelayInfoLike | undefined>,
        forceLoad: async (url) => {
            loads.push(url)
            // **Erst einen Microtask abwarten.** Ein echter `fetchRelay` geht über HTTP
            // und kann NIE synchron antworten. Ohne dieses Yield liefe `doc.set` noch
            // innerhalb von `subscribe()` und der erste Abonnent saehe das Ergebnis,
            // ohne je 'unknown' gesehen zu haben — der Test bewiese dann eine
            // Zeitlichkeit, die es in der Fläche nicht gibt (gemessen: genau so ist
            // dieser Test beim ersten Lauf falsch gruen/rot ausgeschlagen).
            await Promise.resolve()
            const answer = script[next++]
            if (answer) {
                doc.set(answer)
            }
            return answer
        },
        delay: async (ms) => {
            delays.push(ms)
        },
    }

    return { deps, doc, loads, delays }
}

/** Alle Werte mitschreiben, die der Store ausspielt. */
const record = (store: Readable<SpaceKind>) => {
    const seen: SpaceKind[] = []
    const unsubscribe = store.subscribe((v) => seen.push(v))
    return { seen, unsubscribe, last: () => seen[seen.length - 1] }
}

// ── 1. Startwert ───────────────────────────────────────────────────────────

test('Startwert ist unknown — vor jedem Laden, synchron beim ersten Abonnenten', () => {
    const { deps, loads } = makeFakes([BUZZ])
    const { seen, unsubscribe } = record(makeSpaceKindStore(URL_UNTER_TEST, deps))

    // Der Fetch ist angestossen, aber noch nicht aufgeloest: der erste Wert, den
    // ein Abonnent sieht, MUSS 'unknown' sein und darf keine Entscheidung sein.
    assert.deepEqual(seen, ['unknown'])
    assert.deepEqual(loads, [URL_UNTER_TEST])
    unsubscribe()
})

test('ein Doc-Store, der beim Abonnieren schweigt, laesst den Startwert stehen', () => {
    // Deckt den Startwert von `readable(...)` selbst ab. Im Normalfall liefert der
    // Doc-Store synchron (Svelte-Contract) und `publish()` bestaetigt 'unknown'
    // sofort — der Startwert ist dann nicht beobachtbar, und eine Mutation an ihm
    // bliebe unbemerkt (in der Mutationsprobe zu P1 genau so passiert). Ein Store,
    // der schweigt, macht ihn sichtbar: auch dann darf hier nie 'other' stehen,
    // sonst entscheidet die Weiche ohne jede Grundlage.
    const { deps } = makeFakes([])
    const stumm: Readable<RelayInfoLike | undefined> = { subscribe: () => () => {} }
    const { seen, unsubscribe } = record(
        makeSpaceKindStore(URL_UNTER_TEST, { ...deps, relayInfo: () => stumm }),
    )

    assert.deepEqual(seen, ['unknown'])
    unsubscribe()
})

test('vor dem ersten Abonnenten laeuft nichts — kein Fetch beim blossen Ableiten', () => {
    const { deps, loads } = makeFakes([BUZZ])
    makeSpaceKindStore(URL_UNTER_TEST, deps)
    assert.deepEqual(loads, [])
})

// ── 2. Nachziehen ──────────────────────────────────────────────────────────

test('nach erfolgreichem Laden zieht der Wert auf buzz nach', async () => {
    const { deps, loads } = makeFakes([BUZZ])
    const { seen, last, unsubscribe } = record(makeSpaceKindStore(URL_UNTER_TEST, deps))

    assert.equal(seen[0], 'unknown')
    await flush()
    assert.equal(last(), 'buzz')
    assert.equal(loads.length, 1, 'ein Erfolg braucht keine Wiederholung')
    unsubscribe()
})

test('ein zooid-Relay zieht auf other nach — other ist nicht der Fehlerzustand', async () => {
    const { deps } = makeFakes([ZOOID])
    const { seen, last, unsubscribe } = record(makeSpaceKindStore(URL_UNTER_TEST, deps))

    assert.equal(seen[0], 'unknown')
    await flush()
    assert.equal(last(), 'other')
    unsubscribe()
})

test('ein Doc, das von aussen im Cache landet, zieht den Wert ebenfalls nach', async () => {
    // Kein Erfolg ueber forceLoad — das Doc kommt aus dem welshman-Cache, weil ein
    // anderes Modul dieselbe URL geladen hat. Auch dann darf die Weiche nicht stehen.
    const { deps, doc, loads } = makeFakes([undefined, undefined, undefined, undefined])
    const { last, unsubscribe } = record(makeSpaceKindStore(URL_UNTER_TEST, deps))

    await flush()
    doc.set(BUZZ)
    assert.equal(last(), 'buzz')
    const nachher = loads.length
    await flush()
    assert.equal(loads.length, nachher, 'ist das Doc da, wird nicht weiter nachgeladen')
    unsubscribe()
})

test('liegt das Doc schon vor, sieht der erste Abonnent gar kein unknown', () => {
    const { deps } = makeFakes([])
    const doc = writable<RelayInfoLike | undefined>(BUZZ)
    const { seen, unsubscribe } = record(
        makeSpaceKindStore(URL_UNTER_TEST, { ...deps, relayInfo: () => doc }),
    )

    assert.deepEqual(seen, ['buzz'])
    unsubscribe()
})

// ── 3. Wiederholung nach Fehlversuch ───────────────────────────────────────

test('ein Fehlversuch zementiert unknown NICHT — es wird erneut versucht', async () => {
    const { deps, loads, delays } = makeFakes([undefined, BUZZ])
    const { seen, last, unsubscribe } = record(makeSpaceKindStore(URL_UNTER_TEST, deps))

    assert.equal(seen[0], 'unknown')
    await flush()

    assert.equal(loads.length, 2, 'nach dem Fehlversuch folgt ein zweiter Versuch')
    assert.deepEqual(delays, [1000], 'und zwar nach der ersten Backoff-Stufe')
    assert.equal(last(), 'buzz')
    // Zwischendurch stand nie 'other': ein Fehlversuch ist kein Urteil.
    assert.ok(!seen.includes('other'), `kein voreiliges other, gesehen: ${seen.join(',')}`)
    unsubscribe()
})

test('drei Fehlversuche in Folge halten unknown und laufen die Backoff-Leiter hoch', async () => {
    const { deps, loads, delays } = makeFakes([undefined, undefined, undefined, ZOOID])
    const { last, unsubscribe } = record(makeSpaceKindStore(URL_UNTER_TEST, deps))

    await flush()
    assert.equal(loads.length, 4)
    assert.deepEqual(delays, [1000, 4000, 15000])
    assert.deepEqual(delays, [...RETRY_BACKOFF_MS], 'die Leiter ist die dokumentierte')
    assert.equal(last(), 'other')
    unsubscribe()
})

// ── 4. Versuche erschoepft ─────────────────────────────────────────────────

test('nach dem letzten Fehlversuch steht other — nicht unknown', async () => {
    const { deps, loads, delays } = makeFakes([undefined, undefined, undefined, undefined, BUZZ])
    const { last, unsubscribe } = record(makeSpaceKindStore(URL_UNTER_TEST, deps))

    await flush()

    // Ein Sofortversuch + drei Wiederholungen = vier Fetches, danach Schluss.
    assert.equal(loads.length, 4, 'kein fuenfter Versuch nach erschoepfter Leiter')
    assert.deepEqual(delays, [1000, 4000, 15000])
    assert.equal(last(), 'other', 'die Flaeche kann einen Hinweis zeigen statt ewig Skeleton')
    unsubscribe()
})

test('der Test verbrennt keine echten Sekunden — die Wartefunktion ist eingesetzt', async () => {
    const begonnen = Date.now()
    const { deps } = makeFakes([undefined, undefined, undefined, undefined])
    const { unsubscribe } = record(makeSpaceKindStore(URL_UNTER_TEST, deps))
    await flush()
    unsubscribe()

    // Echte Backoffs waeren 20 s. Grosszuegige Schranke, sie soll nur den Rueckbau
    // der Injektion fangen, nicht die Maschine bewerten.
    assert.ok(Date.now() - begonnen < 1000, `Lauf dauerte ${Date.now() - begonnen} ms`)
})

// ── Abbruch beim Abmelden ──────────────────────────────────────────────────

test('das letzte Abmelden bricht die Wiederholungsschleife ab', async () => {
    const { deps, loads } = makeFakes([undefined, undefined, undefined, undefined])
    const { unsubscribe } = record(makeSpaceKindStore(URL_UNTER_TEST, deps))

    unsubscribe()
    await flush()

    // Der Sofortversuch war schon unterwegs; danach darf nichts mehr nachkommen.
    assert.ok(loads.length <= 1, `nach dem Abmelden weitergeladen: ${loads.length} Versuche`)
})

// ── Leere URL ──────────────────────────────────────────────────────────────

test('leere URL ist entschieden (other), nicht unbekannt', () => {
    const { deps, loads } = makeFakes([BUZZ])
    const { seen, unsubscribe } = record(makeSpaceKindStore('', deps))

    assert.deepEqual(seen, ['other'])
    assert.deepEqual(loads, [], 'ohne URL wird nichts geladen')
    unsubscribe()
})

// ── Ebene 1: synchron, ohne Netz ───────────────────────────────────────────

test('workspaceUrlFrom normalisiert und behandelt „nicht konfiguriert" als leer', () => {
    assert.equal(workspaceUrlFrom(undefined), '')
    assert.equal(workspaceUrlFrom(''), '')
    assert.equal(workspaceUrlFrom('wss://buzz.einundzwanzig.space'), 'wss://buzz.einundzwanzig.space/')
})

test('hasWorkspace entscheidet synchron — ohne Konfiguration ist der Arm aus', () => {
    // Im Node-Lauf ist `__nostrWorkspace` nicht gesetzt: der Tab existiert nicht.
    // Entscheidend ist nicht der Wert, sondern dass die Antwort OHNE Netz und ohne
    // Warten fällt — genau deshalb taugt sie fuer die Existenzfrage im Mount.
    assert.equal(typeof hasWorkspace(), 'boolean')
    assert.equal(hasWorkspace(), false)
})
