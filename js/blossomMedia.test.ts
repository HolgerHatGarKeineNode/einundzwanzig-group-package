/**
 * Der Ladeweg — ohne Browser, ohne Netz, ohne Signer: alles Aeussere kommt als
 * Abhaengigkeit herein ({@link makeBlossomLoader}).
 *
 * Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/blossomMedia.test.ts
 *
 * Geprueft werden die vier Zusagen, an denen diese Flaeche haengt: eine Signatur je
 * Host (NIP-46 fragt sonst pro Gesicht), kein zweiter Versuch nach einer Ablehnung,
 * kein Signaturversuch ohne Sitzung, und freigegebene `blob:`-URLs.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { bindAvatarState, makeBlossomLoader, type AvatarState, type BlossomDeps, type BlossomResponse } from './blossomMedia.ts'
import { BLOSSOM_AUTH_KIND, type SignedLike } from './blossomAuth.ts'

const HOST = 'https://buzz.test.invalid'
const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const bild = (n: number): string => `${HOST}/media/${String(n).repeat(4)}.jpg`

type Protokoll = {
    signaturen: { kind: number; created_at: number; tags: string[][] }[]
    anfragen: { url: string; authorization: string }[]
    freigegeben: string[]
}

const harness = (over: Partial<BlossomDeps> = {}, antwort: (url: string) => BlossomResponse = () => ({ ok: true, status: 200, blob: async () => ({ groesse: 1 }) })) => {
    const log: Protokoll = { signaturen: [], anfragen: [], freigegeben: [] }
    let jetzt = 1_800_000_000
    let laufendeNummer = 0
    let sitzung = ALICE

    const loader = makeBlossomLoader({
        isProtected: (url: string) => url.startsWith(`${HOST}/`),
        sessionPubkey: () => sitzung,
        sign: async (template): Promise<SignedLike> => {
            log.signaturen.push(template)
            // Der Fake signiert mit der Identitaet der LAUFENDEN Sitzung — wie ein
            // echter Signer. Ein fester Pubkey machte Alices und Bobs Header
            // bytegleich, und die Zusage „Bob liest nie mit Alices Bearer" waere
            // unbeweisbar gewesen.
            return { ...template, pubkey: sitzung, id: 'b'.repeat(64), sig: 'c'.repeat(128) }
        },
        fetchMedia: async (url: string, authorization: string) => {
            log.anfragen.push({ url, authorization })
            return antwort(url)
        },
        createObjectURL: () => `blob:${++laufendeNummer}`,
        revokeObjectURL: (objectUrl: string) => log.freigegeben.push(objectUrl),
        now: () => jetzt,
        ...over,
    })

    return {
        loader,
        log,
        vorspulen: (sekunden: number) => (jetzt += sekunden),
        anmelden: (pubkey: string) => (sitzung = pubkey),
    }
}

describe('Blossom-Ladeweg', () => {
    test('EINE Signatur fuer viele Bilder — nicht eine pro Gesicht', async () => {
        const { loader, log } = harness()

        // Zehn Avatare einer Maintainer-Zeile, gleichzeitig wie beim Rendern.
        const ergebnisse = await Promise.all([...Array(10)].map((_, i) => loader.load(bild(i))))

        assert.equal(log.signaturen.length, 1, 'bei NIP-46 waere jede Signatur eine Nutzer-Bestaetigung')
        assert.equal(log.signaturen[0].kind, BLOSSOM_AUTH_KIND)
        assert.equal(log.anfragen.length, 10)
        assert.equal(new Set(log.anfragen.map((a) => a.authorization)).size, 1, 'alle zehn tragen denselben Header')
        assert.equal(new Set(ergebnisse).size, 10, 'jedes Bild bekommt seine eigene blob:-URL')
    })

    test('… auch nacheinander, solange das Auth-Event gilt — und danach genau eine neue', async () => {
        const { loader, log, vorspulen } = harness()

        await loader.load(bild(1))
        await loader.load(bild(2))
        assert.equal(log.signaturen.length, 1)

        // 46 Minuten spaeter: `created_at` waere dem Relay zu alt (gemessen: −2 h → 401).
        vorspulen(46 * 60)
        await loader.load(bild(3))
        assert.equal(log.signaturen.length, 2)
    })

    test('ein zweites Mal dieselbe URL kostet weder Anfrage noch Signatur', async () => {
        const { loader, log } = harness()

        const erst = await loader.load(bild(1))
        const nochmal = await loader.load(bild(1))

        assert.equal(erst, nochmal)
        assert.equal(log.anfragen.length, 1)
        assert.equal(log.signaturen.length, 1)
    })

    test('OHNE Signer-Sitzung wird gar nicht erst signiert', async () => {
        const { loader, log } = harness({ sessionPubkey: () => '' })

        assert.equal(await loader.load(bild(1)), '', 'kein Bild ist hier der KORREKTE Zustand, kein Fehler')
        assert.equal(log.signaturen.length, 0, 'ein Gast darf keinen Signer-Dialog sehen')
        assert.equal(log.anfragen.length, 0, 'und schon gar keine Anfrage, die nur 401 werden kann')
    })

    test('nach dem Login geht es dann doch — die Absage war nicht endgueltig', async () => {
        let angemeldet = ''
        const { loader, log } = harness({ sessionPubkey: () => angemeldet })

        assert.equal(await loader.load(bild(1)), '')
        angemeldet = ALICE
        assert.notEqual(await loader.load(bild(1)), '')
        assert.equal(log.signaturen.length, 1)
    })

    test('401 fuehrt zur Initiale und NICHT zu einem zweiten Versuch', async () => {
        const { loader, log } = harness({}, () => ({ ok: false, status: 401, blob: async () => ({}) }))

        assert.equal(await loader.load(bild(1)), '')
        assert.equal(await loader.load(bild(1)), '')
        assert.equal(await loader.load(bild(1)), '')

        assert.equal(log.anfragen.length, 1, 'ein Wiederhol-Sturm ist hier der teure Fehler, nicht das fehlende Bild')
    })

    test('403 (kein Mitglied) ebenso — pro URL genau eine Anfrage', async () => {
        const { loader, log } = harness({}, () => ({ ok: false, status: 403, blob: async () => ({}) }))

        await Promise.all([loader.load(bild(1)), loader.load(bild(1)), loader.load(bild(2))])
        await loader.load(bild(1))

        assert.equal(log.anfragen.length, 2, 'zwei URLs, zwei Anfragen — nicht mehr')
    })

    test('eine abgelehnte Signatur sperrt kurz, statt pro Avatar zu fragen', async () => {
        // Der Versuch wird protokolliert und scheitert DANN. Vorher warf dieser Fake
        // sofort, ohne zu protokollieren — die Zaehlung unten war dadurch immer 0 und
        // haette auch eine DAUERHAFTE Sperre durchgewinkt.
        let versuche = 0
        const { loader, vorspulen } = harness({
            sign: async () => {
                versuche++
                throw new Error('Nutzer hat abgelehnt')
            },
        })

        await loader.load(bild(1))
        await loader.load(bild(2))
        await loader.load(bild(3))
        assert.equal(versuche, 1, 'drei Gesichter, EINE Abfrage — sonst prasseln bei NIP-46 drei Dialoge')

        // Der Nutzer darf seine Meinung aendern — aber erst nach der Sperrfrist.
        vorspulen(61)
        await loader.load(bild(4))
        assert.equal(versuche, 2, 'nach der Frist wird wieder gefragt, sonst waere die Sperre endgueltig')
    })

    test('F1: nach dem Abmelden kommt KEIN Header mehr aus dem Cache', async () => {
        const { loader, log, anmelden } = harness()

        await loader.load(bild(1))
        assert.equal(log.anfragen.length, 1, 'Vorbedingung: angemeldet, ein Auth-Event liegt im Cache')

        anmelden('')
        assert.equal(await loader.load(bild(2)), '')

        assert.equal(log.anfragen.length, 1, 'ein `server`-Auth ist ein 45-Minuten-Lesebearer, kein Ticket fuer EIN Bild')
        assert.equal(log.freigegeben.length, 1, 'und die blob:-URLs des Abgemeldeten sind weg')
    })

    test('F1: beim Nutzerwechsel wird neu signiert, nichts uebernommen', async () => {
        const { loader, log, anmelden } = harness()

        await loader.load(bild(1))
        const alicesHeader = log.anfragen[0].authorization

        anmelden(BOB)
        await loader.load(bild(2))

        assert.equal(log.signaturen.length, 2, 'Bob bekommt sein eigenes Auth-Event')
        assert.notEqual(log.anfragen[1].authorization, alicesHeader, 'Bob darf nie mit Alices Bearer lesen')
        assert.equal(log.freigegeben.length, 1, 'Alices blob:-URLs sind beim Wechsel widerrufen')
    })

    test('F1: revokeAll raeumt auch das MITTEL, nicht nur die Bilder', async () => {
        const { loader, log } = harness()

        await loader.load(bild(1))
        loader.revokeAll()
        await loader.load(bild(2))

        assert.equal(log.signaturen.length, 2, 'nach dem Raeumen muss neu signiert werden')
    })

    test('blob:-URLs werden freigegeben, wenn der Cache ueberlaeuft', async () => {
        const { loader, log } = harness({ maxCached: 2 })

        const erstes = await loader.load(bild(1))
        await loader.load(bild(2))
        await loader.load(bild(3))

        assert.deepEqual(log.freigegeben, [erstes], 'sonst waechst der Speicher mit jedem Raumwechsel')

        loader.revokeAll()
        assert.equal(log.freigegeben.length, 3)
    })

    test('fremde Bilder ruehrt der Ladeweg nicht an', async () => {
        const { loader, log } = harness()

        assert.equal(loader.needsAuth('https://image.nostr.build/x.jpg'), false)
        assert.equal(await loader.load('https://image.nostr.build/x.jpg'), '')
        assert.equal(loader.needsAuth(''), false)
        assert.equal(loader.needsAuth(undefined), false)
        assert.equal(log.signaturen.length, 0)
        assert.equal(log.anfragen.length, 0)
    })

    test('ein Netzfehler merkt sich nichts — aber wiederholt auch nicht von selbst', async () => {
        let versuche = 0
        const { loader, log } = harness({
            fetchMedia: async () => {
                versuche++
                throw new Error('offline')
            },
        })

        assert.equal(await loader.load(bild(1)), '')
        assert.equal(versuche, 1)
        assert.equal(log.freigegeben.length, 0)
    })
})

describe('Zustand der Avatar-Flaeche', () => {
    const zustand = (): AvatarState => ({ imgOrig: true, imgBroken: true, needsAuth: true, authSrc: 'alt' })

    test('fremdes Bild: die Proxy-Kette bleibt zustaendig, nichts wird geladen', async () => {
        const { loader, log } = harness()
        const state = zustand()

        bindAvatarState(loader, state, 'https://image.nostr.build/x.jpg')

        assert.deepEqual(state, { imgOrig: false, imgBroken: false, needsAuth: false, authSrc: '' })
        assert.equal(log.anfragen.length, 0)
    })

    test('geschuetztes Bild: erst KEIN <img>, dann die blob:-URL', async () => {
        const { loader } = harness()
        const state = zustand()

        bindAvatarState(loader, state, bild(1))
        // Sofort nach dem Binden: needsAuth true, authSrc leer → die Flaeche zeigt die
        // Initiale und baut KEIN <img> mit der rohen URL.
        assert.equal(state.needsAuth, true)
        assert.equal(state.authSrc, '')
        assert.equal(state.imgBroken, false)

        await new Promise((resolve) => setTimeout(resolve, 0))
        assert.match(state.authSrc, /^blob:/)
        assert.equal(state.imgBroken, false)
    })

    test('geschuetztes Bild ohne Zugriff: Initiale, und zwar erst nach der Antwort', async () => {
        const { loader } = harness({}, () => ({ ok: false, status: 403, blob: async () => ({}) }))
        const state = zustand()

        bindAvatarState(loader, state, bild(1))
        await new Promise((resolve) => setTimeout(resolve, 0))

        assert.equal(state.authSrc, '')
        assert.equal(state.imgBroken, true)
    })
})
