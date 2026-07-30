/**
 * Profil-Herkunft: **das native Nostr-Profil gewinnt, nicht das des Workspace-Relays.**
 *
 * Buzz legt beim Onboarding ein eigenes kind-0 an — am Prod-Relay am 2026-07-30
 * nachgesehen: vier Profile mit generierten Namen („Bumble", „Honey", „Fizz") und
 * eigenen Bildern, Zeitstempel von heute. Genau das ist das Problem: kind 0 ist ein
 * **ersetzbares** Event, im welshman-Repository gewinnt pro Pubkey der jüngste
 * Zeitstempel. Ein frisch erzeugtes Buzz-Profil ist fast immer jünger als das echte,
 * über Jahre gepflegte — betritt man den Workspace, kippen Name und Avatar auf die
 * Buzz-Fassung, und zwar app-weit, weil `profilesByPubkey` EINE Quelle pro Pubkey hat.
 *
 * Zwei Hälften, beide nötig:
 *
 * 1. **Nicht mehr anfragen** — `members.ts` holt kind 0 zusätzlich vom Space-Relay
 *    (auf zooid sinnvoll, dort veröffentlichen Mitglieder ihr Profil oft direkt). Auf
 *    einem Buzz-Space unterbleibt das jetzt.
 * 2. **Schon Vorhandenes entfernen** — Punkt 1 allein reicht nicht: einmal
 *    eingesammelte Buzz-Profile liegen im Repository UND in der IndexedDB
 *    (`storage.ts` persistiert PROFILE). Sie blieben dort liegen und gewännen weiter
 *    gegen das echte Profil, solange dessen Zeitstempel älter ist.
 *
 * Entfernt wird nur, was **ausschließlich** vom Workspace-Relay stammt. Ein Profil,
 * das der Tracker auch auf einem anderen Relay gesehen hat, ist kein Buzz-Artefakt —
 * es ist dasselbe Event, das auch im nativen Nostr liegt, und bleibt unangetastet.
 */
import { repository, tracker, loadProfile } from '@welshman/app'
import { PROFILE, type TrustedEvent } from '@welshman/util'

/**
 * Stammt dieses Event **nur** vom Space-Relay?
 *
 * Pure Funktion, damit die Entscheidung ohne Repository und ohne Relay testbar ist —
 * sie ist die einzige Stelle, an der über das Löschen entschieden wird.
 *
 * Leere Herkunft → `false`. Ein Event ohne Tracker-Eintrag kommt aus der IndexedDB
 * oder dem Backend-Cache; woher es ursprünglich stammt, wissen wir nicht, und eine
 * Vermutung rechtfertigt kein Löschen.
 */
export const isSpaceLocalOnly = (relays: Iterable<string> | undefined, spaceUrl: string): boolean => {
    const seen = Array.from(relays ?? [])
    return seen.length > 0 && seen.every((r) => r === spaceUrl)
}

/**
 * Entfernt alle kind-0, die ausschließlich vom Workspace-Relay stammen, und stößt für
 * die betroffenen Pubkeys ein frisches `loadProfile` an (Outbox + Indexer-Fallback).
 * Liefert die Zahl der entfernten Profile — für Log/Test, nicht für die UI.
 */
export const purgeSpaceLocalProfiles = (spaceUrl: string): number => {
    let removed = 0
    for (const event of repository.query([{ kinds: [PROFILE] }]) as TrustedEvent[]) {
        if (isSpaceLocalOnly(tracker.getRelays(event.id), spaceUrl)) {
            repository.removeEvent(event.id)
            void loadProfile(event.pubkey)
            removed++
        }
    }
    return removed
}
