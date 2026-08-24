/**
 * P2 — die **Adresse eines einzelnen Vorgangs** auf `/forge/{naddr}`.
 *
 * Rein: kein Netz, kein Store, kein welshman, kein `window`. Der Node-Test-Runner
 * lädt das Modul unverändert
 * (`node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeVorgang.test.ts`).
 *
 * ── Warum Query und nicht Route ─────────────────────────────────────────────
 *
 * Ein Issue ist `kind 1621`, ein Pull Request `kind 1618` — beide sind **nicht
 * adressierbar** (kind < 10000, kein `d`-Tag). Ein Routensegment bräuchte
 * deshalb einen `nevent` samt Relay-Hints; gemessen sind das 68–247 Zeichen für
 * eine Information, die als rohe Ereignis-Id 64 Zeichen belegt und auf dieser
 * Seite ohnehin eindeutig ist (die Seite spricht mit genau EINEM Relay). Buzz
 * selbst adressiert so — `/projects/30617:<owner>:<d>?issueId=<id>`
 * (`docs/buzz-entity-links.md:199-200`).
 *
 * Die `nevent`-Bauform gibt es im Haus für Threads (`routes/group.php:95`). Sie
 * zeigt, dass es ginge — nicht, dass es soll: dort ist der `nevent` die
 * Eintrittskarte in einen fremden Raum auf einem fremden Relay, hier steht das
 * Relay bereits in der Route.
 *
 * ── Die Regeln, und warum jede eine Ausfallrichtung hat ─────────────────────
 *
 * 1. **Nur eine 64-stellige Hex-Id gilt.** Dieselbe Whitelist-Haltung wie bei
 *    `?tab=` (`forgeTab.ts`) und `?space=`: was nicht passt, ist Müll und fällt
 *    auf „kein Ziel" zurück. Ein ungeprüfter Wert liefe sonst als
 *    Attributselektor in eine `querySelector`-Abfrage.
 * 2. **Zwei Ziele sind kein Ziel.** Trägt eine Adresse `?issue=` UND `?pr=`,
 *    wird nicht gewählt, sondern verworfen. Eine Auswahl wäre geraten, und die
 *    Adresse behauptete danach etwas anderes als der Bildschirm zeigt.
 * 3. **Der Tab folgt aus der Art**, nicht aus einem zweiten Parameter. Ein
 *    `?issue=…&tab=code` wäre eine Adresse, die sich selbst widerspricht;
 *    {@link tabForVorgang} löst das an einer Stelle auf, statt die Frage an
 *    zwei Parameter zu verteilen.
 */

/** Der Parameter für ein Issue (kind 1621). */
export const ISSUE_PARAM = 'issue'
/** Der Parameter für einen Pull Request (kind 1618). */
export const PR_PARAM = 'pr'

/** Die beiden Vorgangsarten, die eine eigene Adresse tragen. */
export type VorgangArt = 'issue' | 'pr'

/** Ein adressiertes Ziel, oder `null` für „kein (gültiges) Ziel". */
export type VorgangZiel = { art: VorgangArt; id: string }

const HEX64 = /^[0-9a-f]{64}$/

/**
 * Der Tab, in dem ein Vorgang dieser Art liegt.
 *
 * Die Werte sind die der Repo-Seite (`tabFromLocation` in `forge.ts`) — dort
 * heisst die PR-Liste `pulls`, nicht `pr`. Diese Übersetzung steht hier und
 * nicht im Markup: sonst gäbe es zwei Orte, an denen jemand `pr` schreibt und
 * sich wundert, dass kein Tab umschaltet.
 */
export const tabForVorgang = (art: VorgangArt): 'issues' | 'pulls' => (art === 'issue' ? 'issues' : 'pulls')

/**
 * Liest das Vorgangs-Ziel aus einer Query (`window.location.search`).
 *
 * @param search Die Query-Zeichenkette, mit oder ohne führendes `?`.
 */
export const readVorgang = (search: string): VorgangZiel | null => {
    let params: URLSearchParams
    try {
        params = new URLSearchParams(search)
    } catch {
        return null
    }
    const issue = (params.get(ISSUE_PARAM) ?? '').toLowerCase()
    const pr = (params.get(PR_PARAM) ?? '').toLowerCase()
    const hatIssue = HEX64.test(issue)
    const hatPr = HEX64.test(pr)

    // Regel 2: beide oder keins ergibt kein Ziel.
    if (hatIssue === hatPr) {
        return null
    }

    return hatIssue ? { art: 'issue', id: issue } : { art: 'pr', id: pr }
}

/**
 * Setzt das Ziel in eine bestehende Adresse — `null` entfernt beide Parameter.
 *
 * **Beide, nicht nur den einen.** Wer von einem Issue zu einem Pull Request
 * springt, ohne den alten Parameter zu räumen, erzeugt genau die Adresse, die
 * {@link readVorgang} nach Regel 2 verwirft: der geteilte Link zeigte dann
 * nichts an, obwohl der Absender etwas offen hatte.
 *
 * Die übrige Query bleibt unberührt — `?tab=` und `?from=` gehören anderen.
 */
export const withVorgang = (href: string, ziel: VorgangZiel | null): string => {
    let url: URL
    try {
        url = new URL(href)
    } catch {
        return href
    }
    url.searchParams.delete(ISSUE_PARAM)
    url.searchParams.delete(PR_PARAM)
    if (ziel && HEX64.test(ziel.id.toLowerCase())) {
        url.searchParams.set(ziel.art === 'issue' ? ISSUE_PARAM : PR_PARAM, ziel.id.toLowerCase())
    }

    return url.toString()
}
