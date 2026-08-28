/**
 * Adapter: Zap-Helfer aus `@welshman/util` (NIP-57).
 *
 * **Warum diese Datei existiert.** `Zapper`, `Zap` und `zapFromEvent` verschwinden in
 * 0.9.5 aus `@welshman/util`. Sie stehen heute in vier Dateien, die mit der eigentlichen
 * Zap-Fläche nichts zu tun haben — sie zeigen bloß Summen an (`js/feeds.ts`,
 * `js/longformFeed.ts`, `js/articleMetrics.ts`, `js/bridge.ts`).
 *
 * **Das ist NICHT die Zap-Fläche.** `js/zaps.ts` ist durch einen Upstream-Bug in
 * 0.9.5 blockiert (das Zapper-Gate in `app/src/plugins/zappers.ts` prüft ein Feld, das
 * eine NIP-57-lnurl-pay-Antwort gar nicht hat) und bleibt bis 0.9.6 unangetastet. Diese
 * Datei kapselt nur die geteilten Typen und den reinen Umrechner, damit der Rest des
 * Pakets nicht am selben Nagel hängt.
 *
 * **Diese Datei importiert ausschließlich `@welshman/util`** — `js/articleMetrics.ts`
 * hält seine Freiheit von `@welshman/app` ausdrücklich im Kopf fest.
 */
export type { Zap, Zapper } from '@welshman/util'
export { zapFromEvent } from '@welshman/util'
