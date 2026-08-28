/**
 * Adapter: Zap-Typen und -Umrechner (NIP-57).
 *
 * ── Welche 0.9.5-API diese Datei vorwegnimmt ─────────────────────────────────────
 * Beide Typen wandern in 0.9.5 nach `@welshman/domain` und behalten ihren Namen:
 * - **`Zap`** ist dort Feld für Feld derselbe Typ (`request`, `response`,
 *   `invoiceAmount`) — reine Weiterleitung, P3 ändert nur den Importpfad.
 * - **`Zapper`** ist dort eine Klasse statt eines Objekttyps, mit `pubkey` und
 *   `nostrPubkey` als PFLICHTfeldern (in 0.8.16 optional) und den Methoden
 *   `validate(receipt)` / `getResponseFilter(pubkey, eventId?)`. Unsere vier
 *   Verwendungen sind reine Typ-Verwendungen, deshalb bleibt der Name hier stehen; die
 *   verschärfte Pflichtfeld-Menge ist die Stelle, an der P3 nachziehen muss.
 *
 * `zapFromEvent(response, zapper)` hat in 0.9.5 kein freistehendes Gegenstück mehr: die
 * Prüfung liegt als `zapper.validate(zapReceiptReader)` an der Klasse, und der
 * app-seitige Weg ist `app.use(Zappers).validateZapReceipt(receipt, parent)` — der
 * zusätzlich den richtigen Empfänger aus den Zap-Splits auflöst, statt immer den ersten
 * `p`-Tag zu nehmen. Das ist ein anderer Zuschnitt mit anderem Ergebnis, keine
 * Umbenennung; hier bleibt deshalb die 0.8.16-Funktion stehen.
 *
 * ── Das ist NICHT die Zap-Fläche ─────────────────────────────────────────────────
 * `js/zaps.ts` ist durch einen Upstream-Bug in 0.9.5 blockiert (das Zapper-Gate in
 * `app/src/plugins/zappers.ts` prüft `info?.pubkey`, ein Feld, das eine
 * NIP-57-lnurl-pay-Antwort gar nicht hat) und bleibt bis 0.9.6 unangetastet. Diese
 * Datei kapselt nur die geteilten Typen und den reinen Umrechner, damit der Rest des
 * Pakets nicht am selben Nagel hängt.
 *
 * **Diese Datei importiert ausschließlich `@welshman/util`** — `js/articleMetrics.ts`
 * hält seine Freiheit von `@welshman/app` ausdrücklich im Kopf fest.
 */
export type { Zap, Zapper } from '@welshman/util'
export { zapFromEvent } from '@welshman/util'
