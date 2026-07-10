/**
 * Pures Portal-Login-Event (kind 22242, NIP-42-artig) — welshman-app-frei, damit
 * unit-testbar. Das Portal (`NostrLogin::verifyEvent`) prüft NUR kind == 22242,
 * den `challenge`-Tag == k1, `created_at` ≤ 300 s und die Schnorr-Signatur; ein
 * `relay`-Tag verlangt es NICHT — deshalb reicht dieses Minimal-Template. Der
 * aktive welshman-Signer signiert es (Key bleibt im Browser/Signer).
 */
import type { StampedEvent } from '@welshman/util'

export function portalAuthEventTemplate(k1: string, createdAt: number): StampedEvent {
    return {
        kind: 22242,
        created_at: createdAt,
        tags: [['challenge', k1]],
        content: '',
    }
}
