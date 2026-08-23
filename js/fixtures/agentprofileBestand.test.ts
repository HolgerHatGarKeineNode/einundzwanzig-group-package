/**
 * **Der Parser gegen die ECHTE Form** — zehn kind-10100-Ereignisse, so wie sie am
 * 2026-08-23 auf `wss://buzz.einundzwanzig.space` lagen (`nak req -k 10100 --auth`).
 *
 * ── Warum ein eingefrorener Satz und nicht nur erfundene Fälle ──────────────────
 *
 * `agentDirectoryData.test.ts` prüft die REGELN — mit selbst gebauten Ereignissen,
 * deren Form dieser Test erst rechtfertigt. Ein Parser, der nur gegen selbst
 * erdachte Eingaben läuft, prüft die eigene Vorstellung von der Gegenseite. Die
 * Gegenseite ist hier `/home/user/buzz-team/bin/publish-agent-profiles.mjs`, und
 * sie schreibt Felder, die in unserem Kopf nicht vorkamen (`channels` neben
 * `channel_ids`, `capabilities`, leere Tag-Liste).
 *
 * ── Was hier bewusst NICHT eingefroren ist ──────────────────────────────────────
 *
 * Namen, Kanal-UUID und Allowlist-Inhalte werden nicht behauptet. Sie ändern sich
 * mit jedem neuen Branch-Kanal (`branch-channel.sh open` schreibt die Profile neu),
 * und ein Test, der sie festschreibt, prüfte den Betriebszustand des Teams statt
 * unseren Code. Behauptet wird nur, was FORM ist: dass jedes Ereignis parst, dass
 * der Autor gewinnt, dass Kanäle da sind.
 *
 * Öffentliche Verzeichnis-Auskunft, keine Geheimnisse — jedes Relay-Mitglied liest
 * dieselben Ereignisse, und der Agent signiert sie selbst.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/fixtures/agentprofileBestand.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
    AGENT_PROFILE,
    agentCanRespondInChannel,
    agentMentionItems,
    parseAgentProfile,
    parseAgentProfiles,
    type AgentProfileEventLike,
} from '../agentDirectoryData.ts'
import * as nip19 from 'nostr-tools/nip19'

type Bestand = { events: AgentProfileEventLike[] }

const bestand = JSON.parse(
    readFileSync(new URL('./agentprofile-bestand.json', import.meta.url), 'utf8'),
) as Bestand
const events = bestand.events

test('der Satz ist da und trägt ausschließlich kind 10100', () => {
    assert.equal(events.length, 10)
    for (const e of events) {
        assert.equal(e.kind, AGENT_PROFILE)
    }
})

test('JEDES echte Profil parst — kein einziges fällt durch die Validierung', () => {
    // Die schärfste Zusage dieses Tests: fiele auch nur eins durch, verschwände
    // ein Agent aus der Liste, ohne dass irgendetwas rot wird.
    for (const e of events) {
        assert.notEqual(parseAgentProfile(e), null, `nicht geparst: ${e.pubkey}`)
    }
    assert.equal(parseAgentProfiles(events).length, 10)
})

test('der Autor gewinnt — und im echten Bestand behauptet der Inhalt dasselbe', () => {
    for (const e of events) {
        const parsed = parseAgentProfile(e)
        assert.equal(parsed?.pubkey, e.pubkey)
        // Zusatzbefund, festgehalten weil er sonst niemandem auffiele: die zehn
        // echten Profile sind in sich stimmig (`content.pubkey === event.pubkey`).
        // Die Regel „Autor gewinnt" ist hier also FOLGENLOS — und genau deshalb
        // würde ihr Verlust an echten Daten nie auffallen. Sie hat ihren eigenen
        // Angriffsfall in `agentDirectoryData.test.ts`.
        const behauptet = (JSON.parse(e.content) as { pubkey?: string }).pubkey
        assert.equal(behauptet, e.pubkey)
    }
})

test('jedes Profil nennt mindestens einen Kanal und einen Namen', () => {
    for (const agent of parseAgentProfiles(events)) {
        assert.ok(agent.channelIds.length > 0, `ohne Kanal: ${agent.pubkey}`)
        assert.ok(agent.name.length > 0, `ohne Namen: ${agent.pubkey}`)
        assert.match(agent.pubkey, /^[0-9a-f]{64}$/)
    }
})

test('aus dem echten Bestand entsteht in seinem eigenen Kanal eine echte Vorschlagsliste', () => {
    const agents = parseAgentProfiles(events)
    // Kanal und Betrachter aus dem Bestand ziehen statt sie zu behaupten — so
    // altert der Fall mit dem Fixture statt gegen ihn.
    const kanal = agents[0].channelIds[0]
    const betrachter = agents[0].respondToAllowlist[0]
    assert.ok(kanal && betrachter, 'Vorbedingung: der Bestand nennt Kanal und Allowlist')

    const items = agentMentionItems({
        agents,
        h: kanal,
        viewerPubkey: betrachter,
        spaceKind: 'buzz',
        encodeNpub: nip19.npubEncode,
    })
    assert.ok(items.length > 0, 'kein einziger Vorschlag aus zehn echten Profilen')
    for (const item of items) {
        assert.equal(item.isAgent, true)
        assert.equal(nip19.decode(item.npub).data, item.pubkey)
    }

    // Und die Gegenprobe am selben Bestand: ein fremder Raum liefert nichts.
    assert.deepEqual(
        agentMentionItems({
            agents,
            h: 'ein-kanal-den-keiner-bedient',
            viewerPubkey: betrachter,
            spaceKind: 'buzz',
            encodeNpub: nip19.npubEncode,
        }),
        [],
    )
})

test('der Betrachterfilter beißt am echten Bestand — ein Unbeteiligter sieht keinen Agenten', () => {
    // Der wichtigste Befund dieser Datei für den Betrieb: alle zehn Profile stehen
    // auf `respond_to: "allowlist"` mit genau zwei Einträgen. Für jeden anderen
    // Betrachter ist die Liste leer — nicht wegen eines Fehlers, sondern weil der
    // Agent auf ihn ohnehin nicht reagieren würde (`buzz-acp/src/lib.rs:249-257`).
    const agents = parseAgentProfiles(events)
    const kanal = agents[0].channelIds[0]
    const fremder = 'ff'.repeat(32)
    for (const agent of agents) {
        assert.equal(agentCanRespondInChannel(agent, kanal, fremder), false, `offen für Fremde: ${agent.name}`)
    }
})
