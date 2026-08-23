/**
 * Die Weckmeldung — geprüft an den Fällen, die sonst STILL das Falsche tun:
 *
 *   1. **Ein `p`-Tag auf einen nicht weckbaren Agenten.** Er bedient den Kanal
 *      nicht oder antwortet diesem Autor nicht (`buzz-acp/src/lib.rs:249-257`).
 *      Die Nachricht ginge raus, der Relay quittierte, und niemand antwortete —
 *      ununterscheidbar von „Agent gerade beschäftigt".
 *   2. **Kein `buzz-channel` am Repo.** Dann gibt es keinen Kanal, in den eine
 *      Weckmeldung gehörte. Das ist bei uns der REGELFALL: alle zehn
 *      Produktivagenten führen genau einen Kanal, und ein Repo, dessen
 *      `buzz-channel` woanders hinzeigt, hat keinen einzigen weckbaren Agenten.
 *   3. **Ein erwähnter Mensch.** Er bekommt seine Benachrichtigung über den
 *      `p`-Tag am Issue selbst; eine Kanalnachricht wäre dieselbe Nachricht ein
 *      zweites Mal, an einen Kanal, in dem sie niemanden angeht.
 *   4. **Ein unparsbarer `buzz://`-Link.** Der Referenzclient verlangt
 *      ausdrücklich „omit the field" statt zu escapen (`links.rs:18-34`) — ein
 *      halber Link führt jeden Leser ins Leere.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeWakeModels.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentEntry } from './agentDirectoryData.ts'
import {
    WAKE_MESSAGE_KIND,
    agentNames,
    buildWakeMessage,
    buzzEntityLink,
    isLinkableDtag,
    planWake,
    wakeMessageContent,
    type WakeTarget,
} from './forgeWakeModels.ts'

/** Echte Werte vom Produktivrelay (2026-08-23, `nak req -k 10100`). */
const CEO = '40b87b4cc62aeb820b10b4e652b26ba7e6793933736185ee2b821dafa2683b49'
const REVIEWER = '026636cf3cff2737a9130f06911963a97600f9778bfd8d2b95a845b99c636b09'
const KANAL = '576d38b2-9372-418e-93ec-134ca508722c'
const ANDERER_KANAL = '11111111-2222-4333-8444-555555555555'
const OWNER = '0adf67475ccc5ca456fd3022e46f5d526eb0af6284bf85494c0dd7847f3e5033'
const FREMDER = 'ff'.repeat(32)
const MENSCH = 'ab'.repeat(32)
const ISSUE_ID = 'cd'.repeat(32)
const ADRESSE = `30617:${'a'.repeat(64)}:mein-repo`

const agent = (over: Partial<AgentEntry> = {}): AgentEntry => ({
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

const ziel = (over: Partial<WakeTarget> = {}): WakeTarget => ({
    art: 'issue',
    eventId: ISSUE_ID,
    repoAddress: ADRESSE,
    repoName: 'mein-repo',
    title: 'Der Otter frisst den Zwerg',
    what: 'issue',
    ...over,
})

// ── Eignung ─────────────────────────────────────────────────────────────────

test('ein weckbarer Agent führt zu „ready"', () => {
    const plan = planWake({ agents: [agent()], channelId: KANAL, viewerPubkey: OWNER, mentioned: [CEO] })
    assert.equal(plan.code, 'ready')
    assert.deepEqual(
        plan.wakeable.map((a) => a.pubkey),
        [CEO],
    )
})

/** NEGATIVBEWEIS (b), erste Hälfte: falscher Kanal. */
test('ein Agent, der DIESEN Kanal nicht bedient, ist nicht weckbar', () => {
    const plan = planWake({
        agents: [agent({ channelIds: [ANDERER_KANAL] })],
        channelId: KANAL,
        viewerPubkey: OWNER,
        mentioned: [CEO],
    })
    assert.equal(plan.code, 'not-wakeable')
    assert.deepEqual(plan.wakeable, [])
    // Der Hinweistext braucht den Namen trotzdem — sonst stünde dort „jemand".
    assert.deepEqual(agentNames(plan.mentionedAgents), ['ceo'])
})

/**
 * NEGATIVBEWEIS (b), zweite Hälfte — **die, die man vergisst**: der Agent
 * bedient den Kanal, aber der Autor steht nicht in seiner Allowlist. Er
 * antwortet nie, und zwar ohne jede Rückmeldung.
 */
test('ein Agent, der DIESEM Autor nicht antwortet, ist nicht weckbar', () => {
    const plan = planWake({ agents: [agent()], channelId: KANAL, viewerPubkey: FREMDER, mentioned: [CEO] })
    assert.equal(plan.code, 'not-wakeable')
    assert.deepEqual(plan.wakeable, [])
})

test('respond_to „anyone" macht ihn für jeden Autor weckbar', () => {
    const plan = planWake({
        agents: [agent({ respondTo: 'anyone', respondToAllowlist: [] })],
        channelId: KANAL,
        viewerPubkey: FREMDER,
        mentioned: [CEO],
    })
    assert.equal(plan.code, 'ready')
})

/** NEGATIVBEWEIS (a): ohne `buzz-channel` entsteht keine Meldung. */
test('ohne buzz-channel gibt es keine Weckmeldung — aber einen Grund', () => {
    const plan = planWake({ agents: [agent()], channelId: '', viewerPubkey: OWNER, mentioned: [CEO] })
    assert.equal(plan.code, 'no-channel')
    assert.deepEqual(plan.wakeable, [])
    assert.deepEqual(agentNames(plan.mentionedAgents), ['ceo'])
    // Und aus einem Plan ohne Kanal entsteht auch dann nichts, wenn jemand
    // trotzdem baut: der Riegel steht zweimal.
    assert.equal(buildWakeMessage({ channelId: '', wakeable: [agent()], target: ziel() }), null)
})

test('ein erwähnter Mensch löst gar nichts aus', () => {
    const plan = planWake({ agents: [agent()], channelId: KANAL, viewerPubkey: OWNER, mentioned: [MENSCH] })
    assert.equal(plan.code, 'none')
    assert.deepEqual(plan.mentionedAgents, [])
})

test('ohne jede Erwähnung ebenfalls nicht', () => {
    assert.equal(
        planWake({ agents: [agent()], channelId: KANAL, viewerPubkey: OWNER, mentioned: [] }).code,
        'none',
    )
})

test('Groß-/Kleinschreibung der erwähnten Schlüssel entscheidet nichts', () => {
    const plan = planWake({
        agents: [agent()],
        channelId: KANAL,
        viewerPubkey: OWNER,
        mentioned: [CEO.toUpperCase()],
    })
    assert.equal(plan.code, 'ready')
})

/**
 * Der gemischte Fall: zwei Agenten erwähnt, einer weckbar. Es entsteht EINE
 * Meldung, und der Nicht-Weckbare bekommt darin keinen `p`-Tag.
 */
test('nur die weckbaren Agenten kommen in die Meldung', () => {
    const plan = planWake({
        agents: [agent(), agent({ pubkey: REVIEWER, name: 'reviewer', displayName: 'reviewer', channelIds: [ANDERER_KANAL] })],
        channelId: KANAL,
        viewerPubkey: OWNER,
        mentioned: [CEO, REVIEWER],
    })
    assert.equal(plan.code, 'ready')
    const meldung = buildWakeMessage({ channelId: KANAL, wakeable: plan.wakeable, target: ziel() })!
    assert.deepEqual(
        meldung.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]),
        [CEO],
    )
})

// ── Form der Meldung ────────────────────────────────────────────────────────

test('die Meldung ist eine kind-9-Kanalnachricht mit h-Tag und p-Tags', () => {
    const meldung = buildWakeMessage({
        channelId: KANAL,
        wakeable: [agent(), agent({ pubkey: REVIEWER, name: 'reviewer', displayName: 'reviewer' })],
        target: ziel(),
    })!
    assert.equal(meldung.kind, WAKE_MESSAGE_KIND)
    assert.equal(WAKE_MESSAGE_KIND, 9)
    assert.deepEqual(meldung.tags, [
        ['h', KANAL],
        ['p', CEO],
        ['p', REVIEWER],
    ])
})

test('der NIP-70-Marker der Fläche steht zwischen h und p', () => {
    const meldung = buildWakeMessage({
        channelId: KANAL,
        wakeable: [agent()],
        target: ziel(),
        extraTags: [['-']],
    })!
    assert.deepEqual(meldung.tags, [['h', KANAL], ['-'], ['p', CEO]])
})

test('derselbe Agent zweimal ergibt EINEN p-Tag', () => {
    const meldung = buildWakeMessage({ channelId: KANAL, wakeable: [agent(), agent()], target: ziel() })!
    assert.equal(meldung.tags.filter((tag) => tag[0] === 'p').length, 1)
})

test('ohne weckbaren Agenten entsteht gar keine Nachricht', () => {
    assert.equal(buildWakeMessage({ channelId: KANAL, wakeable: [], target: ziel() }), null)
})

test('der Verweis nennt Vorgang, Repo und den kanonischen buzz://-Link', () => {
    const text = wakeMessageContent(ziel())
    assert.match(text, /Neues Issue in mein-repo: Der Otter frisst den Zwerg/)
    assert.match(text, new RegExp(`buzz://issue\\?id=${ISSUE_ID}&owner=${'a'.repeat(64)}&d=mein-repo`))
})

test('ein Kommentar verweist auf die WURZEL, nicht auf sich selbst', () => {
    const text = wakeMessageContent(ziel({ what: 'comment' }))
    assert.match(text, /Neuer Kommentar am Issue/)
    assert.match(text, new RegExp(`buzz://issue\\?id=${ISSUE_ID}`))
})

test('am Pull Request heißt der Link `pr`', () => {
    const text = wakeMessageContent(ziel({ what: 'comment', art: 'pr' }))
    assert.match(text, /Neuer Kommentar am Pull Request/)
    assert.match(text, new RegExp(`buzz://pr\\?id=${ISSUE_ID}`))
})

test('ohne Anzeigenamen steht das d-Tag der Koordinate im Text', () => {
    assert.match(wakeMessageContent(ziel({ repoName: '' })), /Neues Issue in mein-repo:/)
})

// ── Der Link ────────────────────────────────────────────────────────────────

test('isLinkableDtag folgt der Regel des Referenzclients', () => {
    assert.equal(isLinkableDtag('mein-repo'), true)
    assert.equal(isLinkableDtag('a.b_c-1'), true)
    assert.equal(isLinkableDtag(''), false)
    assert.equal(isLinkableDtag('.versteckt'), false)
    assert.equal(isLinkableDtag('a..b'), false)
    assert.equal(isLinkableDtag('mit leerzeichen'), false)
    assert.equal(isLinkableDtag('sl/ash'), false)
    assert.equal(isLinkableDtag('ä'), false)
    assert.equal(isLinkableDtag('x'.repeat(65)), false)
})

/**
 * NEGATIVBEWEIS (4): lieber gar kein Link als ein halber. Ein `d`-Tag mit
 * Sonderzeichen ergibt eine Adresse, die weder Buzz Desktop noch die CLI parst —
 * der Empfänger klickt und landet nirgends.
 */
test('ein nicht linkbares d-Tag liefert KEINEN Link, sondern die Koordinate', () => {
    const adresse = `30617:${'a'.repeat(64)}:mein repo`
    assert.equal(buzzEntityLink('issue', ISSUE_ID, adresse), '')
    assert.match(wakeMessageContent(ziel({ repoAddress: adresse })), /30617:a{64}:mein repo/)
})

test('eine kaputte Koordinate oder Ereignis-Id liefert keinen Link', () => {
    assert.equal(buzzEntityLink('issue', ISSUE_ID, '30617:nichthex:x'), '')
    assert.equal(buzzEntityLink('issue', 'keineid', ADRESSE), '')
})
