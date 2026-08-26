/**
 * P7/1 — der Beweis, dass ein Repo auf seiner eigenen Seite VOLLSTÄNDIG ist.
 *
 * Der Befund, gegen den hier gebaut wird: `limit` gilt in NIP-01 **je Filter**.
 * Ein `{kinds:[1621], "#a":[A,B], limit:200}` liefert also die 200 jüngsten
 * Issues von A und B **zusammen**. Die Detailseite benutzte bis zum 2026-08-26
 * genau diesen Filter — ein aktiver Nachbar konnte ihr das Budget wegnehmen,
 * ohne dass irgendetwas sichtbar wurde.
 *
 * ── Warum hier ein Relay nachgebaut wird ────────────────────────────────────
 *
 * Weil eine Aussage über Filter sonst tautologisch bleibt. „`#a` enthält genau
 * eine Adresse" prüft die Zeile, die daneben steht; sie sagt nichts darüber, ob
 * ein Repo am Ende vollständig ankommt. {@link relayAntwort} setzt deshalb die
 * beiden Regeln um, auf die es ankommt — Filter sind eine ODER-Verknüpfung,
 * `limit` schneidet **die neuesten N je Filter** ab — und misst das Ergebnis.
 * Kein Netz, kein Relay, kein welshman: 300 Ereignisse im Speicher.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeAbfragen.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    FORGE_ROOT_LIMIT,
    contentFilters,
    overviewFilters,
    repoContentFilters,
    tombstoneFilters,
    type RelayFilter,
} from './forgeAbfragen.ts'
import { GIT_ISSUE, REPO_STATE, repoAddressOf, type ForgeEvent } from './forgeModels.ts'

const OWNER_A = 'a'.repeat(64)
const OWNER_B = 'b'.repeat(64)
const RELAY_SELF = 'e'.repeat(64)
const REPO_A = repoAddressOf(OWNER_A, 'alpha')
const REPO_B = repoAddressOf(OWNER_B, 'beta')

// ── Ein Relay, so weit NIP-01 hier reicht ───────────────────────────────────

const passt = (filter: RelayFilter, event: ForgeEvent): boolean => {
    if (filter.kinds && !filter.kinds.includes(event.kind)) {
        return false
    }
    if (filter.authors && !filter.authors.includes(event.pubkey)) {
        return false
    }
    for (const [schluessel, werte] of Object.entries(filter)) {
        if (!schluessel.startsWith('#')) {
            continue
        }
        const name = schluessel.slice(1)
        const gesucht = werte as string[]
        if (!event.tags.some((tag) => tag[0] === name && gesucht.includes(tag[1] ?? ''))) {
            return false
        }
    }

    return true
}

/**
 * Was ein Relay auf diese Filter herausgäbe.
 *
 * `limit` heisst in NIP-01 „die **neuesten** N" — nicht „die ersten N in
 * Speicherreihenfolge". Genau daran hängt der Befund: verdrängt wird das
 * ÄLTERE, und bei zwei aktiven Repos ist das je zur Hälfte beides.
 */
const relayAntwort = (filters: RelayFilter[], bestand: ForgeEvent[]): ForgeEvent[] => {
    const raus = new Map<string, ForgeEvent>()
    for (const filter of filters) {
        const treffer = bestand
            .filter((event) => passt(filter, event))
            .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
            .slice(0, filter.limit ?? bestand.length)
        for (const event of treffer) {
            raus.set(event.id, event)
        }
    }

    return [...raus.values()]
}

let zaehler = 0
const issue = (address: string, created_at: number): ForgeEvent => ({
    id: String(zaehler++).padStart(64, '0'),
    pubkey: OWNER_A,
    kind: GIT_ISSUE,
    created_at,
    content: '',
    tags: [['a', address]],
})

/**
 * Zwei Repos mit je 150 Issues, **verschränkt** in der Zeit.
 *
 * Die Verschränkung ist der Kern des Falls: bei zwei gleich aktiven Repos
 * gehören die 200 neuesten Ereignisse je zur Hälfte beiden, jedes bekommt 100
 * von 150. Läge ein Repo geschlossen vor dem anderen, verlöre eines alles und
 * das andere nichts — auch ein Fehler, aber der auffälligere.
 */
const JE_REPO = 150
const bestand: ForgeEvent[] = []
for (let i = 0; i < JE_REPO; i++) {
    bestand.push(issue(REPO_A, 2 * i))
    bestand.push(issue(REPO_B, 2 * i + 1))
}

const issuesFuer = (geliefert: ForgeEvent[], address: string): number =>
    geliefert.filter((event) => event.kind === GIT_ISSUE && event.tags[0][1] === address).length

// ── Der Fall ────────────────────────────────────────────────────────────────

test('DER BEFUND: workspace-weit gescopet fehlen BEIDEN Repos ein Drittel ihrer Issues', () => {
    const geliefert = relayAntwort(contentFilters([REPO_A, REPO_B]), bestand)

    assert.equal(geliefert.length, FORGE_ROOT_LIMIT, 'ein Filter, ein Budget: 200 von 300')
    // Die literalen Zahlen stehen bewusst da. `JE_REPO - irgendwas` wäre die
    // Rechnung gegen sich selbst; 100 ist gemessen, 150 ist der Bestand.
    assert.equal(issuesFuer(geliefert, REPO_A), 100)
    assert.equal(issuesFuer(geliefert, REPO_B), 100)
    assert.equal(bestand.length, 300)
})

test('DIE REPARATUR: repo-gescopet bekommen BEIDE Repos ihre 150 vollständig', () => {
    const nurA = relayAntwort(repoContentFilters(REPO_A), bestand)
    const nurB = relayAntwort(repoContentFilters(REPO_B), bestand)

    assert.equal(issuesFuer(nurA, REPO_A), 150)
    assert.equal(issuesFuer(nurA, REPO_B), 0, 'und kein einziges fremdes Issue')
    assert.equal(issuesFuer(nurB, REPO_B), 150)
    assert.equal(issuesFuer(nurB, REPO_A), 0)
})

test('das Budget ist auch dann ganz da, wenn der Nachbar den Deckel ALLEIN sprengt', () => {
    // Der bösere Fall: ein einzelnes sehr aktives Repo. Workspace-weit
    // verdrängt es das ruhige vollständig; auf dessen eigener Seite nicht.
    const laut: ForgeEvent[] = []
    for (let i = 0; i < 400; i++) {
        laut.push(issue(REPO_B, 10_000 + i))
    }
    const alles = [...bestand.filter((event) => event.tags[0][1] === REPO_A), ...laut]

    assert.equal(issuesFuer(relayAntwort(contentFilters([REPO_A, REPO_B]), alles), REPO_A), 0)
    assert.equal(issuesFuer(relayAntwort(repoContentFilters(REPO_A), alles), REPO_A), 150)
})

// ── Die Filter selbst ───────────────────────────────────────────────────────

test('repo-gescopte Filter nennen genau EINE Adresse — in jedem einzelnen Filter', () => {
    const filters = repoContentFilters(REPO_A)

    assert.equal(filters.length, 6, 'je Kind ein eigener Filter: 1621, 1617, 1618, 1619, Status, kind 1')
    for (const filter of filters) {
        assert.deepEqual(filter['#a'], [REPO_A])
    }
    // Und die Grabsteine derselben Runde ebenso.
    assert.deepEqual(tombstoneFilters([REPO_A]), [{ kinds: [5], '#a': [REPO_A] }])
})

test('ohne Adresse wird GAR NICHT gefragt — nicht mit leerem `#a`', () => {
    // Ein `{"#a": []}` fände am Relay nichts und sähe wie ein leeres Repo aus.
    assert.deepEqual(repoContentFilters(''), [])
    assert.deepEqual(contentFilters([]), [])
})

test('die erste Runde bleibt workspace-weit — sie trägt keinen `#a`-Deckel', () => {
    // Die Detailseite braucht den Repo-BESTAND (geteilter `d`-Tag, `euc`).
    // Diese Filter dürfen deshalb NICHT repo-gescopet werden.
    const mitSelf = overviewFilters(RELAY_SELF)
    assert.equal(mitSelf.length, 3)
    assert.equal(
        mitSelf.some((filter) => filter['#a'] !== undefined),
        false,
    )
    assert.deepEqual(
        mitSelf.find((filter) => filter.kinds?.includes(REPO_STATE))?.authors,
        [RELAY_SELF],
        'der 30618-Filter nennt den Relay als Autor — sonst sieht man null Branch-Zustände',
    )
    // Ohne bekanntes `self` bleibt der `authors`-Filter weg statt leer zu sein.
    assert.equal(
        overviewFilters('').find((filter) => filter.kinds?.includes(REPO_STATE))?.authors,
        undefined,
    )
})
