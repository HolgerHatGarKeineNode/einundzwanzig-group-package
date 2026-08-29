/**
 * Adapter: Zap-Typen und -Umrechner (NIP-57).
 *
 * ── Wo die Typen jetzt liegen ────────────────────────────────────────────────────
 * Beide sind nach `@welshman/domain` gewandert und behalten ihren Namen:
 * - **`Zap`** ist dort Feld für Feld derselbe Typ (`request`, `response`,
 *   `invoiceAmount`) — reine Weiterleitung.
 * - **`Zapper`** ist dort eine **Klasse** statt eines Objekttyps, mit `pubkey` und
 *   `nostrPubkey` als PFLICHTfeldern (in 0.8.16 optional) und den Methoden
 *   `validate(receipt)` / `getResponseFilter(pubkey, eventId?)`.
 *
 * ── `zapFromEvent`: umgezogen, nicht kaputt — und dabei STRENGER geworden ────────
 * Ein freistehendes `zapFromEvent` gibt es in 0.9.5 nicht mehr; die Prüfung liegt als
 * `zapper.validate(zapReceiptReader)` an der Klasse. Die Funktion unten setzt genau das
 * zusammen. **Die Rümpfe gegeneinander gelesen (0.8.16 `util/src/Zaps.js` gegen 0.9.5
 * `domain/src/other/Zapper.js:32-51`) — ein Unterschied, und er ist ein Sicherheitsfix:**
 *
 * 0.8.16 hatte einen Kurzschluss, der die Signaturprüfung übersprang:
 *
 *     // If the recipient and the zapper are the same person, it's legit
 *     if (responseMeta.p === response.pubkey) { return zap }
 *
 * Wer eine Quittung signierte und sich selbst in ihren `p`-Tag schrieb, bekam damit ein
 * gültiges Zap — ohne dass der `nostrPubkey` des echten Zappers je geprüft wurde. Genau
 * dagegen steht der handgeschriebene Riegel in `js/articleMetrics.ts:612`, der
 * ausdrücklich VOR `zapFromEvent` läuft.
 *
 * **In 0.9.5 ist der Kurzschluss weg**: `validate` prüft `receipt.event.pubkey !==
 * this.nostrPubkey` unbedingt. Unser Riegel bleibt trotzdem stehen — er kostet nichts,
 * und eine Zusage, die an zwei Stellen gilt, überlebt den nächsten Upstream-Umbau.
 *
 * ── Warum diese Datei `@welshman/app`-frei bleibt ────────────────────────────────
 * `js/articleMetrics.ts` hält im Kopf fest, dass es „rein bis auf `@welshman/util`" ist,
 * und sein Test läuft unter `node --test` ohne Browser-Runtime. Ein Import von
 * `@welshman/app` würde hier eine App-Instanz samt Socket-Pool in den Testlauf ziehen.
 *
 * Der Reader braucht einen `KindContext` — aber nur die **Writer** benutzen dessen
 * Resolver (für Relay-Hints beim Rendern). Für das Lesen genügt deshalb ein Kontext mit
 * einem Resolver, der nichts auflöst; er wird nie befragt. Das ist keine Attrappe für
 * einen Test, sondern die kleinste gültige Konfiguration für einen reinen Leser.
 */
import { Resolver, ZAP_RECEIPT, type TrustedEvent } from '@welshman/util'
import { Zapper as ZapperKlasse, ZapReceiptReader } from '@welshman/domain'

export type { Zap } from '@welshman/domain'

/**
 * **Unser** Zapper: das lnurl-pay-Wertbild, wie es wirklich im Store liegt.
 *
 * In 0.9.5 ist `Zapper` eine KLASSE mit `validate()`/`getResponseFilter()` und
 * PFLICHTfeld `pubkey`. Beides passt nicht auf das, was bei uns entsteht:
 * `loadZapperNow` (`js/zaps.ts:249`) holt das lnurl-pay-Dokument selbst und legt ein
 * schlichtes Objekt ab — und ein NIP-57-Dokument führt kein `pubkey` (genau der Punkt,
 * an dem sich das 0.9.5-Zapper-Gate blamiert, siehe `js/welshmanZapperGate.test.ts`).
 *
 * Am laufenden Paket gemessen: `MapPlugin.set` nimmt dieses Objekt an (kein
 * `instanceof`-Zwang) und `get` gibt es unverändert zurück. Der Datentyp bildet die
 * Laufzeit also korrekt ab — die Klasse täte es nicht. Wo eine Klassenmethode gebraucht
 * wird, hebt {@link zapFromEvent} den Wert in eine echte Instanz.
 */
export type Zapper = {
    /** Pflicht, weil unser Ladepfad ihn immer setzt (`{...info, lnurl}`). */
    lnurl: string
    pubkey?: string
    nostrPubkey?: string
    callback?: string
    minSendable?: number
    maxSendable?: number
    allowsNostr?: boolean
}

/** Siehe Modulkopf: gültig, aber nie befragt — Leser brauchen keinen Routen-Auflöser. */
const leseKontext = { resolver: new Resolver(() => []) }

/**
 * Eine kind-9735-Quittung gegen einen Zapper prüfen und, wenn sie standhält, das
 * rekonstruierte Zap zurückgeben. `undefined` heisst „zählt nicht".
 *
 * `zapper` ist bewusst locker typisiert: unser heisser Ladepfad
 * (`js/zaps.ts loadZapperNow`) holt das lnurl-Dokument selbst und legt ein schlichtes
 * Objekt ab — die Felder, auf die `validate` schaut, sind `pubkey`, `nostrPubkey` und
 * `lnurl`. Aus dem wird hier eine echte `Zapper`-Instanz gebaut; deren Konstruktor ist
 * ein `Object.assign` und wirft nie (am Paket gemessen, nicht aus der Signatur gelesen).
 */
export const zapFromEvent = (response: TrustedEvent, zapper: Zapper | undefined) => {
    if (!zapper) {
        return undefined
    }

    return new ZapperKlasse(zapper as ConstructorParameters<typeof ZapperKlasse>[0]).validate(
        new ZapReceiptReader(ZAP_RECEIPT, leseKontext, response).parse(),
    )
}
