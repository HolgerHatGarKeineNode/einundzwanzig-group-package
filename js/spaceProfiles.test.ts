/**
 * Vertragstest gegen die **installierte** welshman-Fassung: kommt ein kind 0 vom
 * Space-Relay bei uns an, OHNE ins gemeinsame Repository zu geraten — und gewinnt
 * danach beim Anzeigen trotzdem das native Profil?
 *
 * Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/spaceProfiles.test.ts
 *
 * **Warum das ein eigener Test ist.** Die Regeln selbst stehen pur in
 * `profileMerge.test.ts`. Hier hängt alles an einer welshman-Eigenheit, die keine
 * Spec garantiert: `netContext.isEventValid` hat ZWEI Aufrufer. Der socket-weite in
 * `@welshman/app` schreibt ins Repository und ist nicht überschreibbar; `requestOne`
 * nimmt daneben ein request-lokales `isEventValid` (`@welshman/net` `request.js:15`:
 * `options.isEventValid || netContext.isEventValid`). Genau diese Trennung trägt die
 * ganze Konstruktion. Fällt sie in einer künftigen welshman-Fassung weg, fällt dieser
 * Test um — und nicht erst die Fläche.
 *
 * Der Kontext-Riegel wird hier nachgebaut wie in `core.ts:225` (kind 0 vom
 * Workspace-Relay ist ungültig). Ohne ihn wäre der Test grün aus dem falschen Grund.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { get } from 'svelte/store'
import { repository } from '@welshman/app'
import { netContext, MockAdapter, type AbstractAdapter, type ClientMessage } from '@welshman/net'
import { PROFILE, normalizeRelayUrl, verifyEvent, type TrustedEvent } from '@welshman/util'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { loadSpaceProfiles, profilesByPubkey, displayProfileByPubkey, getSpaceProfile } from './spaceProfiles.ts'

const SPACE = normalizeRelayUrl('wss://buzz.test.invalid/')

/** Ein Nutzer MIT gepflegtem nativem Profil — und einem jüngeren Buzz-Profil daneben. */
const beideSecret = generateSecretKey()
const beidePubkey = getPublicKey(beideSecret)

/** Ein reiner Space-Account: nirgends im nativen Nostr, nur auf dem Space-Relay. */
const nurSpaceSecret = generateSecretKey()
const nurSpacePubkey = getPublicKey(nurSpaceSecret)

const kind0 = (secret: Uint8Array, content: Record<string, string>, created_at: number): TrustedEvent =>
    finalizeEvent({ kind: PROFILE, created_at, tags: [], content: JSON.stringify(content) }, secret) as unknown as TrustedEvent

/** Das echte, über Jahre gepflegte Profil — ÄLTER als das des Space-Relays. */
const nativesProfil = kind0(beideSecret, { name: 'El Presidento Ben', picture: 'https://image.nostr.build/echt.jpg' }, 1_781_649_668)

/** Was das Space-Relay ausliefert: eigener Name, eigenes (auth-pflichtiges) Bild, JÜNGER. */
const spaceProfilBeide = kind0(
    beideSecret,
    { display_name: 'ElPresidentoBenito', about: 'Workspace-Konto', picture: 'https://buzz.test.invalid/media/a.jpg' },
    1_785_401_118,
)
const spaceProfilNurSpace = kind0(
    nurSpaceSecret,
    { display_name: 'nostr-specialist', picture: 'https://buzz.test.invalid/media/b.jpg' },
    1_786_450_596,
)

/** Ein Relay, das auf jedes REQ beide Space-Profile liefert und dann EOSE sagt. */
const makeAdapter = (): MockAdapter => {
    const adapter: MockAdapter = new MockAdapter(SPACE, (message: ClientMessage) => {
        if (message[0] !== 'REQ') {
            return
        }
        const subId = message[1] as string
        setTimeout(() => {
            adapter.receive(['EVENT', subId, spaceProfilBeide])
            adapter.receive(['EVENT', subId, spaceProfilNurSpace])
            adapter.receive(['EOSE', subId])
        }, 0)
    })

    return adapter
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('Space-Profile: zweite Quelle statt Verdrängung', () => {
    const originalGetAdapter = netContext.getAdapter
    const originalIsEventValid = netContext.isEventValid
    let unsubscribe: () => void

    before(async () => {
        netContext.getAdapter = (): AbstractAdapter => makeAdapter()
        // Der Riegel aus `core.ts`: kind 0 vom Workspace-Relay ist kontextweit ungültig.
        netContext.isEventValid = (event: TrustedEvent, url: string) =>
            event.kind === PROFILE && normalizeRelayUrl(url) === SPACE ? false : verifyEvent(event)

        // **Ohne laufendes Abo bleibt `profilesByPubkey` LEER** — nachgemessen an der
        // installierten Fassung: `deriveItemsByKey` füllt seine Map erst beim ersten
        // Abonnenten und dann asynchron (`addEvent` ist `async`). `getProfile()` liefert
        // vorher `undefined`, und der Test wäre grün-blind (kein natives Profil da, also
        // „gewinnt" das Space-Profil scheinbar zu Recht). Die App hat dieses Abo über
        // ihre Feeds ohnehin; hier muss es ausdrücklich stehen.
        unsubscribe = profilesByPubkey.subscribe(() => {})
        repository.publish(nativesProfil)
        await tick(50)
        await loadSpaceProfiles(SPACE, [beidePubkey, nurSpacePubkey], true)
        await tick(250)
    })

    after(() => {
        unsubscribe()
        netContext.getAdapter = originalGetAdapter
        netContext.isEventValid = originalIsEventValid
    })

    test('die Space-Profile kommen an — trotz Kontext-Riegel', () => {
        assert.equal(getSpaceProfile(beidePubkey)?.display_name, 'ElPresidentoBenito')
        assert.equal(getSpaceProfile(nurSpacePubkey)?.display_name, 'nostr-specialist')
    })

    test('… und NICHT ins gemeinsame Repository', () => {
        const gespeichert = repository.query([{ kinds: [PROFILE], authors: [beidePubkey] }]) as TrustedEvent[]

        assert.deepEqual(
            gespeichert.map((event) => event.id),
            [nativesProfil.id],
            'das jüngere Space-Profil hätte das native verdrängt — kind 0 ist ersetzbar',
        )
        assert.equal(repository.query([{ kinds: [PROFILE], authors: [nurSpacePubkey] }]).length, 0)
    })

    test('DIE ALTE GEFAHR: der echte Name überlebt das jüngere Space-Profil', () => {
        const gemergt = get(profilesByPubkey).get(beidePubkey)

        assert.equal(gemergt?.name, 'El Presidento Ben')
        assert.equal(gemergt?.picture, 'https://image.nostr.build/echt.jpg')
        assert.equal(displayProfileByPubkey(beidePubkey), 'El Presidento Ben')
        // Die Lücke daneben füllt das Space-Profil trotzdem.
        assert.equal(gemergt?.about, 'Workspace-Konto')
    })

    test('ein reiner Space-Account bekommt Namen statt npub-Initiale', () => {
        assert.equal(get(profilesByPubkey).get(nurSpacePubkey)?.display_name, 'nostr-specialist')
        assert.equal(displayProfileByPubkey(nurSpacePubkey), 'nostr-specialist')
    })

    test('das Bild vom Space-Relay ist raus (401 ohne Blossom-Auth)', () => {
        assert.equal(getSpaceProfile(nurSpacePubkey)?.picture, undefined)
        assert.equal(get(profilesByPubkey).get(nurSpacePubkey)?.picture, undefined)
    })
})
