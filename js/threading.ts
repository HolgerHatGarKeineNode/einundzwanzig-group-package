/**
 * **Buzz-natives Threading — die EINE Quelle der Tag-Regeln.**
 *
 * Eine Antwort ist bei Buzz kein eigenes Kind: sie ist eine ganz normale
 * Raum-Nachricht (**kind 9**, mit `h`), die ihre Vorgänger über NIP-10-**markierte**
 * `e`-Tags trägt. Drei Formen, mehr gibt es nicht:
 *
 * ```jsonc
 * // Wurzel              {"kind":9,"tags":[["h","<uuid>"]]}
 * // Antwort auf Wurzel  {"kind":9,"tags":[["h","<uuid>"],["e","<root>","","reply"]]}
 * // Antwort auf Antwort {"kind":9,"tags":[["h","<uuid>"],["e","<root>","","root"],["e","<parent>","","reply"]]}
 * ```
 *
 * **Warum das nicht einfach „NIP-10" ist** — acht am laufenden Relay gemessene Regeln
 * (Belege: `crates/buzz-relay/src/handlers/ingest.rs` `resolve_nip10_thread_meta`,
 * Zeilen 576–729; Messung 2026-07-28 gegen `ws://localhost:3001`):
 *
 * 1. **Die direkte Antwort auf die Wurzel trägt `reply`, NIEMALS `root`.** NIP-10 schreibt
 *    für genau diesen Fall ein einzelnes `root`-markiertes Tag vor — Buzz nimmt so ein
 *    Event zwar an, verknüpft es aber NICHT (`(Some(root), None) => Ok(None)`, ingest.rs:608):
 *    keine `thread_metadata`, kein Zähler, kein 39005, **kein NOTICE**. Ein sauber
 *    NIP-10-konformer Client verliert hier still jede Antwort. Das ist der teuerste
 *    Unterschied und der Grund, warum diese Datei existiert.
 * 2. **Ab Tiefe ≥ 2 sind BEIDE Tags Pflicht** (`root` + `reply`). Nur `reply` auf ein
 *    Nicht-Wurzel-Parent wird hart abgelehnt: `invalid: root tag does not match thread
 *    ancestry` (gemessen).
 * 3. **Der Marker steht an Position 3 und ist Pflicht.** Buzz liest `tag[3]` und verlangt
 *    `tag.len() >= 4` (ingest.rs:588). Markerlose `e`-Tags (auch das positionale
 *    Alt-NIP-10) werden ignoriert → Event angenommen, aber unverknüpft. Es gibt genau
 *    zwei gültige Marker: `root` und `reply`; `mention` fällt durch.
 * 4. **Position 2 (Relay-Hint) bleibt leer, muss aber DA sein**, sonst rutscht der Marker
 *    auf Index 2 und Regel 3 greift nicht. Ein gefüllter Hint schadet nicht (ignoriert).
 * 5. **Der Parent muss beim Relay liegen, BEVOR die Antwort kommt** — sonst `invalid:
 *    reply parent not found`. Kein optimistisches Senden über eine noch unbestätigte
 *    Wurzel (siehe `feeds.ts sendThreadReply`).
 * 6. **`p`-Tags spielen fürs Threading keine Rolle** — Buzz liest sie nie (ingest.rs
 *    liest ausschließlich `e`). Mentions bleiben davon unberührt.
 * 7. **Antworten liegen im selben Raum wie die Wurzel** (`h` identisch; ein Parent aus
 *    einem anderen Kanal wird abgelehnt) und erscheinen deshalb im `#h`-Raumfilter MIT.
 *    Wer den Slack-Schnitt will, filtert client-seitig — {@link isRootMessage}.
 * 8. **`#e` ist markerblind.** Der Filter matcht per JSONB-Containment jedes `e`-Tag mit
 *    dieser id (auch `mention`, auch Reaktionen) — also immer nachfiltern
 *    ({@link threadRootId}), und **nie ohne `kinds`** anfragen (ein `kinds`-loser Filter
 *    wird relayweit mit `restricted: p-gated events require #p matching your pubkey`
 *    geschlossen, gemessen).
 *
 * Bewusst OHNE Laufzeit-Importe (nur ein `import type`, der beim Strippen verschwindet):
 * dieses Modul muss aus `feeds.ts`/`interactions.ts` (Browser, Vite) **und** aus
 * `unread.ts`/`updates.ts` unter `node --test` ladbar sein. Vor P4 stand die Root-Regel
 * in drei Kopien in genau diesen Dateien — bei einer Regel, deren Fehlbedienung STILL
 * Daten verliert, ist das die falsche Sparsamkeit.
 */
import type { TrustedEvent } from '@welshman/util'

/** Marker der Thread-Wurzel an Position 3 des `e`-Tags (nur bei Tiefe ≥ 2 gesetzt). */
export const THREAD_ROOT_MARKER = 'root'

/** Marker des direkten Vorgängers an Position 3 des `e`-Tags — trägt JEDE Antwort. */
export const THREAD_REPLY_MARKER = 'reply'

/** Alles, was Tags hat — Events aus dem Repository ebenso wie frisch gebaute Entwürfe. */
type Tagged = Pick<TrustedEvent, 'tags'>

/** Wert des ersten `e`-Tags mit genau diesem Marker an Position 3; '' wenn keins. */
const markedEventId = (event: Tagged, marker: string): string => {
    for (const tag of event.tags) {
        if (tag[0] === 'e' && tag[3] === marker && tag[1]) {
            return tag[1]
        }
    }
    return ''
}

/**
 * Direkter Vorgänger einer Antwort (`["e", id, "", "reply"]`); '' wenn das Event keine
 * Antwort ist. Der `reply`-Marker ist zugleich das Erkennungsmerkmal — siehe
 * {@link isThreadReply}.
 */
export const threadParentId = (event: Tagged): string => markedEventId(event, THREAD_REPLY_MARKER)

/**
 * Thread-Wurzel einer Antwort: der `root`-Marker, wenn er da ist (Tiefe ≥ 2) — sonst der
 * `reply`-Marker, denn bei Tiefe 1 IST der Parent die Wurzel (Buzz leitet exakt so ab,
 * ingest.rs:605-609). '' wenn das Event keine Antwort ist.
 */
export const threadRootId = (event: Tagged): string =>
    markedEventId(event, THREAD_ROOT_MARKER) || markedEventId(event, THREAD_REPLY_MARKER)

/** Ist das Event eine Thread-Antwort (trägt einen `reply`-Marker)? */
export const isThreadReply = (event: Tagged): boolean => threadParentId(event) !== ''

/**
 * Ist das Event eine Wurzel-Nachricht (keine Antwort)? Der Schnitt für den Raum-Feed:
 * Buzz liefert Antworten im `#h`-Filter mit (Regel 7), das Slack-Modell zeigt sie dort
 * aber nicht.
 */
export const isRootMessage = (event: Tagged): boolean => threadParentId(event) === ''

/**
 * Die Thread-Tags einer Antwort in Buzz-Form (Regeln 1–4). `parentId === rootId` (oder ein
 * leeres `parentId`) heißt „Antwort direkt auf die Wurzel" → EIN `reply`-Tag; alles andere
 * ist Tiefe ≥ 2 → `root` UND `reply`.
 *
 * Der leere String an Position 2 ist Absicht und kein vergessener Relay-Hint: er hält den
 * Marker auf Index 3 (Regel 4).
 */
export const threadTags = (rootId: string, parentId: string): string[][] =>
    !parentId || parentId === rootId
        ? [['e', rootId, '', THREAD_REPLY_MARKER]]
        : [
              ['e', rootId, '', THREAD_ROOT_MARKER],
              ['e', parentId, '', THREAD_REPLY_MARKER],
          ]
