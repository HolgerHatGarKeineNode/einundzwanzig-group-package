/**
 * Profil-Seeding (PLAN4): holt gecachte kind-0-Events vom geteilten Backend-Cache
 * und lädt sie ins welshman-Repository — Namen/Avatare erscheinen sofort, statt erst
 * nach der Live-Relay-Auflösung (Flacker-Fix). welshman löst weiterhin live nach und
 * überschreibt. Web = relativer Endpunkt; Mobile = gehosteter Host (Hybrid wie $img).
 */
import { repository } from '@welshman/app'
import { verifyEvent, verifiedSymbol, type TrustedEvent } from '@welshman/util'
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
    for (let i = 0; i < fresh.length; i += 100) {
        void seedChunk(base, fresh.slice(i, i + 100))
    }
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
