/**
 * Pure NIP-88-Poll-Logik (kind 1068 Poll, kind 1018 Response) — aus flotillas
 * `polls.ts` portiert. Bewusst **welshman-app-frei** (nur `@welshman/util`/`lib`),
 * damit die Auswahl-/Tally-Regeln als reine JS-Unit ohne Browser prüfbar sind.
 * Die publish-nahen Builder (`makePoll`/`makePollResponse`) liegen in `interactions.ts`.
 */
import { now, removeUndefined, uniq } from '@welshman/lib'
import { getTag, getTagValue, getTags, getTagValues, type TrustedEvent } from '@welshman/util'

export type PollType = 'singlechoice' | 'multiplechoice'

/** Eine Poll-Option: stabile `id` (im `option`-Tag) + Anzeigetext. */
export type PollOption = { id: string; label: string }

/** `["polltype", …]` → Einfach-/Mehrfachwahl (Default Einfachwahl). */
export const getPollType = (event: TrustedEvent): PollType =>
    getTagValue('polltype', event.tags) === 'multiplechoice' ? 'multiplechoice' : 'singlechoice'

/** Optionen aus den `["option", id, label]`-Tags (ohne id verworfen; label defaultet auf id). */
export const getPollOptions = (event: TrustedEvent): PollOption[] =>
    removeUndefined(
        getTags('option', event.tags).map((tag) => {
            const [, id, label = id] = tag
            return id ? { id, label } : undefined
        }),
    )

/** `["endsAt", unix]` → Timestamp oder undefined (auch bei kaputtem Wert). */
export const getPollEndsAt = (event: TrustedEvent): number | undefined => {
    const endsAt = getTagValue('endsAt', event.tags)
    if (!endsAt) {
        return undefined
    }
    const ts = parseInt(endsAt)
    return Number.isNaN(ts) ? undefined : ts
}

/** Läuft die Poll noch? Ohne `endsAt` nie geschlossen. */
export const isPollClosed = (event: TrustedEvent): boolean => {
    const endsAt = getPollEndsAt(event)
    return typeof endsAt === 'number' ? endsAt <= now() : false
}

/**
 * Gewählte Options-IDs einer Response, unter Beachtung des Poll-Typs: Einfachwahl
 * zählt nur die erste, Mehrfachwahl dedupliziert. Reine Regel — der Kern der JS-Unit.
 */
export const getPollResponseSelections = (event: TrustedEvent, pollType: PollType): string[] => {
    const selections = getTagValues('response', event.tags)
    return pollType === 'singlechoice' ? selections.slice(0, 1) : uniq(selections)
}

/** Aggregiertes Ergebnis: Stimmen je Option + Wählerzahl. */
export type PollResults = { options: { id: string; label: string; votes: number }[]; voters: number }

/**
 * Zählt die Stimmen: pro Wähler zählt nur die **jüngste** Response (created_at),
 * ihre Auswahl (typ-korrekt) erhöht die Options-Zähler. So macht es flotilla —
 * Einfachwahl-Umentscheiden überschreibt, Mehrfachwahl summiert je Option.
 */
export const getPollResults = (event: TrustedEvent, responses: TrustedEvent[]): PollResults => {
    const pollType = getPollType(event)
    const options = getPollOptions(event).map((option) => ({ ...option, votes: 0 }))
    const counts = new Map(options.map((option) => [option.id, option]))
    const latestByPubkey = new Map<string, TrustedEvent>()

    for (const response of responses) {
        const current = latestByPubkey.get(response.pubkey)
        if (!current || response.created_at > current.created_at) {
            latestByPubkey.set(response.pubkey, response)
        }
    }

    for (const response of latestByPubkey.values()) {
        for (const optionId of getPollResponseSelections(response, pollType)) {
            const option = counts.get(optionId)
            if (option) {
                option.votes += 1
            }
        }
    }

    return { options, voters: latestByPubkey.size }
}

/** Options-IDs, die `pubkey` zuletzt gewählt hat (leeres Array = keine Stimme). */
export const ownPollSelection = (
    event: TrustedEvent,
    responses: TrustedEvent[],
    pubkey: string | null | undefined,
): string[] => {
    if (!pubkey) {
        return []
    }
    let latest: TrustedEvent | undefined
    for (const response of responses) {
        if (response.pubkey === pubkey && (!latest || response.created_at > latest.created_at)) {
            latest = response
        }
    }
    return latest ? getPollResponseSelections(latest, getPollType(event)) : []
}

/** `["e", pollId]` einer Response → zugehörige Poll (fürs Gruppieren nach Ziel). */
export const pollResponseTarget = (event: TrustedEvent): string => getTag('e', event.tags)?.[1] ?? ''

/** Vorangestelltes `nostr:nevent…`/`note…`-Zitat (unser Quote-Prefix). */
export const QUOTE_PREFIX = /^nostr:(?:nevent1|note1)[0-9a-z]+\n\n/

/**
 * Ist `event` die reine kind-9-Share-Quote einer Poll aus `pollIds` (Frage kommt
 * bereits als native Poll-Karte)? Erkennungsmerkmal: `q`-Tag zeigt auf eine Poll-ID
 * UND der Text besteht NUR aus dem `nostr:nevent…`-Zitat (kein eigener Kommentar).
 * Diese Quote posten wir ausschließlich für Flotilla (dessen Chat-Feed kind-1068
 * nicht direkt lädt); im eigenen Feed wird sie ausgeblendet, sonst erschiene die
 * Poll doppelt. Ein echtes Textzitat auf eine Poll (nicht leer) bleibt sichtbar.
 */
export const isPollShareQuote = (event: TrustedEvent, pollIds: Set<string>): boolean => {
    const q = getTagValue('q', event.tags)
    return q !== undefined && pollIds.has(q) && event.content.replace(QUOTE_PREFIX, '').trim() === ''
}
