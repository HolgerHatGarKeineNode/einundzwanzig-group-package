/**
 * Adapter: Tag-Leser — **in der 0.9.5-Gestalt** (`TagSpec` + `tagValue`/`tagValues`).
 *
 * ── Welche 0.9.5-API diese Datei vorwegnimmt ─────────────────────────────────────
 * `@welshman/util/Tags` aus 0.9.5. Dort sind die Ad-hoc-Getter von 0.8.16
 * (`getTag`, `getTags`, `getTagValue`, `getTagValues`, `getRelayTagValues`) durch eine
 * **Spezifikation** ersetzt: ein `TagSpec` beschreibt Schlüssel, optionale Wertprüfung
 * und optionale Normalisierung, und `matchTag`/`matchTags`/`tagValue`/`tagValues` werten
 * ihn aus. Aus `getTagValue('d', tags)` wird `tagValue(tagSpec('d'), tags)`; aus
 * `getRelayTagValues(tags)` wird `tagValues(relayTags(['r', 'relay']), tags)`.
 * Die Namen, Signaturen und die Reihenfolge der Argumente sind hier die von 0.9.5.
 *
 * ── Was in P3 daraus entfällt ────────────────────────────────────────────────────
 * Die Rümpfe. Jede Funktion hier wird in P3 durch den gleichnamigen Import aus
 * `@welshman/util` ersetzt; danach ist die Datei leer und wird gelöscht.
 * **Keine Aufrufstelle muss angefasst werden** — sie stehen schon in der Zielform.
 *
 * ── Wo bewusst 0.8.16 durchschlägt (P3 muss das wissen) ──────────────────────────
 * Die Rümpfe rechnen NICHT selbst, sie rufen die 0.8.16-Getter. Damit bleibt das
 * Verhalten unter 0.8.16 exakt das von vorher. Ein Unterschied ist dabei bekannt und
 * ausdrücklich stehen gelassen: **0.9.5 zieht in `tagValues` ein `removeUndefined`
 * durch**, 0.8.16 nicht. Ein wertloses Tag (`["p"]` ohne zweites Feld) liefert heute
 * ein `undefined` im Ergebnis-Array und wird nach dem Sprung stillschweigend
 * weggelassen. Das ist eine echte, wenn auch enge Verhaltensänderung — sie gehört in
 * P3, nicht in P1.
 *
 * **Diese Datei importiert ausschließlich `@welshman/util`** — siehe Begründung in
 * `js/welshmanKinds.ts`.
 */
import {
    getTag,
    getTags,
    isRelayUrl,
    getGroupTags as getGroupTags0816,
    getListTags as getListTags0816,
} from '@welshman/util'

/** Beschreibung einer Tag-Auswahl: Schlüssel, optionale Wert-Prüfung, optionale Normalisierung. */
export type TagSpec<T = string> = {
    keys: string[]
    matchValue?: (value: string) => boolean
    normalizeValue?: (value: string) => T
}

/**
 * `tagSpec('d')` / `tagSpec(['a', 'e'])`. `ensurePlural` aus `@welshman/lib` ist hier
 * bewusst NICHT importiert: `js/goals.ts` hängt heute an `@welshman/util` allein, und
 * ein Adapter soll die Abhängigkeitsmenge einer Datei nicht verbreitern.
 */
export const tagSpec = <T = string>(
    keys: string | string[],
    matchValue?: (value: string) => boolean,
    normalizeValue?: (value: string) => T,
): TagSpec<T> => ({ keys: Array.isArray(keys) ? keys : [keys], matchValue, normalizeValue })

/** Tags, deren Wert eine Relay-URL ist — die 0.9.5-Form von `getRelayTagValues`. */
export const relayTags = (keys: string | string[]): TagSpec<string> => tagSpec(keys, isRelayUrl)

/** Tags mit 32-Byte-Hex-Wert (`e`, `p`, …). */
export const hexTags = (keys: string | string[]): TagSpec<string> =>
    tagSpec(keys, (value) => /^[0-9a-f]{64}$/i.test(value))

export const tagMatcher =
    <T>(spec: TagSpec<T>) =>
    (tag: string[]): boolean => {
        if (!spec.keys.includes(tag[0] as string)) {
            return false
        }
        if (spec.matchValue && (!tag[1] || !spec.matchValue(tag[1]))) {
            return false
        }

        return true
    }

/** Alle passenden Tags. Ohne Wert-Prüfung ist das wörtlich das 0.8.16-`getTags`. */
export const matchTags = <T>(spec: TagSpec<T>, tags: string[][]): string[][] => {
    const treffer = getTags(spec.keys, tags)

    return spec.matchValue ? treffer.filter(tagMatcher(spec)) : treffer
}

/** Das erste passende Tag. Ohne Wert-Prüfung wörtlich das 0.8.16-`getTag`. */
export const matchTag = <T>(spec: TagSpec<T>, tags: string[][]): string[] | undefined =>
    spec.matchValue ? matchTags(spec, tags)[0] : getTag(spec.keys, tags)

export const tagValueExtractor =
    <T>(spec: TagSpec<T>) =>
    (tag: string[]): T =>
        (spec.normalizeValue ? spec.normalizeValue(tag[1] as string) : tag[1]) as T

/**
 * Alle Werte der passenden Tags. **Ohne** das `removeUndefined`, das 0.9.5 hier zieht —
 * siehe Modulkopf; das ist die eine bekannte Verhaltensdifferenz, und sie gehört in P3.
 */
export const tagValues = <T>(spec: TagSpec<T>, tags: string[][]): T[] =>
    matchTags(spec, tags).map(tagValueExtractor(spec))

/** Der Wert des ersten passenden Tags. */
export const tagValue = <T>(spec: TagSpec<T>, tags: string[][]): T | undefined => {
    const tag = matchTag(spec, tags)

    return tag ? tagValueExtractor(spec)(tag) : undefined
}

// ── Ohne Gegenstück in 0.9.5: bewusst in der 0.8.16-Form stehen gelassen ─────────
//
// `getGroupTags` (h/group-Tags mit Relay-Hinweis in Feld 3) und `getListTags` (Tags
// einer geparsten Liste) haben in 0.9.5 keine namensgleiche Entsprechung — dort liegen
// beide Fälle in `@welshman/domain` (`RoomMeta`-Reader bzw. `ListReader`), also hinter
// einer Reader-Klasse mit anderem Wertbild. Eine Nachbildung hier hieße, die Klasse zu
// erfinden; das wäre in P3 doppelte Arbeit statt halber. Beide Aufrufstellen liegen in
// `js/groups.ts`, das der Sprung ohnehin komplett trifft.
export const getGroupTags = getGroupTags0816
export const getListTags = getListTags0816
