/**
 * Profil-Seeding (PLAN4): holt gecachte kind-0-Events vom geteilten Backend-Cache
 * und lädt sie ins welshman-Repository — Namen/Avatare erscheinen sofort, statt erst
 * nach der Live-Relay-Auflösung (Flacker-Fix). welshman löst weiterhin live nach und
 * überschreibt. Web = relativer Endpunkt; Mobile = gehosteter Host (Hybrid wie $img).
 */
import { get } from 'svelte/store'
import { app, Profiles, Thunks, userProfile, waitForThunkCompletion } from './welshmanApp.ts'
import { PublishStatus } from '@welshman/net'
import { makeEvent, verifyEvent, verifiedSymbol, type TrustedEvent } from '@welshman/util'
import {
    createProfile,
    editProfile,
    isPublishedProfile,
    makeProfile,
    profileHasName,
    type Profile,
    ausReader,
} from './welshmanProfile.ts'
import { indexers, relays, resolveRelays, userOutbox } from './welshmanRouter.ts'
import { isMobile } from './core.ts'
import { WORKSPACE_URL } from './spaceCaps.ts'
import { clearNativePending, loadSpaceProfiles, markNativePending } from './spaceProfiles.ts'

const HOST = 'https://group.einundzwanzig.space'
const HEX64 = /^[0-9a-f]{64}$/

/** Bereits angefragte pubkeys — kein doppelter Fetch (welshman hält den Rest live). */
const seeded = new Set<string>()

export async function warmProfiles(pubkeys: Iterable<string>): Promise<void> {
    const all = [...new Set(pubkeys)].filter((pk) => HEX64.test(pk))
    const fresh = all.filter((pk) => !seeded.has(pk))
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

    // ERST das native Nachladen anstossen — das markiert die betroffenen pubkeys
    // SYNCHRON als "pending" (spaceProfiles.ts markNativePending), BEVOR die
    // Space-Anfrage unterwegs ist. Umgekehrt (wie bis 2026-08-23) kann die oft
    // schnellere, lokale Space-Antwort eintreffen, WÄHREND die native Live-Anfrage
    // noch läuft, und der Merge zeigt kurzzeitig das FALSCHE (Fremd-)Profil an —
    // siehe spaceProfiles.ts, Kopf von `markNativePending`.
    repairMissingProfiles(all)

    // Zweite Quelle: die Profile, die es NUR im Workspace gibt. Der Backend-Cache
    // erreicht sie strukturell nicht — er fragt Indexer + Vereins-Space
    // (`ProfileCache::sources()`), nie das Workspace-Relay. Gemessen am 2026-08-18:
    // zehn von elf Forge-Maintainern haben ausschliesslich dort ein kind 0. Ergebnis
    // landet NICHT im Repository, sondern in der Anzeige-Rueckfallebene
    // ([[spaceProfiles]]) — bewusst ohne `await`, die Fläche wartet darauf nicht.
    void loadSpaceProfiles(WORKSPACE_URL, all)
}

/** Noch namenlose pubkeys, die der konservative Timer nachfasst. */
const watching = new Set<string>()
let repairTimer: ReturnType<typeof setTimeout> | null = null
// Konservativ: grosser Abstand, wenige Runden → kein Dauer-Poll, kein Performance-Verlust.
const REPAIR_INTERVAL_MS = 20_000
const REPAIR_MAX_ROUNDS = 5

/**
 * Reparatur für Autoren mit schlechter Relay-Pflege: kind-0, das der Backend-Cache nicht
 * abdeckt, live via welshman nachladen — Outbox (Schreib-Relays des Autors) UND Indexer-
 * Fallback (`purplepag.es`, `relay.damus.io`, …) statt aufzugeben. welshmans `loadProfile`
 * bringt eingebautes Exponential-Backoff (mehrere Versuche) + Dedup mit, deshalb NICHT über
 * `seeded` gated: jeder Feed-Re-Derive stösst hängende pubkeys erneut an, welshman drosselt.
 * Für STILLE Räume ohne Re-Derive gibt ein einzelner, selbst-abschaltender Timer den Rest.
 */
function repairMissingProfiles(pubkeys: string[]): void {
    for (const pk of pubkeys) {
        if (!profileHasName(app.use(Profiles).get(pk))) {
            watching.add(pk)
            // Riegel gegen die Space-Race (spaceProfiles.ts markNativePending): auf,
            // solange die Anfrage läuft, zu — sobald sie sich entscheidet (gefunden
            // oder endgültig leer). `loadProfile` wirft laut welshman nie (siehe
            // `@welshman/store` `makeLoadItem`), `.finally` genügt.
            markNativePending(pk)
            void app.use(Profiles).load(pk).finally(() => clearNativePending(pk))
        }
    }
    startRepairTimer()
}

/**
 * Ein einziger Timer für die ganze Insel — läuft nur solange etwas hängt und schaltet sich
 * nach REPAIR_MAX_ROUNDS ab (leert `watching`, damit tote Accounts nicht ewig gepollt werden).
 * Neue `warmProfiles`-Aufrufe (Aktivität/Raumwechsel) starten ihn bei Bedarf frisch neu.
 */
function startRepairTimer(): void {
    if (repairTimer || watching.size === 0) {
        return
    }
    let round = 0
    const tick = () => {
        repairTimer = null
        for (const pk of watching) {
            if (profileHasName(app.use(Profiles).get(pk))) {
                watching.delete(pk)
            }
        }
        if (watching.size === 0 || ++round > REPAIR_MAX_ROUNDS) {
            watching.clear()
            return
        }
        for (const pk of watching) {
            void app.use(Profiles).load(pk)
        }
        repairTimer = setTimeout(tick, REPAIR_INTERVAL_MS)
    }
    repairTimer = setTimeout(tick, REPAIR_INTERVAL_MS)
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
                    app.repository.publish(event)
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

/** Ein Relay-Ergebnis eines Publishs: `ok=false` trägt den (Relay-)Grund in `reason`. */
export type RelayPublishResult = { url: string; ok: boolean; reason: string }

/**
 * welshman-Thunk-Results → flache Per-Relay-Liste (pure, JS-Unit-fähig). `success`
 * = akzeptiert; alles andere (failure/timeout/aborted) = Ablehnung mit Relay-Detail
 * als Grund (Fallback: der Status selbst). Ersetzt das First-Failure-`waitForThunkError`,
 * das ein einzelnes ablehnendes Relay wie einen Totalausfall aussehen ließ.
 */
export const summarizePublishResults = (
    results: Record<string, { relay: string; status: string; detail?: string }>,
): RelayPublishResult[] =>
    Object.values(results).map((r) => ({
        url: r.relay,
        ok: r.status === PublishStatus.Success,
        reason: r.status === PublishStatus.Success ? '' : r.detail || r.status,
    }))

/**
 * Empfangsadresse als kind-0 publizieren (ZAPS.md Z4): an die Schreib-Relays des
 * Users (`FromUser`), die übergebenen `spaceUrls` (Space-Relays) und den Index.
 * Signatur 100 % im Browser (`publishThunk` → Session-Signer). Wartet auf den
 * ABSCHLUSS aller Relays und gibt die Per-Relay-Ergebnisse zurück — der Aufrufer
 * entscheidet (≥1 akzeptiert = gespeichert), statt bei einem einzigen Reject
 * (z. B. Member-Relay „NIP-05 needed") alles als Fehler zu werten.
 * `spaceUrls` kommt vom Aufrufer (`js/groups.ts` `userSpaceUrls`), damit dieses
 * Modul `@welshman/util`-nah bleibt (kein `./groups`-Import → JS-Unit-fähig).
 */
export const publishReceivingAddress = async (lud16: string, spaceUrls: string[] = []): Promise<RelayPublishResult[]> => {
    const event = buildReceivingAddressEvent(ausReader(get(userProfile)), lud16)
    // 0.9.5: die deklarative RelaySelection-DSL statt `router.merge([...])`. Diese
    // Funktion ist ohnehin `async`, also geht hier der volle Weg — inklusive des
    // Nachladens fehlender Relay-Listen, das die synchronen Helfer nicht können.
    const szenario = await resolveRelays([userOutbox(), ...relays(spaceUrls), indexers()])
    const zielRelays = szenario.getUrls().filter(acceptsProfiles)
    const thunk = app.use(Thunks).publish({ event, relays: zielRelays })
    await waitForThunkCompletion(thunk)
    return summarizePublishResults(thunk.results)
}

/**
 * Reine Relay-Listen-Indexer, die AUSSCHLIESSLICH kind 10002 (NIP-65-Relayliste)
 * annehmen und jedes kind-0 mit `blocked: this relay only accepts kind 10002 events`
 * ablehnen. Sie stehen zu Recht in `INDEXER_RELAYS` (dort lesen wir Relaylisten), sind
 * als Ziel eines Profil-Publishs aber sinnlos: sie speichern kind 0 nie. Ohne diesen
 * Filter zeigte die Profil-Diagnose nach jedem erfolgreichen Speichern einen roten
 * Relay-Fehler — technisch korrekt gemeldet, für den Nutzer schlicht falsch.
 *
 * Bewusst eine Ausschlussliste und KEIN Entfernen aus `INDEXER_RELAYS`: zum LESEN von
 * Relaylisten bleibt das Relay wertvoll. `purplepag.es` bleibt drin — es indexiert
 * kind 0 und kind 10002 und ist der wichtigste Profil-Indexer.
 */
const PROFILE_HOSTILE_INDEXERS = ['indexer.coracle.social']

const acceptsProfiles = (url: string): boolean => !PROFILE_HOSTILE_INDEXERS.some((host) => url.includes(host))
