/**
 * **Der Beleg, dass eine Erwähnung IM FORGE-RUMPF wirklich als `p`-Tag ankommt.**
 *
 * Zwischen dem Vorschlag im Popover und dem Tag am Ereignis liegen drei
 * Stationen, und jede davon gehört einem anderen Modul:
 *
 *   agentMentionItems (npub)  →  mentionInsert (`nostr:npub… `)
 *                             →  mentionPubkeys (zurück nach hex)
 *                             →  buildIssueTags / buildCommentTags (`["p", hex]`)
 *
 * Dieser Test fährt **alle vier echt**. Kein nachgebauter regulärer Ausdruck,
 * keine nachgebaute Einfügeform: eine Kopie bewiese nur, dass die Kopie
 * funktioniert — und genau daran hängt hier, ob ein headless Agent geweckt wird
 * (`buzz-acp/src/filter.rs:392-396` vergleicht `tag[1]` als rohe 64-hex-Zeichen-
 * kette). Dasselbe Muster wie `agentPTag.test.ts`, nur für die Forge-Seite.
 *
 * Die Trennung dahinter: `forgeWriteModels.ts` bleibt REIN (kein welshman) und
 * bekommt die Schlüssel gereicht; `forgeWrite.ts` liest sie mit `mentionPubkeys`
 * aus dem Rumpf. Der Riss zwischen beiden — jemand reicht die Liste nicht mehr
 * durch — wäre in keinem der beiden Modultests sichtbar. Hier ist er es.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeMentionTags.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as nip19 from 'nostr-tools/nip19'
import { agentMentionItems, type AgentEntry } from './agentDirectoryData.ts'
import { mentionInsert, mentionPubkeys } from './interactions.ts'
import { buildCommentTags, buildIssueTags } from './forgeWriteModels.ts'

/** ceo aus `/home/user/buzz-team/registry.json` (Stand 2026-08-23). */
const CEO = '40b87b4cc62aeb820b10b4e652b26ba7e6793933736185ee2b821dafa2683b49'
const KANAL = '576d38b2-9372-418e-93ec-134ca508722c'
const OWNER = 'a'.repeat(64)
const ADDRESS = `30617:${OWNER}:mein-repo`
const ROOT_ID = 'd'.repeat(64)

const ceo: AgentEntry = {
    pubkey: CEO,
    name: 'ceo',
    displayName: 'ceo',
    agentType: 'agent',
    channelIds: [KANAL],
    respondTo: 'anyone',
    respondToAllowlist: [],
    status: 'online',
    createdAt: 1,
}

/** Der Entwurf, wie er nach einem übernommenen Vorschlag wirklich dasteht. */
const entwurfMitErwaehnung = (): string => {
    const [item] = agentMentionItems({
        agents: [ceo],
        h: KANAL,
        // Die Raumliste des Betrachters — ohne sie schlaegt die Flaeche
        // niemanden vor (Riegel gegen einen fremdgesetzten Kanal).
        knownChannelIds: new Set([KANAL]),
        viewerPubkey: OWNER,
        spaceKind: 'buzz',
        encodeNpub: nip19.npubEncode,
    })
    assert.ok(item, 'Kein Vorschlag — dann prüft der Rest dieses Tests nichts')

    return `Bitte schau dir das an, ${mentionInsert(item)}danke.`
}

test('ein erwähnter Agent im Issue-Rumpf landet als 64-hex-p-Tag am 1621', () => {
    const rumpf = entwurfMitErwaehnung()
    // Positivkontrolle für die Kette selbst: im Rumpf steht ein npub, KEIN hex.
    assert.match(rumpf, /nostr:npub1/)
    assert.ok(!rumpf.includes(CEO), 'Der Rumpf trägt bereits hex — dann misst der Test die Umwandlung nicht')

    const tags = buildIssueTags(ADDRESS, 'Titel', mentionPubkeys(rumpf))
    assert.deepEqual(
        tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]),
        [OWNER, CEO],
    )
})

test('dieselbe Kette am Kommentar (kind 1)', () => {
    const tags = buildCommentTags(ADDRESS, ROOT_ID, OWNER, mentionPubkeys(entwurfMitErwaehnung()))
    assert.deepEqual(
        tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]),
        [OWNER, CEO],
    )
})

/**
 * Die Gegenprobe: ein Rumpf OHNE Erwähnung darf die Tag-Form nicht verändern.
 * Sonst wäre der Fall oben auch dann grün, wenn `mentionPubkeys` einfach alles
 * durchreichte, was nach Hex aussieht.
 */
test('ein Rumpf ohne Erwähnung ändert nichts an den Tags', () => {
    const ohne = buildIssueTags(ADDRESS, 'Titel', mentionPubkeys('Nur Text, kein npub.'))
    assert.deepEqual(ohne, buildIssueTags(ADDRESS, 'Titel'))
})

/**
 * **Ein nacktes `npub1…` ohne `nostr:`-Präfix ist KEINE Erwähnung** — weder für
 * `mentionPubkeys` (NIP-27 verlangt das Präfix) noch für welshmans Parser. Wer
 * einen Schlüssel von Hand hineinkopiert, weckt damit niemanden; der Weg über
 * den Vorschlag ist der einzige, der trägt. Festgehalten, weil das Ereignis in
 * beiden Fällen gleich AUSSIEHT.
 */
test('ein hineinkopiertes npub ohne nostr:-Präfix erzeugt kein p-Tag', () => {
    const npub = nip19.npubEncode(CEO)
    const tags = buildIssueTags(ADDRESS, 'Titel', mentionPubkeys(`Hallo ${npub}, schau mal.`))
    assert.deepEqual(
        tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]),
        [OWNER],
    )
})
