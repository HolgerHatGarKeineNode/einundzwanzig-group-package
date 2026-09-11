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
 *
 * ── Update 2026-09-11, @welshman/* 0.9.5 => 0.9.9 ───────────────────────────────
 * Point 1 above expired: 0.9.9 carries `bebf008`, and `Zappers.fetch` now gates on
 * `allowsNostr && nostrPubkey`. The measurements above are kept as the record of what
 * 0.9.5 did, not as a description of what is installed.
 *
 * What did NOT change is why {@link loadZapperForPubkey} is closed. It reads as a
 * workaround for that gate, and after the bump the tempting move is to delete it. Three
 * reasons survive the bump, all re-measured against 0.9.9 — orphaned batcher rejections,
 * `makeLoadItem` backoff answering explicit taps, and the NIP-42 relay round trip. They
 * are spelled out with file and line at the function itself; read that block before
 * touching it.
 */
import { Profiles, Zappers, RelayLists, Router as RouterPlugin } from '@welshman/app'
import {
    RelayScenario,
    ZAP_REQUEST,
    addNoFallbacks,
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
 *
 * ── Die Fassade kann NICHT löschen, und sie sagt das laut ────────────────────────
 *
 * Sie arbeitet auf einer KOPIE und spielt danach nur die Unterschiede per `set` zurück.
 * Ein Schlüssel, den der Aufrufer aus der Kopie entfernt, verschwindet damit aus der
 * Kopie und aus nichts sonst — `MapPlugin` hat kein `delete` in dieser Richtung.
 *
 * Heute ist das folgenlos: die einzige Aufrufstelle (`js/zaps.ts`, `loadZapperNow`) setzt
 * genau einen Schlüssel und entfernt nie einen. Folgenlos ist aber nicht harmlos — die
 * Fassade SIEHT aus wie ein Svelte-Store, und der Vertrag eines Stores schließt Löschen
 * ein. Wer `$zappers.delete(lnurl); return $zappers` schreibt, bekäme heute grünes
 * TypeScript, einen grünen Test und einen Zapper, der weiterlebt: ein zurückgezogenes
 * oder als falsch erkanntes lnurl-pay-Dokument bliebe in der Sammlung und speiste
 * weiterhin den ⚡-Tally.
 *
 * Deshalb wirft die Fassade bei einer versuchten Löschung, statt sie zu schlucken. Das
 * ist ein Programmierfehler und kein Betriebszustand, also ist der Wurf die richtige
 * Lautstärke — und er kann keinen Bestandspfad treffen, weil heute niemand löscht.
 */
export const zappersByLnurl = {
    subscribe: app.use(Zappers).index.$.subscribe,
    update: (fn: (map: Map<string, unknown>) => Map<string, unknown>) => {
        const vorher = new Map(app.use(Zappers).index.get())
        const nachher = fn(new Map(vorher))
        const entfernt = [...vorher.keys()].filter((k) => !nachher.has(k))

        if (entfernt.length > 0) {
            throw new Error(
                'zappersByLnurl.update kann nicht löschen: ' +
                    entfernt.length +
                    ' Schlüssel wurde(n) aus der Kopie entfernt (' +
                    entfernt.slice(0, 3).join(', ') +
                    '), die Sammlung von @welshman/app@0.9.5 kennt dafür keinen Weg. ' +
                    'Die Entfernung wäre still verpufft — siehe Docblock.',
            )
        }

        for (const [k, v] of nachher) {
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
 * **Closed deliberately — and NOT because of the 0.9.5 zapper gate any more.**
 *
 * That gate (`info.pubkey`, a field a NIP-57 lnurl-pay response does not carry) was the
 * reason this threw when it was written, and it is gone: 0.9.9 ships `bebf008` and gates
 * on `allowsNostr && nostrPubkey`. Reading the old justification, the obvious next move
 * is to delete this function and let `resolveZapper` through. Measured against the
 * installed 0.9.9, that would be a regression — three reasons remain, none of them a
 * version bug, each with a user-visible failure behind it:
 *
 * 1. **An unreachable endpoint produces an ORPHAN rejection.** `Zappers.fetch` is still
 *    `batcher(800, …)` (`app/src/plugins/zappers.js:15`), and `batcher` still starts its
 *    work with `setTimeout(_execute, t)` and throws the promise away
 *    (`@welshman/lib/dist/Tools.js:1078`). A rejection there reaches no caller's
 *    `.catch`, and the caller's own promise never settles. A dead wallet domain in
 *    someone's profile — an everyday case — becomes an unhandled rejection in every
 *    viewer's browser. This is what `storage-cache.spec.ts` P4 reported as a "flake"
 *    for weeks.
 * 2. **Exponential backoff answers an explicit user tap.** `makeLoadItem` still throttles
 *    repeat attempts per source (`@welshman/store/dist/store/src/repository.js:477-482`,
 *    the comment says so in as many words). `warmZappers` spends those attempts in the
 *    background for every feed author, so a tap on ⚡ got `undefined` out of the backoff
 *    instead of an answer from the server — "payment endpoint unreachable" on a healthy
 *    address, intermittently.
 * 3. **It drags the OUTBOX relays and NIP-42 in with it.** `loadForPubkey` resolves the
 *    profile first, which authenticates against a dozen foreign relays (a 22242 signature
 *    each) before the zap sheet can open. See `js/bridge.ts`, `openZapSheet` — the sheet
 *    opens first and resolves in the background for exactly this reason.
 *
 * So the throw stays, and so does `loadZapperNow` (`js/zaps.ts`, search `warmZapper`): it
 * fetches the document itself with a real try/catch and writes into the same welshman
 * store the feed reads from. Same state, no orphan, no backoff, no relay round trip.
 *
 * Re-open this only against a welshman release where points 1 and 2 are measurably gone —
 * the two greps above are the check, and they take a minute.
 */
export const loadZapperForPubkey = (_pubkey: string): never => {
    throw new Error(
        'loadZapperForPubkey is closed on purpose, and no longer because of the 0.9.5 zapper gate ' +
            '(fixed in 0.9.9). Zappers.fetch is a batcher whose rejections are orphaned, its loader ' +
            'throttles explicit taps through makeLoadItem backoff, and it resolves the profile over ' +
            'the outbox relays with NIP-42 first. Use loadZapperNow — it fetches the document itself. ' +
            'See the block above this function before reopening.',
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
 *
 * Der `nostrPubkey`-Riegel davor ist NICHT Zierrat, sondern der Rumpf von 0.8.16
 * (`util@0.8.16 dist/util/src/Zaps.js`), den 0.9.5 fallen gelassen hat. Gemessen an
 * beiden installierten Paketen mit einem Zapper ohne `nostrPubkey`:
 *
 *   0.8.16 → Wurf `Zapper did not have a nostr pubkey`
 *   0.9.5  → kein Wurf, Filter `{"kinds":[9735],"authors":[null],…}`
 *
 * `authors:[null]` ist kein leerer Filter, sondern ein REQ, der rausgeht, leer
 * zurückkommt und niemandem sagt, warum: die Zap-Quittung wird ewig erwartet und nie
 * erkannt. Der Aufrufer in der eingefrorenen `js/zaps.ts` verlässt sich ausdrücklich auf
 * den Wurf (Kommentar dort: „wirft ohne `nostrPubkey`"), also gehört der Riegel hierher —
 * wortgleich, damit eine Fehlersuche denselben Text findet wie vor dem Sprung.
 */
export const getZapResponseFilter = ({
    zapper,
    pubkey,
    eventId,
}: {
    zapper: { nostrPubkey?: string; lnurl?: string; pubkey?: string }
    pubkey: string
    eventId?: string
}): Filter => {
    if (!zapper.nostrPubkey) {
        throw new Error('Zapper did not have a nostr pubkey')
    }

    return new ZapperKlasse(zapper as ConstructorParameters<typeof ZapperKlasse>[0]).getResponseFilter(pubkey, eventId)
}

/**
 * Die unsignierte kind-9734-Zap-Request. In 0.9.5 baut das der `ZapRequestWriter` —
 * aber dessen `renderTemplate()` ist `Promise`-wertig (der Writer löst Relay-Hints über
 * den jetzt asynchronen Router auf), und `js/zaps.ts` ruft es synchron in einer Datei,
 * die dieser Sprung nicht anfassen darf.
 *
 * Der Rumpf ist deshalb der von 0.8.16 (`util@0.8.16 dist/util/src/Zaps.js:100-116`),
 * Tag für Tag: `relays`, `amount` in Millisats, `lnurl`, `p`, optional `e`.
 *
 * ── Zwei bewusste Abweichungen vom 0.8.16-Rumpf, beide gemessen ──────────────────
 *
 * **(1) Kein `anonymous`.** 0.8.16 nahm ein `anonymous`-Flag und hängte dafür ein
 * `["anon"]`-Tag an (NIP-57, anonymer Zap). Diese Fläche kennt das nicht: die einzige
 * Aufrufstelle ist `js/zaps.ts` (`zapRequestEvent`), sie übergibt es nie, und ihr
 * Eingabetyp `ZapRequestInput` hat kein solches Feld.
 *
 * Der Parameter fehlt hier deshalb GANZ und steht nicht als ignoriertes Feld im Typ. Das
 * ist der Unterschied zwischen „unterstützen wir nicht" und einem stillen Ausfall: wer
 * anonyme Zaps ergänzt und `anonymous: true` übergibt, bekommt einen Typfehler. Stünde
 * das Feld im Typ und würde nur nicht ausgewertet, ginge der Zap nicht-anonym hinaus und
 * legte den Absender offen — ein Datenschutzfehler, den niemand bemerkt. Wer die Fläche
 * erweitert, ergänzt hier den `["anon"]`-Zweig aus 0.8.16 mit.
 *
 * **(2) `lnurl` ist Pflicht statt optional.** 0.8.16 schrieb `zapper.lnurl` ungeprüft ins
 * Tag; fehlte es, entstand `["lnurl", undefined]`. Unser Wertetyp `Zapper`
 * (`js/welshmanZap.ts`) hat `lnurl: string` als Pflichtfeld, weil `loadZapperNow` es
 * immer setzt (`{...info, lnurl}`). Der Parametertyp bildet das jetzt ab, statt die
 * Lücke mit einem `?? ''` zu füllen — ein leeres `["lnurl", ""]`-Tag wäre gegenüber dem
 * LNURL-Server dieselbe Art von stiller Falschaussage wie das `authors:[null]` weiter
 * unten.
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
    zapper: { lnurl: string }
    pubkey: string
    relays: string[]
    content?: string
    eventId?: string
}): StampedEvent => {
    const tags = [
        ['relays', ...relays],
        ['amount', String(msats)],
        ['lnurl', zapper.lnurl],
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
 *
 * `.policy(addNoFallbacks)` überschreibt hier bewusst die Instanz-Politik. Die
 * `resolver.options` tragen seit `js/welshmanInstance.ts` `addMinimalFallbacks` — richtig
 * für LESENDE Auswahl (ohne sie lädt kein Profil eines Autors ohne kind 10002, das war der
 * Befund, der 17 E2E-Fälle rot machte). Für DIESE Auswahl ist es falsch: Ihr Ergebnis wird
 * nicht abgefragt, sondern in das `["relays",…]`-Tag der kind-9734-Zap-Request geschrieben
 * (`js/zaps.ts`) und damit dem fremden LNURL-Server als Zustellanweisung übergeben.
 *
 * Gemessen mit leerer Relay-Liste des Empfängers:
 *
 *   addNoFallbacks (0.8.16-Form) → []
 *   addMinimalFallbacks          → ["wss://nos.lol/"]
 *
 * Die zweite Zeile nennt dem Zahlungsdienst einen öffentlichen Relay, den der Empfänger nie
 * angegeben hat, und legt die Quittung dort ab, wo er sie nicht sucht. Ein leeres Tag ist
 * ehrlicher als ein geratenes. `js/welshmanRouter.ts` erzwingt an der Schwesterstelle
 * (`eigeneOutboxUrls`) aus demselben Grund dieselbe Politik.
 */
export const Router = {
    get: () => ({
        ForPubkey: (pubkey: string) =>
            new RelayScenario(
                [makeSelection(app.use(RelayLists).readUrls(pubkey).get())],
                app.use(RouterPlugin).resolver.options,
            ).policy(addNoFallbacks),
    }),
}
