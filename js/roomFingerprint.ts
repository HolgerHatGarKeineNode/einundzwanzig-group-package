/**
 * Fingerabdruck einer Raum-Liste — REIN & welshman-frei (wie `roomCategories.ts`),
 * damit die Logik ohne Browser-/Store-Runtime testbar bleibt
 * (`roomFingerprint.test.ts`). KEINE relativen Imports (auch kein Typ-Import auf
 * `groups.ts`): der Node-Test-Runner laedt sonst ueber @welshman/app das
 * `localStorage`. Der Typ ist deshalb strukturell (`RoomLike`).
 *
 * WOZU: Die Raumliste memoisiert ihre Filterung/Sortierung (`_ensureFiltered` in
 * `bridge.ts`) hinter einem Schluessel. Zaehlte dieser nur Laengen und
 * Zeitstempel, ueberlebte jede Aenderung INNERHALB eines Raums den Cache — genau
 * so blieb ein umbenannter Raum (9002 → neues 39000, gleiche Raum-Anzahl) bis zum
 * Reload unter seinem alten Namen stehen. Anlegen/Loeschen fielen nicht auf, weil
 * sie die Laenge aendern.
 *
 * WIE: gefaltet wird ueber ALLE eigenen Felder jedes Raums, nicht ueber eine
 * gepflegte Feldliste. Ein spaeter hinzugefuegtes RoomView-Feld ist damit
 * automatisch erfasst — eine Liste haette denselben Fehler nur vertagt.
 *
 * Der Schluessel bleibt trotzdem STABIL, solange sich nichts aendert: gleiche
 * Daten ⇒ gleicher Fingerabdruck ⇒ der Cache haelt. Er ersetzt keinen Cache,
 * er macht ihn ehrlich.
 *
 * GRENZE: Werte werden mit `String(v)` gefaltet — RoomView ist flach (nur
 * Strings/Booleans/Zahlen). Ein spaeteres VERSCHACHTELTES Feld faltete als
 * „[object Object]" und muesste hier ausgepackt werden.
 */

/** Strukturell: alles mit eigenen, flach serialisierbaren Feldern. */
export type RoomLike = Record<string, unknown>

/** Stabile Text-Form eines Feldwerts (null/undefined unterscheidbar von ''). */
const encode = (value: unknown): string => {
    if (value === undefined) {
        return '\u0000u'
    }
    if (value === null) {
        return '\u0000n'
    }
    return String(value)
}

/**
 * 64-Bit-Fingerabdruck (zwei unabhaengige 32-Bit-Falten, FNV-1a + djb2) ueber
 * Anzahl, Reihenfolge, Feldnamen und Feldwerte der Raeume. Zwei Falten, weil eine
 * einzelne 32-Bit-Summe bei einigen hundert Raeumen sonst kollidieren koennte —
 * eine Kollision hiesse: Umbenennung bleibt unsichtbar (der Fehler von zuvor).
 */
export const roomsFingerprint = (rooms: readonly RoomLike[] | null | undefined): string => {
    let h1 = 0x811c9dc5
    let h2 = 5381
    let count = 0
    for (const room of rooms ?? []) {
        count++
        // Sortierte Feldnamen: die Schluessel-Reihenfolge eines Objekts ist keine
        // fachliche Aenderung und darf den Cache nicht brechen.
        for (const key of Object.keys(room).sort()) {
            const text = key + '\u0001' + encode(room[key]) + '\u0002'
            for (let i = 0; i < text.length; i++) {
                const code = text.charCodeAt(i)
                h1 = Math.imul(h1 ^ code, 16777619)
                h2 = (Math.imul(h2, 33) + code) | 0
            }
        }
        // Raum-Grenze mitfalten → „ab"+„c" faltet nicht wie „a"+„bc".
        h1 = Math.imul(h1 ^ 0x1f, 16777619)
        h2 = (Math.imul(h2, 33) + 0x1f) | 0
    }
    return count + '.' + (h1 >>> 0).toString(36) + '.' + (h2 >>> 0).toString(36)
}
