/**
 * Das Agenten-Verzeichnis (kind 10100) — geprüft wird, was in der Fläche STILL
 * das Falsche tut:
 *
 *   1. **Ein fremder `content.pubkey` darf keinen Vorschlag umlenken.** Wer ein
 *      10100 mit `{"pubkey":"<fremd>","name":"ceo"}` publiziert, bekäme sonst
 *      einen Eintrag „ceo", dessen `p`-Tag auf jemand anderen zeigt: die
 *      Nachricht ginge an den Falschen, der echte Agent bliebe stumm, und der
 *      Nutzer sähe nur, dass „niemand antwortet".
 *   2. **Ein Profil ohne Kanäle ist kein Profil.** kind 10100 ist ersetzbar; ein
 *      leeres `channel_ids` ersetzt das gute und nimmt den Agenten aus jeder
 *      Liste (genau der Vorfall, gegen den `publish-agent-profiles.mjs:68-76`
 *      gebaut wurde). Es darf hier nicht als gültiger Eintrag durchgehen.
 *   3. **Der Kanalfilter ist die halbe Wahrheit — und die andere Hälfte auch.**
 *      Ein Agent, der diesen Kanal nicht bedient, antwortet nie; einer, dessen
 *      `respond_to_allowlist` den Betrachter nicht kennt, ebenso wenig
 *      (`buzz-acp/src/lib.rs:249-257`). Beide Fälle wären Knöpfe, die
 *      garantiert nichts tun.
 *   4. **Der Negativbeweis für zooid.** Auf einem Nicht-Buzz-Space entsteht kein
 *      Agentenvorschlag — auch nicht, wenn Einträge, Kanal und Betrachter alle
 *      passen. Der `'unknown'`-Fall zählt dabei ausdrücklich als „nicht Buzz":
 *      beim Mount steht die Weiche immer dort.
 *   5. **Jede Identität genau einmal.** Alle zehn Agenten sind zugleich
 *      Relay-Mitglieder (am 2026-08-23 gemessen); ohne Faltung stünde jeder
 *      zweimal im Popover, einmal mit und einmal ohne Kanalprüfung.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/agentDirectoryData.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as nip19 from 'nostr-tools/nip19'
import {
    AGENT_PROFILE,
    agentCanRespondInChannel,
    agentIsSharedWithUser,
    agentMentionItems,
    agentServesChannel,
    mergeMentionItems,
    AGENT_NAME_MAX,
    MENTION_AGENT_LIMIT,
    MENTION_MEMBER_LIMIT,
    AGENT_PROFILE_MAX_CONTENT,
    AGENT_PROFILE_MAX_LIST,
    cleanDisplayName,
    parseAgentProfile,
    parseAgentProfiles,
    shortNpub,
    type AgentEntry,
    type MentionItemLike,
} from './agentDirectoryData.ts'

/** Echte Werte vom Produktivrelay (2026-08-23, `nak req -k 10100`). */
const CEO = '40b87b4cc62aeb820b10b4e652b26ba7e6793933736185ee2b821dafa2683b49'
const REVIEWER = '026636cf3cff2737a9130f06911963a97600f9778bfd8d2b95a845b99c636b09'
const KANAL = '576d38b2-9372-418e-93ec-134ca508722c'
const OWNER = '0adf67475ccc5ca456fd3022e46f5d526eb0af6284bf85494c0dd7847f3e5033'
const FREMDER = 'ff'.repeat(32)

const inhalt = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
        pubkey: CEO,
        name: 'ceo',
        display_name: 'ceo',
        agent_type: 'agent',
        channel_ids: [KANAL],
        channels: [KANAL],
        respond_to: 'allowlist',
        respond_to_allowlist: [OWNER],
        capabilities: [],
        status: 'online',
        ...over,
    })

const event = (over: Record<string, unknown> = {}, contentOver: Record<string, unknown> = {}) => ({
    kind: AGENT_PROFILE,
    pubkey: CEO,
    created_at: 1787436616,
    content: inhalt(contentOver),
    ...over,
})

const entry = (over: Partial<AgentEntry> = {}): AgentEntry => ({
    pubkey: CEO,
    name: 'ceo',
    displayName: 'ceo',
    agentType: 'agent',
    channelIds: [KANAL],
    respondTo: 'allowlist',
    respondToAllowlist: [OWNER],
    status: 'online',
    createdAt: 1,
    ...over,
})

// ── 1. Der Autor zählt, der Inhalt behauptet nur ─────────────────────────────

test('der Eintrag trägt den EVENT-Autor, nicht content.pubkey', () => {
    const parsed = parseAgentProfile(event({}, { pubkey: FREMDER }))
    assert.equal(parsed?.pubkey, CEO)
})

test('ein 10100 des Angreifers benennt sich „ceo" — und bleibt SEIN Schlüssel', () => {
    // Der Angreifer signiert selbst, behauptet im Inhalt den ceo-Schlüssel und
    // wählt dessen Namen. Der Eintrag darf auf IHN zeigen; die Fläche zeigt dann
    // zwar „ceo", aber die Erwähnung weckt keinen fremden Agenten — und der echte
    // ceo steht mit seinem eigenen Eintrag daneben.
    const parsed = parseAgentProfile(event({ pubkey: FREMDER }, { pubkey: CEO }))
    assert.equal(parsed?.pubkey, FREMDER)
    assert.notEqual(parsed?.pubkey, CEO)
})

// ── 2. Was gar nicht erst zum Eintrag wird ───────────────────────────────────

test('falsches Kind, kaputtes JSON, Nicht-Objekt und Array liefern null', () => {
    assert.equal(parseAgentProfile(event({ kind: 10101 })), null)
    assert.equal(parseAgentProfile(event({ content: '{kaputt' })), null)
    assert.equal(parseAgentProfile(event({ content: '"nur ein String"' })), null)
    assert.equal(parseAgentProfile(event({ content: '[]' })), null)
    assert.equal(parseAgentProfile(event({ content: 'null' })), null)
})

test('ein Autor ohne 64-hex-Kleinschreibung liefert null — genau die Form vergleicht buzz-acp', () => {
    for (const pk of ['', 'ab', CEO.slice(0, 63), CEO + 'a', CEO.toUpperCase(), nip19.npubEncode(CEO)]) {
        assert.equal(parseAgentProfile(event({ pubkey: pk })), null, `durchgelassen: ${pk}`)
    }
})

test('fehlende, leere oder untypisierte channel_ids liefern null', () => {
    assert.equal(parseAgentProfile(event({}, { channel_ids: [], channels: [] })), null)
    assert.equal(parseAgentProfile(event({}, { channel_ids: undefined, channels: undefined })), null)
    assert.equal(parseAgentProfile(event({}, { channel_ids: 'nicht-array', channels: 7 })), null)
    assert.equal(parseAgentProfile(event({}, { channel_ids: [1, null, {}], channels: [] })), null)
    assert.equal(parseAgentProfile(event({}, { channel_ids: ['  ', ''], channels: [] })), null)
})

test('`channels` trägt nur als Rückfall, wenn `channel_ids` fehlt', () => {
    const nurChannels = parseAgentProfile(event({}, { channel_ids: undefined, channels: [KANAL] }))
    assert.deepEqual(nurChannels?.channelIds, [KANAL])
    // Widersprechen sich beide, führt `channel_ids` — das ist das Feld, an dem
    // der Referenzclient hängt (agentAutocompleteEligibility.ts).
    const beide = parseAgentProfile(event({}, { channel_ids: [KANAL], channels: ['anderer'] }))
    assert.deepEqual(beide?.channelIds, [KANAL])
})

test('ein Eintrag ohne jeden Namen liefert null — er wäre im Popover nicht wählbar', () => {
    assert.equal(parseAgentProfile(event({}, { name: '', display_name: '' })), null)
    assert.equal(parseAgentProfile(event({}, { name: undefined, display_name: undefined })), null)
})

test('nicht-hex-Einträge der Allowlist fallen weg statt den Vergleich zu verwässern', () => {
    const parsed = parseAgentProfile(event({}, { respond_to_allowlist: [OWNER, 'muell', OWNER.toUpperCase()] }))
    assert.deepEqual(parsed?.respondToAllowlist, [OWNER])
})

// ── Mehrere Events, ein Autor ────────────────────────────────────────────────

test('je Autor bleibt der neuere Eintrag; kaputte Events reißen die Liste nicht', () => {
    const agents = parseAgentProfiles([
        event({ created_at: 100 }, { display_name: 'alt' }),
        event({ created_at: 200 }, { display_name: 'neu' }),
        event({ pubkey: REVIEWER }, { name: 'reviewer', display_name: 'reviewer' }),
        event({ content: '{kaputt' }),
    ])
    assert.equal(agents.length, 2)
    assert.equal(agents.find((a) => a.pubkey === CEO)?.displayName, 'neu')
    assert.equal(agents.find((a) => a.pubkey === REVIEWER)?.name, 'reviewer')
})

// ── 3. Beide Hälften der Eignung ─────────────────────────────────────────────

test('der Kanalfilter: nur der Kanal aus channel_ids zählt, und ein leeres h nie', () => {
    const a = entry()
    assert.equal(agentServesChannel(a, KANAL), true)
    assert.equal(agentServesChannel(a, 'anderer-kanal'), false)
    assert.equal(agentServesChannel(a, ''), false)
    assert.equal(agentServesChannel(entry({ channelIds: [] }), KANAL), false)
})

test('der Betrachterfilter bildet respond_to nach — allowlist, anyone, owner_only, nobody', () => {
    const allow = entry({ respondTo: 'allowlist', respondToAllowlist: [OWNER] })
    assert.equal(agentIsSharedWithUser(allow, KANAL, OWNER), true)
    assert.equal(agentIsSharedWithUser(allow, KANAL, FREMDER), false)
    // Ohne Sitzung (kein eigener Pubkey) fällt „allowlist" auf den anyone-Zweig
    // und damit auf false — wie im Referenzclient.
    assert.equal(agentIsSharedWithUser(allow, KANAL, ''), false)

    const jeder = entry({ respondTo: 'anyone', respondToAllowlist: [] })
    assert.equal(agentIsSharedWithUser(jeder, KANAL, FREMDER), true)
    assert.equal(agentIsSharedWithUser(jeder, 'anderer-kanal', FREMDER), false)

    for (const modus of ['owner_only', 'nobody', '']) {
        assert.equal(agentIsSharedWithUser(entry({ respondTo: modus }), KANAL, OWNER), false, modus)
    }
})

test('beide Hälften zusammen: eine reicht nie', () => {
    const a = entry()
    assert.equal(agentCanRespondInChannel(a, KANAL, OWNER), true)
    assert.equal(agentCanRespondInChannel(a, 'anderer-kanal', OWNER), false) // Kanal fehlt
    assert.equal(agentCanRespondInChannel(a, KANAL, FREMDER), false) // Betrachter fehlt
})

// ── Vorschlagsliste ──────────────────────────────────────────────────────────

const items = (over: Parameters<typeof agentMentionItems>[0] extends infer T ? Partial<T> : never = {}) =>
    agentMentionItems({
        agents: [entry()],
        h: KANAL,
        viewerPubkey: OWNER,
        spaceKind: 'buzz',
        encodeNpub: nip19.npubEncode,
        ...over,
    })

test('auf einem Buzz-Space entsteht der Vorschlag — mit npub, Agentenmarke und suchbarem Namen', () => {
    const [item] = items()
    assert.equal(item.pubkey, CEO)
    assert.equal(item.npub, nip19.npubEncode(CEO))
    assert.equal(item.name, 'ceo')
    assert.equal(item.isAgent, true)
    assert.ok(item.search.includes('ceo'))
})

test('der Kanal filtert die Liste: derselbe Agent, ein anderer Raum → kein Vorschlag', () => {
    assert.deepEqual(items({ h: 'ein-anderer-raum' }), [])
})

// ── 4. NEGATIVBEWEIS: zooid ──────────────────────────────────────────────────

test('auf zooid entsteht KEIN Agentenvorschlag — auch mit passenden Einträgen', () => {
    // Positivkontrolle in derselben Prüfung: dieselben Argumente, nur die
    // Relay-Art wechselt. Ohne sie bewiese die leere Liste nichts.
    assert.equal(items({ spaceKind: 'buzz' }).length, 1)
    assert.deepEqual(items({ spaceKind: 'other' }), [])
})

test('auch das noch unentschiedene „unknown" liefert leer — beim Mount steht die Weiche dort', () => {
    assert.deepEqual(items({ spaceKind: 'unknown' }), [])
})

// ── 5. Faltung mit den Mitgliedern ───────────────────────────────────────────

const member = (pubkey: string, name: string): MentionItemLike => ({
    pubkey,
    npub: nip19.npubEncode(pubkey),
    name,
    picture: `https://example.invalid/${name}.png`,
    search: `${name} ${nip19.npubEncode(pubkey)}`.toLowerCase(),
})

test('der Agent borgt sich den Avatar aus dem Directory — das 10100 trägt keinen', () => {
    const [item] = items({ memberItems: [member(CEO, 'CEO Mensch')] })
    assert.equal(item.picture, 'https://example.invalid/CEO Mensch.png')
    assert.ok(item.search.includes('ceo mensch'), 'auch der Directory-Name bleibt suchbar')
})

test('ein Agent, der zugleich Mitglied ist, steht genau EINMAL in der Liste — als Agent', () => {
    const mitglieder = [member(CEO, 'CEO Mensch'), member(REVIEWER, 'Reviewer Mensch')]
    const gefaltet = mergeMentionItems(mitglieder, items({ memberItems: mitglieder }))
    assert.equal(gefaltet.filter((i) => i.pubkey === CEO).length, 1)
    assert.equal(gefaltet[0].isAgent, true, 'Agenten stehen vorn')
    assert.equal(gefaltet.length, 2)
    assert.equal(gefaltet[1].pubkey, REVIEWER)
    assert.equal(gefaltet[1].isAgent, undefined)
})

test('ohne Agenten bleibt die Mitgliederliste Zeichen für Zeichen dieselbe', () => {
    const mitglieder = [member(CEO, 'a'), member(REVIEWER, 'b')]
    assert.deepEqual(mergeMentionItems(mitglieder, []), mitglieder)
})

test('ein Encoder, der wirft, kostet den einen Eintrag — nicht die Liste', () => {
    const ergebnis = agentMentionItems({
        agents: [entry(), entry({ pubkey: REVIEWER, name: 'reviewer', displayName: 'reviewer' })],
        h: KANAL,
        viewerPubkey: OWNER,
        spaceKind: 'buzz',
        encodeNpub: (pk) => {
            if (pk === CEO) {
                throw new Error('kaputt')
            }
            return nip19.npubEncode(pk)
        },
    })
    assert.deepEqual(
        ergebnis.map((i) => i.pubkey),
        [REVIEWER],
    )
})


// -- Fremdtext im Anzeigenamen (Sicherheitsbefund F3) ------------------------

/**
 * **Der Name eines Agenten ist selbstsignierter Fremdtext.**
 *
 * Jedes Relay-Mitglied darf ein 10100 publizieren, und Buzz sagt ausdruecklich,
 * dass die Durchsetzung relay-seitig fehlt
 * (`buzz-cli/src/commands/channels.rs:1030-1035`). Der Name traegt also keine
 * Identitaet - er darf aber auch nicht die ANZEIGE anderer Eintraege verfaelschen.
 */
test('ein Bidi-Override im Namen wird entfernt, nicht durchgereicht', () => {
    // U+202E dreht die Darstellung der folgenden Zeichen um - damit laesst sich
    // eine Zeile so setzen, dass sie wie ein anderer Eintrag aussieht.
    const eintrag = parseAgentProfile(event({ content: inhalt({ name: 'ce‮oo', display_name: 'ce‮oo' }) }))
    assert.ok(eintrag)
    assert.equal(eintrag!.name.includes('‮'), false)
})

test('Zeilenumbrueche und Zero-Width-Zeichen fallen aus dem Namen', () => {
    const eintrag = parseAgentProfile(
        event({ content: inhalt({ name: 'ceo\nADMIN​', display_name: 'ceo\nADMIN​' }) }),
    )
    assert.ok(eintrag)
    assert.equal(eintrag!.name, 'ceo ADMIN')
})

test('ein ueberlanger Name wird auf die Anzeigelaenge gekappt', () => {
    const eintrag = parseAgentProfile(event({ content: inhalt({ name: 'z'.repeat(4000), display_name: '' }) }))
    assert.ok(eintrag)
    assert.equal(eintrag!.name.length, AGENT_NAME_MAX)
})

test('cleanDisplayName laesst gewoehnliche Namen unangetastet', () => {
    // Positivkontrolle: ein Filter, der alles frisst, bestuende die Faelle oben auch.
    assert.equal(cleanDisplayName('ceo'), 'ceo')
    assert.equal(cleanDisplayName('Müller-Lüdenscheidt'), 'Müller-Lüdenscheidt')
})

/**
 * Der Vorschlag fuehrt den Namen NIE allein: zwei Profile duerfen „ceo" heissen,
 * und welches der Prozess ist, den der Nutzer meint, sagt allein der Schluessel.
 */
test('jeder Agentenvorschlag traegt die npub-Kurzform', () => {
    const [eintrag] = items()
    assert.ok(eintrag.hint, 'ohne Kurzform ist der Name die einzige Aussage')
    assert.match(eintrag.hint!, /^npub1.+….{4}$/)
})

test('zwei Agenten mit demselben Namen sind ueber die Kurzform unterscheidbar', () => {
    const beide = agentMentionItems({
        agents: [
            entry(),
            { ...entry(), pubkey: REVIEWER, name: 'ceo', displayName: 'ceo' },
        ],
        h: KANAL,
        viewerPubkey: OWNER,
        spaceKind: 'buzz',
        encodeNpub: nip19.npubEncode,
    })
    assert.equal(beide.length, 2)
    assert.equal(beide[0].name, beide[1].name, 'Vorbedingung: gleicher Anzeigename')
    assert.notEqual(beide[0].hint, beide[1].hint)
})

test('shortNpub kuerzt in der Mitte und laesst Kurzes stehen', () => {
    const npub = nip19.npubEncode(CEO)
    assert.equal(shortNpub(npub).startsWith(npub.slice(0, 10)), true)
    assert.equal(shortNpub(npub).endsWith(npub.slice(-4)), true)
    assert.equal(shortNpub('npub1kurz'), 'npub1kurz')
})

// -- Groesse eines Profils (Sicherheitsbefund F4) ----------------------------

/**
 * **Ein einziges Profil darf nicht die Insel anhalten.**
 *
 * `parseAgentProfiles` laeuft bei JEDEM Verzeichnis-Update ueber alle Events, auf
 * dem Hauptthread. Gemessen: 25 000 Eintraege / 220 KB -> 1 303 ms; die Grenze
 * des Relays liegt bei 256 KB (`ingest.rs:2014`), publizieren darf jedes
 * Mitglied. Verworfen wird wie bei jedem anderen Formfehler.
 */
test('ein Profil mit zu vielen Kanaelen wird verworfen', () => {
    const viele = Array.from({ length: AGENT_PROFILE_MAX_LIST + 1 }, (_, i) => `kanal-${i}`)
    assert.equal(parseAgentProfile(event({ content: inhalt({ channel_ids: viele, channels: viele }) })), null)
})

test('eine zu lange Allowlist verwirft das Profil ebenfalls', () => {
    const viele = Array.from({ length: AGENT_PROFILE_MAX_LIST + 1 }, () => OWNER)
    assert.equal(parseAgentProfile(event({ content: inhalt({ respond_to_allowlist: viele }) })), null)
})

test('ein zu grosser Content wird gar nicht erst geparst', () => {
    const gross = JSON.stringify({
        name: 'ceo',
        display_name: 'ceo',
        channel_ids: [KANAL],
        fuellung: 'x'.repeat(AGENT_PROFILE_MAX_CONTENT),
    })
    assert.ok(gross.length > AGENT_PROFILE_MAX_CONTENT, 'Vorbedingung: der Content ist wirklich zu gross')
    assert.equal(parseAgentProfile(event({ content: gross })), null)
})

test('die Grenzen liegen ueber dem, was echte Profile brauchen', () => {
    // Positivkontrolle gegen einen zu engen Riegel: das echte Format (ein Kanal,
    // zwei Allowlist-Eintraege, 2026-08-23 gemessen) muss bequem durchpassen.
    assert.ok(parseAgentProfile(event({ content: inhalt() })))
    assert.ok(AGENT_PROFILE_MAX_LIST >= 64 && AGENT_PROFILE_MAX_CONTENT >= 4096)
})

test('ein Profil mit vielen, aber zulaessigen Kanaelen bleibt schnell', () => {
    // Die eigentliche Ursache der 1 303 ms war `out.includes(...)` in der
    // Schleife, zweimal je Feld. Mit `Set` ist der zulaessige Hoechstfall
    // unauffaellig - eine Zeitmessung als Riegel waere auf fremder Hardware
    // wackelig, deshalb steht hier nur die Groessenordnung.
    const viele = Array.from({ length: AGENT_PROFILE_MAX_LIST }, (_, i) => `kanal-${i}`)
    const start = Date.now()
    for (let i = 0; i < 200; i++) {
        parseAgentProfile(event({ content: inhalt({ channel_ids: viele, channels: viele }) }))
    }
    assert.ok(Date.now() - start < 2000, 'zu langsam - steht `includes` wieder in der Schleife?')
})

// ── Deckelung der Vorschlagsliste ───────────────────────────────────────────

const vieleAgenten = (n: number): MentionItemLike[] =>
    Array.from({ length: n }, (_, i) => ({
        pubkey: `${i}`.padStart(64, '0'),
        npub: `npub1agent${i}`,
        name: `agent-${i}`,
        picture: '',
        search: `agent-${i}`,
        isAgent: true,
    }))

const vieleMenschen = (n: number): MentionItemLike[] =>
    Array.from({ length: n }, (_, i) => ({
        pubkey: `${i}`.padStart(63, 'f') + '1',
        npub: `npub1mensch${i}`,
        name: `mensch-${i}`,
        picture: '',
        search: `mensch-${i}`,
    }))

/**
 * **Agenten dürfen die Menschen nicht verdrängen.** Mit zehn Produktivagenten in
 * EINEM Kanal (2026-08-23 gemessen) hätte ein gemeinsamer Achter-Deckel bei
 * leerer Suche nur noch Maschinen gezeigt — die Agenten stehen ja vorn.
 */
test('ein Schwarm Agenten lässt den Menschen ihre Plätze', () => {
    const liste = mergeMentionItems(vieleMenschen(20), vieleAgenten(20))
    const menschen = liste.filter((item) => !item.isAgent)
    const agenten = liste.filter((item) => item.isAgent)
    assert.equal(agenten.length, MENTION_AGENT_LIMIT)
    assert.equal(menschen.length, MENTION_MEMBER_LIMIT)
})

test('wenige Agenten schenken ihre Plätze nicht her — und nehmen keine weg', () => {
    const liste = mergeMentionItems(vieleMenschen(20), vieleAgenten(1))
    assert.equal(liste.filter((item) => item.isAgent).length, 1)
    // Der Menschen-Deckel ist von der Agentenzahl unabhängig; vorher war die
    // Gesamtliste gedeckelt und ein Agent kostete einen Menschen.
    assert.equal(liste.filter((item) => !item.isAgent).length, MENTION_MEMBER_LIMIT)
})

test('ohne Agenten bleibt die Menschenliste unverändert gedeckelt', () => {
    assert.equal(mergeMentionItems(vieleMenschen(3), []).length, 3)
})
