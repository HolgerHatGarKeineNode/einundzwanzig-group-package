/**
 * Die **Mechanik** des @-Autocomplete, unabhängig von der Fläche, die ihn zeigt.
 *
 * Zwei Fragen, mehr steht hier nicht:
 *
 *   1. Steht der Cursor gerade in einem `@wort`? → {@link mentionQueryAt}
 *   2. Wie sieht der Entwurf aus, nachdem der Vorschlag übernommen wurde?
 *      → {@link spliceMention}
 *
 * ── Warum das ein eigenes Modul ist ─────────────────────────────────────────
 *
 * Bis hierher stand beides inline in `bridge.ts` (Chat-Composer). Mit dem
 * Forge-Composer gäbe es einen zweiten Ort mit demselben regulären Ausdruck —
 * und damit zwei Antworten auf die Frage „was ist eine Erwähnung im Entwurf".
 * Genau dieser Riss ist im Haus schon einmal aufgetreten (`isCappedEvent`,
 * siehe `storage.ts`); die zweite Kopie altert unbemerkt, und der Unterschied
 * zeigt sich als „im Chat geht es, in der Forge nicht".
 *
 * Rein und importfrei — also unter `node --test` prüfbar
 * (`mentionCompose.test.ts`), was die inline-Fassung nie war.
 *
 * ── Was die Suchform leistet, und was NICHT ─────────────────────────────────
 *
 * `(?:^|\s)@([^\s@]*)$` — das `@` muss am Zeilen-/Wortanfang stehen, damit eine
 * E-Mail-Adresse (`a@b`) oder ein bereits eingefügtes `nostr:npub…` keinen
 * Vorschlag auslöst. Das zweite `@` in der Zeichenklasse ist der Riegel gegen
 * `@a@b`. Und der Anker `$` ist der Grund, warum hier der **Text bis zum
 * Cursor** übergeben wird und nicht der ganze Entwurf: gesucht wird, was
 * unmittelbar vor der Schreibmarke steht, nicht irgendwo im Absatz.
 */

/** Ein `@wort` unmittelbar vor der Schreibmarke — oder `null`. */
export type MentionQuery = {
    /** Was hinter dem `@` steht (ohne das `@`, kleinschreibung NICHT angewandt). */
    query: string
    /** Index des `@` im Entwurf — der Anfang des zu ersetzenden Stücks. */
    start: number
}

const MENTION_QUERY = /(?:^|\s)@([^\s@]*)$/

/**
 * Steht die Schreibmarke in einem `@wort`? `caret` ist `selectionStart`; ein
 * fehlender Wert bedeutet „am Ende".
 */
export const mentionQueryAt = (value: string, caret: number): MentionQuery | null => {
    const bis = Math.max(0, Math.min(caret, value.length))
    const match = MENTION_QUERY.exec(value.slice(0, bis))
    if (!match) {
        return null
    }
    const query = match[1] ?? ''

    return { query, start: bis - query.length - 1 }
}

/**
 * Den Entwurf nach der Übernahme eines Vorschlags — `@query` (ab dem `@`) durch
 * `insert` ersetzt.
 *
 * Liefert die neue Schreibmarke gleich mit: sie hinter das Eingefügte zu setzen
 * ist Teil des Vorgangs und nicht Sache des Aufrufers. Ein `start < 0` (kein
 * offener Vorschlag) lässt den Entwurf unangetastet — der Aufrufer soll dann
 * nichts tun, nicht an Position 0 schreiben.
 */
export const spliceMention = (
    draft: string,
    start: number,
    queryLength: number,
    insert: string,
): { text: string; caret: number } => {
    if (start < 0) {
        return { text: draft, caret: draft.length }
    }
    const before = draft.slice(0, start)
    const after = draft.slice(start + 1 + queryLength)

    return { text: before + insert + after, caret: before.length + insert.length }
}
