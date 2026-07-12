/**
 * Profil-Seeding (PLAN4): holt gecachte kind-0-Events vom geteilten Backend-Cache
 * und lädt sie ins welshman-Repository — Namen/Avatare erscheinen sofort, statt erst
 * nach der Live-Relay-Auflösung (Flacker-Fix). welshman löst weiterhin live nach und
 * überschreibt. Web = relativer Endpunkt; Mobile = gehosteter Host (Hybrid wie $img).
 */
import { get } from 'svelte/store'
import { publishThunk, repository, userProfile, waitForThunkError } from '@welshman/app'
import { createProfile, editProfile, isPublishedProfile, makeEvent, makeProfile, verifyEvent, verifiedSymbol, type Profile, type TrustedEvent } from '@welshman/util'
import { Router } from '@welshman/router'
import { isMobile } from './core'

const HOST = 'https://group.einundzwanzig.space'
const HEX64 = /^[0-9a-f]{64}$/

/** Bereits angefragte pubkeys — kein doppelter Fetch (welshman hält den Rest live). */
const seeded = new Set<string>()

export async function warmProfiles(pubkeys: Iterable<string>): Promise<void> {
    const fresh = [...new Set(pubkeys)].filter((pk) => HEX64.test(pk) && !seeded.has(pk))
    if (fresh.length === 0) {
        return
    }
    fresh.forEach((pk) => seeded.add(pk))

    const base = isMobile ? HOST : ''
    // In 100er-Blöcken (Endpoint-Limit) laden, damit große Räume nicht abgeschnitten werden.
    // Awaitbar (Viewport-Prewarm-Gate, Schritt 4): seedChunk fängt Fehler intern → rejectet nie.
    // fire-and-forget-Aufrufer nutzen weiter `void warmProfiles(...)`, unverändert.
    const chunks: Promise<void>[] = []
    for (let i = 0; i < fresh.length; i += 100) {
        chunks.push(seedChunk(base, fresh.slice(i, i + 100)))
    }
    await Promise.all(chunks)
}

async function seedChunk(base: string, pubkeys: string[]): Promise<void> {
    try {
        const res = await fetch(`${base}/nostr/profiles?pubkeys=${pubkeys.join(',')}`, {
            headers: { Accept: 'application/json' },
        })
        if (!res.ok) {
            return
        }
        const { events } = (await res.json()) as { events: TrustedEvent[] }
        // WICHTIG: `repository.publish()` (additiv), NICHT `repository.load()` — load
        // LEERT das Repository und lädt nur die übergebenen Events (würde Nachrichten
        // und Raum-Mitgliedschaft wegwischen). publish fügt einzeln hinzu + notifiziert.
        for (const event of events ?? []) {
            try {
                if (verifyEvent(event)) {
                    ;(event as unknown as Record<symbol, boolean>)[verifiedSymbol] = true
                    repository.publish(event)
                }
            } catch {
                // ungültige Signatur → überspringen (nie ungeprüfte Relay-Daten laden).
            }
        }
    } catch {
        // Endpoint/Netz weg → welshman löst die Profile ohnehin live auf.
    }
}

/**
 * kind-0-Event für eine geänderte Empfangsadresse bauen (ZAPS.md Z4, pure — nur
 * `@welshman/util`, als JS-Unit ohne Signer/Relay prüfbar). Setzt `lud16` (leer ⇒
 * entfernt) und **löscht `lud06`** (flotilla-Verhalten: eine Adresse, nicht zwei).
 * Bestehendes Profil ⇒ `editProfile` (behält übrige Felder), sonst `createProfile`.
 * Ein alter PROTECTED-Tag (`["-"]`) wird abgestreift — kind-0 nicht geschützt publizieren.
 */
export const buildReceivingAddressEvent = (current: Profile | undefined, lud16: string) => {
    const next: Profile = { ...(current ?? makeProfile()), lud06: undefined, lud16: lud16.trim() || undefined }
    const template = isPublishedProfile(next) ? editProfile(next) : createProfile(next)
    template.tags = template.tags.filter((t) => t[0] !== '-')
    return makeEvent(template.kind, template)
}

/**
 * Empfangsadresse als kind-0 publizieren (ZAPS.md Z4): an die Schreib-Relays des
 * Users (`FromUser`), die übergebenen `spaceUrls` (Space-Relays) und den Index.
 * Signatur 100 % im Browser (`publishThunk` → Session-Signer). Gibt die (deutsche)
 * Thunk-Fehlermeldung zurück (leer = Erfolg), analog `sendReaction`/`sendReport`.
 * `spaceUrls` kommt vom Aufrufer (`js/groups.ts` `userSpaceUrls`), damit dieses
 * Modul `@welshman/util`-nah bleibt (kein `./groups`-Import → JS-Unit-fähig).
 */
export const publishReceivingAddress = (lud16: string, spaceUrls: string[] = []): Promise<string> => {
    const event = buildReceivingAddressEvent(get(userProfile), lud16)
    const router = Router.get()
    const relays = router.merge([router.FromUser(), router.FromRelays(spaceUrls), router.Index()]).getUrls()
    return waitForThunkError(publishThunk({ event, relays }))
}
