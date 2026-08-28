/**
 * M3 P0 — Lokale Persistenz der welshman-`repository` (Kaltstart-Cache).
 *
 * Die welshman-`repository`/`tracker` sind reine In-Memory-Singletons; jeder
 * Kaltstart (Mobile-App-Start UND Web-Reload) lädt alle Events neu vom member-
 * only-Relay hinter NIP-42-AUTH — das sind die ~13 s. Dieser Modul spiegelt die
 * gecachten Events VOR dem ersten Raum-`setup()` in die `repository` zurück →
 * der bestehende Warm-Pfad malt instant, nur Deltas gehen übers Netz.
 *
 * Portiert schlank aus `flotilla/src/app/storage.ts`, aber gegen ROHE IndexedDB
 * (Muster `secure-storage.ts`) statt der `idb`-Dependency — keine neue Dep.
 *
 * ponytail: iOS-WKWebView läuft mit `WKWebsiteDataStore.nonPersistent()` (vendored,
 * gitignorierte NativePHP-Shell) → IndexedDB dort ephemer, Cache pro Kaltstart weg.
 * Scope von M3 ist Web + Android. Upgrade-Pfad für iOS-Durability: NativePHP-Flag
 * für `WKWebsiteDataStore.default()` ODER nativer On-Device-SQLite-Bridge-Cache.
 */
import { pubkey } from './welshmanSession.ts'
import { repository, tracker } from './welshmanApp.ts'
import { on, batch } from '@welshman/lib'
import { verifiedSymbol, type TrustedEvent } from '@welshman/util'
import {
    PROFILE,
    FOLLOWS,
    DELETE,
    ROOM_DELETE,
    ROOM_DELETE_EVENT,
    MESSAGE,
    COMMENT,
    POLL,
    ZAP_GOAL,
    MUTES,
    RELAYS,
    RELAY_MEMBERS,
    APP_DATA,
    ROOM_META,
    ROOM_ADMINS,
    ROOM_MEMBERS,
} from './welshmanKinds.ts'
import type { RepositoryUpdate } from '@welshman/net'
import { BUZZ_MESSAGE_V2 } from './relayCaps.ts'
import { BUZZ_PIN, ZOOID_PIN_LIST, isZooidPinList } from './pins.ts'
import {
    FORGE_COMMENT,
    GIT_ISSUE,
    GIT_PR_UPDATE,
    GIT_PULL_REQUEST,
    GIT_STATUS_KINDS,
    PROJECT_ANNOUNCEMENT,
    REPO_ANNOUNCEMENT,
    REPO_STATE,
    forgeTargetAddress,
    isForgeComment,
    repoAddressOf,
} from './forgeModels.ts'
import { FORUM_COMMENT, FORUM_POST } from './forumModels.ts'
import { USER_STATUS } from './userStatusData.ts'

// §4.4 Multi-Account: EINE DB PRO pubkey (`…-<hex>`). Damit teilen zwei Accounts NIE
// einen Store → kein Cross-Account-Leak (auch nicht über konkurrierende Web-Tabs, die
// sich denselben Origin/IDB teilen, oder einen still fehlgeschlagenen Clear). Der owner-
// Marker/-Gate entfällt komplett — die DB-Zugehörigkeit IST der pubkey. Gast (kein pk)
// öffnet gar keine DB.
const DB_PREFIX = 'einundzwanzig-cache-'
const DB_VERSION = 1

type StoreName = 'events' | 'tracker'

/** id→relays-Zeile im `tracker`-Store (Set ist nicht structured-clone-freundlich). */
type TrackerItem = { id: string; relays: string[] }

/**
 * §4.1 Whitelist — was gecacht wird: Chat (MESSAGE=9, der 13-s-Treiber) +
 * bounded Control-Plane (Profile/Follows/Relays/Room-Meta/Member-Listen) +
 * kind 5 (DELETE, zwingend — sonst reappearen gelöschte Nachrichten) + kind 9005
 * (ROOM_DELETE_EVENT, NIP-29 Admin-Löschung fremder Nachrichten — derselbe Grund:
 * der Tombstone MUSS den Kaltstart überleben, sonst aufersteht die gelöschte
 * Nachricht bei einem Client, der beim Live-Broadcast offline war).
 *
 * kind 9008 (ROOM_DELETE, gelöschter RAUM) aus genau demselben Grund — er fehlte
 * hier, obwohl das Argument eine Zeile höher steht. Folge: Das 39000 des Raums lag
 * im Cache, sein Grabstein nicht. Beim Kaltstart erschien ein gelöschter Raum in
 * „Meine Räume" und verschwand erst wieder, wenn die 9008 vom Relay nachströmte —
 * ein sichtbares Aufblitzen bei JEDEM Seitenaufbau, nicht nur einmal.
 *
 * kind 1111 (COMMENT, NIP-22-Thread-Kommentar) kam mit dem Ungelesen-Punkt (P3) dazu:
 * ohne ihn überlebt KEIN Thread-Marker den Kaltstart — die Ungelesen-Ableitung liest
 * Kommentare aus derselben `repository`, und die wäre beim Start leer. Die Spezifikation
 * riet davon ursprünglich ab, weil der Store dadurch unbegrenzt wüchse; genau deshalb
 * kappt {@link eventsToPrune} kind 1111 jetzt mit (siehe dort, §4.3). Persistenz OHNE
 * Kappung wäre der Fehler, den die Spezifikation meinte.
 *
 * Dieser Eintrag betrifft ausschließlich den zooid-Pfad: **Buzz nimmt kind 1111 gar
 * nicht an.** Am Teststack gemessen (2026-08-18) antwortet der Relay auf ein 1111 mit
 * `restricted: unknown event kind`, auch nackt mit nur einem `h`-Tag — während dasselbe
 * Ereignis als kind 1 mit identischen Tags und ein kind 1621 beide `success` bekommen.
 * Die Ablehnung ist also kind-spezifisch, nicht tag- oder auth-bedingt. Folge für die
 * Forge: die NIP-22-konforme Kommentarform kann an einem Buzz-Relay nicht existieren,
 * weshalb {@link isForgeComment} auf kind 1 richtig liegt und dort nichts übersieht.
 *
 * §4.2 raus:
 * Ephemeral/AUTH/Reaktionen/Zaps (kein `#h`, laden lazy nach dem Paint). Lotus' kind-10
 * (In-Chat-Thread, `feeds.ts CHAT_THREAD`) bleibt bewusst draußen: wir lesen ihn nur für
 * die Interop, schreiben ihn nie — ein Lotus-Thread-Marker ist beim Kaltstart also erst
 * nach dem Netz-Load da. Bekannte Grenze, kein Versehen.
 *
 * ── P10: Forge, Forum und NIP-38-Status ─────────────────────────────────────
 *
 * Sie fehlten hier komplett und luden bei JEDEM Reload neu — derselbe Fehler wie
 * bei 9008 und der Pin-Leiste, nur an einer neuen Stelle. Aufgenommen wurde jedes
 * Kind erst nach drei Fragen, und die erste ist am Relay beantwortet, nicht erwartet
 * (Teststack, 2026-08-17: jedes der folgenden Kinds wurde publiziert und per `nak req`
 * zurückgelesen):
 *
 * 1. *Speichert der Relay es überhaupt?* — ja, alle. Gegenbeispiel bleibt `39005`
 *    (siehe {@link shouldPersistEvent}), das Buzz nur zur Abfragezeit synthetisiert.
 * 2. *Ersetzbar oder append-only?* — 30617/30618/30621/30315 sind parameterisiert
 *    ersetzbar und damit je `(pubkey, d)` selbst-begrenzt. Alles andere wächst und
 *    wird deshalb gekappt ({@link eventsToPrune}).
 * 3. *Welcher Grabstein wirkt?* — Forum: **9005** (kind 5 löscht dort NICHTS, am
 *    Stack gemessen); Forge: **kind 5**, und zwar hart (das Ereignis ist danach vom
 *    Relay verschwunden). Beide stehen bereits in dieser Liste. Die Falle dabei
 *    steht in `forge.ts` bei `reconcileForgeTombstones`: der Grabstein eines Issues
 *    trägt **nur** `["e", …]` und wird von einem `#a`-gescopten Filter nie gefunden.
 *
 * **Kommentare an Issues/PRs sind kind 1** und stehen deshalb NICHT in dieser Liste,
 * sondern hinter der Strukturprüfung {@link isForgeComment} — dieselbe Trennung wie
 * bei `39005`, nur aus dem umgekehrten Grund: nicht das Kind ist mehrdeutig belegt,
 * sondern es ist das allgemeinste Kind überhaupt. `PERSIST_KINDS.add(1)` würde jede
 * Notiz jedes Relays in den Cache ziehen.
 */
const PERSIST_KINDS = new Set<number>([
    MESSAGE,
    BUZZ_MESSAGE_V2, // Buzz' zweite Chat-Fassung — sonst fehlten fremde Nachrichten beim Kaltstart
    COMMENT,
    DELETE,
    ROOM_DELETE_EVENT,
    ROOM_DELETE,
    POLL,
    ZAP_GOAL,
    PROFILE,
    FOLLOWS,
    MUTES,
    RELAYS,
    RELAY_MEMBERS,
    APP_DATA,
    ROOM_META,
    ROOM_ADMINS,
    ROOM_MEMBERS,
    BUZZ_PIN, // P6b — sonst ist die Pin-Leiste auf Buzz beim Kaltstart leer
    // P10 — Forge (NIP-34 + NIP-MP). Ersetzbar und selbst-tragend:
    REPO_ANNOUNCEMENT,
    REPO_STATE,
    PROJECT_ANNOUNCEMENT,
    // Die BLÄTTER der Forge (1621, 1618, 1619, 1630–1633, kind 1) stehen bewusst
    // NICHT hier, sondern hinter {@link FORGE_LEAF_KINDS} + Existenzprüfung.
    // P10 — Forum (append-only, gekappt):
    FORUM_POST,
    FORUM_COMMENT,
    // P10 — NIP-38-Status (ersetzbar je `(pubkey, d)`; `userStatusData.ts` verwirft
    // beim Lesen zusätzlich Abgelaufenes und alles älter als MAX_STATUS_AGE_SEC —
    // ein veralteter Cache-Stand kann die Zeile also nie falsch beschriften).
    USER_STATUS,
])

/**
 * P6b — angepinnte Nachrichten. Beide Relays brauchen Persistenz, sonst flackert die
 * Pin-Leiste bei jedem Kaltstart leer, bis das Netz antwortet: **genau der 9008-Fehler,
 * der oben schon dokumentiert ist.**
 *
 * Buzz' `40004` steht dafür schlicht in `PERSIST_KINDS`. zooids `39005` steht bewusst
 * NICHT dort, sondern hier — denn `39005` ist bei Buzz `KIND_THREAD_SUMMARY`, und die
 * darf **nicht** in den Cache:
 *
 *  - Buzz speichert sie relay-seitig gar nicht erst (`kind.rs:417-422`: „synthesized at
 *    query time, never stored"); sie entsteht nur live, wenn sich Thread-Zähler ändern.
 *  - Ein persistierter Stand wäre also dauerhaft veraltet und würde nie korrigiert —
 *    schlimmer als gar keiner.
 *
 * Getrennt wird an der Struktur, nicht an der Herkunfts-URL: `shouldPersistEvent` sieht
 * nur das Ereignis, nicht den `tracker`. {@link isZooidPinList} prüft `["-"]` (NIP-70),
 * die Abwesenheit von `["h"]` und leeren `content` — drei gemessene Merkmale, jedes für
 * sich ausreichend.
 */
/**
 * Die **Blätter** der Forge: alles, was per `a`-Tag an einem Repo hängt, statt für
 * sich zu stehen. Sie brauchen ein zweites Kriterium — siehe {@link knownRepos}.
 */
const FORGE_LEAF_KINDS = new Set<number>([
    GIT_ISSUE,
    GIT_PULL_REQUEST,
    GIT_PR_UPDATE,
    ...GIT_STATUS_KINDS,
    FORGE_COMMENT,
])

/**
 * Die Repo-Koordinaten, die dieser Cache **kennt** — gefüllt aus jedem 30617, das
 * er selbst aufnimmt.
 *
 * ── Warum die Form eines `a`-Tags als Aufnahmekriterium nicht genügt ────────────
 *
 * Ein `a`-Tag ist eine **Behauptung des Absenders**, keine Tatsache:
 * `30617:<64 beliebige Hexzeichen>:<beliebiges d>` besteht jede Syntaxprüfung, auch
 * wenn dieses Repo nie existiert hat. Und die Persistenz sieht **nicht**, woher ein
 * Ereignis kam: `shouldPersistEvent` bekommt nur das Ereignis, die Herkunftsprüfung
 * sitzt erst beim Rendern (`deriveEventsForUrl` über den `tracker`). Der
 * `repository` ist geteilt — in ihm liegen auch Buzz-Chat und zooid-Antworten.
 *
 * Zusammen ergab das eine Lücke, die eine reine Formprüfung nicht schließt: **jedes**
 * kind 1 aus **jeder** Quelle, die der Client ohnehin empfängt, hätte mit einem
 * angehängten `a`-Tag im Forge-Topf landen und dort echte Statuswechsel und
 * Kommentare aus {@link FORGE_META_CAP_TOTAL} verdrängen können. Der Store wüchse
 * nicht unbegrenzt — sein begrenzter Platz wäre nur mit Fremdinhalt füllbar, was den
 * Zweck des Caches genauso zunichtemacht.
 *
 * Aufgenommen wird ein Blatt deshalb nur, wenn sein Ziel ein Repo ist, das dieser
 * Cache **selbst kennt**. Das gilt für die ganze Klasse (1621, 1618, 1619, 1630–1633
 * und kind 1), nicht nur für den mehrdeutigen kind-1-Fall: dieselbe Zeichenkette
 * trägt bei allen dieselbe Beweislast.
 *
 * ── Die Reihenfolge, an der so ein Riegel sonst scheitert ───────────────────────
 *
 * Ein Kommentar, der VOR seinem Repo eintrifft, dürfte nicht verworfen werden — sonst
 * ist der Riegel ein neuer Datenverlust. Drei Wege, und alle drei sind gedeckt:
 *
 *  1. **Netz:** `loadForge`/`loadForgeNav` laden in zwei Runden, und Runde 2 leitet
 *     ihre `#a`-Filter aus Runde 1 ab. Das Repo ist also **immer** vor seinen
 *     Blättern da; ein Blatt ohne bekanntes Repo kann über diesen Weg gar nicht
 *     hereinkommen (`watchForge` scopet ebenso über `#a`).
 *  2. **Kaltstart:** {@link loadCachedEvents} merkt sich die Repos des gecachten
 *     Bestands, BEVOR es filtert — die Reihenfolge in der IndexedDB ist beliebig,
 *     also darf sie nicht zählen.
 *  3. **Live-Persistenz:** {@link syncEvents} tut dasselbe je Batch, ebenfalls vor
 *     dem Filtern. Repo und Kommentar im selben Schwung funktionieren in beiden
 *     Reihenfolgen.
 *
 * Bleibt der Fall „Blatt kommt in einem FRÜHEREN Batch als sein Repo". Er entsteht
 * über keinen der Lesewege dieser App; träte er doch auf, bleibt das Ereignis im
 * `repository` (nur der Cache lässt es aus) und die nächste Laderunde holt es
 * regulär nach. Fehlerrichtung: eine Kaltstart-Zeile später statt Fremdinhalt im
 * Cache.
 */
const knownRepos = new Set<string>()

/**
 * Die 30617 eines Schwungs vormerken. **Vor** jedem Filtern aufrufen, nie danach.
 * Idempotent; `pubkey` wird kleingeschrieben, weil `#a`-Filter bytegenau vergleichen.
 */
export function rememberRepos(events: Iterable<TrustedEvent>): void {
    for (const event of events) {
        if (event.kind !== REPO_ANNOUNCEMENT) {
            continue
        }
        const dtag = event.tags.find((tag) => tag[0] === 'd')?.[1]
        if (dtag) {
            knownRepos.add(repoAddressOf(event.pubkey, dtag))
        }
    }
}

/** Das Gedächtnis leeren (Abmelden, Tests). */
export function forgetRepos(): void {
    knownRepos.clear()
}

/**
 * Darf dieses Ereignis in den Cache? `known` ist injizierbar, damit der Test die
 * Existenzfrage ohne Modul-Zustand stellen kann.
 */
export function shouldPersistEvent(event: TrustedEvent, known: ReadonlySet<string> = knownRepos): boolean {
    if (event.kind === ZOOID_PIN_LIST) {
        return isZooidPinList(event)
    }
    if (FORGE_LEAF_KINDS.has(event.kind)) {
        // Erst die Form (bei kind 1 die einzige Unterscheidung zu einer beliebigen
        // Notiz), dann die Existenz. Beides ist nötig, keins reicht allein.
        const address = forgeTargetAddress(event)

        return address !== '' && known.has(address)
    }

    return PERSIST_KINDS.has(event.kind)
}

/**
 * Einen ganzen Schwung auf „kommt rein" / „fliegt raus" aufteilen — **die einzige
 * Stelle, an der über Aufnahme entschieden wird.**
 *
 * Sie merkt sich die Repos des Schwungs, BEVOR sie filtert. Genau das ist die
 * Reihenfolge-Zusage aus {@link knownRepos}: ob ein Kommentar vor oder nach seinem
 * 30617 in der Liste steht, darf nicht zählen. Stünde dieser Vorlauf bei den
 * Aufrufern statt hier, gäbe es zwei Kopien derselben Regel — und die zweite
 * altert unbemerkt (derselbe Riss wie bei {@link isCappedEvent}).
 */
export function partitionForCache(events: Iterable<TrustedEvent>): {
    keep: TrustedEvent[]
    drop: TrustedEvent[]
} {
    const all = Array.from(events)
    rememberRepos(all)
    const keep: TrustedEvent[] = []
    const drop: TrustedEvent[] = []
    for (const event of all) {
        ;(shouldPersistEvent(event) ? keep : drop).push(event)
    }

    return { keep, drop }
}

/**
 * Reine Berechnung der von NIP-29-9005-Tombstones (ROOM_DELETE_EVENT) im Cache-Bestand
 * gelöschten Ziel-Event-IDs: sammelt alle `e`-Ziele aller 9005. Diese IDs dürfen beim
 * Kaltstart weder in die `repository` geladen noch in der IDB behalten werden — sonst
 * aufersteht eine vom Admin gelöschte Nachricht bei einem Client, der beim Live-Broadcast
 * offline war (der `limit:0`-`listenRoom` liefert historische 9005 nie nach). Der Cache
 * enthält nur relay-akzeptierte Events (der Relay hat das 9005 bereits auf `can_manage`
 * gegatet) → keine h-/Autor-Prüfung nötig. Reine Funktion, node-testbar (kein welshman).
 *
 * **Das deckt seit P10 auch die Forum-Inhalte ab** — die Funktion filtert nach Ziel-Id
 * und nicht nach Ziel-Kind, für 45001/45003 war deshalb keine Zeile zu ergänzen.
 *
 * **KORREKTUR (2026-08-27).** Hier stand, ein `kind 5` auf ein 45001/45003 werde von
 * Buzz mit `OK true` quittiert und lösche **nichts**, das 9005 sei „der einzige Weg".
 * Diese Aussage stammte aus einer EINZELMESSUNG vom 2026-08-17 und ist am 2026-08-24 an
 * einem frischen, isolierten Stack (Image `ghcr.io/block/buzz:main`, rev `f956e6fe`)
 * zweimal unabhängig **widerlegt**: der `kind 5` des Autors löscht 45001 **und** 45003
 * hart, der Readback per `#h` ist danach leer. Der Buzz-Quelltext gibt dem recht —
 * `handlers/side_effects.rs handle_standard_deletion_event` kennt genau EINE
 * Kind-Ausnahme (Push-Lease) und ruft sonst `soft_delete_event_and_update_thread` für
 * jedes Ziel; jeder Lesepfad filtert `deleted_at IS NULL`.
 *
 * **Was daraus für DIESE Funktion folgt: nichts.** Das 9005 wirkt weiterhin und wird
 * weiterhin nur hier ausgewertet; den `kind 5` behandelt welshman selbst (Absatz
 * darunter). Der Satz war trotzdem zu korrigieren, weil er als Begründung für
 * Löschwege an anderen Flächen zitiert werden könnte — und dort in die Irre führte.
 * Die Grenzen des `kind 5` bei Buzz: EIN Ziel je Grabstein, nie fremd, keine Kaskade
 * auf die Antworten eines Themas.
 *
 * **Nicht hier, sondern in welshman: `kind 5`.** Der NIP-09-Grabstein der Forge braucht
 * keine eigene Behandlung — `repository.load()` sammelt beim Einspielen alle kind-5 in
 * `deletes` und schließt ihre Ziele danach aus jeder `query()` aus (Regel: nur vom
 * SELBEN Autor, `_isDeleted` vergleicht `pubkey`). Was er nicht kann, ist einen
 * Grabstein zu berücksichtigen, der nie geladen wurde — siehe
 * `forge.ts reconcileForgeTombstones`.
 */
export function tombstonedIds(events: TrustedEvent[]): Set<string> {
    const ids = new Set<string>()
    for (const event of events) {
        if (event.kind !== ROOM_DELETE_EVENT) {
            continue
        }
        for (const tag of event.tags) {
            if (tag[0] === 'e' && tag[1]) {
                ids.add(tag[1])
            }
        }
    }
    return ids
}

/**
 * §4.3 Pruning — kind 9 UND kind 1111 wachsen unbegrenzt (Control-Plane ist replaceable
 * → selbst-bounded, kein Cap). Nachrichten: per-Raum die neuesten N behalten;
 * Kommentare: ein globaler Deckel (Begründung bei {@link COMMENT_CAP_TOTAL}). Beide
 * zusätzlich mit Alters-Backstop als harte Obergrenze (fängt zugleich tombstone-lose
 * Relay-Purges, §6). Kein LRU-Framework.
 */
const MSG_CAP_PER_ROOM = 300
const MSG_MAX_AGE_SEC = 30 * 24 * 60 * 60 // 30 Tage

/**
 * Kommentare (kind 1111) werden GLOBAL gekappt, nicht per Thread — anders als
 * Nachrichten, die per Raum gekappt werden.
 *
 * Der Grund ist eine Asymmetrie im Datenmodell: Räume sind wenige und relay-verwaltet
 * (39000), ein Per-Raum-Cap ist deshalb faktisch beschränkt. Thread-WURZELN sind es
 * nicht — im Slack-Modell ist JEDE Nachricht thread-fähig, die Zahl möglicher Roots
 * wächst also mit der Zahl der Nachrichten. Ein Per-Root-Cap („100 je Thread") hätte
 * damit gar keine Obergrenze, sondern nur eine unauffälligere Wachstumskurve — genau
 * der unbegrenzte Store, vor dem die Spezifikation warnt. Ein globaler Deckel bindet
 * den Verbrauch hart.
 *
 * Preis: ein sehr geschwätziger Thread kann ältere Kommentare anderer Threads
 * verdrängen. Das kostet nur Kaltstart-Latenz, nie Korrektheit — `loadThread`/
 * `loadRoomComments` holen den Bestand ohnehin vom Relay nach.
 */
const COMMENT_CAP_TOTAL = 500

/**
 * P10 — die Deckel für Forum und Forge, und **warum sie anders geschnitten sind**
 * als die des Chats.
 *
 * *Forum-Themen (45001) per Kanal.* Ein Thema trägt `["h", <kanal>]`, und Kanäle
 * sind wenige und relay-verwaltet (39000) — dasselbe Argument wie bei kind 9, also
 * derselbe Schnitt: ein Per-Kanal-Cap ist eine echte Obergrenze.
 *
 * *Forum-Antworten (45003) global.* Sie hängen an einem Thema, und Themen wachsen
 * mit der Nutzung. Ein Per-Thema-Cap wäre exakt der Fall, den {@link COMMENT_CAP_TOTAL}
 * beschreibt: keine Obergrenze, nur eine unauffälligere Kurve.
 *
 * *Forge global, nicht per Repo.* Hier war zu prüfen, ob das Repo als Träger
 * dieselbe Rolle spielt wie der Raum — es tut es **nicht**: ein 39000 entsteht nur
 * über ein relay-gegatetes Kommando, ein 30617 darf jedes Mitglied beliebig oft
 * ankündigen. Die Zahl der Träger wächst also mit der Nutzung, und ein Per-Repo-Cap
 * hätte damit genauso wenig eine Obergrenze wie ein Per-Thread-Cap. Deshalb zwei
 * globale Deckel.
 *
 * *Warum ZWEI und nicht einer.* Wurzeln (Issue/PR) und ihr Beiwerk (PR-Update,
 * Statuswechsel, Kommentar) teilen sich bewusst keinen Topf. Bei einem gemeinsamen
 * Deckel verdrängte ein Automat mit vielen Statuswechseln die Issues selbst — und
 * ein Issue ohne sein Status-Ereignis zeigt „offen", also eine **falsche Aussage**
 * statt einer fehlenden. Fehlt umgekehrt die Wurzel, fehlt nur eine Zeile.
 */
const FORUM_POST_CAP_PER_ROOM = 200
const FORUM_COMMENT_CAP_TOTAL = 500
const FORGE_ROOT_CAP_TOTAL = 300
const FORGE_META_CAP_TOTAL = 600

/**
 * Alters-Backstop für Forum und Forge: **180 Tage**, nicht die 30 des Chats.
 *
 * Eine Nachricht von vor 40 Tagen interessiert beim Kaltstart niemanden; ein seit
 * einem halben Jahr offenes Issue ist die aktuelle Lage. Mit dem Chat-Fenster fiele
 * genau der Bestand aus dem Cache, den die Fläche zeigen soll — und schlimmer: der
 * Statuswechsel ist jünger als seine Wurzel, ein zu kurzes Fenster könnte also die
 * Wurzel entfernen und das „geschlossen" stehen lassen. Der Backstop bleibt trotzdem,
 * denn er ist zugleich der Fang für tombstone-lose Relay-Purges (§6).
 */
const LONGLIVED_MAX_AGE_SEC = 180 * 24 * 60 * 60

/** Kinds, deren Bestand wächst und die deshalb gekappt werden. Ohne kind 1 (Struktur). */
const CAPPED_KINDS = new Set<number>([
    MESSAGE,
    BUZZ_MESSAGE_V2,
    COMMENT,
    FORUM_POST,
    FORUM_COMMENT,
    GIT_ISSUE,
    GIT_PULL_REQUEST,
    GIT_PR_UPDATE,
    ...GIT_STATUS_KINDS,
])

/**
 * Wächst dieses Ereignis den Store zu — muss es also durch die Kappung?
 *
 * Eine Funktion und nicht zwei Listen: {@link eventsToPrune} wählt damit aus, und
 * {@link syncEvents} entscheidet damit, ob nach einem Schreibvorgang überhaupt
 * gekappt werden muss. Zwei Kopien dieser Frage wären der Riss, an dem ein
 * Kommentar-Burst (kind 1111) einmal an der Kappung vorbeilief.
 */
export const isCappedEvent = (event: TrustedEvent): boolean =>
    CAPPED_KINDS.has(event.kind) || isForgeComment(event)

/** Die Deckel, alle injizierbar — damit der Test sie ohne 500 Fixtures prüfen kann. */
export type PruneCaps = {
    msgPerRoom: number
    msgMaxAgeSec: number
    commentTotal: number
    forumPostPerRoom: number
    forumCommentTotal: number
    forgeRootTotal: number
    forgeMetaTotal: number
    longLivedMaxAgeSec: number
}

const DEFAULT_CAPS: PruneCaps = {
    msgPerRoom: MSG_CAP_PER_ROOM,
    msgMaxAgeSec: MSG_MAX_AGE_SEC,
    commentTotal: COMMENT_CAP_TOTAL,
    forumPostPerRoom: FORUM_POST_CAP_PER_ROOM,
    forumCommentTotal: FORUM_COMMENT_CAP_TOTAL,
    forgeRootTotal: FORGE_ROOT_CAP_TOTAL,
    forgeMetaTotal: FORGE_META_CAP_TOTAL,
    longLivedMaxAgeSec: LONGLIVED_MAX_AGE_SEC,
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

/**
 * Gibt die zu VERWERFENDEN event-ids zurück — für **alles**, was wächst:
 *
 * | Familie                         | Deckel        | Alters-Backstop |
 * |---------------------------------|---------------|-----------------|
 * | kind 9 / Buzz-V2 (Chat)         | pro Raum      | 30 Tage         |
 * | kind 1111 (Thread-Kommentar)    | global        | 30 Tage         |
 * | 45001 (Forum-Thema)             | pro Kanal     | 180 Tage        |
 * | 45003 (Forum-Antwort)           | global        | 180 Tage        |
 * | 1621/1618 (Issue, PR)           | global        | 180 Tage        |
 * | 1619, 1630–1633, kind 1 (Forge) | global        | 180 Tage        |
 *
 * Control-Plane und alles Ersetzbare (30617/30618/30621/30315/39000…) bleiben
 * unangetastet: sie sind je `(pubkey, [d])` selbst-begrenzt.
 *
 * Reine Funktion (Uhr und Deckel injizierbar) → deterministisch node-testbar.
 */
export function eventsToPrune(events: TrustedEvent[], now: number, caps: Partial<PruneCaps> = {}): string[] {
    const {
        msgPerRoom,
        msgMaxAgeSec,
        commentTotal,
        forumPostPerRoom,
        forumCommentTotal,
        forgeRootTotal,
        forgeMetaTotal,
        longLivedMaxAgeSec,
    } = { ...DEFAULT_CAPS, ...caps }
    const chatCutoff = now - msgMaxAgeSec
    const longCutoff = now - longLivedMaxAgeSec
    const chatByRoom = new Map<string, TrustedEvent[]>()
    const forumByRoom = new Map<string, TrustedEvent[]>()
    const comments: TrustedEvent[] = []
    const forumComments: TrustedEvent[] = []
    const forgeRoots: TrustedEvent[] = []
    const forgeMeta: TrustedEvent[] = []
    const drop: string[] = []
    /** `#h`-gescopte Familien nach Träger einsortieren; ohne `h` in Ruhe lassen. */
    const intoRoom = (map: Map<string, TrustedEvent[]>, event: TrustedEvent): void => {
        const h = event.tags.find((tag) => tag[0] === 'h')?.[1]
        if (!h) {
            return // ohne #h nicht pro Raum kappbar → unangetastet
        }
        const arr = map.get(h)
        if (arr) {
            arr.push(event)
        } else {
            map.set(h, [event])
        }
    }
    for (const event of events) {
        if (!isCappedEvent(event)) {
            continue
        }
        const chat = event.kind === MESSAGE || event.kind === BUZZ_MESSAGE_V2 || event.kind === COMMENT
        if (event.created_at < (chat ? chatCutoff : longCutoff)) {
            drop.push(event.id)
            continue
        }
        switch (event.kind) {
            case COMMENT:
                comments.push(event)
                break
            case FORUM_POST:
                intoRoom(forumByRoom, event)
                break
            case FORUM_COMMENT:
                forumComments.push(event)
                break
            case GIT_ISSUE:
            case GIT_PULL_REQUEST:
                forgeRoots.push(event)
                break
            default:
                if (chat) {
                    intoRoom(chatByRoom, event)
                } else {
                    // 1619, 1630–1633 und die kind-1-Kommentare der Forge.
                    forgeMeta.push(event)
                }
        }
    }
    const capOff = (arr: TrustedEvent[], limit: number): void => {
        if (arr.length <= limit) {
            return
        }
        arr.sort((a, b) => b.created_at - a.created_at) // neueste zuerst
        for (const event of arr.slice(limit)) {
            drop.push(event.id)
        }
    }
    for (const arr of chatByRoom.values()) {
        capOff(arr, msgPerRoom)
    }
    for (const arr of forumByRoom.values()) {
        capOff(arr, forumPostPerRoom)
    }
    capOff(comments, commentTotal)
    capOff(forumComments, forumCommentTotal)
    capOff(forgeRoots, forgeRootTotal)
    capOff(forgeMeta, forgeMetaTotal)

    return drop
}

// ── Rohe IndexedDB (Muster secure-storage.ts) ──────────────────────────────
//
// P4 Robustheit: ALLE IDB-Zugriffe sind fail-soft. Bei Quota/Eviction/Privacy-Mode/
// fehlendem IndexedDB (iOS-nonPersistent-WebView reagiert nicht so, aber ein
// gesperrter/voller Store schon) degradiert jeder Helfer still — Reads → leer,
// Writes → No-op — statt zu rejecten. So kann KEIN Storage-Fehler (weder am Boot
// noch im Live-Sync als unhandled rejection) je den Chat brechen: er fällt auf das
// heutige reine Relay-Laden zurück. Der Fehler wird EINMAL geloggt (kein Spam).

let dbName: string | null = null // erst nach Login gesetzt (`DB_PREFIX + pubkey`); Gast = null
let dbPromise: Promise<IDBDatabase> | null = null
let storageWarned = false

function onStorageError(error: unknown): void {
    if (!storageWarned) {
        storageWarned = true
        console.warn('[cache] IndexedDB nicht verfügbar → Fallback auf reines Relay-Laden', error)
    }
}

function connect(): Promise<IDBDatabase> {
    if (!dbName) {
        return Promise.reject(new Error('cache: kein pubkey')) // Gast → fail-soft No-op/leer
    }
    if (!dbPromise) {
        const name = dbName
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(name, DB_VERSION)
            req.onupgradeneeded = () => {
                const db = req.result
                db.createObjectStore('events', { keyPath: 'id' })
                db.createObjectStore('tracker', { keyPath: 'id' })
            }
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
    }
    return dbPromise
}

async function getAll<T>(store: StoreName): Promise<T[]> {
    try {
        const db = await connect()
        return await new Promise<T[]>((resolve, reject) => {
            const req = db.transaction(store, 'readonly').objectStore(store).getAll()
            req.onsuccess = () => resolve(req.result as T[])
            req.onerror = () => reject(req.error)
        })
    } catch (error) {
        onStorageError(error)
        return []
    }
}

async function bulkPut<T>(store: StoreName, items: T[]): Promise<void> {
    if (items.length === 0) {
        return
    }
    try {
        const db = await connect()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite')
            const os = tx.objectStore(store)
            for (const item of items) {
                os.put(item)
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (error) {
        onStorageError(error)
    }
}

async function bulkDelete(store: StoreName, ids: Iterable<string>): Promise<void> {
    const arr = Array.from(ids)
    if (arr.length === 0) {
        return
    }
    try {
        const db = await connect()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite')
            const os = tx.objectStore(store)
            for (const id of arr) {
                os.delete(id)
            }
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (error) {
        onStorageError(error)
    }
}

/** Eine ganze IndexedDB löschen (fail-soft; hängt nie, auch nicht bei offener Zweit-Verbindung). */
function deleteDb(name: string): Promise<void> {
    return new Promise((resolve) => {
        try {
            const req = indexedDB.deleteDatabase(name)
            req.onsuccess = () => resolve()
            req.onerror = () => resolve()
            req.onblocked = () => resolve()
        } catch {
            resolve()
        }
    })
}

// ── Load (Boot) + Sync (live) ──────────────────────────────────────────────

/**
 * `repository.load()` genau EINMAL am Boot: getAll → `verifiedSymbol` neu setzen
 * (symbol-Property überlebt structured-clone nicht → sonst unnötige Schnorr-Re-
 * Verifikation) → Whitelist-Fremdkörper verwerfen. `load` ist destruktiv (leert
 * alle Indizes zuerst) → MUSS vor dem ersten Insel-`publish` laufen (P1-Gate).
 */
async function loadCachedEvents(): Promise<void> {
    const cached = await getAll<TrustedEvent>('events')
    // Die Reihenfolge in der IndexedDB ist beliebig — deshalb entscheidet
    // {@link partitionForCache} über den ganzen Bestand auf einmal (Weg 2 bei
    // {@link knownRepos}), nicht Ereignis für Ereignis.
    const { keep, drop: dropped } = partitionForCache(cached)
    for (const event of keep) {
        event[verifiedSymbol] = true
    }
    const drop = dropped.map((event) => event.id)
    // §4.3: gekappte/veraltete Nachrichten weder in die repository laden noch behalten.
    // Zusätzlich: durch gecachte 9005-Tombstones gelöschte Ziele ausschließen (B2) — ein
    // im Cache liegendes 9005 darf seine Nachricht nicht wieder auferstehen lassen. Das
    // 9005 SELBST bleibt erhalten (persistierter Tombstone); nur seine `e`-Ziele fliegen raus.
    const prune = new Set(eventsToPrune(keep, nowSec()))
    const tombstoned = tombstonedIds(keep)
    const excluded = new Set<string>([...prune, ...tombstoned])
    repository.load(keep.filter((event) => !excluded.has(event.id)))
    const remove = [...drop, ...excluded]
    if (remove.length > 0) {
        void bulkDelete('events', remove)
    }
}

/**
 * Tracker (Event→Relay-Herkunft) zwingend mitladen — sonst rendern die url-
 * gescopten Ableitungen (Raum-Feed) LEER trotz gefülltem Repository. Einträge
 * ohne zugehöriges (geladenes) Event sind stale → verwerfen.
 *
 * **`tracker.load()` ist destruktiv und leert BEIDE Maps** (welshman
 * `net/src/tracker.js:46-56`) — was das Netz in der Zwischenzeit schon geliefert
 * hat, wäre danach ohne Herkunft. Das ist kein theoretischer Fall: bei einer
 * P10-Messung fehlte dem 30617 genau deshalb sein Tracker-Eintrag, und die
 * Forge-Fläche blieb bei schweigendem Relay leer, obwohl das Ereignis im Cache
 * lag — eine url-gescopte Ableitung sieht ein Ereignis ohne Herkunft nicht.
 * Deshalb wird der Bestand **gemischt** statt ersetzt; die Persistenz zieht über
 * `syncTracker`s `load`-Handler nach.
 */
async function loadCachedTracker(): Promise<void> {
    const relaysById = new Map<string, Set<string>>()
    const stale: string[] = []
    for (const { id, relays } of await getAll<TrackerItem>('tracker')) {
        if (!repository.getEvent(id)) {
            stale.push(id)
            continue
        }
        relaysById.set(id, new Set(relays))
    }
    for (const [id, relays] of tracker.relaysById.entries()) {
        const merged = relaysById.get(id) ?? new Set<string>()
        for (const relay of relays) {
            merged.add(relay)
        }
        relaysById.set(id, merged)
    }
    tracker.load(relaysById)
    if (stale.length > 0) {
        void bulkDelete('tracker', stale)
    }
}

/**
 * Die Herkunftszeilen (`tracker`) zu gegebenen Ids schreiben — **nur für Ids, deren
 * Ereignis bereits im `repository` steht.**
 *
 * Modulweit und nicht in `syncTracker` versteckt, weil {@link syncEvents} sie
 * mitbenutzt. Das ist der Kern der Sache: welshman meldet erst die Herkunft und legt
 * das Ereignis DANACH in den `repository`, und `batch()` aus `@welshman/lib` feuert
 * beim ERSTEN Aufruf sofort (führende Flanke, `Tools.js:1030-1036`) statt erst nach
 * dem Fenster. Für das erste Ereignis eines Schwungs läuft dieser Schreiber deshalb
 * genau in dem Moment, in dem es die Herkunft schon gibt, das Ereignis aber noch
 * nicht — `repository.getEvent(id)` ist leer, die Zeile wird übersprungen, und ein
 * zweiter Versuch kommt nie, weil die folgenden `add`-Meldungen andere Ids tragen.
 *
 * **Gemessen, nicht vermutet** (P10, Teststack): im Cache lag ein 30617 ohne
 * Tracker-Zeile — reproduzierbar genau das erste Forge-Ereignis der Sitzung. Eine
 * url-gescopte Ableitung (`deriveEventsForUrl`) sieht ein Ereignis ohne Herkunft
 * nicht: die Forge-Fläche blieb bei schweigendem Relay leer, obwohl ihr Bestand
 * vollständig im Cache lag. Deshalb schreibt {@link syncEvents} die Herkunft jetzt
 * **zusammen mit dem Ereignis** — zu diesem Zeitpunkt ist beides da.
 */
const persistTrackerRows = async (ids: Iterable<string>): Promise<void> => {
    const items: TrackerItem[] = []
    for (const id of ids) {
        const event = repository.getEvent(id)
        if (!event || !shouldPersistEvent(event)) {
            continue
        }
        const relays = Array.from(tracker.getRelays(id))
        if (relays.length > 0) {
            items.push({ id, relays })
        }
    }
    await bulkPut('tracker', items)
}

/** Inkrementelle Event-Persistenz: `added`→bulkPut (whitelisted), `removed`→bulkDelete. */
function syncEvents(): () => void {
    return on(
        repository,
        'update',
        batch(3000, async (updates: RepositoryUpdate[]) => {
            // Ein Schwung, eine Entscheidung (Weg 3 bei {@link knownRepos}): sonst
            // entschiede die Ankunftsreihenfolge INNERHALB eines Batches darüber, ob
            // ein Kommentar seinen Repo-Bezug belegen kann.
            const { keep: add } = partitionForCache(updates.flatMap((update) => update.added))
            const remove = new Set<string>()
            for (const update of updates) {
                for (const id of update.removed) {
                    remove.add(id)
                }
            }
            for (const event of add) {
                remove.delete(event.id)
            }
            await bulkPut('events', add)
            // Herkunft IMMER zusammen mit dem Ereignis — Begründung bei
            // {@link persistTrackerRows}. Ohne diese Zeile fehlt dem ersten Ereignis
            // jedes Schwungs seine Relay-Zeile, und es ist im Cache unsichtbar.
            await persistTrackerRows(add.map((event) => event.id))
            await bulkDelete('events', remove)
            // §4.3: nach neuem wachsendem Bestand den (bounded) Store kappen. Der
            // events-Store ist durchs Cap selbst begrenzt → getAll bleibt günstig.
            // Die Auswahl kommt aus {@link isCappedEvent} und NICHT aus einer zweiten
            // Kind-Liste: ein reiner Kommentar-Burst (kind 1111, aktive Thread-Diskussion
            // ohne neues kind 9) lief hier schon einmal an der Kappung vorbei, und mit
            // Forum und Forge (P10) sind es jetzt neun weitere Kinds, bei denen genau
            // dasselbe passieren könnte.
            if (add.some(isCappedEvent)) {
                const prune = eventsToPrune(await getAll<TrustedEvent>('events'), nowSec())
                if (prune.length > 0) {
                    await bulkDelete('events', prune)
                }
            }
        }),
    )
}

/** Inkrementelle Tracker-Persistenz (add/remove/load/clear → events-Store spiegeln). */
function syncTracker(): () => void {
    const persistIds = persistTrackerRows
    const deleteIds = (ids: Iterable<string>): Promise<void> => bulkDelete('tracker', Array.from(ids))

    const onAdd = batch(3000, (ids: string[]) => void persistIds(ids))
    const onRemove = batch(3000, (ids: string[]) => void deleteIds(ids))
    const onLoad = () => void persistIds(tracker.relaysById.keys())
    const onClear = () => void deleteIds(Array.from(tracker.relaysById.keys()))

    tracker.on('add', onAdd)
    tracker.on('remove', onRemove)
    tracker.on('load', onLoad)
    tracker.on('clear', onClear)

    return () => {
        tracker.off('add', onAdd)
        tracker.off('remove', onRemove)
        tracker.off('load', onLoad)
        tracker.off('clear', onClear)
    }
}

let stopSyncFn: (() => void) | null = null

function startSync(): void {
    if (stopSyncFn) {
        return
    }
    const unEvents = syncEvents()
    const unTracker = syncTracker()
    stopSyncFn = () => {
        unEvents()
        unTracker()
    }
}

// ── Öffentliche API ────────────────────────────────────────────────────────

/**
 * Die pubkey-DB des AKTUELLEN Accounts GANZ löschen + Live-Sync abmelden (aus
 * `session.ts logout()`, P3). Privacy-Hygiene beim Abmelden. Bewusst `deleteDatabase`
 * statt nur `clear()`: sonst bliebe die leere DB `DB_PREFIX+pubkey` zurück und der
 * pubkey wäre über `indexedDB.databases()` dauerhaft am Gerät enumerierbar (Identitäts-
 * Spur). `dbName=null` macht zugleich einen später feuernden batch-Trailing-Flush zum
 * No-op (connect() rejektet ohne dbName). Die Multi-Account-ISOLATION braucht das nicht
 * — jeder Account hat seine eigene DB, niemand liest je die eines anderen.
 */
export async function clearCache(): Promise<void> {
    stopSyncFn?.()
    stopSyncFn = null
    forgetRepos() // kein Repo-Wissen des abgemeldeten Kontos an den nächsten weiterreichen
    const name = dbName
    if (!name) {
        return
    }
    dbName = null
    try {
        ;(await dbPromise)?.close()
    } catch {
        // Verbindung evtl. schon fehlerhaft — egal, gleich wird sie gelöscht.
    }
    dbPromise = null
    await deleteDb(name)
}

let started = false

/** Aufgelöst = Boot-Load fertig; wie `ensureAuthReady()` modulweit, einmal ausgewertet. */
export let storageReady: Promise<void> = Promise.resolve()

/**
 * Idempotenter Boot-Einstieg (aus `core.ts`, P1). Öffnet die DB DES eingeloggten
 * pubkey und lädt sie in die repository (Gast: kein pk → keine DB, nichts geladen).
 * Multi-Account-Isolation ist strukturell: eine DB pro pubkey (`DB_PREFIX+pk`) → in der
 * DB liegen ausschließlich die Events DIESES pubkey (nur er hat je hineingeschrieben),
 * ein Cross-Account-Leak ist damit unmöglich — kein owner-Gate/-Marker nötig. Jeder
 * IDB-Fehler fällt still auf reines Relay-Laden zurück — der Chat bricht nie am Cache.
 */
export function initStorage(): void {
    if (started) {
        return
    }
    started = true
    storageReady = (async () => {
        try {
            // Einmalige Migration (pro Boot, billig): die ALTE GETEILTE Cache-DB löschen.
            // Der Pre-per-pubkey-Build nutzte den festen Namen `einundzwanzig-cache` über
            // Accounts hinweg → sie kann Cross-Account-member-only-Events enthalten (der
            // behobene Leak). deleteDatabase räumt diese Alt-Daten weg (auch für Gäste).
            await deleteDb('einundzwanzig-cache')
            // Dynamischer Import: `session.ts` zieht den halben Login-Graphen nach —
            // so bleibt die reine Cache-Logik (shouldPersistEvent) node-/testbar und
            // der (in P1) von `core.ts` gezogene Import zirkelfrei. `ensureAuthReady()`
            // startet die localStorage-Bindung von pubkey/sessions beim ersten Gebrauch.
            const { ensureAuthReady } = await import('./session.ts')
            await ensureAuthReady()
            const pk = pubkey.get()
            if (!pk) {
                return // Gast → keine DB, keinen member-only-Cache laden
            }
            dbName = DB_PREFIX + pk // ab jetzt liest/schreibt der Cache DIESE pubkey-DB
            await loadCachedEvents()
            await loadCachedTracker()
            startSync() // Live-Persistenz erst NACH dem destruktiven load()
        } catch (error) {
            console.warn('[cache] init fehlgeschlagen, Fallback auf Relay-Laden', error)
        }
    })()
}
