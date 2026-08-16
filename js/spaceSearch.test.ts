/**
 * Tests zu `spaceSearch.ts` (P5).
 *
 * Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/spaceSearch.test.ts
 *
 * Zwei der Fälle hier sind keine gewöhnlichen Unit-Tests, sondern Nachweise für
 * genau die zwei Behauptungen, an denen diese Phase hängt. Beide sind so geführt,
 * dass sie die ECHTE Bibliothek befragen, wo das ohne Browser möglich ist:
 *
 *  - **Stammform.** Statt nur einem Fake zu glauben, prüft
 *    `matchFilters aus @welshman/util verwirft den Stammform-Treffer wirklich`
 *    die installierte Fassung direkt: sie entscheidet über den Treffer, der
 *    danach im Fake über `onFiltered` eintrifft. Erst dieser Doppelschritt macht
 *    aus „mein Fake ruft onFiltered" ein „welshman ruft hier onFiltered".
 *  - **kind-0-Riegel.** Der Fake fängt die Request-Optionen ab; geprüft wird,
 *    dass NUR die Personen-Anfrage ein `isEventValid` mitbekommt und dass diese
 *    Funktion ein kind 0 durchlässt, aber ein gefälschtes NICHT (die
 *    Signaturprüfung bleibt scharf). Dass das Repository leer bleibt, ist von
 *    hier aus nicht beobachtbar — das trägt `buzz-space-search.spec.ts`.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { matchFilters, type TrustedEvent } from '@welshman/util'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import {
    SEARCH_CONTENT_KINDS,
    SEARCH_PROFILE_KINDS,
    buildSearchFilters,
    relaySearchEventValid,
    runSpaceSearch,
    toMessageHits,
    toPersonHits,
    type SpaceSearchRequestOptions,
} from './spaceSearch.ts'

const RELAY = 'wss://buzz.example/'

/** Ein Ereignis ohne gültige Signatur — genügt überall, wo nicht geprüft wird. */
const ev = (over: Partial<TrustedEvent> = {}): TrustedEvent => ({
    id: over.id ?? 'a'.repeat(64),
    pubkey: over.pubkey ?? 'b'.repeat(64),
    created_at: over.created_at ?? 1_700_000_000,
    kind: over.kind ?? 9,
    tags: over.tags ?? [],
    content: over.content ?? '',
    sig: over.sig,
})

/**
 * Ein `request`-Ersatz, der die Optionen mitschreibt und je Filter ausliefert,
 * was das Skript ihm sagt — getrennt nach `onEvent` und `onFiltered`.
 */
type Delivery = { onEvent?: TrustedEvent[]; onFiltered?: TrustedEvent[]; closed?: string; eose?: boolean }

const fakeRequest = (plan: (filterKinds: number[]) => Delivery) => {
    const calls: SpaceSearchRequestOptions[] = []
    const request = async (options: SpaceSearchRequestOptions): Promise<unknown> => {
        calls.push(options)
        assert.equal(options.filters.length, 1, 'je Anfrage genau EIN Filter')
        const delivery = plan(options.filters[0].kinds)
        for (const event of delivery.onEvent ?? []) {
            options.onEvent?.(event, RELAY)
        }
        for (const event of delivery.onFiltered ?? []) {
            options.onFiltered?.(event, RELAY)
        }
        if (delivery.closed !== undefined) {
            options.onClosed?.(delivery.closed, RELAY)
        }
        if (delivery.eose !== false) {
            options.onEose?.(RELAY)
        }

        return []
    }

    return { request, calls }
}

const isProfileFilter = (kinds: number[]): boolean => kinds.length === 1 && kinds[0] === 0

describe('buildSearchFilters', () => {
    test('baut genau zwei Filter, Inhalt und Personen getrennt', () => {
        const filters = buildSearchFilters({ q: 'meetup' })

        assert.equal(filters.length, 2)
        assert.deepEqual(filters[0].kinds, [...SEARCH_CONTENT_KINDS])
        assert.deepEqual(filters[1].kinds, [...SEARCH_PROFILE_KINDS])
        for (const filter of filters) {
            assert.equal(filter.search, 'meetup')
            assert.equal(filter.limit, 50)
        }
    })

    test('die Eingrenzungen hängen NUR am Inhaltsfilter', () => {
        const [content, people] = buildSearchFilters({
            q: 'meetup',
            h: 'a956ca5e-f2f7-5bed-bfe9-3313a8ee8718',
            authors: ['c'.repeat(64)],
            since: 100,
            until: 200,
        })

        assert.deepEqual(content['#h'], ['a956ca5e-f2f7-5bed-bfe9-3313a8ee8718'])
        assert.deepEqual(content.authors, ['c'.repeat(64)])
        assert.equal(content.since, 100)
        assert.equal(content.until, 200)

        // Ein Profil hat kein `h`; Buzz verwirft einen solchen Filter sogar ganz
        // (`req.rs:588-600`) — er dürfte hier gar nicht erst entstehen.
        assert.equal(people['#h'], undefined)
        assert.equal(people.authors, undefined)
        assert.equal(people.since, undefined)
        assert.equal(people.until, undefined)
    })

    test('leere und reine Leerraum-Eingabe ergeben KEINEN Filter', () => {
        assert.deepEqual(buildSearchFilters({ q: '' }), [])
        assert.deepEqual(buildSearchFilters({ q: '   \n\t ' }), [])
    })

    test('der Suchtext wird getrimmt, nicht zerlegt', () => {
        // Mehrwortsuche geht ALS GANZES an den Relay: `websearch_to_tsquery`
        // verknüpft die Lexeme selbst mit UND. Eine Zerlegung hier wäre eine
        // zweite Wahrheit über dieselbe Frage.
        assert.equal(buildSearchFilters({ q: '  bitcoin meetup  ' })[0].search, 'bitcoin meetup')
    })
})

describe('runSpaceSearch', () => {
    test('leere Anfrage löst keinen einzigen Roundtrip aus', async () => {
        const { request, calls } = fakeRequest(() => ({}))
        const outcome = await runSpaceSearch(RELAY, { q: '   ' }, undefined, { request })

        assert.equal(calls.length, 0, 'kein Request bei leerer Eingabe')
        assert.equal(outcome.ran, false)
        assert.equal(outcome.complete, false)
        assert.deepEqual(outcome.messages, [])
        assert.deepEqual(outcome.profiles, [])
    })

    test('zwei Anfragen mit je einem Filter, an genau ein Relay', async () => {
        const { request, calls } = fakeRequest(() => ({}))
        await runSpaceSearch(RELAY, { q: 'meetup' }, undefined, { request })

        assert.equal(calls.length, 2)
        for (const call of calls) {
            assert.deepEqual(call.relays, [RELAY])
            assert.equal(call.filters.length, 1)
            assert.equal(call.autoClose, true)
        }
        // Such- und Nicht-Such-Filter dürfen sich nie im selben REQ treffen —
        // hier trägt schlicht jeder Filter ein `search`.
        assert.ok(calls.every((call) => typeof call.filters[0].search === 'string'))
    })

    test('onEvent UND onFiltered fließen beide ein, Duplikate fliegen raus', async () => {
        const viaEvent = ev({ id: '1'.repeat(64), content: 'aus onEvent', created_at: 200 })
        const viaFiltered = ev({ id: '2'.repeat(64), content: 'aus onFiltered', created_at: 300 })

        const { request } = fakeRequest((kinds) =>
            isProfileFilter(kinds)
                ? {}
                : {
                      // Dasselbe Ereignis zweimal, einmal je Kanal: der Relay
                      // schickt es genau einmal, aber die Deduplizierung darf
                      // nicht davon abhängen.
                      onEvent: [viaEvent, viaEvent],
                      onFiltered: [viaFiltered, viaEvent],
                  },
        )

        const outcome = await runSpaceSearch(RELAY, { q: 'meetup' }, undefined, { request })

        assert.equal(outcome.ran, true)
        assert.equal(outcome.messages.length, 2)
        // Neueste zuerst.
        assert.deepEqual(
            outcome.messages.map((event) => event.content),
            ['aus onFiltered', 'aus onEvent'],
        )
    })

    test('kind 0 landet bei den Personen, alles andere bei den Nachrichten', async () => {
        const profile = ev({
            id: '3'.repeat(64),
            kind: 0,
            pubkey: 'd'.repeat(64),
            content: JSON.stringify({ name: 'Satoshi', nip05: 'satoshi@example.org' }),
        })
        const older = ev({ id: '4'.repeat(64), kind: 0, pubkey: 'd'.repeat(64), created_at: 1, content: '{}' })
        const message = ev({ id: '5'.repeat(64), kind: 45001, content: 'Forumsthema' })

        const { request } = fakeRequest((kinds) =>
            isProfileFilter(kinds) ? { onEvent: [older, profile] } : { onEvent: [message] },
        )
        const outcome = await runSpaceSearch(RELAY, { q: 'satoshi' }, undefined, { request })

        assert.equal(outcome.messages.length, 1)
        assert.equal(outcome.messages[0].kind, 45001)
        // Ein Profil je Pubkey, und zwar das neuere.
        assert.equal(outcome.profiles.length, 1)
        assert.equal(outcome.profiles[0].id, '3'.repeat(64))
    })

    test('eine Relay-Ablehnung wird gemeldet statt verschluckt', async () => {
        const { request } = fakeRequest((kinds) =>
            isProfileFilter(kinds) ? { eose: true } : { closed: 'restricted: not a channel member', eose: false },
        )
        const outcome = await runSpaceSearch(RELAY, { q: 'geheim' }, undefined, { request })

        assert.equal(outcome.rejected, 'restricted: not a channel member')
        // Nur eine der beiden Anfragen hat EOSE gesehen → die Runde ist NICHT
        // vollständig, und die Oberfläche darf nicht „nichts gefunden" sagen.
        assert.equal(outcome.complete, false)
    })

    test('complete erst, wenn BEIDE Anfragen EOSE gesehen haben', async () => {
        const { request } = fakeRequest(() => ({ eose: true }))
        const outcome = await runSpaceSearch(RELAY, { q: 'meetup' }, undefined, { request })

        assert.equal(outcome.complete, true)
        assert.equal(outcome.rejected, null)
    })
})

describe('Nachweis 1 — ein am Relay gültiger Treffer geht nicht verloren', () => {
    /**
     * **Der Fall ist ein anderer als in der Planvorlage, und zwar gemessen.**
     *
     * Dort stand Stemming („meetups" ↔ „meetup"). Buzz indiziert aber mit
     * `to_tsvector('simple', content)` — am laufenden Testrelay aus
     * `pg_get_expr(events.search_tsv)` ausgelesen (2026-08-17) —, und `simple`
     * stemmt nicht: `… 'meetup' … @@ websearch_to_tsquery('simple','meetups')`
     * ist dort `false`. Ein Stammform-Treffer entsteht bei Buzz also gar nicht,
     * und ein Test darauf wäre grün, ohne je etwas Reales zu berühren.
     *
     * Der Riss liegt bei der QUERY-Sprache: `websearch_to_tsquery` versteht
     * `or`, `matchFilter` nicht. Am Relay (`ws://localhost:3001`, 2026-08-17)
     * nachgemessen: `--search 'kupferzwerg or zwergpinguin'` liefert das
     * Ereignis mit dem Inhalt „Zwergpinguin am See" — obwohl „kupferzwerg"
     * darin nicht vorkommt. Genau diesen Treffer verwirft `matchFilter`, und
     * genau dieses Paar steht unten.
     */
    const query = 'kupferzwerg or zwergpinguin'
    const hit = ev({ id: '6'.repeat(64), content: 'Zwergpinguin am See' })

    test('matchFilters aus @welshman/util verwirft den Relay-Treffer wirklich', () => {
        const [contentFilter] = buildSearchFilters({ q: query })

        // Das ist die installierte Bibliothek, nicht meine Nachbildung: sie sagt
        // „passt nicht" — und genau deshalb ruft `requestOne` an dieser Stelle
        // `onFiltered` statt `onEvent` (`request.js:44-47`).
        assert.equal(
            matchFilters([contentFilter as never], hit),
            false,
            'wäre das true, bräuchte es die onFiltered-Auswertung nicht',
        )

        // Gegenprobe, damit der Test nicht aus dem falschen Grund grün ist: mit
        // dem zweiten Wort ALLEIN kommt derselbe Treffer durch. Der Fehlschlag
        // oben liegt an der Auswertung „nur das erste Wort", nicht daran, dass
        // `search` grundsätzlich nie greift.
        const [literal] = buildSearchFilters({ q: 'zwergpinguin' })
        assert.equal(matchFilters([literal as never], hit), true)
    })

    test('runSpaceSearch behält ihn trotzdem', async () => {
        const { request } = fakeRequest((kinds) => (isProfileFilter(kinds) ? {} : { onFiltered: [hit] }))
        const outcome = await runSpaceSearch(RELAY, { q: query }, undefined, { request })

        assert.equal(outcome.messages.length, 1)
        assert.equal(outcome.messages[0].id, hit.id)
    })

    test('und die Aufbereitung wirft ihn nicht in zweiter Instanz weg', () => {
        // `matchesAllTerms` aus `search.ts` verlangt JEDEN Begriff — „kupferzwerg"
        // und „or" stehen nicht im Text. Ein Filterschritt hier hätte denselben
        // Treffer noch einmal weggeworfen, nur eine Ebene später.
        const hits = toMessageHits([hit], query, () => 'Alice')

        assert.equal(hits.length, 1, 'kein zweiter Textabgleich über den Relay-Treffern')
        assert.equal(hits[0].text, 'Zwergpinguin am See')
        // Hervorgehoben wird, was tatsächlich im Text steht — hier „zwergpinguin".
        assert.deepEqual(
            hits[0].segments.filter((segment) => segment.hit).map((segment) => segment.text),
            ['Zwergpinguin'],
        )
    })
})

describe('Nachweis 2 — der kind-0-Riegel', () => {
    test('nur die Personen-Anfrage trägt einen eigenen isEventValid-Haken', async () => {
        const { request, calls } = fakeRequest(() => ({}))
        await runSpaceSearch(RELAY, { q: 'satoshi' }, undefined, { request })

        const content = calls.find((call) => !isProfileFilter(call.filters[0].kinds))!
        const people = calls.find((call) => isProfileFilter(call.filters[0].kinds))!

        assert.equal(
            content.isEventValid,
            undefined,
            'die Inhaltssuche behält den unveränderten netContext-Haken',
        )
        assert.equal(typeof people.isEventValid, 'function')
    })

    test('der Haken lässt ein echtes kind 0 durch — und ein gefälschtes nicht', () => {
        const secret = generateSecretKey()
        const profile = finalizeEvent(
            { kind: 0, created_at: 1_700_000_000, tags: [], content: JSON.stringify({ name: 'Satoshi' }) },
            secret,
        ) as unknown as TrustedEvent

        // Der Riegel aus `core.ts` würde hier `false` liefern (kind 0 vom
        // Workspace) — der Request-Haken liefert `true`, sonst hätte die
        // Personensuche strukturell null Treffer.
        assert.equal(relaySearchEventValid(profile), true)

        // Aber NICHT um den Preis der Signaturprüfung: ein untergeschobenes
        // Profil für einen fremden Pubkey fliegt weiterhin raus. Genau das wäre
        // mit dem wörtlich verlangten `() => true` durchgekommen.
        //
        // **Feldweise gebaut, NICHT per Spread** — und das ist kein Stil, sondern
        // die Bedingung dafür, dass dieser Test überhaupt etwas misst:
        // `nostr-tools/pure.verifyEvent` merkt sich sein Urteil unter
        // `verifiedSymbol` AM EREIGNIS und liefert es beim nächsten Aufruf
        // ungeprüft zurück. Ein `{...profile, pubkey: …}` kopiert diesen Merker
        // mit — der erste Versuch hier war deshalb grün-blind (`true !== false`,
        // gemessen).
        const forged: TrustedEvent = {
            id: profile.id,
            pubkey: 'e'.repeat(64),
            created_at: profile.created_at,
            kind: profile.kind,
            tags: profile.tags,
            content: profile.content,
            sig: profile.sig,
        }
        assert.equal(relaySearchEventValid(forged), false)
    })
})

describe('Aufbereitung', () => {
    test('Nachrichten: Kanal, Autorname und Hervorhebung', () => {
        const hits = toMessageHits(
            [ev({ content: 'Hallo Bitcoin Welt', tags: [['h', 'kanal-1']] })],
            'bitcoin',
            () => 'Grüße-Bot',
        )

        assert.equal(hits[0].h, 'kanal-1')
        assert.equal(hits[0].name, 'Grüße-Bot')
        assert.deepEqual(
            hits[0].segments.filter((segment) => segment.hit).map((segment) => segment.text),
            ['Bitcoin'],
        )
    })

    test('Personen: Name, nip05 und ein kaputtes Profil ohne Absturz', () => {
        const good = ev({
            kind: 0,
            pubkey: 'd'.repeat(64),
            content: JSON.stringify({ display_name: 'Satoshi N', nip05: 's@example.org', about: 'baut Bitcoin' }),
        })
        const broken = ev({ id: '7'.repeat(64), kind: 0, pubkey: 'f'.repeat(64), content: '{kaputt' })

        const [first, second] = toPersonHits([good, broken], 'satoshi')

        assert.equal(first.name, 'Satoshi N')
        assert.equal(first.nip05, 's@example.org')
        assert.deepEqual(
            first.nameSegments.filter((segment) => segment.hit).map((segment) => segment.text),
            ['Satoshi'],
        )
        // Ohne lesbaren Namen trägt der gekürzte Pubkey die Zeile.
        assert.equal(second.name, 'f'.repeat(12))
        assert.deepEqual(second.aboutSegments, [])
    })
})
