/**
 * Die REGELN der Profil-Zusammenführung — import-frei und damit unter `node --test`
 * direkt prüfbar (Muster `imageFallback.ts`). Wer entscheidet, was angezeigt wird,
 * entscheidet hier; wer Events holt und Stores hält, tut das in `spaceProfiles.ts`.
 *
 * ── Was gemessen wurde (2026-08-18, `wss://buzz.einundzwanzig.space`) ──
 *
 * Das Repo-Announcement `einundzwanzig-verein` (kind 30617) trägt zehn
 * `maintainers`-Pubkeys. Für **alle zehn** liefert Buzz ein kind 0 mit `display_name`
 * (`ceo`, `nostr-specialist`, `design-lead`, …), `about` und Bild. Dieselben zehn
 * haben auf `purplepag.es`, `relay.damus.io`, `nos.lol`, `relay.nostr.band` und am
 * Vereins-Relay **null** kind 0 — sie existieren nur im Workspace. Genau deshalb
 * standen in der Maintainer-Zeile zehn `N`-Initialen: `displayProfileByPubkey` fiel
 * auf die gekürzte npub-Form zurück.
 *
 * Der elfte Pubkey (der Repo-Eigentümer) hat beides: nativ „El Presidento Ben"
 * (`created_at` 1781649668) und auf Buzz „ElPresidentoBenito" (1785401118) — das
 * Space-Event ist **jünger**. Die Gefahr aus der alten Fassung ist also real: käme
 * das Space-kind-0 ins gemeinsame Repository, verdrängte es app-weit den echten
 * Namen, weil kind 0 ersetzbar ist (NIP-01) und pro Pubkey nur EINE Fassung überlebt.
 * Deshalb wird nicht im Repository gemischt, sondern hier — beim Anzeigen.
 */
import type { TrustedEvent } from '@welshman/util'
import type { Profile } from './welshmanProfile.ts'
import { mediaOriginOf } from './blossomAuth.ts'

/**
 * Stammt dieses Event **nur** vom Space-Relay?
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
 * Die Felder, die ein Space-Profil beisteuern darf — und **nur** diese.
 *
 * Bewusst NICHT dabei:
 * - `lud06`/`lud16`/`lnurl`: eine Zahlungsadresse aus einem relay-erzeugten Profil
 *   leitete Zaps an einen Empfänger um, den der Nutzer nie gewählt hat. Eine fehlende
 *   Zap-Adresse ist ein fehlendes Feature, eine falsche ist ein Vermögensschaden.
 * - `nip05`: eine Identitätsbehauptung („ich bin x@domain"), die ein Space-Relay ohne
 *   Zutun des Nutzers setzen kann. Gemessen setzt Buzz ohnehin keine.
 * - `event`: das gemergte Objekt trägt immer das NATIVE Event (siehe
 *   {@link mergeProfileForDisplay}) — sonst hinge an einem Anzeige-Objekt ein
 *   Editier-/Publish-Pfad, der auf dem Space-Event aufsetzt.
 *
 * Die Liste greift auf ZWEI Ebenen, absichtlich doppelt: beim Aufnehmen in die
 * Zweitquelle ({@link sanitizeSpaceProfile}) und beim Zusammenführen
 * ({@link spaceFieldsForDisplay}). Eine Ebene allein war nachweislich zu wenig — der
 * Kurzschluss-Zweig „kein natives Profil" ging an ihr vorbei.
 */
export const MERGED_FIELDS = ['name', 'display_name', 'picture', 'banner', 'about', 'website'] as const

/** Leer = fehlt. Ein Feld aus Leerzeichen ist ein leeres Feld. */
const isBlank = (value: unknown): boolean => typeof value !== 'string' || value.trim() === ''

/**
 * Die Felder, die ein Space-Profil beisteuern darf, aus einem Space-Profil heraus —
 * und **nichts sonst**. Leere Felder fallen weg, ein leeres Ergebnis ist `undefined`.
 *
 * **Diese Funktion ist der einzige Weg, auf dem Daten der Zweitquelle in ein
 * Anzeige-Objekt gelangen.** Sie steht getrennt, weil die Allowlist sonst nur auf dem
 * einen von zwei Pfaden griffe: der Kurzschluss „kein natives Profil → nimm das
 * Space-Profil" gab vorher die Referenz der Zweitquelle unverändert weiter, samt
 * `lud16`, `lud06`, `nip05` und dem Space-`event`. Genau dieser Zweig ist im Workspace
 * der NORMALFALL (gemessen zehn von elf Maintainern ohne natives Profil), und
 * `feeds.ts` baut aus `profile.lud16 || profile.lud06` das Zap-Ziel — ein Relay hätte
 * damit die Empfangsadresse setzen können. Zurückgegeben wird deshalb immer ein NEUES
 * Objekt: nie eine geteilte Referenz auf einen Eintrag der Zweitquelle.
 */
export const spaceFieldsForDisplay = (local: Profile | undefined): Profile | undefined => {
    if (!local) {
        return undefined
    }
    let picked: Profile | undefined
    for (const field of MERGED_FIELDS) {
        if (!isBlank(local[field])) {
            picked = picked ?? {}
            picked[field] = local[field]
        }
    }
    return picked
}

/**
 * Natives Profil + Space-Profil → EIN Anzeige-Objekt.
 *
 * **Regel: das native Profil gewinnt pro FELD.** Das Space-Profil füllt nur, was dort
 * leer ist oder fehlt, und auch das nur aus {@link MERGED_FIELDS}. Ein gepflegter Name
 * kann damit nie durch einen generierten ersetzt werden — auch dann nicht, wenn das
 * Space-Event jünger ist (was es gemessen fast immer ist). Zeitstempel spielen hier
 * bewusst **keine** Rolle: sie sind genau das Kriterium, das im Repository zum
 * Falschen führt.
 *
 * Kein Space-Profil → das native Objekt wird **unverändert durchgereicht** (gleiche
 * Referenz): der Normalfall darf keine Allokation und keinen Identitätswechsel kosten,
 * sonst rechnete jede abgeleitete Fläche bei jedem Emit neu. Kein natives Profil →
 * ein neues Objekt aus {@link spaceFieldsForDisplay}, ohne `event` und ohne
 * Zahlungsfelder.
 */
export const mergeProfileForDisplay = (native: Profile | undefined, local: Profile | undefined): Profile | undefined => {
    if (!local) {
        return native
    }
    if (!native) {
        return spaceFieldsForDisplay(local)
    }
    let merged: Profile | undefined
    for (const field of MERGED_FIELDS) {
        if (isBlank(native[field]) && !isBlank(local[field])) {
            merged = merged ?? { ...native }
            merged[field] = local[field]
        }
    }
    return merged ?? native
}

/**
 * Wird dieses Bild vom Space-Relay selbst ausgeliefert? (Origin gegen Origin,
 * `wss://` → `https://`.)
 *
 * Ein zu lockerer Vergleich würfe legitime Fremdbilder weg, ein zu strenger ließe die
 * unbrauchbaren stehen — deshalb steht die Entscheidung hier allein und wird einzeln
 * geprüft.
 */
export const isSpaceHostedMedia = (picture: unknown, spaceUrl: string): boolean => {
    if (typeof picture !== 'string' || picture === '' || !spaceUrl) {
        return false
    }
    const origin = mediaOriginOf(spaceUrl)
    try {
        return origin !== '' && new URL(picture).origin === origin
    } catch {
        return false
    }
}

/**
 * Ein Space-Profil anzeigefertig machen: **nur** die Felder aus {@link MERGED_FIELDS},
 * dazu das Event (siehe unten). Aufbauend gefiltert, nicht abziehend — ein neues Feld
 * der Fremdquelle ist damit nicht automatisch drin.
 *
 * ── Was hier bis 2026-08-19 zusätzlich passierte, und warum es weg ist ──
 *
 * Ein `picture`/`banner`, das vom Space-Relay selbst kommt, wurde verworfen: Buzz
 * verlangt für jedes `GET /media/…` ein signiertes Blossom-Event, und ein `<img src>`
 * kann diesen Header nicht mitschicken (gemessen: blank `401`, signiert `200`). Die
 * Fläche holt diese Bilder jetzt über [[blossomMedia]] mit dem Schlüssel des
 * angemeldeten Nutzers — die URL wird also gebraucht und bleibt stehen. Erkannt wird
 * der Fall am Origin ({@link isSpaceHostedMedia}), nicht an einem Merker im Profil:
 * die URL trägt die Information schon, und ein zweiter, mitzupflegender Zustand wäre
 * die nächste Stelle, an der etwas auseinanderläuft.
 */
export const sanitizeSpaceProfile = (profile: Profile): Profile => {
    const clean: Profile = {}
    for (const field of MERGED_FIELDS) {
        if (!isBlank(profile[field])) {
            clean[field] = profile[field]
        }
    }
    // `event` bleibt: {@link loadSpaceProfiles} vergleicht daran den Zeitstempel zweier
    // Fassungen. Es verlässt die Zweitquelle nie — {@link spaceFieldsForDisplay} nimmt
    // es nicht mit.
    clean.event = profile.event
    return clean
}

/**
 * Der jüngste Eintrag pro Pubkey aus einem Schwung Events.
 *
 * Nötig, weil ein Relay zu einem ersetzbaren Kind durchaus mehrere Fassungen
 * ausliefert — am Buzz-Relay ist das für kind 30618 belegt, und für kind 0 gilt
 * dieselbe Mechanik. Wer den letzten nimmt statt den jüngsten, zeigt Zufall an.
 */
export const newestByPubkey = (events: TrustedEvent[]): Map<string, TrustedEvent> => {
    const byPubkey = new Map<string, TrustedEvent>()
    for (const event of events) {
        const previous = byPubkey.get(event.pubkey)
        if (!previous || event.created_at > previous.created_at) {
            byPubkey.set(event.pubkey, event)
        }
    }
    return byPubkey
}
