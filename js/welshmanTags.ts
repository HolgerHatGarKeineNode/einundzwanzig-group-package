/**
 * Adapter: Tag-Leser aus `@welshman/util`.
 *
 * **Warum diese Datei existiert.** Beim Sprung auf welshman 0.9.5 verschwinden alle
 * hier durchgereichten Namen aus `@welshman/util` (gemessen mit
 * `scripts/welshman-bruchflaeche.mjs` gegen die echten 0.9.5-Tarballs). Sie standen
 * vorher in einem Dutzend Dateien als direkter Import. Hinter diesem Adapter ist der
 * Sprung eine Änderung an EINER Datei statt an zwölf.
 *
 * **Reine Durchreiche, keine Interpretation.** Hier wird nichts umbenannt, nichts
 * umgerechnet, nichts gefiltert — sonst wäre P1 kein Umbau der Verdrahtung mehr,
 * sondern ein Verhaltenswechsel.
 *
 * **Diese Datei importiert ausschließlich `@welshman/util`.** Das ist keine Kosmetik:
 * `js/polls.ts` („bewusst welshman-app-frei") und `js/articleMetrics.ts` („rein bis auf
 * `@welshman/util` — kein `core`, kein `@welshman/app`, kein Store") halten diese
 * Reinheit ausdrücklich fest. Ein Adapter, der nebenbei `@welshman/app` hereinzieht,
 * würde sie still aufheben.
 */
export {
    getTag,
    getTags,
    getTagValue,
    getTagValues,
    getListTags,
    getGroupTags,
    getRelayTagValues,
} from '@welshman/util'
