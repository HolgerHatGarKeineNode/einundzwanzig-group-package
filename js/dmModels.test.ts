/**
 * Pure tests for the Buzz DM commands (41010/41011/41012, P7) — no browser, no relay,
 * no signer. Run by `npm run test:unit` (`node --test`).
 *
 * Every fixture below is the shape the RELAY produces or accepts, read off
 * `crates/buzz-relay/src/handlers/command_executor.rs`,
 * `crates/buzz-relay/src/handlers/side_effects.rs` and `crates/buzz-db/src/dm.rs`.
 * Where a value looks arbitrary it is not: the `["name","DM"]` in `dmMeta` is literally
 * what the relay stores as the channel name for every conversation, and the 30622 fixture
 * carries exactly the tag kinds the relay writes (`d`, `p`, one `h` per hidden DM).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    DM_ADD_MEMBER,
    DM_DUPLICATE,
    DM_HIDE,
    DM_MAX_OTHERS,
    DM_MAX_PARTICIPANTS,
    DM_OPEN,
    DM_VISIBILITY,
    chooseDmSpace,
    dmCounterparts,
    dmListFilter,
    dmMembershipFilter,
    dmOthers,
    dmParticipants,
    dmTitle,
    dmVisibilityFilter,
    foldHiddenDms,
    isDmChannelId,
    isDmPubkey,
    parseDmRecipient,
    parseDmResponse,
    planDmAddMember,
    planDmHide,
    planDmOpen,
} from './dmModels.ts'
import type { SpaceKind } from './spaceCaps.ts'

/** 64 lowercase hex, one per letter so the fixtures read at a glance. */
const pk = (c: string): string => c.repeat(64)

const ME = pk('1')
const ALICE = pk('a')
const BOB = pk('b')
const CAROL = pk('c')

/** A channel id in the shape `Uuid::new_v4()` produces. */
const H = '3f1c5b6a-9d2e-4c7b-8a10-6e5d4c3b2a19'
const H2 = '00000000-1111-2222-3333-444444444444'

const RELAY = pk('f')

const ctx = (spaceKind: SpaceKind) => ({ spaceKind })

// ── The write gate ──────────────────────────────────────────────────────────────

test('GATE: nur ein Buzz-Space nimmt die drei Kommandos an', () => {
    assert.notEqual(planDmOpen([ALICE], ME, ctx('buzz')), null)
    assert.equal(planDmOpen([ALICE], ME, ctx('other')), null, 'zooid: kein 41010')
    assert.equal(planDmOpen([ALICE], ME, ctx('unknown')), null, 'NIP-11 unterwegs: fail-closed')

    assert.notEqual(planDmAddMember(H, [BOB], [ME, ALICE], ME, ctx('buzz')), null)
    assert.equal(planDmAddMember(H, [BOB], [ME, ALICE], ME, ctx('other')), null)
    assert.equal(planDmAddMember(H, [BOB], [ME, ALICE], ME, ctx('unknown')), null)

    assert.notEqual(planDmHide(H, ctx('buzz')), null)
    assert.equal(planDmHide(H, ctx('other')), null)
    assert.equal(planDmHide(H, ctx('unknown')), null)
})

// ── Welcher Space eine NEUE Unterhaltung trägt ─────────────────────────────────

const HOME = 'wss://zooid.test.invalid/'
const WORK = 'wss://buzz.test.invalid/'

test('WAHL: der Workspace trägt die Unterhaltung, wenn der Space in der Ansicht es nicht kann', () => {
    // Genau der Aufbau, an dem die Fläche hing: zooid daheim, Buzz als Workspace. Vor
    // `chooseDmSpace` fragte der Store nur den ersten und bekam „nein" — auf `/spaces`
    // dauerhaft, weil dessen `init()` den ephemeren Space unbedingt zurücksetzt.
    assert.deepEqual(
        chooseDmSpace([{ url: HOME, spaceKind: 'other' }, { url: WORK, spaceKind: 'buzz' }]),
        { url: WORK, support: 'buzz' },
    )
})

test('WAHL: der Space in der Ansicht hat Vorrang — ein Buzz-Heim-Space verhält sich unverändert', () => {
    // Die Reihenfolge ist die Präferenz, und der Aufrufer stellt den Space in der Ansicht
    // nach vorn. Fiele diese Zusage, liefe auf einem Buzz-Heim-Space plötzlich jede neue
    // Unterhaltung auf den Workspace — eine stille Umleitung bestehender Installationen.
    assert.deepEqual(
        chooseDmSpace([{ url: HOME, spaceKind: 'buzz' }, { url: WORK, spaceKind: 'buzz' }]),
        { url: HOME, support: 'buzz' },
    )
})

test('WAHL: kann keiner es, gibt es kein Ziel — und das ist ein entschiedenes Nein', () => {
    assert.deepEqual(
        chooseDmSpace([{ url: HOME, spaceKind: 'other' }, { url: WORK, spaceKind: 'other' }]),
        { url: '', support: 'other' },
    )
    // Keine Kandidaten ist ebenfalls entschieden: es gibt nichts, worauf man warten
    // könnte. Dieselbe Richtung wie `makeSpaceKindStore` bei leerer URL.
    assert.deepEqual(chooseDmSpace([]), { url: '', support: 'other' })
    assert.deepEqual(chooseDmSpace([{ url: '', spaceKind: 'unknown' }]), { url: '', support: 'other' })
})

test('WAHL: `unknown` wird NICHT zu `other` eingeebnet — auch nicht neben einem entschiedenen Nein', () => {
    // DAS ist die Zeile, die die Dreiwertigkeit trägt. Ein `some(kind === "unknown")` ist
    // leicht zu einem `every(kind === "other")` zu vereinfachen, und dann meldete die
    // Fläche einem Nutzer auf einem langsamen Relay ein Nein, das niemand festgestellt
    // hat. Kleene-Oder: falsch ∨ unbestimmt ist unbestimmt, nicht falsch.
    assert.deepEqual(
        chooseDmSpace([{ url: HOME, spaceKind: 'other' }, { url: WORK, spaceKind: 'unknown' }]),
        { url: '', support: 'unknown' },
    )
    assert.deepEqual(
        chooseDmSpace([{ url: HOME, spaceKind: 'unknown' }, { url: WORK, spaceKind: 'unknown' }]),
        { url: '', support: 'unknown' },
    )
})

test('WAHL: ein entschiedenes Ja schlägt ein offenes Doc — wahr ∨ unbestimmt ist wahr', () => {
    // Die Gegenrichtung derselben Regel: wer schon einen tragfähigen Relay hat, wartet
    // nicht auf den zweiten. Sonst bliebe der Knopf aus, solange irgendein Space schweigt.
    assert.deepEqual(
        chooseDmSpace([{ url: HOME, spaceKind: 'unknown' }, { url: WORK, spaceKind: 'buzz' }]),
        { url: WORK, support: 'buzz' },
    )
})

test('WAHL: Ziel und Auskunft können nicht auseinanderlaufen — über den ganzen Zustandsraum', () => {
    // Die Zusage, an der die Fläche hängt: `support === "buzz"` genau dann, wenn es ein
    // Ziel gibt. Wäre das eine Richtung verletzt, gäbe es entweder einen Knopf ohne
    // Relay (die Zusage bricht beim Schreiben) oder ein Ziel ohne Knopf (tote Fläche).
    // Deshalb ALLE 3×3 Kombinationen zweier Spaces, nicht drei Beispiele.
    const arten: SpaceKind[] = ['unknown', 'buzz', 'other']
    for (const a of arten) {
        for (const b of arten) {
            const choice = chooseDmSpace([{ url: HOME, spaceKind: a }, { url: WORK, spaceKind: b }])
            assert.equal(
                choice.support === 'buzz',
                choice.url !== '',
                `${a}/${b}: Ziel und Auskunft widersprechen sich`,
            )
            assert.equal(
                planDmOpen([ALICE], ME, ctx(choice.support)) !== null,
                choice.url !== '',
                `${a}/${b}: der Riegel und die Wahl sind verschiedener Meinung`,
            )
        }
    }
})

test('WAHL: ein Ziel kommt NUR heraus, wenn `mayWriteKind` es für 41010 durchlässt', () => {
    // Der Riegel steht nicht neben der Wahl, er IST sie: jedes zurückgegebene Ziel muss
    // dieselbe Prüfung bestehen, die `planDmOpen` gleich noch einmal stellt.
    for (const kind of ['other', 'unknown'] as SpaceKind[]) {
        const choice = chooseDmSpace([{ url: HOME, spaceKind: kind }])
        assert.equal(choice.url, '')
        assert.equal(planDmOpen([ALICE], ME, ctx(choice.support)), null)
    }
    const ja = chooseDmSpace([{ url: WORK, spaceKind: 'buzz' }])
    assert.equal(ja.url, WORK)
    assert.notEqual(planDmOpen([ALICE], ME, ctx(ja.support)), null, 'Gegenprobe: mit Ziel gibt es einen Körper')
})

test('GATE: der Riegel IST der Rückgabewert — es gibt keinen zweiten Weg zum Körper', () => {
    // Die drei Planer sind die einzigen Stellen, an denen ein 41010/41011/41012 entsteht.
    // Wer nicht fragt, hat nichts zu signieren — dieselbe Bauform wie `planReminder`,
    // `planPresence`, `planForumVote`, `planTimeout` und `planBookmarkWrite`.
    for (const spaceKind of ['other', 'unknown'] as SpaceKind[]) {
        assert.equal(planDmOpen([ALICE, BOB], ME, ctx(spaceKind)), null)
        assert.equal(planDmAddMember(H, [CAROL], [ME, ALICE], ME, ctx(spaceKind)), null)
        assert.equal(planDmHide(H, ctx(spaceKind)), null)
    }
})

// ── 41010 DM_OPEN ───────────────────────────────────────────────────────────────

test('41010: ein `p`-Tag je anderem Teilnehmer, kein `h`, kein `d`, kein Inhalt', () => {
    const plan = planDmOpen([ALICE, BOB], ME, ctx('buzz'))

    assert.equal(plan?.kind, DM_OPEN)
    assert.deepEqual(plan?.tags, [['p', ALICE], ['p', BOB]])
    // Kein `h`: das Kommando legt den Kanal ERST an, es gibt noch keinen.
    assert.equal(plan?.tags.some((tag) => tag[0] === 'h'), false)
    // Kein `d`: `persist_command_event` verzweigt auf die ANWESENHEIT eines `d`-Tags,
    // nicht auf den Kind, und nimmt dann den NIP-33-Koordinatenpfad. Der SDK-Erzeuger
    // `build_dm_open` setzt keins — `buzz-cli` schon, und genau das wird hier nicht
    // nachgebaut.
    assert.equal(plan?.tags.some((tag) => tag[0] === 'd'), false)
})

test('41010: der eigene Schlüssel im Feld kostet keinen Platz', () => {
    // Der Relay faltet Duplikate selbst (`command_executor.rs:348-353`) — aber ERST
    // nachdem er die `p`-Tags gegen die Acht gezählt hat. Wir nehmen ihn deshalb vorher
    // heraus, statt dem Nutzer einen Platz dafür zu berechnen.
    const plan = planDmOpen([ME, ALICE, ME], ME, ctx('buzz'))

    assert.deepEqual(plan?.tags, [['p', ALICE]])
})

test('41010: 1 bis 8 andere — darunter und darüber gibt es keinen Körper', () => {
    // Ziffern 2..9 — bewusst nicht bei 1 angefangen: `ME` ist `pk('1')`, und ein
    // eigener Schlüssel in der Liste würde still herausfallen und den Fall entschärfen.
    const acht = Array.from({ length: DM_MAX_OTHERS }, (_, i) => pk((i + 2).toString(16)))
    assert.equal(planDmOpen(acht, ME, ctx('buzz'))?.tags.length, DM_MAX_OTHERS)

    const neun = [...acht, pk('a')]
    assert.equal(planDmOpen(neun, ME, ctx('buzz')), null, '9 andere = 10 Teilnehmer')
    assert.equal(planDmOpen([], ME, ctx('buzz')), null, 'niemand')
    assert.equal(planDmOpen([ME], ME, ctx('buzz')), null, 'nur ich selbst')
    assert.equal(planDmOpen(['keinhex'], ME, ctx('buzz')), null, 'kein Pubkey')
})

test('41010: Groß-/Kleinschreibung und Duplikate fallen zusammen, die Reihenfolge bleibt', () => {
    const plan = planDmOpen([ALICE.toUpperCase(), BOB, ALICE], ME, ctx('buzz'))

    assert.deepEqual(plan?.tags, [['p', ALICE], ['p', BOB]])
})

// ── 41011 DM_ADD_MEMBER ─────────────────────────────────────────────────────────

test('41011: `h` zuerst, dann die NEUEN — die bestehenden werden nicht wiederholt', () => {
    const plan = planDmAddMember(H, [ALICE, CAROL], [ME, ALICE], ME, ctx('buzz'))

    assert.equal(plan?.kind, DM_ADD_MEMBER)
    assert.deepEqual(plan?.tags, [['h', H], ['p', CAROL]])
})

test('41011: wer nichts hinzufügt, bekommt keinen Körper', () => {
    // Der Relay beantwortete das mit demselben Kanal und `created: false` — die Fläche
    // müsste dann eine „neue Unterhaltung" melden, die keine ist.
    assert.equal(planDmAddMember(H, [ALICE], [ME, ALICE], ME, ctx('buzz')), null)
    assert.equal(planDmAddMember(H, [ME], [ME, ALICE], ME, ctx('buzz')), null, 'ich bin schon drin')
    assert.equal(planDmAddMember(H, [], [ME, ALICE], ME, ctx('buzz')), null)
})

test('41011: die Neun gilt für die VEREINIGUNG, nicht für die neuen allein', () => {
    const acht = Array.from({ length: 8 }, (_, i) => pk((i + 2).toString(16)))
    const voll = [ME, ...acht] // 9 Teilnehmer — das Maximum
    assert.equal(voll.length, DM_MAX_PARTICIPANTS)
    assert.equal(planDmAddMember(H, [CAROL], voll, ME, ctx('buzz')), null, '10 wäre einer zu viel')

    const acht_minus = [ME, ...acht.slice(0, 7)]
    assert.notEqual(planDmAddMember(H, [CAROL], acht_minus, ME, ctx('buzz')), null, 'genau 9 geht')
})

test('41011/41012: ein `h`, das der Relay nicht parsen würde, kommt gar nicht erst zustande', () => {
    // `Uuid::parse_str` ist die Hürde am Relay (`command_executor.rs:462`, `:625`); der
    // Fehler `invalid: bad channel_id format` käme NACH dem Signatur-Prompt.
    for (const bad of ['', 'nicht-uuid', H.replace(/-/g, ''), `${H}x`]) {
        assert.equal(planDmAddMember(bad, [ALICE], [ME], ME, ctx('buzz')), null, `add: ${bad}`)
        assert.equal(planDmHide(bad, ctx('buzz')), null, `hide: ${bad}`)
    }
})

// ── 41012 DM_HIDE ───────────────────────────────────────────────────────────────

test('41012: genau ein `h` und sonst nichts', () => {
    const plan = planDmHide(H, ctx('buzz'))

    assert.equal(plan?.kind, DM_HIDE)
    assert.deepEqual(plan?.tags, [['h', H]])
})

// ── Die Antwort im OK-Message-Feld ──────────────────────────────────────────────

test('OK-Feld: `response:` mit channel_id und created — der Normalfall von 41010', () => {
    const parsed = parseDmResponse(`response:{"channel_id":"${H}","created":true}`)

    assert.deepEqual(parsed, { channelId: H, created: true })
    assert.deepEqual(parseDmResponse(`response:{"channel_id":"${H}","created":false}`), {
        channelId: H,
        created: false,
    })
})

test('OK-Feld: 41011 antwortet OHNE `created` — das ist `null`, nicht `false`', () => {
    // `handle_dm_add_member` baut `json!({"channel_id": …})` ohne zweites Feld
    // (`command_executor.rs:576-583`). Ein `false` an dieser Stelle behauptete, der Relay
    // habe den Kanal wiedergefunden — er hat dazu nichts gesagt.
    assert.deepEqual(parseDmResponse(`response:{"channel_id":"${H}"}`), { channelId: H, created: null })
})

test('OK-Feld: alles ohne verwertbare channel_id ist `null` — auch der Doppel-Durchlauf', () => {
    assert.equal(parseDmResponse(DM_DUPLICATE), null, 'duplicate: das Kommando lief nie')
    assert.equal(parseDmResponse('{}'), null, 'die Antwort von 41012')
    assert.equal(parseDmResponse(''), null)
    assert.equal(parseDmResponse(undefined), null)
    assert.equal(parseDmResponse('response:kein json'), null)
    assert.equal(parseDmResponse('response:{"channel_id":"nicht-uuid"}'), null)
    assert.equal(parseDmResponse('response:{"channel_id":42}'), null)
    assert.equal(parseDmResponse('response:null'), null)
    assert.equal(parseDmResponse(`{"channel_id":"${H}"}`), null, 'ohne das Präfix ist es keine Antwort')
})

test('OK-Feld: führende Leerzeichen ändern nichts — das Frame kommt vom Relay, nicht von uns', () => {
    assert.deepEqual(parseDmResponse(`  response:{"channel_id":"${H}","created":true}  `), {
        channelId: H,
        created: true,
    })
})

// ── Die ausgeblendeten Unterhaltungen (30622) ───────────────────────────────────

const visibility = (over: Partial<{ pubkey: string; created_at: number; tags: string[][]; id: string }> = {}) => ({
    kind: DM_VISIBILITY,
    pubkey: RELAY,
    created_at: 1_000,
    id: 'e1',
    tags: [['d', ME], ['p', ME], ['h', H]],
    ...over,
})

test('30622: die Form, die der Relay wirklich schreibt', () => {
    assert.deepEqual([...foldHiddenDms([visibility()], RELAY, ME)], [H])
})

test('30622: nur vom Relay selbst — ein fremd signierter Schnappschuss zählt nicht', () => {
    // Der Kind ist relay-only (`is_relay_only_kind`). Ein angenommener Fremd-Schnappschuss
    // leerte die DM-Spalte eines beliebigen Nutzers; dieselbe Absicherung wie bei den
    // Raum-Metadaten in `roomsByUrl`.
    assert.equal(foldHiddenDms([visibility({ pubkey: ALICE })], RELAY, ME).size, 0)
    assert.equal(foldHiddenDms([visibility()], '', ME).size, 0, 'NIP-11 noch unterwegs → nichts verstecken')
})

test('30622: ein Schnappschuss für einen ANDEREN Betrachter zählt nicht', () => {
    assert.equal(foldHiddenDms([visibility({ tags: [['d', ALICE], ['p', ALICE], ['h', H]] })], RELAY, ME).size, 0)
    assert.equal(foldHiddenDms([visibility()], RELAY, '').size, 0, 'ohne Betrachter kein Urteil')
})

test('30622: der JÜNGSTE gewinnt — sonst käme ein Wieder-Öffnen nie an', () => {
    const alt = visibility({ created_at: 1_000, id: 'a', tags: [['d', ME], ['p', ME], ['h', H], ['h', H2]] })
    const neu = visibility({ created_at: 1_001, id: 'b', tags: [['d', ME], ['p', ME], ['h', H]] })

    assert.deepEqual([...foldHiddenDms([alt, neu], RELAY, ME)], [H])
    assert.deepEqual([...foldHiddenDms([neu, alt], RELAY, ME)], [H], 'Eingangsreihenfolge entscheidet nicht')
})

test('30622: bei gleicher Sekunde entscheidet die höhere Id, nicht der Zufall', () => {
    // Der Relay erzwingt zwar streng wachsende Zeitstempel (`side_effects.rs:3196-3221`);
    // ein Cache-Kaltstart kann zwei Stände trotzdem nebeneinander halten, und dann darf
    // die Faltung nicht von der Array-Reihenfolge abhängen.
    const a = visibility({ created_at: 5, id: 'aaa', tags: [['d', ME], ['p', ME], ['h', H]] })
    const b = visibility({ created_at: 5, id: 'bbb', tags: [['d', ME], ['p', ME], ['h', H2]] })

    assert.deepEqual([...foldHiddenDms([a, b], RELAY, ME)], [H2])
    assert.deepEqual([...foldHiddenDms([b, a], RELAY, ME)], [H2])
})

test('30622: ein leerer Schnappschuss blendet nichts aus — er ist die Rücknahme', () => {
    const leer = visibility({ created_at: 2_000, id: 'z', tags: [['d', ME], ['p', ME]] })

    assert.equal(foldHiddenDms([visibility(), leer], RELAY, ME).size, 0)
})

test('30622: ein `h`, das keine Kanal-Id ist, wird verworfen statt weitergereicht', () => {
    const krumm = visibility({ tags: [['d', ME], ['p', ME], ['h', 'nicht-uuid'], ['h', H]] })

    assert.deepEqual([...foldHiddenDms([krumm], RELAY, ME)], [H])
})

test('30622: ein anderer Kind im selben Topf zählt nicht mit', () => {
    // Der Topf kommt aus `deriveRelaySignedEvents`, das auf `pubkey === relay.self`
    // filtert und NICHT auf den Kind — ein relay-signiertes 39000 liegt also im selben
    // Ergebnis. Ohne die Kind-Prüfung faltete dessen `h`-Tag mit.
    const anderer = { ...visibility(), kind: 39000 }

    assert.equal(foldHiddenDms([anderer], RELAY, ME).size, 0)
})

// ── Teilnehmer und Titel ────────────────────────────────────────────────────────

/** Das 39000, das der Relay für eine Unterhaltung schreibt (`side_effects.rs:1069-1096`). */
const dmMeta = (participants: string[]): string[][] => [
    ['d', H],
    ['name', 'DM'],
    ['private'],
    ['hidden'],
    ...participants.map((p) => ['p', p]),
    ['closed'],
    ['t', 'dm'],
]

test('Teilnehmer: aus den `p`-Tags des 39000, in der Reihenfolge des Relays', () => {
    assert.deepEqual(dmParticipants(dmMeta([ME, ALICE, BOB])), [ME, ALICE, BOB])
    assert.deepEqual(dmParticipants([['d', H], ['t', 'dm']]), [], 'ein Kanal ohne Teilnehmer')
})

test('Teilnehmer: die VIERSTELLIGE NIP-29-Form wird ebenso gelesen', () => {
    // Der Relay schreibt in die 39002 `["p", <hex>, "", <rolle>]` und in die 39000 die
    // nackte Zweierform. Beide sollen hier funktionieren — gelesen wird nur `tag[1]`.
    assert.deepEqual(dmParticipants([['p', ALICE, '', 'member']]), [ALICE])
})

test('Titel: der Gegenüber, nicht der Kanalname des Relays', () => {
    // Der Relay speichert für JEDE Zweier-Unterhaltung den Namen „DM" — ein Titel daraus
    // wäre in jeder Zeile derselbe.
    const namen: Record<string, string> = { [ALICE]: 'Alice', [BOB]: 'Bob', [CAROL]: 'Carol' }
    const nameOf = (p: string) => namen[p] ?? ''

    assert.equal(dmTitle([ME, ALICE], ME, nameOf), 'Alice')
    assert.equal(dmTitle([ME, ALICE, BOB], ME, nameOf), 'Alice, Bob')
})

test('Titel: ab dem vierten Namen zählt der Rest statt ihn auszuschreiben', () => {
    const leute = [pk('2'), pk('3'), pk('4'), pk('5'), pk('6')]
    const nameOf = (p: string) => `N${leute.indexOf(p)}`

    assert.equal(dmTitle([ME, ...leute], ME, nameOf), 'N0, N1, N2 +2')
})

test('Titel: ohne Profil steht der gekürzte Schlüssel da, nie ein leerer Name', () => {
    assert.equal(dmTitle([ME, ALICE], ME, () => ''), `${ALICE.slice(0, 8)}…`)
    assert.equal(dmTitle([ME, ALICE], ME, () => '   '), `${ALICE.slice(0, 8)}…`, 'Leerraum ist kein Name')
})

test('Titel: eine Unterhaltung mit sich selbst nennt sich selbst statt gar nichts', () => {
    // `open_dm` mischt den Aufrufer immer ein; eine Unterhaltung, in der nur der eigene
    // Schlüssel steht, ist damit möglich. Ein leerer Titel wäre die schlechtere Antwort.
    assert.deepEqual(dmCounterparts([ME], ME), [ME])
    assert.equal(dmTitle([ME], ME, () => 'Ich'), 'Ich')
})

// ── Filterformen ────────────────────────────────────────────────────────────────

test('Auflisten läuft über 39000 mit `#p` — nicht über 41001', () => {
    assert.deepEqual(dmListFilter(ME), [{ kinds: [39000], '#p': [ME] }])
    assert.deepEqual(dmListFilter(''), [], 'ohne eigenen Schlüssel gibt es nichts zu fragen')
    // 41001 `KIND_DM_CREATED` hat im Relay keinen Erzeuger und keine Scope-Zeile; ein
    // Filter darauf liefert per Konstruktion null Ergebnisse (`buzz-cli` tut genau das).
    assert.equal(JSON.stringify(dmListFilter(ME)).includes('41001'), false)
})

test('Die Auffrischung liest AUCH die 39002 — sonst ist die neue Unterhaltung keine', () => {
    // `buildSpaceView` sortiert einen Kanal nur dann in `dmRooms`, wenn die
    // relay-signierte Mitgliederliste den Betrachter nennt. Ohne diesen zweiten Filter
    // landet die eben eröffnete Unterhaltung in den ENTDECKBAREN Räumen und taucht in
    // keiner DM-Liste auf — die 39000 allein reicht nicht, ihre eigenen `p`-Tags sind
    // die Aussage des Kanals über sich selbst, nicht die des Relays über Mitgliedschaft.
    assert.deepEqual(dmMembershipFilter(ME), [{ kinds: [39002], '#p': [ME] }])
    assert.deepEqual(dmMembershipFilter(''), [], 'ohne eigenen Schlüssel gibt es nichts zu fragen')
    // Und beide zusammen sind das, was `refresh()` schickt: zwei Filter, ein REQ.
    assert.deepEqual(
        [...dmListFilter(ME), ...dmMembershipFilter(ME)],
        [{ kinds: [39000], '#p': [ME] }, { kinds: [39002], '#p': [ME] }],
    )
})

test('Der Sichtbarkeits-Filter trägt `#p` — ohne ihn schließt der Relay das REQ', () => {
    // 30622 steht in `P_GATED_KINDS`, und die `ids`-Ausnahme gilt für ihn ausdrücklich
    // NICHT (`req.rs:1069-1086`). Ein Filter ohne `#p` bekommt CLOSED, nicht weniger
    // Events — und CLOSED sieht in dieser Fläche aus wie „nichts ausgeblendet".
    assert.deepEqual(dmVisibilityFilter(ME), [{ kinds: [DM_VISIBILITY], '#p': [ME] }])
    assert.deepEqual(dmVisibilityFilter('keinhex'), [])
})

// ── Eingabe im Personen-Feld ────────────────────────────────────────────────────

/** Ein Stellvertreter für `nip19.decode` — der Parser bleibt ohne bech32 prüfbar. */
const fakeDecode = (value: string): { type: string; data: unknown } => {
    if (value === 'npub1alice') {
        return { type: 'npub', data: ALICE }
    }
    if (value === 'npub1kaputt') {
        return { type: 'npub', data: 'keinhex' }
    }
    if (value === 'nprofile1alice') {
        return { type: 'nprofile', data: { pubkey: ALICE, relays: [] } }
    }
    throw new Error('checksum failed')
}

test('Personenfeld: nacktes Hex und npub, beides in beliebiger Schreibweise', () => {
    assert.equal(parseDmRecipient(ALICE, fakeDecode), ALICE)
    assert.equal(parseDmRecipient(ALICE.toUpperCase(), fakeDecode), ALICE)
    assert.equal(parseDmRecipient('  npub1alice  ', fakeDecode), ALICE)
})

test('Personenfeld: alles andere ist keine Person — inklusive nprofile', () => {
    assert.equal(parseDmRecipient('', fakeDecode), '')
    assert.equal(parseDmRecipient('Alice', fakeDecode), '')
    assert.equal(parseDmRecipient('nprofile1alice', fakeDecode), '', 'Relay-Hinweise fielen still weg')
    assert.equal(parseDmRecipient('npub1kaputt', fakeDecode), '', 'npub mit unbrauchbaren Daten')
    assert.equal(parseDmRecipient('npub1tippfehler', fakeDecode), '', 'ein werfender Decoder reißt nichts mit')
    assert.equal(parseDmRecipient(`${ALICE}00`, fakeDecode), '', 'zu lang ist nicht „fast richtig"')
})

// ── Die zwei Formprüfungen, gegen sich selbst kalibriert ────────────────────────

test('Formprüfungen: die Grenzen liegen dort, wo der Relay sie zieht', () => {
    assert.equal(isDmPubkey(ALICE), true)
    assert.equal(isDmPubkey(ALICE.toUpperCase()), false, 'Buzz dekodiert nur Kleinschreibung')
    assert.equal(isDmPubkey(ALICE.slice(0, 63)), false)
    assert.equal(isDmPubkey(undefined), false)

    assert.equal(isDmChannelId(H), true)
    assert.equal(isDmChannelId(H.toUpperCase()), true, '`Uuid::parse_str` ist unempfindlich')
    assert.equal(isDmChannelId(H.replace(/-/g, '')), false)
    assert.equal(isDmChannelId(42), false)
})

test('dmOthers normalisiert genau einmal — die Planer verlassen sich darauf', () => {
    assert.deepEqual(dmOthers([` ${ALICE.toUpperCase()} `, ALICE, ME, 'x', ''], ME), [ALICE])
    assert.deepEqual(dmOthers([ALICE, BOB], ''), [ALICE, BOB], 'ohne eigenen Schlüssel fällt nichts weg')
})
