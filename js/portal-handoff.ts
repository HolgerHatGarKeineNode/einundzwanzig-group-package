/**
 * Single-Login → Portal-Anbindung (Mobile).
 *
 * Nach dem welshman-Login besorgt DERSELBE Signer im Hintergrund ein Portal-
 * Token — der Nutzer meldet sich nur EINMAL an. Nicht-blockierend und
 * fehlertolerant: schlägt der Handoff fehl (Portal offline, Signatur abgelehnt),
 * bleibt der Chat voll nutzbar.
 *
 * ZEITPUNKT (wichtig): Der Handoff läuft NICHT direkt beim Login, sondern erst
 * auf der Zielseite über das Mobile-Boot-Gate (session.ts). Sonst würde die
 * Login-Navigation (`window.location.assign`) den Handoff NACH dem Signieren,
 * VOR dem POST abreißen (am Gerät beobachtet). `schedulePortalHandoff()` merkt
 * ihn nur vor; `runScheduledPortalHandoff()` führt ihn auf der stabilen Seite
 * aus und wiederholt bei Fehlschlag beim nächsten Seiten-Load.
 *
 * Host-Contract: dieses geteilte Package kennt NUR zwei lokale, gleich-origin
 * Endpunkte, die die Host-App bereitstellt — `/portal/nostr-challenge` und
 * `/portal/nostr-handoff`. Kein Portal-URL, kein Token, kein Keystore hier; die
 * Mobile-App proxyt zum Portal + persistiert nativ, eine spätere Web-Variante
 * implementiert dieselben zwei Routen server-seitig. Läuft nur in der nativen
 * App (`isMobile`); im Web ohne Portal-Host ein No-op.
 */
import { signer } from '@welshman/app'
import { isMobile } from './core'
import { portalAuthEventTemplate } from './portal-auth-event'

/** sessionStorage-Marker: „nach dem Login das Portal verbinden" (überlebt die
 *  Login-Navigation, wird beim Erfolg gelöscht). */
const HANDOFF_PENDING_KEY = 'portalHandoffPending'

let handoffInFlight = false

/** Merkt den Portal-Handoff für die Zielseite vor (aus postLoginRedirect). */
export function schedulePortalHandoff(): void {
    if (!isMobile) {
        return
    }
    try {
        sessionStorage.setItem(HANDOFF_PENDING_KEY, '1')
    } catch {
        // sessionStorage nicht verfügbar → dann eben kein Auto-Portal-Login.
    }
}

/**
 * Führt einen vorgemerkten Handoff aus (Mobile-Boot-Gate, auf der Zielseite).
 * Bei Erfolg wird die Vormerkung gelöscht; bei Fehlschlag bleibt sie → der
 * nächste Seiten-Load versucht es erneut (z. B. Portal war kurz offline).
 */
export async function runScheduledPortalHandoff(): Promise<void> {
    if (!isMobile || handoffInFlight) {
        return
    }
    try {
        if (sessionStorage.getItem(HANDOFF_PENDING_KEY) !== '1') {
            return
        }
    } catch {
        return
    }

    handoffInFlight = true
    try {
        if (await handoffToPortal()) {
            try {
                sessionStorage.removeItem(HANDOFF_PENDING_KEY)
            } catch {
                // egal — schlimmstenfalls ein weiterer (idempotenter) Versuch.
            }
        }
    } finally {
        handoffInFlight = false
    }
}

/**
 * Ein Handoff-Durchlauf: Challenge holen → kind-22242 mit dem aktiven Signer
 * signieren → gegen ein Portal-Token tauschen (die Host-Route persistiert es).
 * Gibt true bei erfolgreichem Tausch zurück; niemals werfend.
 */
async function handoffToPortal(): Promise<boolean> {
    if (!isMobile) {
        return false
    }

    const activeSigner = signer.get()
    if (!activeSigner) {
        return false
    }

    try {
        const challengeRes = await fetch('/portal/nostr-challenge', {
            headers: { Accept: 'application/json' },
        })
        if (!challengeRes.ok) {
            return false
        }
        const { k1 } = (await challengeRes.json()) as { k1?: string }
        if (!k1) {
            return false
        }

        const event = await activeSigner.sign(portalAuthEventTemplate(k1, Math.floor(Date.now() / 1000)))

        const handoffRes = await fetch('/portal/nostr-handoff', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '',
            },
            body: JSON.stringify({ k1, event }),
        })
        return handoffRes.ok
    } catch {
        // Portal-Handoff ist optional; ein Fehler darf den Chat-Login nie stören.
        return false
    }
}
