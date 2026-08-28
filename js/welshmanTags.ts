/**
 * Adapter: Tag-Leser — jetzt die **echte** 0.9.5-`Tags`-API.
 *
 * ── Was hier passiert ist ────────────────────────────────────────────────────────
 * In 0.8.16 gab es Ad-hoc-Getter (`getTag`, `getTags`, `getTagValue`, `getTagValues`,
 * `getRelayTagValues`). 0.9.5 ersetzt sie durch eine **Spezifikation**: ein `TagSpec`
 * beschreibt Schlüssel, optionale Wertprüfung und optionale Normalisierung, und
 * `matchTag`/`matchTags`/`tagValue`/`tagValues` werten ihn aus.
 *
 * P1 hat diese Form vorweggenommen und intern auf 0.8.16 abgebildet; der Sprung hat die
 * Rümpfe durch die Originale ersetzt. **Keine Aufrufstelle musste angefasst werden** —
 * Namen, Signaturen und Argumentreihenfolge sind identisch.
 *
 * ── Die eine Verhaltensänderung, die damit eintritt ──────────────────────────────
 * **`tagValues` zieht in 0.9.5 ein `removeUndefined` durch** (`Tags.js:23`), 0.8.16 nicht.
 * Ein wertloses Tag (`["p"]` ohne zweites Feld) lieferte bis eben ein `undefined` im
 * Ergebnis-Array und fehlt jetzt. Der Rückgabetyp sagt das auch: `NonNullable<T>[]`.
 * Eng, aber echt — und der Grund, warum diese Zeile im Sprung-Plan steht.
 *
 * ── Warum die Datei bleibt, statt gelöscht zu werden ─────────────────────────────
 * Wegen der beiden Funktionen unten, die 0.9.5 nicht mehr kennt. Ohne sie wäre das hier
 * eine reine Weiterleitung und die 20 Importeure könnten direkt auf `@welshman/util`
 * zeigen.
 *
 * **Diese Datei importiert ausschliesslich `@welshman/util`** — `js/polls.ts` („bewusst
 * welshman-app-frei") und `js/articleMetrics.ts` („rein bis auf `@welshman/util`") halten
 * diese Reinheit ausdrücklich fest.
 */
import { isRelayUrl } from '@welshman/util'

export type { TagSpec } from '@welshman/util'
export { tagSpec, relayTags, hexTags, tagMatcher, matchTags, matchTag, tagValueExtractor, tagValues, tagValue } from '@welshman/util'

// ── Ohne Gegenstück in 0.9.5 ─────────────────────────────────────────────────────

/**
 * `h`/`group`-Tags mit gültigem Relay-Hinweis im dritten Feld (NIP-29).
 *
 * 0.9.5 hat dafür keinen freien Getter mehr — die Gruppen-Zugehörigkeit liest dort der
 * `RoomMeta`-Reader aus `@welshman/domain`, also eine Klasse mit anderem Wertbild. Der
 * Rumpf hier ist der von 0.8.16 (`util@0.8.16 dist/util/src/Tags.js:24`), Zeichen für
 * Zeichen; die einzige Aufrufstelle liegt in `js/groups.ts:106`, das die Rooms-Phase
 * ohnehin durch `app.use(Rooms)` ersetzt.
 */
export const getGroupTags = (tags: string[][]): string[][] =>
    tags.filter((t) => ['h', 'group'].includes(t[0] as string) && t[1] && isRelayUrl(t[2] || ''))

/**
 * Öffentliche und private Tags einer geparsten Liste, hintereinander.
 *
 * Dasselbe Bild wie oben: in 0.9.5 ist eine Liste ein `ListReader`, und der gibt seine
 * Tags über eigene Methoden heraus. Rumpf aus `util@0.8.16 dist/util/src/List.js:32`,
 * einzige Aufrufstelle `js/groups.ts:104`.
 */
export const getListTags = (list?: { publicTags?: string[][]; privateTags?: string[][] }): string[][] => [
    ...(list?.publicTags || []),
    ...(list?.privateTags || []),
]
