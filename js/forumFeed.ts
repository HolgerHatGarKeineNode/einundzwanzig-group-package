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
 * ── Ein Filter, drei Kinds ─────────────────────────────────────────────────
 *
 * Wurzeln (45001) und Antworten (45003 **und** kind 9, beide am Teststack
 * gemessen) tragen alle `#h` und liegen im selben Filter. Das ist nicht Sparsamkeit,
 * sondern Reaktivität: `deriveEventsForUrl` emittiert nur, wenn ein Ereignis den
 * Filter TRIFFT — eine Antwort, die durch einen zweiten, getrennt abonnierten
 * Filter käme, ließe die Zeile mit ihrem alten Zähler stehen. Genau diese Lücke
 * ist im Projektgedächtnis als `derive-feed-recompute-luecke` dokumentiert.
 */
import { derived, type Readable } from 'svelte/store'
import { load, request } from '@welshman/net'
import { pubkey } from './welshmanSession.ts'
import { type TrustedEvent } from '@welshman/util'
import { MESSAGE } from './welshmanKinds.ts'
import { throttled } from '@welshman/store'
import { displayProfileByPubkey, profilesByPubkey } from './spaceProfiles.ts'
import { deriveEventsForUrl } from './repository.ts'
import { warmProfiles } from './profiles.ts'
import { isThreadReply, threadRootId } from './threading.ts'
import { timelineFullLabel, timelineTimeLabel } from './forgeTimeline.ts'
import {
    FORUM_COMMENT,
    FORUM_POST,
    buildForumTopics,
    type ForumReplyInput,
    type ForumRootInput,
    type ForumTopicRow,
} from './forumModels.ts'

/**
 * Themen + Antworten EINES Forumkanals.
 *
 * `#h` ist bei Buzz Pflicht — ein 45001/45003 ohne `h` lehnt der Relay ab
 * (gemessen: `invalid: channel-scoped events must include an h tag`). Der Filter
 * darf sich also darauf verlassen und muss keinen kanallosen Zweig tragen.
 */
const forumFilter = (h: string) => [{ kinds: [FORUM_POST, FORUM_COMMENT, MESSAGE], '#h': [h] }]

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
    for (const event of events) {
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

    return { roots, replies }
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
            const { roots, replies } = splitForumEvents($events)
            const rows = buildForumTopics(roots, replies)
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
 * Themas. `limit` deckelt das Fenster; die Liste sagt selbst nicht, dass sie
 * gekürzt ist, weil bei 500 Themen die Sortierung nach Aktivität ohnehin die
 * relevanten oben hält.
 */
export const loadForumTopics = (url: string, h: string): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: forumFilter(h).map((f) => ({ ...f, limit: 500 })) })

/** Live-Sub auf neue Themen und Antworten des offenen Forums, bis abort. */
export const listenForum = (url: string, h: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: forumFilter(h).map((f) => ({ ...f, limit: 0 })) })
}
