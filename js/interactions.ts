/**
 * Zentrale Publish-Helfer für schreibende Room-Aktionen (PLAN5). Hier lebt die
 * NIP-29/NIP-70-Tag-Logik, die JEDE Aktion teilt (Message, Reply — und ab C1
 * Reaction/Delete/Poll). Die konkreten `make*`-Event-Builder aus dem Referenz-
 * Client kommen mit ihrer Phase; C0 legt nur `roomTags` an.
 */
import { getRelay } from '@welshman/app'
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
