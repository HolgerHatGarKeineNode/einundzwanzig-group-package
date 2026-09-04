/**
 * Die Forum-Fläche eines Buzz-Kanals (P3) — reaktive Schicht über
 * {@link buildForumTopics}.
 *
 * ── Warum eine eigene Ableitung und kein erweiterter Raumfilter ─────────────
 *
 * Ein Forum sortiert nach LETZTER ANTWORT, ein Chat pinnt den Boden. Nähme man
 * 45001/45003 in `roomFilter` auf und renderte sie im Verlauf mit, ruinierte man
 * beide Flächen zugleich — und der erweiterte Filter liefe zusätzlich gegen
 * zooid mit, wo diese Kinds nie existieren. Diese Entscheidung stammt aus dem
 * Vorgängerplan (Abschnitt „Verworfene Alternativen") und steht hier, weil hier
 * die Fläche ist, die sie umsetzt.
 *
 * ── Der Thread ist NICHT hier ──────────────────────────────────────────────
 *
 * Ein Forum-Thread ist strukturell derselbe Thread wie im Chat: Wurzel + flache
 * Antwortliste. Er läuft deshalb durch `deriveThread` (`feeds.ts`), dessen
 * Antwort-Filter seit P3 auch 45003 kennt — es gibt genau EINE Thread-Maschine.
 * Dieses Modul liefert die Liste DAVOR.
 *
 * ── Ein Filter, fünf Kinds ─────────────────────────────────────────────────
 *
 * Wurzeln (45001), Antworten (45003 **und** kind 9, beide am Teststack
 * gemessen) und seit P3 die Bewertungen (45002) samt ihren Rücknahmen (kind 5)
 * tragen alle `#h` und liegen im selben Filter. Das ist nicht Sparsamkeit,
 * sondern Reaktivität: `deriveEventsForUrl` emittiert nur, wenn ein Ereignis den
 * Filter TRIFFT — eine Antwort, die durch einen zweiten, getrennt abonnierten
 * Filter käme, ließe die Zeile mit ihrem alten Zähler stehen. Genau diese Lücke
 * ist im Projektgedächtnis als `derive-feed-recompute-luecke` dokumentiert.
 */
import { derived, type Readable } from 'svelte/store'
import { load, request } from './welshmanNet.ts'
import { pubkey } from './welshmanSession.ts'
import { type TrustedEvent } from '@welshman/util'
import { DELETE, MESSAGE } from './welshmanKinds.ts'
import { throttled } from '@welshman/store'
import { displayProfileByPubkey, profilesByPubkey } from './spaceProfiles.ts'
import { deriveEventsForUrl } from './repository.ts'
import { warmProfiles } from './profiles.ts'
import { isThreadReply, threadRootId } from './threading.ts'
import { timelineFullLabel, timelineTimeLabel } from './forgeTimeline.ts'
import {
    FORUM_COMMENT,
    FORUM_POST,
    FORUM_VOTE,
    buildForumTopics,
    type ForumReplyInput,
    type ForumRootInput,
    type ForumTombstoneInput,
    type ForumTopicRow,
    type ForumVoteInput,
} from './forumModels.ts'

/**
 * Themen + Antworten EINES Forumkanals.
 *
 * `#h` ist bei Buzz Pflicht — ein 45001/45003 ohne `h` lehnt der Relay ab
 * (gemessen: `invalid: channel-scoped events must include an h tag`). Der Filter
 * darf sich also darauf verlassen und muss keinen kanallosen Zweig tragen.
 */
const forumFilter = (h: string) => [{ kinds: [FORUM_POST, FORUM_COMMENT, MESSAGE, FORUM_VOTE, DELETE], '#h': [h] }]

/**
 * Der BESTANDS-Load — zwei Filter mit **getrennten Deckeln**, und das ist keine
 * Kosmetik.
 *
 * Der Live-Filter oben führt Votes (45002) im selben Objekt, weil er das muss:
 * `deriveEventsForUrl` emittiert nur, wenn ein Ereignis den Filter TRIFFT, und eine
 * Bewertung, die durch einen zweiten getrennt abonnierten Filter käme, ließe die Zeile
 * mit ihrem alten Punktstand stehen (`derive-feed-recompute-luecke`). Für den
 * einmaligen Bestands-Load gilt das Gegenteil: ein gemeinsames `limit: 500` über alle
 * vier Kinds bedeutet, dass in einem lebhaften Forum die Bewertungen die THEMEN aus
 * dem Fenster drängen — der Relay liefert die 500 jüngsten Ereignisse, und Votes sind
 * das häufigste davon. Ein Thema, das nicht geladen wurde, hat auch keine Zeile, an
 * der ein Punktstand stehen könnte.
 *
 * Zwei Filter kosten zwei Subscriptions (welshman sendet **ein Filter je REQ**,
 * `@welshman/net` `request.js:99-103`), gegen ein Budget von 1024 bei Buzz.
 */
const forumBacklogFilters = (h: string) => [
    { kinds: [FORUM_POST, FORUM_COMMENT, MESSAGE, DELETE], '#h': [h], limit: 500 },
    { kinds: [FORUM_VOTE], '#h': [h], limit: 1000 },
]

/** Eine Zeile der Themenliste, fertig für das Markup. */
export type ForumTopic = ForumTopicRow & {
    /** Anzeigename des Autors (Fallback: gekürzter npub, via welshman). */
    authorName: string
    picture: string
    /** Gehört das Thema mir? Trägt später die Lösch-/Bearbeiten-Rechte. */
    mine: boolean
    /** „vor 3 Std" — relativ unter 24 h, danach das kurze Datum. */
    lastLabel: string
    /** Volle Zeitangabe für `title`/Tooltip. */
    lastFullLabel: string
    /** Namen der Gesichter, in der Reihenfolge von `faces`. */
    faceNames: string[]
    facePictures: string[]
}

/**
 * Trennt den Ereignisstrom eines Forumkanals in Wurzeln und Antworten.
 *
 * Die Zuordnung „Antwort" läuft über den `reply`-Marker (`threading.ts`), nicht
 * über den Kind: ein kind 9 ohne Marker ist im Forumkanal eine Chat-Nachricht,
 * die dort niemand sehen will, und ein 45003 OHNE Wurzelbezug wäre eine Waise.
 * Beide fallen damit heraus, ohne dass die Regel zweimal existiert.
 */
const splitForumEvents = (events: readonly TrustedEvent[]) => {
    const roots: ForumRootInput[] = []
    const replies: ForumReplyInput[] = []
    const votes: ForumVoteInput[] = []
    const tombstones: ForumTombstoneInput[] = []
    for (const event of events) {
        // NIP-09 tombstones. They are handed to the fold rather than trusted to the
        // repository alone: `Repository.query` does skip deleted events, but
        // `deriveEventsByIdForUrl`'s `tracker.add` branch re-adds an event by id WITHOUT
        // asking `isDeleted` — so a retracted vote can reappear in this very list. The
        // reasoning belongs to the fold and is written out there.
        if (event.kind === DELETE) {
            const targetIds = event.tags.filter((tag) => tag[0] === 'e' && tag[1]).map((tag) => tag[1] as string)
            if (targetIds.length > 0) {
                tombstones.push({ pubkey: event.pubkey, created_at: event.created_at, targetIds })
            }
            continue
        }
        // Votes first, and by KIND: a 45002 carries a bare `["e", <target>]` without a
        // thread marker, so `isThreadReply` says no and it would fall out of the loop
        // unnoticed today — but a marker added to a vote by any future client would
        // make it count as a reply and inflate the reply counter. The `e` tag read here
        // is the FIRST one, which is the one the relay validates against for this kind
        // (`ingest.rs:1001-1046`, `find_map` without `.rev()`).
        if (event.kind === FORUM_VOTE) {
            const targetId = event.tags.find((tag) => tag[0] === 'e' && tag[1])?.[1] ?? ''
            if (targetId !== '') {
                votes.push({
                    id: event.id,
                    pubkey: event.pubkey,
                    created_at: event.created_at,
                    targetId,
                    content: event.content,
                })
            }
            continue
        }
        if (event.kind === FORUM_POST && !isThreadReply(event)) {
            roots.push({ id: event.id, pubkey: event.pubkey, content: event.content, created_at: event.created_at })
            continue
        }
        if (!isThreadReply(event)) {
            continue
        }
        const rootId = threadRootId(event)
        if (rootId !== '') {
            replies.push({ id: event.id, pubkey: event.pubkey, created_at: event.created_at, rootId })
        }
    }

    return { roots, replies, votes, tombstones }
}

/**
 * Die reaktive Themenliste eines Forumkanals.
 *
 * `now` wird je Emit GENAU EINMAL gelesen und durch alle Zeilen gereicht — zwei
 * getrennte `Date.now()` ergäben an der Mitternachtsgrenze in einer Zeile
 * „gestern" und in der nächsten „vor 3 Std" für denselben Zeitpunkt (die Lehre
 * aus P5, siehe `forgeTimeline.ts`).
 */
export const deriveForumTopics = (url: string, h: string): Readable<ForumTopic[]> =>
    derived(
        [deriveEventsForUrl(url, forumFilter(h)), throttled(200, profilesByPubkey), pubkey],
        ([$events, $profiles, $me]) => {
            const { roots, replies, votes, tombstones } = splitForumEvents($events)
            // `$me` decides `myVote` — the same store the row's `mine` already comes
            // from. A guest gets `''` and therefore no marked arrow, which is correct:
            // without a pubkey there is nothing that could be their vote.
            const rows = buildForumTopics(roots, replies, votes, $me ?? '', tombstones)
            const now = Math.floor(Date.now() / 1000)
            void warmProfiles([...roots.map((r) => r.pubkey), ...replies.map((r) => r.pubkey)])

            return rows.map((row): ForumTopic => ({
                ...row,
                authorName: displayProfileByPubkey(row.pubkey),
                picture: $profiles.get(row.pubkey)?.picture ?? '',
                mine: Boolean($me) && row.pubkey === $me,
                lastLabel: timelineTimeLabel(row.lastActivityAt, now),
                lastFullLabel: timelineFullLabel(row.lastActivityAt),
                faceNames: row.faces.map((pk) => displayProfileByPubkey(pk)),
                facePictures: row.faces.map((pk) => $profiles.get(pk)?.picture ?? ''),
            }))
        },
    )

/**
 * Bestand laden. Der Zähler einer Zeile ist eine ZAHL AUS DEN DATEN und keine
 * Serverangabe (der Relay synthetisiert für Forum-Wurzeln kein 39005) — die
 * Antworten müssen deshalb mitgeladen werden, nicht erst beim Öffnen eines
 * Themas. Die Deckel stehen in {@link forumBacklogFilters} und sind getrennt,
 * damit Bewertungen die Themen nicht aus dem Fenster drängen; die Liste sagt
 * selbst nicht, dass sie gekürzt ist, weil bei 500 Themen die Sortierung nach
 * Aktivität ohnehin die relevanten oben hält.
 */
export const loadForumTopics = (url: string, h: string): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: forumBacklogFilters(h) })

/** Live-Sub auf neue Themen und Antworten des offenen Forums, bis abort. */
export const listenForum = (url: string, h: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: forumFilter(h).map((f) => ({ ...f, limit: 0 })) })
}
