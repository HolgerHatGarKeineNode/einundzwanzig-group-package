/**
 * Adapter: die Zap-API, die `js/zaps.ts` benutzt — **die eingefrorene Fläche**.
 *
 * `js/zaps.ts` bleibt beim 0.9.5-Sprung logisch unverändert (so die Vorgabe): kein
 * anderer Ablauf, keine andere Bedingung, kein anderer Datenfluss. Nur seine
 * Importzeilen zeigen ab jetzt hierher. Diese Datei liefert die Symbole, die
 * `@welshman/app` und `@welshman/util` in 0.9.5 nicht mehr exportieren, in ihrer alten
 * Signatur.
 *
 * ── Was GEMESSEN wurde, bevor hier etwas gebaut wurde ────────────────────────────
 * Der Plan sagt: „Zaps funktionieren nach dem Sprung ohnehin nicht (R1)". Gegen das
 * echte 0.9.5 nachgemessen ist das **so nicht richtig**, und der Unterschied entscheidet
 * darüber, was hier laut sein muss und was nicht:
 *
 * 1. **Das R1-Gate greift nur in welshmans eigenem Lader.** `Zappers.fetch`
 *    (`app/src/plugins/zappers.js:21`) verwirft jedes lnurl-Dokument ohne `info.pubkey`
 *    — ein Feld, das eine NIP-57-lnurl-pay-Antwort gar nicht hat. Gemessen an einem
 *    realen Dokument: **verworfen**. Betroffen ist damit genau ein Weg,
 *    `loadZapperForPubkey`.
 * 2. **Unser heisser Pfad geht da nicht durch.** `loadZapperNow` (`js/zaps.ts:249`)
 *    holt das Dokument selbst und schreibt direkt in die Sammlung. Gemessen:
 *    `MapPlugin.set` nimmt ein schlichtes Objekt an, ohne `instanceof`-Zwang, und
 *    `get` gibt genau dieses Objekt zurück. Die Feldzugriffe, auf denen `canZap` und
 *    `canPay` beruhen, funktionieren daran unverändert.
 * 3. **Was wirklich fehlt, sind drei Builder** — `makeZapRequest`,
 *    `getZapResponseFilter` und `zapFromEvent` existieren in 0.9.5 nicht mehr. Das ist
 *    ein Umzug (in `ZapRequestWriter` bzw. an die `Zapper`-Klasse), kein Defekt.
 *
 * ── Was daraus folgt: laut genau dort, wo der Ausfall echt ist ───────────────────
 * {@link loadZapperForPubkey} **wirft** mit einer Meldung, die auf R1 zeigt — das ist
 * der Weg, den 0.9.5 tatsächlich sperrt, und ein stiller `undefined`-Rückgabewert wäre
 * dort das, was der Plan zu Recht verbietet.
 *
 * Die drei Builder sind dagegen **funktional portiert**, nicht künstlich blockiert. Ein
 * absichtlicher Wurf an einer Stelle, die eine Sieben-Zeilen-Portierung heilt, würde die
 * Fläche kaputter machen als der Versionssprung sie macht — und die Meldung „wartet auf
 * 0.9.6" wäre dort schlicht unwahr.
 */
import { Profiles, Zappers, RelayLists, Router as RouterPlugin } from '@welshman/app'
import {
    RelayScenario,
    ZAP_REQUEST,
    makeEvent,
    makeSelection,
    tagSpec,
    tagValue,
    type StampedEvent,
    type Filter,
} from '@welshman/util'
import { Zapper as ZapperKlasse } from '@welshman/domain'
import { app } from './welshmanInstance.ts'
import { ausReader, type Profile } from './welshmanProfile.ts'

export { signer } from './welshmanSession.ts'
import type { Zapper } from './welshmanZap.ts'
export type { Zapper } from './welshmanZap.ts'

/**
 * Zapper aus der Sammlung. 0.9.5: `app.use(Zappers).get(lnurl)`.
 *
 * Der Cast auf unseren Wertetyp ist der ehrliche Weg: die Sammlung ist als
 * `Zapper`-KLASSE typisiert, enthält aber das schlichte Objekt, das `loadZapperNow`
 * hineingelegt hat (am Paket gemessen — `MapPlugin.set` erzwingt kein `instanceof`).
 */
export const getZapper = (lnurl: string): Zapper | undefined =>
    app.use(Zappers).get(lnurl) as Zapper | undefined

/**
 * Die Zapper-Sammlung als Store mit `update` — die Form, die `loadZapperNow` benutzt.
 *
 * 0.9.5 hat dafür `app.use(Zappers).set(lnurl, zapper)`. Der Umweg über eine
 * `update(map => …)`-Fassade existiert nur, damit `js/zaps.ts` unangetastet bleibt; wer
 * neu schreibt, nimmt `set`.
 */
export const zappersByLnurl = {
    subscribe: app.use(Zappers).index.$.subscribe,
    update: (fn: (map: Map<string, unknown>) => Map<string, unknown>) => {
        const kopie = new Map(app.use(Zappers).index.get())
        for (const [k, v] of fn(kopie)) {
            if (app.use(Zappers).get(k) !== v) {
                app.use(Zappers).set(k, v as ZapperKlasse)
            }
        }
    },
}

/**
 * In 0.8.16 musste man Abonnenten nach einem direkten Store-Schreiben von Hand wecken.
 * 0.9.5 erledigt das in `MapPlugin.set` selbst (`emitItem`), also ist hier nichts mehr
 * zu tun. Die Funktion bleibt, damit die Aufrufstelle unverändert bleibt.
 */
export const notifyZapper = (_zapper: unknown): void => {}

/**
 * Profil laden — und als **Datenobjekt** zurückgeben, nicht als Reader.
 *
 * Das ist hier keine Bequemlichkeit, sondern eine stille Falle, die sonst zuschlägt:
 * `js/zaps.ts:270` liest `profile?.lnurl` als FELD. `app.use(Profiles).load()` liefert
 * einen `ProfileReader`, an dem `lnurl` eine METHODE ist — der Ausdruck wäre `truthy`
 * (eine Funktion), und der Zapper-Warmlauf liefe mit einer Funktion als lnurl weiter,
 * ohne dass irgendetwas rot wird.
 */
export const loadProfile = async (pubkey: string): Promise<Profile | undefined> =>
    ausReader(await app.use(Profiles).load(pubkey))

/**
 * **Gesperrt durch R1 — der eine Weg, den 0.9.5 wirklich zumacht.**
 *
 * `Zappers.loadForPubkey` geht durch `Zappers.fetch`, und dessen Gate verlangt
 * `info.pubkey` — ein Feld, das eine NIP-57-lnurl-pay-Antwort nicht führt
 * (`app/src/plugins/zappers.js:21`). Gemessen: ein reales Dokument wird verworfen, die
 * Sammlung bleibt leer, und der Aufrufer bekäme `undefined` ohne jeden Hinweis.
 *
 * Der Fix steht upstream auf `master` (`bebf008`, `allowsNostr && nostrPubkey`), ist in
 * 0.9.5 **nicht** enthalten und hat keinen Tag. Deshalb hier ein Wurf statt eines
 * stillen `undefined`: der einzige Aufrufer ist `resolveZapper` (`js/zaps.ts:64`), und
 * der hat heute keine Produktionsstelle — fiele das je zurück in den heissen Pfad,
 * soll es auffallen.
 */
export const loadZapperForPubkey = (_pubkey: string): never => {
    throw new Error(
        'loadZapperForPubkey ist unter @welshman/app@0.9.5 gesperrt (R1): das Zapper-Gate in ' +
            'plugins/zappers.ts prüft `info.pubkey`, ein Feld, das eine NIP-57-lnurl-pay-Antwort nicht ' +
            'hat — jedes echte Dokument wird verworfen. Der Fix steht upstream auf master (bebf008) und ' +
            'kommt mit 0.9.6. Bis dahin ist `loadZapperNow` der Weg; es holt das Dokument selbst.',
    )
}

/** `getTagValue(key, tags)` → in 0.9.5 `tagValue(tagSpec(key), tags)`. Reiner Umzug. */
export const getTagValue = (key: string, tags: string[][]): string | undefined => tagValue(tagSpec(key), tags)

/**
 * Filter für die kind-9735-Quittungen, die dieser Zapper ausstellen würde.
 *
 * In 0.9.5 eine Methode an der `Zapper`-Klasse. Unser Zapper kommt als schlichtes Objekt
 * aus `loadZapperNow`, deshalb wird er hier in eine Instanz gehoben — deren Konstruktor
 * ist ein `Object.assign` und wirft nie (am Paket gemessen).
 */
export const getZapResponseFilter = ({
    zapper,
    pubkey,
    eventId,
}: {
    zapper: { nostrPubkey?: string; lnurl?: string; pubkey?: string }
    pubkey: string
    eventId?: string
}): Filter =>
    new ZapperKlasse(zapper as ConstructorParameters<typeof ZapperKlasse>[0]).getResponseFilter(pubkey, eventId)

/**
 * Die unsignierte kind-9734-Zap-Request. In 0.9.5 baut das der `ZapRequestWriter` —
 * aber dessen `renderTemplate()` ist `Promise`-wertig (der Writer löst Relay-Hints über
 * den jetzt asynchronen Router auf), und `js/zaps.ts` ruft es synchron in einer Datei,
 * die dieser Sprung nicht anfassen darf.
 *
 * Der Rumpf ist deshalb der von 0.8.16 (`util@0.8.16 dist/util/src/Zaps.js:100-116`),
 * Tag für Tag: `relays`, `amount` in Millisats, `lnurl`, `p`, optional `e`.
 */
export const makeZapRequest = ({
    msats,
    zapper,
    pubkey,
    relays,
    content = '',
    eventId,
}: {
    msats: number
    zapper: { lnurl?: string }
    pubkey: string
    relays: string[]
    content?: string
    eventId?: string
}): StampedEvent => {
    const tags = [
        ['relays', ...relays],
        ['amount', String(msats)],
        ['lnurl', zapper.lnurl ?? ''],
        ['p', pubkey],
    ]
    if (eventId) {
        tags.push(['e', eventId])
    }

    return makeEvent(ZAP_REQUEST, { content, tags })
}

/**
 * Die Relay-Auswahl, die `js/zaps.ts:299` synchron braucht — in der Form, die dort steht
 * (`Router.get().ForPubkey(pubkey).getUrls()`).
 *
 * Warum das synchron geht, obwohl `resolve()` in 0.9.5 asynchron ist, steht ausführlich
 * in `js/welshmanRouter.ts`: asynchron ist nur das BESCHAFFEN der Relay-Listen, und die
 * liegen für diesen Aufruf bereits im Repository.
 */
export const Router = {
    get: () => ({
        ForPubkey: (pubkey: string) =>
            new RelayScenario(
                [makeSelection(app.use(RelayLists).readUrls(pubkey).get())],
                app.use(RouterPlugin).resolver.options,
            ),
    }),
}
