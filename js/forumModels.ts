/**
 * Das Datenmodell der Forum-Fläche (P3) — REIN & welshman-frei (wie
 * `railForge.ts`, `forgeTimeline.ts`, `roomCategories.ts`), damit die
 * Themenliste ohne Browser, ohne Relay und ohne Store unter `node --test`
 * prüfbar ist. Relative Imports MIT `.ts`-Endung: die Datei muss aus Vite UND
 * aus dem Node-Test-Runner ladbar sein.
 *
 * ── Die gemessene Ereignisform, nicht die vermutete ─────────────────────────
 *
 * Am Buzz-Teststack am 2026-08-17 gemessen (nicht aus dem Relay-Quelltext
 * abgeleitet, sondern publiziert und zurückgelesen):
 *
 *   Kanal   `39000` mit `["t","forum"]` — der `channel_type` des Relays
 *   Thema   `45001`, Tags: **nur** `["h","<uuid>"]`
 *   Antwort `45003`, Tags: `["h","<uuid>"]`, `["e","<root>","","reply"]`
 *   Antwort `9`      — dieselbe Form, vom Relay im Forumkanal AKZEPTIERT und
 *                     von Buzz Desktop als Forum-Antwort gelesen
 *                     (`get_forum_thread` fragt `kinds:[9,45003]`)
 *
 * **Ein Thema hat keinen Titel.** Es gibt weder ein `subject`- noch ein
 * `title`-Tag; Buzz Desktop rendert die Karte ebenfalls aus dem Inhalt. Der
 * Titel dieser Fläche ist deshalb die ERSTE ZEILE des Inhalts
 * ({@link forumTopicTitle}) und der Rest die Vorschau — eine Anzeige-Regel, die
 * hier steht und nicht im Markup, damit sie testbar ist.
 *
 * **Kein `39005`.** Der Relay synthetisiert für Forum-Wurzeln keine
 * Thread-Zusammenfassung (am Teststack abgefragt: null Ereignisse). Antwortzahl,
 * letzte Aktivität und die Gesichter rechnet deshalb {@link buildForumTopics}
 * client-seitig aus den Antworten aus — es gibt keine Serverzahl, die man
 * stattdessen glauben könnte.
 */

// ── Kinds ───────────────────────────────────────────────────────────────────

/** Buzz: Wurzel eines Forum-Themas (`KIND_FORUM_POST`, `buzz-core/src/kind.rs:550`). */
export const FORUM_POST = 45001

/** Buzz: Antwort in einem Forum-Thema (`KIND_FORUM_COMMENT`, `kind.rs:554`). */
export const FORUM_COMMENT = 45003

// ── Titel & Vorschau ────────────────────────────────────────────────────────

/** Obergrenze des Titels in Zeichen. Darüber wird hart gekürzt (mit Ellipse). */
const TITLE_MAX = 120

/** Obergrenze der Vorschauzeile. */
const PREVIEW_MAX = 160

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

const clamp = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

/**
 * Der Titel eines Themas: die erste nicht-leere Zeile des Inhalts.
 *
 * Warum die erste ZEILE und nicht die ersten N Zeichen: wer ein Thema eröffnet,
 * schreibt seine Frage in die erste Zeile — ein Schnitt nach Zeichen zerhackte
 * sie mitten im Wort und der Rest der Liste sähe aus wie Fließtext. Ein Inhalt
 * ganz ohne Text (nur ein Bild-Anhang, nur Leerzeichen) hat keinen Titel; die
 * Fläche zeigt dann ihren eigenen Ersatztext, statt hier eine Sprache
 * einzuführen (dieses Modul bleibt sprachfrei, wie `railForge.ts`).
 */
export const forumTopicTitle = (content: string): string =>
    clamp(collapse((content ?? '').split('\n').find((line) => line.trim() !== '') ?? ''), TITLE_MAX)

/**
 * Die Vorschauzeile: alles NACH der Titelzeile, in einer Zeile zusammengezogen.
 * Leer, wenn das Thema nur aus einer Zeile besteht — dann steht in der Liste
 * kein zweites Mal derselbe Satz.
 */
export const forumTopicPreview = (content: string): string => {
    const lines = (content ?? '').split('\n')
    const first = lines.findIndex((line) => line.trim() !== '')
    if (first === -1) {
        return ''
    }

    return clamp(collapse(lines.slice(first + 1).join(' ')), PREVIEW_MAX)
}

// ── Themenliste ─────────────────────────────────────────────────────────────

/** Was die Liste von einer Wurzel (45001) braucht — strukturell, nicht `TrustedEvent`. */
export type ForumRootInput = {
    id: string
    pubkey: string
    content: string
    created_at: number
}

/**
 * Was die Liste von einer Antwort braucht. `rootId` löst der Aufrufer auf
 * (`threading.ts`), weil die Marker-Regeln dort schon einmal stehen und nicht
 * zweimal gelten dürfen.
 */
export type ForumReplyInput = {
    id: string
    pubkey: string
    created_at: number
    rootId: string
}

/** Eine Zeile der Themenliste. Sprachfrei: Zeit-Labels macht die Fläche. */
export type ForumTopicRow = {
    id: string
    pubkey: string
    /** Erste Zeile des Inhalts, ggf. gekürzt. '' bei textlosem Inhalt. */
    title: string
    /** Rest des Inhalts, einzeilig, ggf. gekürzt. '' wenn es keinen gibt. */
    preview: string
    createdAt: number
    replyCount: number
    /** `created_at` der jüngsten Antwort — oder der Wurzel, wenn es keine gibt. */
    lastActivityAt: number
    /** Autoren der jüngsten Antworten, neueste zuerst, ohne Wiederholung, max. 3. */
    faces: string[]
}

/** Wie viele Gesichter an einer Zeile stehen. Wie im Thread-Indikator des Chats. */
export const FORUM_FACE_CAP = 3

/**
 * Baut die Themenliste.
 *
 * **Drei Regeln, alle testbar und alle mit einem Grund:**
 *
 * 1. *Eine Antwort ohne auflösbare Wurzel erscheint NICHT als eigenes Thema.*
 *    Sonst stünde in der Liste eine Zeile ohne Frage, deren Inhalt eine Antwort
 *    auf etwas Ungezeigtes ist — und der Zähler des echten Themas fehlte.
 *    Dieselbe Regel wie in `deriveSpaceThreads` („nur Threads mit AUFLÖSBARER
 *    Wurzel"), aus demselben Grund.
 * 2. *Sortiert wird nach LETZTER AKTIVITÄT, nicht nach Erstellung.* Ein Forum
 *    ist kein Verlauf: ein zwei Wochen altes Thema mit einer Antwort von heute
 *    gehört nach oben. Genau daran unterscheidet sich diese Fläche vom Chat, und
 *    genau deshalb bekommt sie eine eigene Ableitung statt eines erweiterten
 *    Raumfilters.
 * 3. *Bei gleicher Aktivität entscheidet die id.* Eine Sortierung, die bei
 *    Gleichstand die Eingangsreihenfolge behält, ordnete die Liste bei jedem
 *    Nachladen anders — am Relay ist Sekundengleichheit der Normalfall, nicht
 *    der Sonderfall (Seed-Ereignisse tragen dieselbe Sekunde).
 */
export const buildForumTopics = (
    roots: readonly ForumRootInput[],
    replies: readonly ForumReplyInput[],
): ForumTopicRow[] => {
    const byId = new Map<string, ForumRootInput>()
    for (const root of roots) {
        byId.set(root.id, root)
    }

    const grouped = new Map<string, ForumReplyInput[]>()
    for (const reply of replies) {
        // Regel 1: keine Waisen — und eine „Antwort" auf sich selbst ist keine.
        if (!byId.has(reply.rootId) || reply.id === reply.rootId) {
            continue
        }
        const list = grouped.get(reply.rootId)
        if (list) {
            list.push(reply)
        } else {
            grouped.set(reply.rootId, [reply])
        }
    }

    const rows: ForumTopicRow[] = []
    for (const root of byId.values()) {
        const own = (grouped.get(root.id) ?? []).slice().sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
        const faces: string[] = []
        for (const reply of own) {
            if (faces.length >= FORUM_FACE_CAP) {
                break
            }
            if (!faces.includes(reply.pubkey)) {
                faces.push(reply.pubkey)
            }
        }
        rows.push({
            id: root.id,
            pubkey: root.pubkey,
            title: forumTopicTitle(root.content),
            preview: forumTopicPreview(root.content),
            createdAt: root.created_at,
            replyCount: own.length,
            lastActivityAt: own.length > 0 ? Math.max(root.created_at, own[0].created_at) : root.created_at,
            faces,
        })
    }

    return rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id))
}
