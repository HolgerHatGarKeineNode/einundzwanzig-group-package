/**
 * **Der Beleg, dass die Erwähnung den Agenten wirklich trifft.**
 *
 * `buzz-acp` weckt einen Agenten nur bei einem `["p", <64-hex>, …]`-Tag —
 * `filter.rs:392-396` vergleicht den zweiten Tag-Wert als rohe Zeichenkette
 * gegen den Hex-Pubkey des Agenten. Kein npub, kein nprofile, keine
 * Großschreibung. Zwischen Vorschlag und Tag liegen bei uns drei Stationen:
 *
 *   agentMentionItems (npub)  →  mentionInsert (`nostr:npub… `)
 *                             →  mentionPubkeys (zurück nach hex)
 *                             →  withMentionTags (`["p", hex, url]`)
 *
 * Dieser Test fährt **alle drei echt** — keine nachgebaute Regex, keine
 * nachgebaute Einfügeform. Genau deshalb ist `withMentionTags` aus `feeds.ts`
 * exportiert: eine Kopie im Test bewiese nur, dass die Kopie funktioniert.
 *
 * Gemessen wird gegen einen **echten** Agentenschlüssel aus
 * `/home/user/buzz-team/registry.json` (ceo, Stand 2026-08-23) — nicht gegen
 * `'ab'.repeat(32)`. Ein synthetischer Schlüssel hat 64 gültige Hexstellen per
 * Konstruktion; ein echter deckt zusätzlich ab, dass die bech32-Runde ihn
 * unverändert zurückgibt.
 *
 * Der `localStorage`-Doppel steht hier, weil `feeds.ts` über `core.ts` den
 * App-Boot mitzieht (`session.ts` liest beim Modul-Eval). Er wird gesetzt, bevor
 * irgendetwas geladen ist, und lebt nur in dieser Datei — dasselbe Muster wie in
 * `activeSpacePersistenz.test.ts`.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/agentPTag.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as nip19 from 'nostr-tools/nip19'

const daten = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => daten.get(k) ?? null,
    setItem: (k: string, v: string): void => void daten.set(k, v),
    removeItem: (k: string): void => void daten.delete(k),
}

import { agentMentionItems, type AgentEntry } from './agentDirectoryData.ts'
import { mentionInsert, mentionPubkeys } from './interactions.ts'
// Dynamisch und NACH dem Speicher-Doppel: `feeds.ts` liest beim Modul-Eval.
const { withMentionTags } = await import('./feeds.ts')

/** ceo aus `registry.json`; identisch mit dem Autor seines 10100 am Produktivrelay. */
const CEO_REGISTRY = '40b87b4cc62aeb820b10b4e652b26ba7e6793933736185ee2b821dafa2683b49'
const KANAL = '576d38b2-9372-418e-93ec-134ca508722c'
const OWNER = '0adf67475ccc5ca456fd3022e46f5d526eb0af6284bf85494c0dd7847f3e5033'
const URL = 'wss://buzz.einundzwanzig.space/'

const ceo: AgentEntry = {
    pubkey: CEO_REGISTRY,
    name: 'ceo',
    displayName: 'ceo',
    agentType: 'agent',
    channelIds: [KANAL],
    respondTo: 'allowlist',
    respondToAllowlist: [OWNER],
    status: 'online',
    createdAt: 1787436616,
}

const vorschlag = () => {
    const [item] = agentMentionItems({
        agents: [ceo],
        h: KANAL,
        viewerPubkey: OWNER,
        spaceKind: 'buzz',
        encodeNpub: nip19.npubEncode,
    })
    assert.ok(item, 'Vorbedingung: der Vorschlag entsteht überhaupt')
    return item
}

test('die ganze Kette endet in ["p", <64-hex des ceo>, url]', () => {
    const entwurf = `${mentionInsert(vorschlag())}bitte übernehmen`
    const tags = withMentionTags([['h', KANAL]], entwurf, URL)

    const pTags = tags.filter((t) => t[0] === 'p')
    assert.equal(pTags.length, 1)
    assert.deepEqual(pTags[0], ['p', CEO_REGISTRY, URL])
    // Die Form, die buzz-acp vergleicht — buchstäblich nachgeprüft, nicht
    // aus „deepEqual ist ja grün" gefolgert.
    assert.match(pTags[0][1], /^[0-9a-f]{64}$/)
    assert.equal(pTags[0][1].length, 64)
})

test('im Entwurf steht bech32, im Tag hex — die Verwechslung wäre stumm folgenlos', () => {
    const entwurf = mentionInsert(vorschlag())
    assert.ok(entwurf.startsWith('nostr:npub1'), `unerwartete Einfügeform: ${entwurf}`)
    assert.ok(!entwurf.includes(CEO_REGISTRY), 'der Entwurf trägt KEINE Hex-Form')
    assert.deepEqual(mentionPubkeys(entwurf), [CEO_REGISTRY])
})

test('der Entwurf trägt das Trennzeichen — sonst frisst die Regex das nächste Wort', () => {
    // Ohne das nachlaufende Leerzeichen in `mentionInsert` würde `…npub1…sofort`
    // als eine einzige bech32-Zeichenkette gelesen und still verworfen: kein
    // p-Tag, kein Fehler, kein geweckter Agent.
    const item = vorschlag()
    assert.deepEqual(mentionPubkeys(`${mentionInsert(item)}sofort`), [CEO_REGISTRY])
    assert.deepEqual(mentionPubkeys(`nostr:${item.npub}sofort`), [])
})

test('ein bereits gesetztes p-Tag desselben Pubkeys wird nicht gedoppelt', () => {
    // Der Fall „Antwort auf den Agenten UND ihn erwähnen": `sendRoomMessage` setzt
    // das p des Antwort-Ziels vor `withMentionTags`. Zwei identische p-Tags wären
    // nicht falsch, aber `buzz-acp` bekäme dieselbe Erwähnung zweimal.
    const tags = withMentionTags([['p', CEO_REGISTRY, URL]], mentionInsert(vorschlag()), URL)
    assert.equal(tags.filter((t) => t[0] === 'p').length, 1)
})

test('ein Mitglieder-Vorschlag geht denselben Weg — der Agent ändert nichts am Sende-Pfad', () => {
    const mensch = 'e420ba194adbea583bb41bffaa0a7e71298534496f2a6bbb175d676dc1a7f9dc'
    const entwurf = mentionInsert({ npub: nip19.npubEncode(mensch) })
    assert.deepEqual(withMentionTags([], entwurf, URL), [['p', mensch, URL]])
})
