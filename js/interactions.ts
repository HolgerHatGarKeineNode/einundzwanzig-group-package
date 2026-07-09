/**
 * Zentrale Publish-Helfer für schreibende Room-Aktionen (PLAN5). Hier lebt die
 * NIP-29/NIP-70-Tag-Logik, die JEDE Aktion teilt (Message, Reply — und ab C1
 * Reaction/Delete/Poll). Die konkreten `make*`-Event-Builder aus dem Referenz-
 * Client kommen mit ihrer Phase; C0 legt nur `roomTags` an.
 */
import { DELETE, REACTION, REPORT, getTag, makeEvent, type TrustedEvent } from '@welshman/util'
import { getRelay, tagEvent, tagEventForReaction } from '@welshman/app'
import { hasNip70 } from './relayCaps'

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
