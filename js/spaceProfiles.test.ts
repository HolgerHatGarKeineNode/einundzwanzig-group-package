/**
 * Vertragstest gegen die **installierte** welshman-Fassung: kommt ein kind 0 vom
 * Space-Relay bei uns an, OHNE ins gemeinsame Repository zu geraten — und gewinnt
 * danach beim Anzeigen trotzdem das native Profil?
 *
 * Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/spaceProfiles.test.ts
 *
 * **Warum das ein eigener Test ist.** Die Regeln selbst stehen pur in
 * `profileMerge.test.ts`. Hier hängt alles an einer welshman-Eigenheit, die keine Spec
 * garantiert: dass ein `request()` seine Ereignisse an den Aufrufer gibt, OHNE sie ins
 * gemeinsame Repository zu schreiben. Genau diese Trennung trägt die Konstruktion.
 * Fällt sie in einer künftigen welshman-Fassung weg, fällt dieser Test um — und nicht
 * erst die Fläche.
 *
 * ── Was der 0.9.5-Sprung an diesem Test geändert hat ────────────────────────────
 * Bis 0.8.16 hing der kind-0-Riegel gegen den Workspace-Relay am globalen
 * `netContext.isEventValid`, und der hatte ZWEI Aufrufer: den socket-weiten (schreibt
 * ins Repository) und den request-lokalen (überschreibbar). Der Test baute den Riegel
 * deshalb nach, sonst wäre er grün aus dem falschen Grund gewesen.
 *
 * **Den globalen Slot gibt es in 0.9.5 nicht mehr.** Der Riegel liegt jetzt in der
 * Ingest-Policy der App (`js/welshmanInstance.ts`), also auf dem Weg vom Socket ins
 * Repository — und ein `request()` geht da per Konstruktion nicht durch. Die Zusage
 * unten ist damit nicht schwächer, sondern stärker: sie hängt nicht mehr daran, dass
 * jemand den richtigen der zwei Aufrufer überschreibt, sondern daran, dass `request()`
 * nicht ins Repository schreibt. Genau das misst der zweite Fall.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { get } from 'svelte/store'
import { app } from './welshmanApp.ts'
import { MockAdapter, type AbstractAdapter, type ClientMessage } from '@welshman/net'
import { normalizeRelayUrl, type TrustedEvent } from '@welshman/util'
import { PROFILE } from './welshmanKinds.ts'
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
    {
        // **`name` ist Absicht, nicht Kosmetik.** Ohne ihn truege das Fixture kein
        // einziges Feld bei, das mit dem nativen Profil KOLLIDIERT — die Zusage
        // „der echte Name ueberlebt" waere dann gruen, egal wie herum die Regel steht.
        name: 'buzz-generierter-name',
        display_name: 'ElPresidentoBenito',
        about: 'Workspace-Konto',
        picture: 'https://buzz.test.invalid/media/a.jpg',
    },
    1_785_401_118,
)
const spaceProfilNurSpace = kind0(
    nurSpaceSecret,
    {
        display_name: 'nostr-specialist',
        picture: 'https://buzz.test.invalid/media/b.jpg',
        // Der Zahlungspfad gehoert in den Vertragstest, nicht nur in den puren:
        // `feeds.ts` liest `lud16`/`lud06` aus GENAU diesem Store.
        lud16: 'angreifer@wallet.example',
        nip05: 'ceo@buzz.test.invalid',
    },
    1_786_450_596,
)

/** Fuer den Wiederhol-Fall: ein Pubkey, den die erste Runde nicht bekommt. */
const nachzueglerSecret = generateSecretKey()
const nachzueglerPubkey = getPublicKey(nachzueglerSecret)
const spaceProfilNachzuegler = kind0(nachzueglerSecret, { display_name: 'nachzuegler' }, 1_786_450_600)

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
    const originalGetAdapter = app.netContext.getAdapter
    let unsubscribe: () => void

    before(async () => {
        app.netContext.getAdapter = (): AbstractAdapter => makeAdapter()

        // **Ohne laufendes Abo bleibt `profilesByPubkey` LEER** — nachgemessen an der
        // installierten Fassung: `deriveItemsByKey` füllt seine Map erst beim ersten
        // Abonnenten und dann asynchron (`addEvent` ist `async`). `getProfile()` liefert
        // vorher `undefined`, und der Test wäre grün-blind (kein natives Profil da, also
        // „gewinnt" das Space-Profil scheinbar zu Recht). Die App hat dieses Abo über
        // ihre Feeds ohnehin; hier muss es ausdrücklich stehen.
        unsubscribe = profilesByPubkey.subscribe(() => {})
        app.repository.publish(nativesProfil)
        await tick(50)
        await loadSpaceProfiles(SPACE, [beidePubkey, nurSpacePubkey])
        await tick(250)
    })

    after(() => {
        unsubscribe()
        app.netContext.getAdapter = originalGetAdapter
    })

    test('die Space-Profile kommen an', () => {
        assert.equal(getSpaceProfile(beidePubkey)?.display_name, 'ElPresidentoBenito')
        assert.equal(getSpaceProfile(nurSpacePubkey)?.display_name, 'nostr-specialist')
    })

    test('… und NICHT ins gemeinsame Repository', () => {
        const gespeichert = app.repository.query([{ kinds: [PROFILE], authors: [beidePubkey] }]) as TrustedEvent[]

        assert.deepEqual(
            gespeichert.map((event) => event.id),
            [nativesProfil.id],
            'das jüngere Space-Profil hätte das native verdrängt — kind 0 ist ersetzbar',
        )
        assert.equal(app.repository.query([{ kinds: [PROFILE], authors: [nurSpacePubkey] }]).length, 0)
    })

    test('DIE ALTE GEFAHR: der echte Name überlebt das jüngere Space-Profil', () => {
        const gemergt = get(profilesByPubkey).get(beidePubkey)

        // Beide Seiten tragen ein `name`, das Space-Event ist das juengere: genau der
        // Fall, in dem das Repository das Falsche waehlen wuerde.
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

    test('das Bild vom Space-Relay steht im Profil — die Flaeche holt es signiert', () => {
        // Es ist ohne Blossom-Auth nicht ladbar, aber es ist auch nicht wertlos:
        // `blossomMedia.ts` holt genau diese URL mit dem Schluessel des Nutzers.
        assert.equal(getSpaceProfile(nurSpacePubkey)?.picture, 'https://buzz.test.invalid/media/b.jpg')
        assert.equal(get(profilesByPubkey).get(nurSpacePubkey)?.picture, 'https://buzz.test.invalid/media/b.jpg')
    })

    test('KEINE Zahlungsadresse und kein Space-Event im Anzeige-Objekt', () => {
        // `feeds.ts:947/1130` liest `lud16 || lud06` aus genau diesem Store und macht
        // daraus das Zap-Ziel. Der Store selbst fuehrt die Felder gar nicht erst.
        assert.equal(getSpaceProfile(nurSpacePubkey)?.lud16, undefined)
        const gemergt = get(profilesByPubkey).get(nurSpacePubkey)
        assert.equal(gemergt?.lud16, undefined)
        assert.equal(gemergt?.nip05, undefined)
        assert.equal(gemergt?.event, undefined)
    })
})

/**
 * Blocker 3: eine Runde, die der Relay NICHT beantwortet, darf die Pubkeys nicht fuer
 * die Sitzung sperren. Der realistische Fall ist die NIP-42-Abweisung —
 * `warmProfiles` feuert fire-and-forget, oft bevor der Signer steht, und Buzz
 * antwortet dann `CLOSED auth-required: …`. Das ist KEIN Wurf: `requestOne` schliesst
 * und loest leer auf. Nur das ausbleibende EOSE unterscheidet ihn von „kennt sie nicht".
 */
describe('Fehlgeschlagene Runde gibt die Pubkeys wieder frei', () => {
    const originalGetAdapter = app.netContext.getAdapter
    let modus: 'abgewiesen' | 'antwortet' = 'abgewiesen'

    const makeSchaltbarenAdapter = (): MockAdapter => {
        const adapter: MockAdapter = new MockAdapter(SPACE, (message: ClientMessage) => {
            if (message[0] !== 'REQ') {
                return
            }
            const subId = message[1] as string
            setTimeout(() => {
                if (modus === 'abgewiesen') {
                    adapter.receive(['CLOSED', subId, 'auth-required: authenticate before subscribing'])
                } else {
                    adapter.receive(['EVENT', subId, spaceProfilNachzuegler])
                    adapter.receive(['EOSE', subId])
                }
            }, 0)
        })

        return adapter
    }

    before(() => {
        app.netContext.getAdapter = (): AbstractAdapter => makeSchaltbarenAdapter()
    })

    after(() => {
        app.netContext.getAdapter = originalGetAdapter
    })

    test('abgewiesene Runde bringt nichts', async () => {
        assert.equal(await loadSpaceProfiles(SPACE, [nachzueglerPubkey]), 0)
        assert.equal(getSpaceProfile(nachzueglerPubkey), undefined)
    })

    test('… und der zweite Anlauf nach dem Login kommt durch', async () => {
        modus = 'antwortet'

        assert.equal(await loadSpaceProfiles(SPACE, [nachzueglerPubkey]), 1, 'der Merker darf nach einer unbeantworteten Runde nicht stehen bleiben')
        assert.equal(getSpaceProfile(nachzueglerPubkey)?.display_name, 'nachzuegler')
    })

    test('GEGENPROBE: eine BEANTWORTETE Runde ohne Treffer wird nicht wiederholt', async () => {
        // Sonst fragte jeder Feed-Re-Derive dieselben Fremd-Pubkeys erneut an.
        const fremd = getPublicKey(generateSecretKey())

        assert.equal(await loadSpaceProfiles(SPACE, [fremd]), 0)
        // Zweiter Aufruf: der Merker steht, es geht gar keine Anfrage mehr raus —
        // messbar daran, dass er auch dann 0 liefert, wenn der Relay antworten WUERDE.
        assert.equal(await loadSpaceProfiles(SPACE, [fremd]), 0)
    })
})
