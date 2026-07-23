/**
 * Der Lesestand — was gemergt, gekappt, migriert und quittiert wird.
 *
 * Vier Eigenschaften hält dieser Test fest, weil ihr Bruch nicht auffällt, sondern
 * still falsch meldet:
 *   1. Der Merge ist ein Grow-only-Max-Register (kommutativ/idempotent). Wäre er das
 *      nicht, hinge der Lesestand von der Reihenfolge ab, in der lokaler Spiegel,
 *      Zweit-Tab und (ab P6) das Relay-Event eintreffen.
 *   2. `pruneReadState` wirft nur weg, was `all` ohnehin dominiert — sonst verliert
 *      man Wasserzeichen und der Nutzer sieht Gelesenes wieder als neu.
 *   3. Raum-Lesen quittiert KEINEN Thread. Kommentare (kind 1111) erscheinen nicht im
 *      Raum-Feed, wer den Raum liest, hat sie also nicht gesehen. Wer diese Trennung
 *      später „vereinfacht", macht Antworten stumm — dieser Test hält ihn auf.
 *   4. `setRead` ist monoton. Eine rückwärts laufende Uhr darf einen gelesenen Raum
 *      nie wieder auf ungelesen ziehen.
 *
 * Ausführen: node --test packages/einundzwanzig-group/js/readState.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { get } from 'svelte/store'
import {
    ALL_KEY,
    PUBLISHED_READ_STATE_CAP,
    READ_STATE_CAP,
    READ_STATE_D,
    clearReadState,
    getBootstrapAll,
    markAllRead,
    mergeReadState,
    mergeRemoteReadState,
    migrateLegacyLastRead,
    noteBootstrapSeed,
    pruneReadState,
    publishableReadState,
    readState,
    readStateRestorePlan,
    restoreReadState,
    roomKey,
    roomWatermark,
    sanitizeReadState,
    setRead,
    snapshotReadState,
    threadKey,
    threadWatermark,
    type ReadState,
} from './readState.ts'

const URL = 'wss://group.einundzwanzig.space/'
const ROOM = 'welcome'
const ROOT = 'a'.repeat(64)

// ── Merge (Grow-only-Max) ──────────────────────────────────────────────────

test('mergeReadState nimmt pro Key den groesseren Zeitpunkt', () => {
    const merged = mergeReadState({ 'r:x|a': 100, 'r:x|b': 500 }, { 'r:x|a': 300, 't:c': 7 })
    assert.deepEqual(merged, { 'r:x|a': 300, 'r:x|b': 500, 't:c': 7 })
})

test('mergeReadState ist kommutativ, idempotent und assoziativ', () => {
    const a: ReadState = { all: 10, 'r:x|a': 100 }
    const b: ReadState = { 'r:x|a': 90, 'r:x|b': 200 }
    const c: ReadState = { all: 50, 't:z': 5 }

    assert.deepEqual(mergeReadState(a, b), mergeReadState(b, a))
    assert.deepEqual(mergeReadState(a, a), a)
    assert.deepEqual(mergeReadState(mergeReadState(a, b), a), mergeReadState(a, b))
    assert.deepEqual(mergeReadState(mergeReadState(a, b), c), mergeReadState(a, mergeReadState(b, c)))
})

test('mergeReadState laesst die Eingaben unangetastet', () => {
    const a: ReadState = { 'r:x|a': 1 }
    const b: ReadState = { 'r:x|a': 2 }
    mergeReadState(a, b)
    assert.deepEqual(a, { 'r:x|a': 1 })
    assert.deepEqual(b, { 'r:x|a': 2 })
})

// ── Prune (Dominanz + Kappung) ─────────────────────────────────────────────

test('pruneReadState wirft weg, was `all` dominiert — und behaelt `all` selbst', () => {
    const pruned = pruneReadState({
        all: 1000,
        'r:x|alt': 999, // aelter als all → dominiert
        'r:x|gleich': 1000, // exakt all → dominiert (Wasserzeichen faellt auf all zurueck)
        'r:x|neu': 1001, // juenger → traegt Information
        't:z': 2000,
    })
    assert.deepEqual(pruned, { all: 1000, 'r:x|neu': 1001, 't:z': 2000 })
})

test('pruneReadState ohne `all` verliert nur Nullwerte', () => {
    assert.deepEqual(pruneReadState({ 'r:x|a': 5, 'r:x|b': 0 }), { 'r:x|a': 5 })
})

test('pruneReadState kappt auf die juengsten `cap` Keys', () => {
    const state: ReadState = {}
    for (let i = 1; i <= 10; i++) {
        state[`r:x|${i}`] = i
    }
    const pruned = pruneReadState(state, 3)
    assert.deepEqual(pruned, { 'r:x|10': 10, 'r:x|9': 9, 'r:x|8': 8 })
})

test('pruneReadState zaehlt `all` nicht gegen das Cap und behaelt es immer', () => {
    const pruned = pruneReadState({ all: 5, 'r:x|a': 10, 'r:x|b': 20 }, 1)
    assert.deepEqual(pruned, { all: 5, 'r:x|b': 20 })
})

// ── Wasserzeichen (und ihre bewusste Nicht-Kopplung) ───────────────────────

test('Wasserzeichen fallen auf `all` zurueck, wenn kein eigener Key existiert', () => {
    const state: ReadState = { all: 700 }
    assert.equal(roomWatermark(state, URL, ROOM), 700)
    assert.equal(threadWatermark(state, ROOT), 700)
})

test('`all` dominiert einen aelteren Einzelwert, ein juengerer gewinnt gegen `all`', () => {
    assert.equal(roomWatermark({ all: 700, [roomKey(URL, ROOM)]: 100 }, URL, ROOM), 700)
    assert.equal(roomWatermark({ all: 700, [roomKey(URL, ROOM)]: 900 }, URL, ROOM), 900)
})

test('Raum-Lesen quittiert KEINEN Thread (und umgekehrt)', () => {
    const state: ReadState = { [roomKey(URL, ROOM)]: 900 }
    assert.equal(roomWatermark(state, URL, ROOM), 900)
    assert.equal(threadWatermark(state, ROOT), 0, 'Thread darf nicht vom Raum quittiert werden')

    const thread: ReadState = { [threadKey(ROOT)]: 900 }
    assert.equal(threadWatermark(thread, ROOT), 900)
    assert.equal(roomWatermark(thread, URL, ROOM), 0, 'Raum darf nicht vom Thread quittiert werden')
})

test('Raeume verschiedener Relays mit gleicher Gruppen-id sind getrennt', () => {
    const state: ReadState = { [roomKey(URL, ROOM)]: 900 }
    assert.equal(roomWatermark(state, 'wss://anderes.relay/', ROOM), 0)
})

// ── Migration der Alt-Keys ─────────────────────────────────────────────────

test('migrateLegacyLastRead trennt am LETZTEN Doppelpunkt (die URL enthaelt selbst welche)', () => {
    const migrated = migrateLegacyLastRead([[`room:lastread:${URL}:${ROOM}`, '1700000000']])
    assert.deepEqual(migrated, { [roomKey(URL, ROOM)]: 1700000000 })
})

test('migrateLegacyLastRead ignoriert fremde Keys und unbrauchbare Werte', () => {
    const migrated = migrateLegacyLastRead([
        ['pubkey', 'npub1…'],
        ['room:lastread:', '123'],
        [`room:lastread:${URL}:`, '123'],
        [`room:lastread:${URL}:kaputt`, 'keine-zahl'],
        [`room:lastread:${URL}:leer`, null],
        [`room:lastread:${URL}:null`, '0'],
        [`room:lastread:${URL}:gut`, '42'],
    ])
    assert.deepEqual(migrated, { [roomKey(URL, 'gut')]: 42 })
})

test('migrateLegacyLastRead nimmt bei Kollision den groesseren Wert (Math.max)', () => {
    const migrated = migrateLegacyLastRead([
        [`room:lastread:${URL}:${ROOM}`, '900'],
        [`room:lastread:${URL}:${ROOM}`, '100'],
    ])
    assert.deepEqual(migrated, { [roomKey(URL, ROOM)]: 900 }, 'der kleinere Wert darf nicht gewinnen')
})

test('Migration gegen bestehenden Lesestand ist konservativ: der groessere Wert bleibt', () => {
    const bestehend: ReadState = { [roomKey(URL, ROOM)]: 500, [roomKey(URL, 'anderer')]: 10 }
    const migriert = migrateLegacyLastRead([
        [`room:lastread:${URL}:${ROOM}`, '400'], // aelter als der IDB-Stand → verliert
        [`room:lastread:${URL}:anderer`, '20'], // juenger → gewinnt
    ])
    assert.deepEqual(mergeReadState(bestehend, migriert), {
        [roomKey(URL, ROOM)]: 500,
        [roomKey(URL, 'anderer')]: 20,
    })
})

// ── Fremde Karten (Zweit-Tab, spaeter kind 30078) ──────────────────────────

test('sanitizeReadState laesst nur endliche positive Zahlen durch', () => {
    assert.deepEqual(
        sanitizeReadState({
            'r:x|a': 100.7,
            'r:x|b': Number.NaN,
            'r:x|c': Number.POSITIVE_INFINITY,
            'r:x|d': -5,
            'r:x|e': '900',
            'r:x|f': null,
        }),
        { 'r:x|a': 100 },
    )
    assert.deepEqual(sanitizeReadState(null), {})
    assert.deepEqual(sanitizeReadState('nope'), {})
})

// ── Schreibpfad (Store; ohne IndexedDB, ohne Netz) ─────────────────────────

test('setRead ist monoton — eine rueckwaerts laufende Uhr entquittiert nichts', () => {
    const key = roomKey(URL, 'monoton')
    setRead(key, 1000)
    assert.equal(get(readState)[key], 1000)

    setRead(key, 400) // Uhr springt zurueck (NTP/Zeitzone/manuell gestellt)
    assert.equal(get(readState)[key], 1000, 'der aeltere Zeitpunkt darf nicht gewinnen')

    setRead(key, 1500)
    assert.equal(get(readState)[key], 1500)
})

test('setRead weist unbrauchbare Zeitpunkte ab', () => {
    const key = roomKey(URL, 'unbrauchbar')
    setRead(key, Number.NaN)
    setRead(key, 0)
    setRead(key, -1)
    assert.equal(get(readState)[key], undefined)
})

test('setRead trennt Raum- und Thread-Key sauber', () => {
    setRead(roomKey(URL, 'getrennt'), 800)
    const state = get(readState)
    assert.equal(roomWatermark(state, URL, 'getrennt'), 800)
    assert.equal(threadWatermark(state, ROOT), 0)
})

test('markAllRead setzt `all` und raeumt die dadurch dominierten Keys weg', () => {
    setRead(roomKey(URL, 'alt'), 1000)
    setRead(threadKey(ROOT), 1000)
    setRead(roomKey(URL, 'zukunft'), 9_000_000)

    markAllRead(2_000_000)

    const state = get(readState)
    assert.equal(state[ALL_KEY], 2_000_000)
    assert.equal(state[roomKey(URL, 'alt')], undefined, 'dominierter Raum-Key muss weg sein')
    assert.equal(state[threadKey(ROOT)], undefined, 'dominierter Thread-Key muss weg sein')
    assert.equal(state[roomKey(URL, 'zukunft')], 9_000_000, 'juengerer Key ueberlebt')
    assert.equal(roomWatermark(state, URL, 'alt'), 2_000_000, 'faellt korrekt auf all zurueck')
})

// ── Rückgängig (P4): der einzige Bruch der Monotonie ───────────────────────
//
// Die scharfe Stelle des Undo. Wer hier „vereinfacht" und die alten Werte per `setRead`
// zurückschreibt, baut ein Rückgängig, das nichts rückgängig macht — der Knopf reagiert,
// die Liste bleibt leer. Die drei Tests halten genau das auseinander.

test('setRead kann `all` NICHT senken — deshalb genuegt Zurueckschreiben nicht', () => {
    markAllRead(5_000_000)
    setRead(ALL_KEY, 4_000_000)
    assert.equal(get(readState)[ALL_KEY], 5_000_000, 'setRead ist monoton, der alte Wert prallt ab')
})

test('readStateRestorePlan nennt Ziel UND die zu loeschenden Keys', () => {
    const current: ReadState = { [ALL_KEY]: 900, [roomKey(URL, 'bleibt')]: 950, [roomKey(URL, 'weg')]: 980 }
    const snapshot: ReadState = { [ALL_KEY]: 100, [roomKey(URL, 'bleibt')]: 950 }

    const plan = readStateRestorePlan(current, snapshot)

    assert.deepEqual(plan.next, snapshot, 'die Momentaufnahme ist das Ziel, nicht ein Merge')
    assert.deepEqual(plan.removed, [roomKey(URL, 'weg')], 'nur was die Momentaufnahme nicht kennt')
    assert.equal(plan.next[ALL_KEY], 100, 'auch ein KLEINERES all ist das Ziel')
})

test('readStateRestorePlan putzt eine fremde/proxifizierte Momentaufnahme', () => {
    const plan = readStateRestorePlan({}, { gut: 5, kaputt: Number.NaN, negativ: -1, text: 'x' } as unknown as ReadState)
    assert.deepEqual(plan.next, { gut: 5 })
})

test('Undo nach markAllRead: restoreReadState stellt die Karte exakt wieder her', async () => {
    setRead(roomKey(URL, 'undo-raum'), 6_000_000)
    setRead(threadKey(ROOT), 6_100_000)
    const before = snapshotReadState()

    markAllRead(7_000_000)
    assert.equal(get(readState)[ALL_KEY], 7_000_000)
    assert.equal(get(readState)[roomKey(URL, 'undo-raum')], undefined, 'markAllRead raeumt dominierte Keys weg')

    await restoreReadState(before)

    assert.deepEqual(get(readState), before, 'die Karte muss wieder dieselbe sein')
    assert.equal(get(readState)[roomKey(URL, 'undo-raum')], 6_000_000, 'der weggeraeumte Key ist zurueck')
    assert.equal(get(readState)[threadKey(ROOT)], 6_100_000, 'auch der Thread-Key')
})

/**
 * Der Doppeltap auf „Alles gelesen" — nachgestellt an der echten Karte.
 *
 * Die Liste ist nach dem Quittieren NICHT leer (gelesene Zeilen bleiben 24 h stehen),
 * der Knopf steht also weiter neben der Undo-Leiste. Puffert der zweite Klick die
 * Momentaufnahme von DANACH, sind Raum- und Thread-Wasserzeichen dauerhaft weg und es
 * bleibt nur `{all}` übrig. Beide Hälften stehen hier nebeneinander: die falsche als
 * Gegenprobe, die richtige als Zusage.
 */
test('Doppeltap auf „Alles": der ERSTE Puffer holt alles zurueck, der zweite nichts', async () => {
    const RAUM1 = roomKey(URL, 'doppeltap-1')
    const RAUM2 = roomKey(URL, 'doppeltap-2')
    const THREAD = threadKey('d'.repeat(64))
    setRead(RAUM1, 10_000_000)
    setRead(THREAD, 10_000_001)
    setRead(RAUM2, 10_000_002)
    const ersterPuffer = snapshotReadState()

    markAllRead(11_000_000)
    const zweiterPuffer = snapshotReadState() // was ein zweiter Klick puffern WUERDE

    markAllRead(11_000_001)

    // Gegenprobe: der Puffer des zweiten Klicks kennt die Wasserzeichen nicht mehr.
    await restoreReadState(zweiterPuffer)
    assert.equal(get(readState)[RAUM1], undefined, 'der zweite Puffer holt NICHTS zurueck')
    assert.equal(get(readState)[THREAD], undefined)
    assert.equal(get(readState)[ALL_KEY], 11_000_000, 'uebrig bliebe nur `all`')

    // Zusage: der behaltene erste Puffer stellt den Stand von vor dem ersten Klick her.
    await restoreReadState(ersterPuffer)
    assert.deepEqual(get(readState), ersterPuffer)
    assert.equal(get(readState)[RAUM1], 10_000_000)
    assert.equal(get(readState)[THREAD], 10_000_001)
    assert.equal(get(readState)[RAUM2], 10_000_002)
})

test('snapshotReadState ist eine Kopie — spaeteres setRead veraendert sie nicht', () => {
    const snapshot = snapshotReadState()
    setRead(roomKey(URL, 'nach-dem-puffern'), 8_000_000)
    assert.equal(snapshot[roomKey(URL, 'nach-dem-puffern')], undefined)
    assert.equal(get(readState)[roomKey(URL, 'nach-dem-puffern')], 8_000_000)
})

test('das d-Tag des publizierten 30078 ist versioniert festgeschrieben', () => {
    assert.equal(READ_STATE_D, 'einundzwanzig/read-state/v1')
})

// ── P6: was das Geraet verlassen darf ──────────────────────────────────────
//
// Der Kern des Sync-Sicherheitsnetzes. Ein frisch aufgesetztes Geraet setzt `all =
// jetzt`, damit nicht der ganze Cache als ungelesen aufblitzt — publiziert, waere dieser
// erfundene Wert von einem echten „Alles gelesen" nicht unterscheidbar und quittierte
// per Grow-only-Max den Rueckstand JEDES anderen Geraets, unumkehrbar. Die vier Tests
// hier halten die eine Eigenschaft fest, an der das haengt: der Seed schweigt, die
// echte Handlung spricht.

const SEED = 5_000_000

test('publishableReadState laesst `all` weg, solange es der synthetische Startwert ist', async () => {
    await restoreReadState({})
    noteBootstrapSeed(SEED)
    setRead(ALL_KEY, SEED)
    setRead(roomKey(URL, 'seed-raum'), SEED + 10)

    const payload = publishableReadState(get(readState), getBootstrapAll())

    assert.equal(payload[ALL_KEY], undefined, 'der erfundene Startwert darf das Geraet nicht verlassen')
    assert.equal(payload[roomKey(URL, 'seed-raum')], SEED + 10, 'echte Wasserzeichen aber schon')
})

test('publishableReadState publiziert ein `all`, das NICHT der Startwert ist', () => {
    const state: ReadState = { [ALL_KEY]: SEED + 1, 'r:x|a': 7 }
    assert.deepEqual(publishableReadState(state, SEED), state, 'anderer Wert ⇒ echter Wert')
    assert.deepEqual(publishableReadState(state, null), state, 'kein Marker ⇒ nichts zu unterdruecken')
})

test('publishableReadState kopiert — die Eingabe bleibt unangetastet', () => {
    const state: ReadState = { [ALL_KEY]: SEED, 'r:x|a': 7 }
    publishableReadState(state, SEED)
    assert.equal(state[ALL_KEY], SEED, 'die lokale Karte behaelt ihr `all` (nur das Publish laesst es weg)')
})

test('publishableReadState kappt auf die juengsten Keys — `all` ausgenommen', () => {
    const state: ReadState = { [ALL_KEY]: 1 }
    for (let i = 0; i < READ_STATE_CAP; i++) {
        state[roomKey(URL, 'raum-' + i)] = 1_000 + i // je groesser i, desto juenger
    }

    const payload = publishableReadState(state, null)

    assert.equal(Object.keys(payload).length, PUBLISHED_READ_STATE_CAP + 1, '`all` kommt zum Deckel dazu')
    assert.equal(payload[ALL_KEY], 1, '`all` ueberlebt die Kappung immer')
    assert.equal(payload[roomKey(URL, 'raum-' + (READ_STATE_CAP - 1))], 1_000 + READ_STATE_CAP - 1, 'der juengste bleibt')
    assert.equal(payload[roomKey(URL, 'raum-0')], undefined, 'der aelteste faellt raus')
    assert.equal(Object.keys(state).length, READ_STATE_CAP + 1, 'die LOKALE Karte bleibt unangetastet')
})

test('publishableReadState kappt eine kleine Karte nicht', () => {
    const state: ReadState = { [ALL_KEY]: 1, 'r:x|a': 2, 't:z': 3 }
    assert.deepEqual(publishableReadState(state, null), state)
})

test('der Uebergang: geseedetes Geraet schweigt, nach „Alles gelesen" publiziert es', async () => {
    await restoreReadState({})
    noteBootstrapSeed(SEED)
    setRead(ALL_KEY, SEED)
    assert.equal(publishableReadState(get(readState), getBootstrapAll())[ALL_KEY], undefined)

    // Quittieren in DERSELBEN Sekunde wie der Seed: gleicher Zahlenwert, aber echte
    // Handlung. Ein reiner Wertvergleich wuerde das verschlucken — markAllRead laesst
    // den Marker deshalb bedingungslos fallen.
    markAllRead(SEED)

    assert.equal(getBootstrapAll(), null, 'der Marker ist gefallen')
    assert.equal(publishableReadState(get(readState), getBootstrapAll())[ALL_KEY], SEED, 'jetzt wird `all` publiziert')
})

test('der Marker faellt auch, wenn ein anderes Geraet ein hoeheres `all` schickt', async () => {
    await restoreReadState({})
    noteBootstrapSeed(SEED)
    setRead(ALL_KEY, SEED)

    mergeRemoteReadState({ [ALL_KEY]: SEED + 500 })

    assert.equal(get(readState)[ALL_KEY], SEED + 500)
    assert.equal(getBootstrapAll(), null, 'der Startwert ist ueberholt — der Marker ist hinfaellig')
    assert.equal(publishableReadState(get(readState), getBootstrapAll())[ALL_KEY], SEED + 500)
})

// ── P6: was von aussen hereinkommt ─────────────────────────────────────────

test('mergeRemoteReadState mergt grow-only — ein aelterer Fremdstand zieht nichts zurueck', async () => {
    await restoreReadState({})
    const RAUM = roomKey(URL, 'fremd')
    const THREAD = threadKey('e'.repeat(64))
    setRead(RAUM, 9_000_000)

    mergeRemoteReadState({ [RAUM]: 8_000_000, [THREAD]: 9_500_000 })

    assert.equal(get(readState)[RAUM], 9_000_000, 'der eigene, juengere Stand gewinnt')
    assert.equal(get(readState)[THREAD], 9_500_000, 'Neues kommt dazu')
})

test('ein kaputtes oder fremdes 30078 kippt nichts', async () => {
    await restoreReadState({})
    const RAUM = roomKey(URL, 'robust')
    setRead(RAUM, 9_000_000)
    const vorher = snapshotReadState()

    mergeRemoteReadState(null)
    mergeRemoteReadState('kein Objekt')
    mergeRemoteReadState({ [RAUM]: Number.NaN })
    mergeRemoteReadState({ [RAUM]: -5 })
    mergeRemoteReadState({ [RAUM]: 'morgen' })
    mergeRemoteReadState({ ['x'.repeat(300)]: 9_999_999 })

    assert.deepEqual(get(readState), vorher, 'nichts davon darf den Store erreichen')
})

test('ein empfangenes 30078 OHNE `all` erfindet keins', async () => {
    await restoreReadState({})
    const RAUM = roomKey(URL, 'ohne-all')

    mergeRemoteReadState({ [RAUM]: 9_000_000 })

    assert.equal(get(readState)[ALL_KEY], undefined, 'fehlendes `all` bleibt fehlend')
    assert.equal(roomWatermark(get(readState), URL, 'ohne-all'), 9_000_000)
    assert.equal(roomWatermark(get(readState), URL, 'nie-gelesen'), 0, 'ohne `all` faellt der Boden auf 0')
})

// Muss der LETZTE Test der Datei bleiben: clearReadState leert den geteilten Store.
test('der Bootstrap-Marker faellt beim Abmelden', async () => {
    await restoreReadState({})
    noteBootstrapSeed(SEED)
    setRead(ALL_KEY, SEED)
    assert.equal(getBootstrapAll(), SEED)

    await clearReadState()

    assert.equal(getBootstrapAll(), null, 'sonst erbt der naechste Account eine fremde Zahl')
    assert.deepEqual(get(readState), {})
})
