/**
 * **Rollen aus der relay-signierten Mitgliederliste (NIP-29 kind 39002).**
 *
 * Eigenes Modul, obwohl es nur eine Funktion ist: `groups.ts` fasst beim Laden
 * `localStorage` an (synced stores) und ist damit weder unter `node --test` noch in
 * einem Playwright-Node-Kontext ladbar. Die Regel unten entscheidet aber, ob die
 * Oberfläche das Löschen eines Raums anbietet — sie gehört geprüft, nicht geglaubt.
 *
 * **Die Tag-Form unterscheidet sich je Liste UND je Relay** (am laufenden Relay gemessen,
 * 2026-07-29):
 *
 * | Quelle        | Tag                          | Rolle auf |
 * |---------------|------------------------------|-----------|
 * | Buzz  39002   | `["p","4b3cac…","","owner"]` | Index 3   |
 * | Buzz  39001   | `["p","4b3cac…","owner"]`    | Index 2   |
 * | zooid 39002   | `["p","2dbaf5…"]`            | — keine   |
 *
 * Diese Funktion liest ausschliesslich die **39002**-Form (Index 3; Index 2 ist dort der
 * leere Relay-Hint). Auf zooid liefert sie damit immer die leere Menge — und die
 * Oberfläche bietet dort kein Löschen an. Das ist die bewusst konservative Wahl: lieber
 * eine Funktion zu wenig als eine fälschlich freigegebene.
 */

/**
 * Die Pubkeys, deren `p`-Tag in einer 39002-Liste die gesuchte Rolle trägt.
 * Leere/kaputte Tags werden übergangen — Fremd-Events sind nicht validiert.
 */
export const roleHoldersFromMembersTags = (tags: string[][], role = 'owner'): Set<string> => {
    const out = new Set<string>()
    for (const tag of tags) {
        if (tag[0] === 'p' && tag[1] && tag[3] === role) {
            out.add(tag[1])
        }
    }
    return out
}
