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

/**
 * Buzz: Bewertung eines Forum-Beitrags (`KIND_FORUM_VOTE`, `kind.rs:552`).
 *
 * **The relay does not count these — we do.** Outside `kind.rs` and `ingest.rs` every
 * occurrence of 45002 in the relay repository sits in `#[cfg(test)]`: there is no
 * reader, no aggregate, no synthesized summary event. Whatever a score says on this
 * surface, this file computed it.
 */
export const FORUM_VOTE = 45002

// ── Votes ───────────────────────────────────────────────────────────────────

/**
 * The two `content` values a vote can carry (`buzz-sdk/src/builders.rs:456-470`,
 * `build_vote`).
 *
 * **These are an SDK convention and nothing more.** `validate_forum_vote_target`
 * (`ingest.rs:1001-1046`) checks the `e` tag, the existence of the target, the target's
 * kind and the channel — it never touches `content`. A third value is therefore a valid
 * event that the relay stores and fans out, and {@link foldForumVotes} discards it
 * instead of guessing: a vote whose direction we cannot read is not a quiet yes.
 */
export const VOTE_UP = '+'
export const VOTE_DOWN = '-'

/** What a pubkey has decided about one target: up, down, or nothing. */
export type VoteChoice = 0 | 1 | -1

/** What the fold needs from a 45002 — structurally, not `TrustedEvent`. */
export type ForumVoteInput = {
    id: string
    pubkey: string
    created_at: number
    /** Value of the vote's single `e` tag — the event it is about. */
    targetId: string
    /** Raw `content`. Anything outside `"+"`/`"-"` makes the vote unreadable. */
    content: string
}

/** The result of folding every vote on one target. */
export type ForumVoteTally = {
    up: number
    down: number
    /** `up - down`. */
    score: number
    /** What the reading user voted, `0` if they did not. */
    mine: VoteChoice
}

/** No vote at all — shared instance, never mutated. */
export const EMPTY_TALLY: ForumVoteTally = Object.freeze({ up: 0, down: 0, score: 0, mine: 0 })

/**
 * Is `a` the later of two votes by the same pubkey on the same target?
 *
 * The tie-break is not decoration. Buzz refuses an event whose `created_at` is more
 * than ±900 s off server time (`ingest.rs:2005-2011`), so votes cluster in whole
 * seconds, and two votes in the same second are the normal case rather than the corner
 * one — exactly the reasoning `buildForumTopics` already writes down for the topic
 * order ("am Relay ist Sekundengleichheit der Normalfall").
 *
 * On a tie the **lexicographically smaller id wins**, because that is the direction
 * this file already treats as "newer": the reply sort below is
 * `b.created_at - a.created_at || a.id.localeCompare(b.id)`, so within one second the
 * smaller id sorts to the newest-first end. One rule, one direction, two places.
 */
const isLaterVote = (a: ForumVoteInput, b: ForumVoteInput): boolean =>
    a.created_at !== b.created_at ? a.created_at > b.created_at : a.id < b.id

/**
 * Fold raw votes into one tally per target — **the rule this whole phase turns on.**
 *
 * The relay has **no dedup for 45002.** NIP-25 reactions get one
 * (`insert_reaction_event_with_thread_metadata` with `ON CONFLICT`, `ingest.rs:2792-2850`);
 * forum votes take the plain ingest path and two votes by the same pubkey on the same
 * target are two valid, both-stored, both-delivered events. Summing naively would count
 * a user as often as they clicked, and there is no server-side number to fall back on.
 *
 * Three filters, in this order, and the order is the rule:
 *
 *  1. **Unknown target out.** `targets` is the set of forum events this view actually
 *     holds (roots and replies). The relay only accepts a vote whose target exists and
 *     is a 45001/45003 in the same channel — but that is *its* check on *its* data, and
 *     a client that trusted it would still count a vote on a chat message the moment a
 *     less strict relay stored one. The set is also why a vote can arrive before its
 *     target and simply not count yet: the next batch that brings the target recomputes
 *     everything, because the derivation feeds all four kinds through one filter.
 *  2. **Unreadable direction out** (see {@link VOTE_UP}). Discarded *before* the
 *     newest-wins step, not after: a garbage event must not be able to silence a
 *     legitimate earlier vote of the same author. The consequence, stated because it
 *     is the flip side and not an oversight — there is no way to *retract* a vote by
 *     writing a third value. Retraction is discussed at `planForumVote`
 *     (`forumVoteModels.ts`) and deliberately not offered.
 *  3. **Newest per `(pubkey, target)` wins**, older ones dropped entirely — not
 *     subtracted. Switching from `+` to `-` therefore moves the score by two, which is
 *     what a reader expects, and re-clicking the same direction moves it by nothing.
 */
export const foldForumVotes = (
    votes: readonly ForumVoteInput[],
    targets: ReadonlySet<string>,
    self = '',
): Map<string, ForumVoteTally> => {
    const winners = new Map<string, ForumVoteInput>()
    for (const vote of votes) {
        if (!vote.id || !vote.pubkey || !targets.has(vote.targetId)) {
            continue
        }
        if (vote.content !== VOTE_UP && vote.content !== VOTE_DOWN) {
            continue
        }
        const key = `${vote.pubkey}|${vote.targetId}`
        const held = winners.get(key)
        if (held && !isLaterVote(vote, held)) {
            continue
        }
        winners.set(key, vote)
    }

    const tallies = new Map<string, ForumVoteTally>()
    for (const vote of winners.values()) {
        const up = vote.content === VOTE_UP
        const held = tallies.get(vote.targetId) ?? { up: 0, down: 0, score: 0, mine: 0 as VoteChoice }
        held.up += up ? 1 : 0
        held.down += up ? 0 : 1
        held.score = held.up - held.down
        if (self !== '' && vote.pubkey === self) {
            held.mine = up ? 1 : -1
        }
        tallies.set(vote.targetId, held)
    }

    return tallies
}

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
    /** `up - down` after the fold. Computed here; no relay reports it. */
    score: number
    upCount: number
    downCount: number
    /** What the reading user voted on this topic. */
    myVote: VoteChoice
}

// ── Sortierung ──────────────────────────────────────────────────────────────

/**
 * The orders the topic list offers, in the order the surface offers them.
 *
 * Literally two — a test pins the count and the values. Same construction and same
 * reason as `ARTICLE_SORTS` (`js/articleSorts.ts`): a labels-in-Blade / values-in-TS
 * split silently drifts, and a comparator that falls back to the default on an unknown
 * value never turns red on its own.
 */
export const FORUM_SORTS = ['activity', 'score'] as const

export type ForumSort = (typeof FORUM_SORTS)[number]

/**
 * The order without a choice: **last activity**.
 *
 * Unchanged from before votes existed, and deliberately so. A forum whose default is
 * the score buries the question asked five minutes ago under the one everybody already
 * agreed with a month ago — the opposite of what {@link buildForumTopics} rule 2 is for.
 */
export const DEFAULT_FORUM_SORT: ForumSort = 'activity'

/**
 * Order the rows. Returns a **new** array; the input is not touched.
 *
 * The score order falls back to activity and then to the id, so it is total: a forum in
 * which nobody has voted yet is not shuffled into a random order by picking "points",
 * it simply looks like the activity order. Without the second level that is exactly
 * what would happen — every score is 0, `sort` is only stable per specification since
 * ES2019 and the *input* order is a repository emit order, not a promise.
 */
export const sortForumTopics = <T extends ForumTopicRow>(rows: readonly T[], sort: ForumSort): T[] =>
    rows
        .slice()
        .sort((a, b) =>
            sort === 'score'
                ? b.score - a.score || b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id)
                : b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id),
        )

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
 * 4. *The score is folded, never summed* — see {@link foldForumVotes}. `votes` is
 *    optional so that every caller written before this phase keeps working and reads
 *    a score of 0, which is the truth for a forum nobody has voted in.
 */
export const buildForumTopics = (
    roots: readonly ForumRootInput[],
    replies: readonly ForumReplyInput[],
    votes: readonly ForumVoteInput[] = [],
    self = '',
): ForumTopicRow[] => {
    const byId = new Map<string, ForumRootInput>()
    for (const root of roots) {
        byId.set(root.id, root)
    }

    // The set of forum events this view holds — roots AND replies, because a vote may
    // target either (`validate_forum_vote_target` accepts 45001 and 45003 alike). A
    // reply whose root is unresolvable is still a forum event and still a legal target;
    // it is only its *display* that rule 1 below suppresses. Votes on replies are folded
    // and currently shown nowhere — the thread view is the next surface that needs them,
    // and computing them twice under two rules is how the two would drift.
    const voteTargets = new Set<string>(byId.keys())
    for (const reply of replies) {
        voteTargets.add(reply.id)
    }
    const tallies = foldForumVotes(votes, voteTargets, self)

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
        const tally = tallies.get(root.id) ?? EMPTY_TALLY
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
            score: tally.score,
            upCount: tally.up,
            downCount: tally.down,
            myVote: tally.mine,
        })
    }

    // Rule 3 is the DEFAULT order, not the only one. The user's choice is applied by
    // {@link sortForumTopics} at the surface: it is not a store input, and threading it
    // through the derivation would rebuild every row for a click that changes no data.
    return sortForumTopics(rows, DEFAULT_FORUM_SORT)
}
