/**
 * Zentrale Publish-Helfer für schreibende Room-Aktionen (PLAN5). Hier lebt die
 * NIP-29/NIP-70-Tag-Logik, die JEDE Aktion teilt (Message, Reply — und ab C1
 * Reaction/Delete/Poll). Die konkreten `make*`-Event-Builder aus dem Referenz-
 * Client kommen mit ihrer Phase; C0 legt nur `roomTags` an.
 */
import { COMMENT, DELETE, POLL, POLL_RESPONSE, REACTION, REPORT, ZAP_GOAL, getTag, makeEvent, type TrustedEvent } from '@welshman/util'
import { getRelay, tagEvent, tagEventForComment, tagEventForReaction } from '@welshman/app'
import * as nip19 from 'nostr-tools/nip19'
import { hasNip70 } from './relayCaps'
import type { PollOption, PollType } from './polls'

/** NIP-70 PROTECTED-Marker: bittet das Relay, das Event nur vom Autor annehmbar zu halten. */
export const PROTECTED = ['-']

/**
 * Setzt das aktive Space-Relay NIP-70 durch? Aus dem NIP-11-Cache (`getRelay`);
 * ist das Profil noch nicht geladen → false (kein PROTECTED, wie beim Referenz-Client).
 */
export const canEnforceNip70 = (url: string): boolean => hasNip70(getRelay(url))

/**
 * Basis-Tags JEDER schreibenden Room-Aktion: `["h", h]` (NIP-29-Group) plus
 * `["-"]` (NIP-70 PROTECTED), wenn das Relay es unterstützt. Message, Reply und
 * die Folgephasen (Reaction/Delete/Poll) hängen ihre spezifischen Tags an.
 */
export const roomTags = (h: string, url: string): string[][] =>
    canEnforceNip70(url) ? [['h', h], PROTECTED] : [['h', h]]

/**
 * Baut die NIP-29-Group-Tags einer Aktion, die sich auf ein Parent-Event bezieht
 * (Reaction/Delete): das `h` wird vom Parent übernommen (`getTag("h", …)`, wie beim
 * Referenz-Client), PROTECTED nach Relay-Fähigkeit. Kein eigenes `h` raten.
 */
const parentRoomTags = (parent: TrustedEvent, url: string): string[][] => {
    const tags: string[][] = []
    const h = getTag('h', parent.tags)
    if (h) {
        tags.push(h)
    }
    if (canEnforceNip70(url)) {
        tags.push(PROTECTED)
    }
    return tags
}

/**
 * Emoji-Reaction (NIP-25 kind 7) auf `event`. `content` ist das Standard-Emoji
 * (Unicode) bzw. `:shortcode:` für Custom-Emoji (NIP-30); für Custom-Emoji trägt
 * `extraTags` das zugehörige `["emoji", shortcode, url]`. `tagEventForReaction`
 * setzt `["p",…]?`+`["k","9"]`+`["e",id,hint]`; dazu `h` (vom Parent) + PROTECTED.
 */
export const makeReaction = (event: TrustedEvent, content: string, url: string, extraTags: string[][] = []) =>
    makeEvent(REACTION, {
        content,
        tags: [...extraTags, ...tagEventForReaction(event, url), ...parentRoomTags(event, url)],
    })

/**
 * NIP-09-Löschung (kind 5) eines eigenen Events — für den Reaction-Toggle die
 * eigene kind-7 zurücknehmen. `["k", kind]`+`["e", id]` (via `tagEvent`), dazu `h`
 * (vom Parent) + PROTECTED. `created_at` muss echt größer als das Ziel sein
 * (Repository-Regel), sonst greift ein Toggle in derselben Sekunde nicht.
 */
export const makeEventDelete = (event: TrustedEvent, url: string) =>
    makeEvent(DELETE, {
        created_at: Math.max(Math.floor(Date.now() / 1000), event.created_at + 1),
        tags: [['k', String(event.kind)], ...tagEvent(event), ...parentRoomTags(event, url)],
    })

/**
 * „Fork off!" — NIP-56-Report (kind 1984) einer fremden Nachricht. `reason` ist der
 * NIP-56-Maschinencode (spam/profanity/impersonation/other) am `["e", id, reason]`, `content` der optionale
 * Freitext. KEIN `h`/PROTECTED — der Report ist keine Group-Message, sondern geht
 * als reguläres Event ans Relay (zooid nimmt ihn vom zugelassenen Member an).
 */
export const makeReport = (event: Pick<TrustedEvent, 'id' | 'pubkey'>, reason: string, content: string) =>
    makeEvent(REPORT, {
        content,
        tags: [['p', event.pubkey], ['e', event.id, reason]],
    })

/**
 * Erstellt eine NIP-88-Poll (kind 1068) direkt im Raum: `content` = Frage, je Option
 * ein `["option", id, label]`, dazu `["polltype", …]`, `["relay", url]`, optional
 * `["endsAt", unix]` — plus `roomTags(h, url)` (`["h", h]` + PROTECTED), damit die
 * Poll wie eine Nachricht ins Space-Relay geroutet und member-only geschützt wird.
 * Poll-**Erstellen** ist bewusst Teil von C5 (Auftraggeber 2026-07-09).
 */
export const makePoll = (
    params: { title: string; options: PollOption[]; pollType: PollType; endsAt?: number },
    h: string,
    url: string,
) => {
    const tags: string[][] = [
        ...params.options.map((o) => ['option', o.id, o.label]),
        ['polltype', params.pollType],
        ['relay', url],
    ]
    if (params.endsAt) {
        tags.push(['endsAt', String(params.endsAt)])
    }
    return makeEvent(POLL, { content: params.title, tags: [...tags, ...roomTags(h, url)] })
}

/**
 * Erstellt ein NIP-75-Zap-Goal (kind 9041) im Raum (ZAPS.md Z5): `content` = Titel,
 * `["amount", <Sats>]` = Ziel (rohe Sats, Plan-Konvention — siehe `goals.ts`),
 * `["relays", url]` = wohin die Beitrags-Receipts sollen, optional `["summary", …]`
 * für Details — plus `roomTags(h, url)` (`["h", h]` + PROTECTED), damit die Goal-Karte
 * wie eine Nachricht ins Space-Relay geroutet und member-only geschützt wird.
 */
export const makeGoal = (
    params: { title: string; summary?: string; targetSats: number },
    h: string,
    url: string,
) => {
    const tags: string[][] = [['amount', String(params.targetSats)], ['relays', url]]
    if (params.summary) {
        tags.push(['summary', params.summary])
    }
    return makeEvent(ZAP_GOAL, { content: params.title, tags: [...tags, ...roomTags(h, url)] })
}

/**
 * Poll-Response (NIP-88 kind 1018): `["e", pollId]` + je gewählter Option
 * `["response", optionId]`, dazu `h` (vom Poll-Event) + PROTECTED. Erneutes Abstimmen
 * publiziert eine neue Response; das Tally wertet pro Wähler nur die jüngste aus.
 * `createdAt` wird über die vorige eigene Stimme gebumpt (Umwählen in derselben
 * Sekunde, analog zum Delete-Toggle) — sonst greift der strikt-größer-Vergleich nicht.
 */
export const makePollResponse = (poll: TrustedEvent, selectedIds: string[], url: string, createdAt: number) =>
    makeEvent(POLL_RESPONSE, {
        created_at: createdAt,
        content: '',
        tags: [['e', poll.id], ...selectedIds.map((id) => ['response', id]), ...parentRoomTags(poll, url)],
    })

/**
 * NIP-22-Kommentar (kind 1111) auf `event` (Root-Nachricht ODER Eltern-Kommentar).
 * `tagEventForComment` setzt die NIP-22-Tags: `K/E/P` (Thread-Root, Großbuchstaben)
 * + `k/e/p` (direktes Parent, klein) — dadurch entsteht der Baum, und ALLE Kommentare
 * eines Threads teilen dasselbe `["E", rootId]` (Ladefilter der Thread-Ansicht).
 * Dazu `parentRoomTags(event)` = `h` (vom Parent geerbt) + PROTECTED — sonst würde
 * der member-only NIP-29-zooid den Kommentar nicht speichern/ausliefern (Abweichung
 * vom Referenz-Client, der Threads gegen offene Relays fährt; hier wie Reaction/Poll).
 */
export const makeComment = (event: TrustedEvent, content: string, url: string) =>
    makeEvent(COMMENT, { content, tags: [...tagEventForComment(event, url), ...parentRoomTags(event, url)] })

/** `nostr:npub…`/`nostr:nprofile…`-Mentions (NIP-27) im Nachrichtentext. */
const MENTION = /nostr:(npub1[0-9a-z]+|nprofile1[0-9a-z]+)/g

/**
 * Zieht die erwähnten Pubkeys (NIP-08/NIP-27) aus dem Klartext: jedes
 * `nostr:npub…`/`nostr:nprofile…` wird dekodiert, ungültige/unbekannte Tokens
 * fallen still raus. Dedupliziert; Reihenfolge = erstes Auftreten. Pure Funktion
 * (nur nip19) → als JS-Unit ohne welshman testbar.
 */
export const mentionPubkeys = (content: string): string[] => {
    const pks: string[] = []
    for (const [, entity] of content.matchAll(MENTION)) {
        try {
            const decoded = nip19.decode(entity)
            const pk = decoded.type === 'npub' ? decoded.data : decoded.type === 'nprofile' ? decoded.data.pubkey : null
            if (pk && !pks.includes(pk)) {
                pks.push(pk)
            }
        } catch {
            // Kaputtes/gekürztes Token — kein p-Tag, kein Fehler.
        }
    }
    return pks
}
