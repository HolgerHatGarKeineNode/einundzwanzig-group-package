/**
 * Kategorie-Marker im `about`-Feld eines 39000 — REIN & welshman-frei (wie
 * `relayCaps.ts`, `meetupPresentation.ts`, `roomCategories.ts`), testbar ohne
 * Browser-/Store-Runtime (`roomAbout.test.ts`). KEINE relativen Imports mit
 * Endung-los — sonst laeuft der Node-Test-Runner nicht mehr.
 *
 * ── Warum es das gibt ──
 *
 * Auf zooid traegt ein Raum seine Kategorie in eigenen Tags: `["t","meetup"]`
 * plus `["i","meetup:<id>"]`. Das funktioniert dort, weil zooid die Tags eines
 * 9002 unveraendert ins 39000 uebernimmt.
 *
 * Buzz erzeugt das 39000 selbst, aus dem Datenbankzustand, mit einem fest
 * verdrahteten Tag-Satz (`handlers/side_effects.rs:1054-1105`): `d`, `name`,
 * `about`, `public`/`private`, `closed`, `t`, `topic`, `purpose`, `archived`,
 * `ttl`. Eigene Marker-Tags kommen dort nie an — und `t` ist bei Buzz mit dem
 * `channel_type` (`stream`/`forum`/`dm`) belegt, kollidiert also frontal.
 *
 * Uebrig bleibt `about`: ein freies Textfeld, das nur Owner/Admin schreiben
 * duerfen (`side_effects.rs:589-594`) — im Gegensatz zu `topic`/`purpose`, die
 * jedes Mitglied aendern kann und die als Anker deshalb untauglich sind.
 *
 * ── Das Format ──
 *
 *   einundzwanzig:<typ>:<id> — <freier Text>
 *
 * Beispiel: `einundzwanzig:meetup:1234 — Meetup Nuernberg`
 *
 * Der Praefix macht den Raum **selbstbeschreibend**: auch ein fremder Client,
 * der unsere Konvention nicht kennt, sieht im 39000, worum es geht. Fuer
 * gezieltes Filtern gibt es zusaetzlich einen Kategorie-Index als kind 30078
 * (`#d`-gefiltert, serverseitig) — `about` ist mehrbuchstabig und damit per
 * Nostr-Filter nicht adressierbar.
 *
 * ── Kein Modus-Schalter ──
 *
 * Dieses Modul kennt weder Relay noch Weiche. Die Aufrufer lesen erst die
 * Marker-Tags und fallen auf den `about`-Praefix zurueck; welches Relay
 * dahintersteht, entscheidet sich am DATENFORMAT, nicht an einer Konfiguration.
 * Das haelt beide Wege gleichzeitig lauffaehig — noetig, solange zooid und Buzz
 * parallel bedient werden.
 */

/** Praefix, mit dem jeder von uns gesetzte Kategorie-Marker beginnt. */
export const ABOUT_MARKER_PREFIX = 'einundzwanzig:'

/** Ergebnis von [[parseAboutMarker]]. */
export type AboutMarker = {
    /** Kategorie, z. B. `meetup` oder `proposal`. */
    kind: string
    /** Stabile Fremd-id der Entitaet ('' wenn der Marker keine traegt). */
    id: string
}

/**
 * Liest den Kategorie-Marker aus einem `about`-Text.
 *
 * Toleriert fehlenden Freitext (`einundzwanzig:meetup:1234`), fehlende id
 * (`einundzwanzig:meetup`) und beliebige Trenner danach. Liefert `null`, wenn
 * kein Marker da ist — ein Raum ohne Praefix ist schlicht unkategorisiert, das
 * ist kein Fehler.
 */
export const parseAboutMarker = (about: string | null | undefined): AboutMarker | null => {
    const text = (about ?? '').trim()
    if (!text.startsWith(ABOUT_MARKER_PREFIX)) {
        return null
    }
    // Alles bis zum ersten Leerzeichen ist der Marker; der Rest ist Freitext.
    const marker = text.slice(ABOUT_MARKER_PREFIX.length).split(/\s/)[0] ?? ''
    if (!marker) {
        return null
    }
    const sep = marker.indexOf(':')
    if (sep === -1) {
        return { kind: marker, id: '' }
    }
    return { kind: marker.slice(0, sep), id: marker.slice(sep + 1) }
}

/**
 * Baut den `about`-Text fuer einen Raum — die Gegenrichtung zu
 * [[parseAboutMarker]]. Genau diese Form schreibt `scripts/sync-meetup-rooms.sh`
 * im Buzz-Modus; die beiden muessen zusammenpassen.
 */
export const buildAboutMarker = (kind: string, id: string, text = ''): string => {
    const head = `${ABOUT_MARKER_PREFIX}${kind}:${id}`
    return text ? `${head} — ${text}` : head
}

/** Hebt den `about`-Wert aus den ROH-Tags eines 39000. */
export const readAboutTag = (tags: string[][]): string => {
    for (const tag of tags) {
        if (tag[0] === 'about' && typeof tag[1] === 'string') {
            return tag[1]
        }
    }
    return ''
}
