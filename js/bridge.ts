/**
 * Reaktivitäts-Bridge: welshman-Store (Svelte-Contract) → Alpine.
 *
 * welshman-Stores erfüllen den Svelte-Store-Contract (`subscribe(cb) => unsub`),
 * ohne Svelte-Compiler. `alpineFromStore` koppelt jeden Store an Alpine-State;
 * `init`/`destroy` folgen dem Alpine-Lifecycle (kein Doppel-Alpine).
 */
import { derived, get, type Readable } from 'svelte/store'
import { repository, pubkey, relaysByUrl, forceLoadRelay, deriveHandleForPubkey, displayNip05, tracker, userProfile, loadUserProfile, getProfile, getRelay, getZapper, deriveRelay } from '@welshman/app'
import { displayProfile, toNostrURI, getTagValue, getLnUrl, normalizeRelayUrl, MESSAGE, RELAYS, type RelayProfile } from '@welshman/util'
import { sanitizeUrl } from '@braintree/sanitize-url'
import { spaceBranding, isBuzzRelay } from './relayCaps.ts'
import { classifyRoomClosedReason } from './roomGate.ts'
import { deriveMergedProfile, purgeSpaceLocalProfiles } from './spaceProfiles.ts'
import { blossomMedia } from './blossomInstance.ts'
import { bindAvatarState, type AvatarState } from './blossomMedia.ts'
import { startBlossomHydration } from './blossomHydrate.ts'
import { load } from '@welshman/net'
import { deriveEvents, throttled } from '@welshman/store'
import type { TrustedEvent } from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'
import QRCode from 'qrcode'
import { DEFAULT_RELAYS, isMobile, mayFallbackToRaw, nativeBrowserOpen, nativeBrowserInApp, proxifyImage, storageReady } from './core.ts'
import { sanitizeReturnUrl, isAuthed } from './auth-gate.ts'
import { createLightboxZoom } from './lightbox.ts'
import {
    loginWithExtension,
    loginWithSecretKey,
    loginWithBunker,
    loginWithNostrConnect,
    logout,
    handoffToServer,
    logoutServer,
    ensureAuthReady,
    nip46PermsStale,
    loginWithNip55,
    currentSignerLabel,
} from './session.ts'
import { nip55Available, startNip55Login } from './nip55-signer.ts'
import { schedulePortalHandoff } from './portal-handoff.ts'
// Desktop-Shell: beide bewusst in eigenen Modulen, nicht hier inline — diese Datei
// ist die meistberührte im Package, und Rail/Viewport haben mit dem Rest nichts zu tun.
import { regionName } from './countryNames.ts'
import { wireViewport } from './viewport.ts'
import { wireRail } from './rail.ts'
import { wirePalette } from './palette.ts'
import { wireDisplayPrefs } from './displayPrefs.ts'
import { wireRoomSearch } from './roomSearch.ts'
import { wireRoomPins } from './roomPins.ts'
import { wireVerein } from './verein.ts'
import { subscribeForgeNav, wireForge } from './forge.ts'
import { dispatchModal } from './modal.ts'
import {
    groupSpaceChoices,
    activeSpace,
    activeSpaceUrl,
    DEFAULT_SPACE_URL,
    activeSpaceView,
    setActiveSpace,
    setActiveSpaceEphemeral,
    clearEphemeralSpace,
    deriveSpaceViewFor,
    WORKSPACE_URL,
    hasWorkspace,
    displayRelayUrl,
    ensureRelayProfile,
    loadUserGroupList,
    loadSpaceRooms,
    watchSpaceRooms,
    roomsByUrl,
    listenRoomMembers,
    deriveUserInRoom,
    joinRoom,
    leaveRoom,
    reloadRoomMembership,
    revokeRoomMembership,
    joinSpace,
    leaveSpace,
    parseInviteLink,
    loadSpaceInviteClaim,
    userSpaceUrls,
    isVereinRelay,
    createRoom,
    newRoomId,
    editRoomMeta,
    deleteRoom,
    addRoomMember,
    removeRoomMember,
    type SpaceView,
    type RoomView,
    type RoomInput,
} from './groups.ts'
import {
    loadMeetupPresentations,
    meetupPresentationBySlug,
    type MeetupPresentation,
} from './meetups.ts'
import { flagEmoji } from './meetupPresentation.ts'
/**
 * **Nur die Typen statisch** — der Code kommt per `import()` erst, wenn jemand die
 * Artikelfläche öffnet (siehe `nostrArticles`). `import type` wird beim Übersetzen
 * restlos entfernt und erzeugt keine Abhängigkeit im Bundle.
 */
import type { ArticleRow, ArticleRowMitMetriken, ArticleView, AuthorView } from './longformFeed.ts'
/**
 * Ebenfalls nur Typen. Die WERTE (`deuteAutorParam`, `aufloesenNip05`, …) kommen per
 * `import()` in `nostrArticleAuthor._boot()` — nicht weil `articleAuthor.ts` schwer wäre
 * (es hängt an nichts außer `nostr-tools/nip19`), sondern weil es im selben Zug mit
 * `longformFeed` geholt wird und ein zweiter Ladeweg ein zweiter Weg wäre, auf dem
 * `_dead` dazwischenkommen kann.
 */
import type { AutorFehler, Monatsgruppe } from './articleAuthor.ts'
import { medienProfilUrl } from './medienProfil.ts'
import { isSafeExternalUrl } from './vereinFlow.ts'

// Nur Typen — zur Laufzeit weggestrippt. Der WERT `createArticleList` kommt per
// `import()` in `nostrArticles._boot()`, weil `articleList.ts` über `longform.ts` an
// markdown-it hängt (50 kB gzip, die nicht in den `app`-Chunk jeder Seite gehören).
import type { ArticleCard, ArticleListProjector } from './articleList.ts'
// WERT-Import, und er ist unbedenklich: `articleWrite.ts` hängt an `@welshman/util` und
// `articleMetrics.ts` — beide liegen ohnehin im Boot-Pfad —, aber an KEINER Zeile aus
// `longform.ts` (nur `import type`). Die Bundle-Grenze bleibt also, wo sie ist; der
// Riegel dafür ist `tests/e2e/support/bundleGrenze.nodetest.ts`.
//
// Warum überhaupt als Wert: die Zeichengrenze und die Sperrregel des Kommentar-Composers
// werden HIER ausgewertet (Knopfzustand, Restzähler) — sie stünden sonst als Literale im
// Markup, also ein zweites Mal und ungeprüft.
import { KOMMENTAR_MAX_ZEICHEN, kommentarSperre } from './articleWrite.ts'
// WERT-Import, kein Typ-Import — und deshalb bewusst aus `articleSorts.ts` und NICHT aus
// `articleList.ts`: das Modul dort haengt ueber `longform.ts` an markdown-it, ein Wert von
// dort zoege 50 kB gzip in den `app`-Chunk. `articleSorts.ts` hat null Importe.
// Damit stehen die drei Ordnungswerte nicht mehr als Literale in dieser Datei.
import { DEFAULT_ARTICLE_SORT, type ArticleSort } from './articleSorts.ts'
import { DEFAULT_ROOM_TYPE, isFocusMode, isStandardRoom, parseForumTag, parseRoomType, supportsCountryFilter, type RoomTypeFilter } from './roomCategories.ts'
import { deriveForumTopics, listenForum, loadForumTopics, type ForumTopic } from './forumFeed.ts'
import { buildWorkspaceList, splitMine, type WorkspacePrefs } from './railGroups.ts'
// P7/NIP-78 — die in Buzz Desktop gesetzten Kanal-Präferenzen auch auf der Bühne
// anwenden. `subscribeWorkspacePrefs` ist der EINZIGE Einstieg: er schaltet den
// Netzweg beim ersten Abonnenten scharf (siehe `channelPrefs.ts`).
import { subscribeWorkspacePrefs } from './channelPrefs.ts'
// P2/NIP-38 — Status lesen. `deriveStatusPending` ist der dreiwertige Zustand aus P1,
// auf eine UI-Frage heruntergebrochen; `warmUserStatuses` ist der einzige Netz-Einstieg.
import { deriveStatusPending, deriveUserStatus, deriveUserStatuses, resyncUserStatuses, warmUserStatuses, type UserStatus } from './userStatus.ts'
import { roomsFingerprint, type RoomLike } from './roomFingerprint.ts'
import { readSpaceParam, withSpace, workspaceRoomHref } from './spaceParam.ts'
import { readSpacesTab, DEFAULT_SPACES_TAB, SPACES_TAB_PARAM } from './spacesTab.ts'
import { ORTSKARTEN_DROSSEL_MS, ORTSKARTEN_NACHLADE_MS, zeigeLive } from './ortskarten.ts'
import {
    deriveSpaceDirectory,
    deriveSpaceRoles,
    deriveVereinAccess,
    isVereinGatedOut,
    isVereinGuestGated,
    deriveUserIsSpaceAdmin,
    refreshSpaceAdmin,
    loadSpaceDirectory,
    watchSpaceDirectory,
    loadMemberProfiles,
    settleMemberProfiles,
    loadBannedMembers,
    createRole,
    editRole,
    deleteRole,
    assignRole,
    unassignRole,
    removeSpaceMember,
    banSpaceMember,
    unbanSpaceMember,
    addSpaceMember,
    banEvent,
    resolveReport,
    setRelayName,
    setRelayDescription,
    setRelayIcon,
    deriveRoomMemberViews,
    type RoomMemberView,
    type DirectoryView,
    type MemberView,
    type RoleView,
    type SpaceRole,
    type BannedMember,
    type VereinAccess,
} from './members.ts'
import {
    deriveSpaceReports,
    loadSpaceReports,
    forgetBuzzReport,
    watchSpaceReports,
    deriveSpaceJoinRequests,
    loadSpaceJoinRequests,
    watchSpaceJoinRequests,
    type ReportView,
    type JoinRequestView,
} from './actionItems.ts'
import {
    deriveRoomChat,
    deriveRoomMessages,
    listenRoom,
    listenRoomScoped,
    loadRoomMessages,
    loadRoomReactions,
    loadRoomComments,
    loadRoomPolls,
    loadRoomDeletes,
    loadRoomZaps,
    sendRoomMessage,
    deleteRoomMessage,
    moderateDeleteMessage,
    editRoomMessage,
    bodyWithoutQuote,
    sendReaction,
    removeReaction,
    sendReport,
    sendPoll,
    sendPollResponse,
    sendGoal,
    deriveThread,
    loadThread,
    listenThread,
    sendComment,
    deriveSpaceThreads,
    loadSpaceThreads,
    loadRoomActivity,
    watchRoomActivity,
    evictChatMsgCache,
    type ChatMessage,
    type ReactionChip,
    type ThreadRoot,
    type SpaceThread,
} from './feeds.ts'
import type { PollType } from './polls.ts'
import { uploadAttachment, thumbDataUrl, type Attachment } from './uploads.ts'
import { signerHealth, signerHealthLabel, type SignerHealth } from './signer-health.ts'
import {
    loadEmojiGroups,
    loadUserCustomEmojis,
    loadRecentEmojis,
    pushRecentEmoji,
    searchEmojis,
    type CustomEmoji,
    type StdEmoji,
    type RecentEmoji,
} from './emoji.ts'
import {
    readState,
    readStateReady,
    roomKey,
    threadKey,
    roomWatermark,
    setRead,
    markAllRead as markAllReadWatermark,
    snapshotReadState,
    restoreReadState,
    type ReadState,
} from './readState.ts'
import { BADGE_CAP, deriveUnread, formatUnreadCount, sumUnreadRooms, type UnreadView } from './unread.ts'
import { deriveUpdates, type UpdateItem } from './updates.ts'
import {
    countUnreadUpdates,
    firstNonEmpty,
    groupUpdates,
    hasMoreUpdates,
    hasUnreadUpdates,
    liveRegionDelay,
    nextUpdatesLimit,
    originTarget,
    threadBackTarget,
    undoClickAction,
    undoSnapshotFor,
    undoStillOpen,
    updateAriaLabel,
    updateAuthors,
    updatesLiveText,
    updatesSubtitle,
    visibleUpdates,
    withOrigin,
    UPDATES_PAGE,
    type UpdateFeed,
    type UpdateGroup,
} from './updatesView.ts'
import { createScroller, type Scroller } from './scroll.ts'
import { toast, flashToast } from './toast.ts'
import {
    getNwcModule,
    getWebLn,
    loadWallet,
    saveWallet,
    clearWallet,
    getWalletBalance,
    createInvoice,
    payInvoice,
    lnurlInvoice,
    fromMsats,
    type NWCInfo,
} from './wallet.ts'
import { getWalletAddress, WalletType, type Wallet, type Zapper } from '@welshman/util'
import { leseFortschritt, restMinuten, lesestandForm, artikelTeilZiel, type TeilZiel } from './articleReader.ts'
import { warmZappers, loadZapperNow, canZap, canPay, chooseZapMethod, createZapInvoice, payZapAuto, payZapPlain, requestPlainInvoice, watchZapReceipt, mapZapError, DEFAULT_ZAP_CONTENT } from './zaps.ts'
import { publishReceivingAddress, warmProfiles, type RelayPublishResult } from './profiles.ts'
import { t, tPlural, type Replacements } from './i18n.ts'
import { dateTimeFormat, formatNumber, formatTimestamp } from './locale.ts'

/** Alpine-Magics, die auf `this` einer Komponente verfügbar sind. */
type AlpineMagics = { $refs: Record<string, HTMLElement>; $nextTick: (cb: () => void) => void; $el: HTMLElement }

/** Zap-Feature-Flag (iOS-Kill-Switch): `window.__nostrZapsEnabled` (Default true). */
const zapsEnabled = (): boolean => (window as { __nostrZapsEnabled?: boolean }).__nostrZapsEnabled !== false

/**
 * Basis der Profil-Verweise nach media. — `''` heißt „kein Verweis".
 *
 * Aus `globalThis` und nicht über einen Import: geschrieben wird sie vom Head-Partial
 * aus `config('group.media_public_url')`, mit derselben `??`-Regel wie `__nostrBoard`.
 * Bewusst bei jedem Aufruf gelesen statt einmal beim Modul-Boot — dann hängt nichts an
 * der Auswertungsreihenfolge zwischen Head-Skript und Bündel, und ein E2E-Lauf kann die
 * Basis jederzeit setzen oder ausdrücklich leeren. Der Zugriff kostet nichts; die
 * Aufrufer sind zwei `href`-Bindungen.
 */
const medienBasis = (): string => (globalThis as { __nostrMedia?: string }).__nostrMedia ?? ''

/**
 * sessionStorage: die zuletzt VERLASSENE App-URL („woher komme ich?"), tab-lokal.
 *
 * Vorgänger war ein reines Bit („in diesem Tab wurde schon einmal navigiert"). Das
 * beantwortete die falsche Frage. Der Kopf-Pfeil ist UP (Hierarchie), und
 * `history.back()` ist nur dann die richtige Umsetzung von UP, wenn der vorherige
 * Eintrag TATSÄCHLICH das UP-Ziel ist. Das Bit war nach der ersten Navigation für
 * immer gesetzt — danach führte der Pfeil aus JEDEM Raum blind zurück, egal ob der
 * Vorgänger die Raumliste, ein anderer Raum, die Wallet oder die Einstellungen war.
 * Genau das ist das „geht komisch zurück", das der Nutzer gemeldet hat.
 *
 * Es bleibt bei EINEM Wert, keinem Stack — der ursprüngliche Grund dagegen gilt
 * unverändert: ein selbst geführter Herkunfts-Stack wäre eine zweite
 * Navigationsgeschichte neben der echten und driftet (Reload, Resume, Deep-Link).
 * Ein einzelner, bei jeder Navigation überschriebener Wert kann nicht driften.
 */
const APP_NAV_PREV_KEY = 'appNavPrev'

/** Die zuletzt verlassene App-URL, oder '' (unbekannt/nicht verfügbar). */
const lastLeftUrl = (): string => {
    try {
        return sessionStorage.getItem(APP_NAV_PREV_KEY) ?? ''
    } catch {
        return ''
    }
}

/**
 * Darf `history.back()` als Umsetzung von UP dienen — führt es also auf `upTarget`?
 *
 * Drei Bedingungen, alle nötig:
 * - der History-Stack hat überhaupt einen Vorgänger,
 * - wir wissen, welche App-URL wir zuletzt verlassen haben, und
 * - das war genau das UP-Ziel (Pfad-Vergleich; die Query bleibt bewusst außen vor,
 *   denn sie trägt den Filterzustand, den `history.back()` ja gerade zurückholen soll).
 *
 * Trifft eines nicht zu — Deep-Link-Kaltstart, Sprung aus einem anderen Raum, aus der
 * Wallet, nach einem Browser-Zurück — gilt das explizite UP-Ziel. Das ist die sichere
 * Richtung: eine Navigation auf das UP-Ziel verlässt die App nie und überrascht nie.
 */
const backLeadsTo = (upTarget: string): boolean => {
    try {
        if (window.history.length <= 1) {
            return false
        }
        const prev = lastLeftUrl()

        return prev !== '' && new URL(prev, window.location.origin).pathname === new URL(upTarget, window.location.origin).pathname
    } catch {
        return false
    }
}

/**
 * Kurzes haptisches Feedback (Android-Web + Android-App-WebView; iOS-Safari kennt
 * `navigator.vibrate` nicht → wird still ignoriert). Für taktile Quittung von Taps
 * und Fehlern, damit der Nutzer spürt, dass ein Tap ankam bzw. warum nichts aufgeht.
 */
const haptic = (pattern: number | number[]): void => {
    try {
        navigator.vibrate?.(pattern)
    } catch {
        /* nicht unterstützt — egal */
    }
}

/**
 * Promise mit Zeitlimit: rejectet nach `ms`. welshmans LNURL-Fetch hat keinen Timeout —
 * ein hängender/CORS-blockierter Endpoint würde einen Tap sonst STUMM verschlucken.
 */
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms)
        p.then(
            (v) => {
                clearTimeout(t)
                resolve(v)
            },
            (e: unknown) => {
                clearTimeout(t)
                reject(e instanceof Error ? e : new Error(String(e)))
            },
        )
    })

/** Minimal-API des cropperjs-Instanz, die wir nutzen (C6a). */
type CropperLike = {
    setAspectRatio(r: number): void
    rotate(d: number): void
    scaleX(x: number): void
    getData(): { scaleX: number }
    getCroppedCanvas(o?: object): HTMLCanvasElement | null
    destroy(): void
}

// Die cropperjs-Instanz lebt BEWUSST außerhalb des Alpine-Zustands: Alpine wickelt
// reaktive Werte in einen Proxy, der cropperjs' interne DOM-/Layout-Mathematik
// (offset-Messungen, Element-Identität) verfälscht → versetzte Doppelanzeige. Es gibt
// nie mehr als einen offenen Cropper, darum genügt eine Modul-Variable.
let cropperInstance: CropperLike | null = null

/**
 * `nostr:nevent…` einer Nachricht (NIP-19/21): gesehene Relays als Hints, sonst
 * das übergebene Fallback-Relay (Space-Relay). Teilbar/auflösbar in jedem Client.
 */
const neventFor = (m: ChatMessage, fallbackRelay: string | null): string => {
    const seen = [...tracker.getRelays(m.id)]
    const relays = seen.length ? seen : fallbackRelay ? [fallbackRelay] : []
    // Echten Kind aus dem Repository (Thread-Kommentar = 1111, Nachricht = 9, Poll = 1068 …);
    // die geteilte Row ruft copyNevent/openInfo auch auf Kommentaren → nicht hart MESSAGE annehmen.
    const kind = repository.getEvent(m.id)?.kind ?? MESSAGE
    return toNostrURI(nip19.neventEncode({ id: m.id, relays, author: m.pubkey, kind }))
}

/**
 * §4.2 „nach Login resume", Sheet-Pfad: Das Login-Sheet (P6) öffnet in-place und
 * navigiert NICHT auf `/nostr-login?return=…`, also fehlt der `?return`-Parameter
 * in der URL. `requireAuth` legt das (bereits sanitisierte) Gate-Ziel darum hier
 * ab, damit `postLoginRedirect` nach dem harten Login-Redirect trotzdem aufs
 * getappte Tab-Ziel springt statt aufs Default. Der Deep-Link-Fallback (`?return`
 * in der URL) bleibt unberührt.
 */
let pendingReturn: string | null = null

/**
 * Ziel nach erfolgreichem welshman-Login. Web: NIP-98-Handoff → Redirect ins
 * Server-Gate. Mobile: kein Server-Gate (§7), direkt zu /spaces — die Insel
 * hält die Session selbst.
 */
async function postLoginRedirect(): Promise<string> {
    // §4.2 „nach Login resume": tapte ein Gast eine gegatete Tab/Aktion, trägt der
    // Login-View `?return=<Zielpfad>` (vom authGate gesetzt) — nach dem Login exakt
    // dorthin, statt aufs Default. Sheet-Pfad → `pendingReturn`, Deep-Link → URL.
    // Open-Redirect-gehärtet (nur eigene Pfade).
    const ret = pendingReturn ?? sanitizeReturnUrl(new URLSearchParams(location.search).get('return'))
    if (isMobile) {
        // Single-Login: den Portal-Handoff für die Zielseite vormerken (das
        // Boot-Gate führt ihn dort aus). Direkt hier würde die folgende
        // window.location-Navigation ihn nach dem Signieren abreißen.
        schedulePortalHandoff()
        return ret ?? '/spaces'
    }
    // Web: NIP-98-Handoff MUSS laufen (setzt die Laravel-Session), das Ziel danach.
    // Bei Direkt-Hit auf eine gegatete Route liefert der Server `url.intended`; ein
    // client-gesetztes `?return` (Gast-Tab-Tap) hat Vorrang.
    const dest = await handoffToServer()
    return ret ?? dest
}

/** Generischer Adapter (für M2+): spiegelt einen Store in `this.value`. */
export function alpineFromStore<T>(store: Readable<T>) {
    return {
        value: undefined as T | undefined,
        _unsub: null as null | (() => void),
        init() {
            this._unsub = store.subscribe((v) => {
                this.value = v
            })
        },
        destroy() {
            this._unsub?.()
        },
    }
}

/**
 * Registriert Alpine-Komponenten. Wird in `alpine:init` aufgerufen (= vor dem
 * Alpine/Livewire-Start), damit `x-data="…"` die Komponenten kennt.
 */
type ProfileCardState = {
    pubkey: string
    npub: string
    name: string
    picture: string
    banner: string
    about: string
    website: string // sanitized href ('' wenn keins/unsicher)
    lud16: string
    nip05: string // verifizierter NIP-05-Handle ('' = kein Häkchen)
    // NIP-38-Status (P2). Immer ein Objekt, nie null — die Karte bindet `status.text`
    // direkt, und ein null-Wechsel mitten im geöffneten Modal wäre eine Fehlerquelle
    // ohne Gegenwert. Leere Felder = kein Status.
    status: { text: string; emoji: string }
    _unsub: null | (() => void)
    _unsubHandle: null | (() => void)
    _unsubStatus: null | (() => void)
    open(pubkey: string): void
    copy(text: string, message: string): void
    /** Öffentliches Profil auf media. — `''` = die Zeile entfällt. */
    medienUrl(): string
    destroy(): void
}

type SmokeState = {
    events: TrustedEvent[]
    loading: boolean
    error: string
    _unsub: null | (() => void)
    init(): void
    destroy(): void
}

type AuthState = {
    pubkey: string | null
    npub: string
    signerLabel: string
    hasExtension: boolean
    keyInput: string
    bunkerInput: string
    connectQr: string
    connectUri: string
    connecting: boolean
    mobile: boolean
    busy: boolean
    error: string
    reauthing: boolean
    reconnect: boolean
    // Eigenes Profil des eingeloggten Users (für den Space-Kopf): reaktiv aus welshman
    // (deriveProfile/deriveHandleForPubkey), Fallback = gekürzter npub. Leer bei ausgeloggt.
    myName: string
    myPicture: string
    myNip05: string
    myAbout: string
    _unsub: null | (() => void)
    _unsubMyProfile: null | (() => void)
    _unsubMyHandle: null | (() => void)
    _connectAbort: AbortController | null
    _reauthTried: boolean
    init(): void
    destroy(): void
    completeLogin(fn: () => void | Promise<void>): Promise<void>
    loginExtension(): Promise<void>
    loginNsec(): Promise<void>
    loginBunker(): Promise<void>
    startConnect(): Promise<void>
    stopConnect(): void
    openAmber(): void
    copy(text: string, message: string): void
    doLogout(): Promise<void>
}

type RelaysState = {
    relays: Array<{ url: string; read: boolean; write: boolean }>
    loading: boolean
    _unsub: null | (() => void)
    _unsubEvents: null | (() => void)
    init(): Promise<void>
    destroy(): void
}

/**
 * Ein Workspace-Raum, wie ihn der Tab „Workspaces" führt: die Sicht aus
 * `deriveSpaceViewFor` plus die Mitgliedschaft, die dort in der Herkunftsliste
 * steckt (`userRooms` vs. `otherRooms`). `buildWorkspaceList` braucht sie, um die
 * beigetretenen Räume oben zu halten — ohne sie sortierte der Default `'alpha'`
 * alles in einen Topf und die Liste sähe für jeden anders aus als bisher.
 */
type WorkspaceRoomView = RoomView & { joined: boolean }

/**
 * Zustand der Workspace-Raumliste — seit P5 der vierte Tab auf `/forge`.
 *
 * **Bis P5 war das der dritte Tab auf `/spaces`**, und die Felder lagen in
 * `SpacesState`. Der Umzug ist keine Kosmetik: die Liste hängt an einer ZWEITEN
 * Relay-URL (`WORKSPACE_URL`), und `nostrSpaces` zog diese Sub-Bridge bei jedem Aufbau
 * der Chat-Startseite mit hoch — für einen Tab, der dort neben zwei anderen stand.
 * Auf `/forge` ist derselbe Relay ohnehin die Quelle der ganzen Seite.
 *
 * **Eigene Insel und nicht Teil von `nostrForge`.** Die Forge-Insel liest 30617/30618
 * und Issues über `deriveEventsForUrl`; diese hier liest die NIP-29-Raumsicht über
 * `deriveSpaceViewFor`. Zwei Datenschichten, ein Relay — sie in einen Zustand zu legen
 * hieße, `forge.ts` an `groups.ts` zu binden, und `forge.ts` ist ausdrücklich auf den
 * Forge-Datenraum zugeschnitten.
 */
type WorkspaceRoomsState = {
    /** Räume des Workspace-Space, in Anzeige-Reihenfolge. */
    rooms: WorkspaceRoomView[]
    /** Anzeigename aus dem NIP-11-Doc des Workspace-Relays. */
    label: string
    loading: boolean
    /** `h` der in Buzz stummgeschalteten Räume. */
    muted: string[]
    /** `h` der in Buzz angehefteten Räume. */
    pinned: string[]
    /** Rohsicht, aus der die Liste neu gebaut wird. */
    _view: SpaceView | null
    _prefs: WorkspacePrefs
    _controller: AbortController | null
    _unsub: null | (() => void)
    _unsubPrefs: null | (() => void)
    init(): void
    destroy(): void
    _apply(): void
    isMuted(room: RoomView): boolean
    isPinned(room: RoomView): boolean
    openRoom(room: RoomView): void
    /** Ziel-URL MIT Space-Markierung (reload-fest). */
    roomHref(room: RoomView): string
}

type SpacesState = {
    space: SpaceView | null
    loading: boolean
    gatedOut: boolean
    tab: string // aktiver Tab („rooms"/„threads"), aus ?tab= gelesen + dorthin gespiegelt (verlinkbar)
    threads: SpaceThread[] // aktive Threads des Space (C6b, Startseiten-Übersicht)
    // Der Workspace stand bis P5 als dritter Tab HIER. Er ist nach `/forge` gewandert
    // (`WorkspaceRoomsState`, Insel `nostrWorkspaceRooms`) — mit ihm die zweite
    // Sub-Bridge auf die Workspace-URL, die diese Seite bei jedem Aufbau mitzog.
    // Raum-Verwaltung (P4, Admin): anlegen/bearbeiten/löschen
    isAdmin: boolean
    // Ist der aktive Space ein Buzz-Relay? Gatet die Kachel-Aktionen, die es dort
    // nicht sinnvoll gibt (Löschen, Raum-Mitglieder) — siehe room-tile.blade.php.
    isBuzz: boolean
    roomForm: RoomInput // beim Anlegen mit frisch gemintetem stabilem `h` (retry-sicher)
    _roomEditing: boolean // Bearbeiten (true) vs. Anlegen (false) — h ist in beiden Fällen gesetzt
    _roomIconFile: File | null // neu gewähltes Raumbild (Upload erst beim Speichern)
    roomSaving: boolean
    pendingRoomDelete: RoomView | null // Zielraum der offenen Lösch-Bestätigung
    // Raum-Mitglieder (P4b): Liste + Hinzufügen/Entfernen
    membersRoom: RoomView | null // Raum des offenen Mitglieder-Modals
    roomMembers: RoomMemberView[]
    memberNpub: string // npub/hex-Eingabe zum Hinzufügen
    memberBusy: boolean
    _unsubRoomMembers: null | (() => void)
    // Meetup-Praesentations-Join (Plan E2): slug → {flag, portalLink, …}. Wird
    // EINMAL aus der Portal-Liste geladen; die Kachel joint per room.meetupSlug.
    meetups: Record<string, MeetupPresentation>
    meetup(slug: string): MeetupPresentation | null
    _unsubMeetups: null | (() => void)
    // ── P4: Raumübersicht-Filter (Text · Land · Typ), rein clientseitig ──────────
    roomQuery: string
    // Fokus-Kategorie: 'rooms' = Standard-Übersicht (Default), 'meetups' und
    // 'proposals' (Projektunterstützung) stellen je EINE Liste allein dar.
    roomType: RoomTypeFilter
    roomCountry: string // ISO-3166-1-alpha-2 ('' = alle Länder)
    focusMode(): boolean
    meetupMode(): boolean
    proposalMode(): boolean
    countryFilterAvailable(): boolean
    selectRoomType(type: RoomTypeFilter): void
    meetupCount(): number
    standardCount(): number
    myCountry(): string
    countryName(iso: string): string
    countryFlag(iso: string): string
    fmtEventDate(iso: string): string
    isEventSoon(iso: string): boolean
    availableCountries(): Array<{ country: string; flag: string; name: string; count: number }>
    filteredMeetups(): RoomView[]
    filteredMine(): RoomView[]
    mineSections(): { key: 'rooms' | 'meetups'; rooms: RoomView[] }[]
    standardRoomTotal(): number
    showRoomSearch(): boolean
    filteredOther(): RoomView[]
    filteredProposals(): RoomView[]
    proposalCount(): number
    proposalUnread(): number
    _proposalPool(): RoomView[]
    activeFilterCount(): number
    visibleCount(): number
    selectCountry(iso: string): void
    resetRoomFilters(): void
    _pres(room: RoomView): MeetupPresentation | null
    _matches(room: RoomView, q: string): boolean
    _meetupPool(all: boolean): RoomView[]
    _dataSig(): string
    _ensureFiltered(): RoomFilterResult
    _url: string | null // aktive Space-URL (für die Admin-Mutationen)
    _unsubView: null | (() => void)
    _unsubActive: null | (() => void)
    _unsubAccess: null | (() => void)
    _unsubAdmin: null | (() => void)
    _unsubIsBuzz: null | (() => void)
    _unsubThreads: null | (() => void)
    _controller: AbortController | null
    init(): void
    roomName(h: string): string
    openRoomCreate(): void
    openRoomEdit(room: RoomView): void
    pickRoomPicture(input: HTMLInputElement): void
    saveRoom(): Promise<void>
    askDeleteRoom(room: RoomView): void
    confirmDeleteRoom(): Promise<void>
    openRoomMembers(room: RoomView): void
    closeRoomMembers(): void
    addRoomMemberByNpub(): Promise<void>
    kickRoomMember(pubkey: string): Promise<void>
    destroy(): void
}

/**
 * Screen-Zustand von `/updates` (P4). Der Vertrag zur View ist EINGEFROREN —
 * `⚡updates.blade.php` bindet direkt an diese Namen.
 */
type UpdatesState = {
    feed: UpdateFeed
    limit: number
    loading: boolean
    /** Deutsche Fehlerzeile (§3.5), '' = kein Fehler. */
    error: string
    items: UpdateItem[]
    /** Ablaufzeitpunkt der Undo-Frist in ms (0 = kein Puffer). Reaktiv, trägt `canUndo()`. */
    _undoUntil: number
    _undoTimer: ReturnType<typeof setTimeout> | null
    _url: string
    _controller: AbortController | null
    _unsubActive: null | (() => void)
    _unsubItems: null | (() => void)
    init(): void
    destroy(): void
    _load(): Promise<void>
    hasAny(): boolean
    hasUnread(): boolean
    isEmpty(): boolean
    isFiltered(): boolean
    hasMore(): boolean
    groups(): UpdateGroup[]
    older(): void
    open(item: UpdateItem): void
    retry(): void
    resetFeed(): void
    markAllRead(): void
    _closeUndo(): void
    undoMarkAll(): void
    canUndo(): boolean
    labelFor(item: UpdateItem): string
    subtitleText(): string
}

/** Eine Ordnung der Artikelliste, wie sie die Oberfläche anbietet. */
type ArticleSortOption = {
    value: ArticleSort
    /** Übersetzt, aus Blade — `bridge.ts` bleibt sprachfrei. */
    label: string
}

/**
 * Zustand der Ortskarten-Leiste (P5) — der Live-Zeilen wegen, sonst nichts.
 *
 * Die Leiste selbst ist reines Server-Markup (`components/ortskarten.blade.php`): Orte,
 * Links, Aktiv-Zustand stehen im ausgelieferten HTML. Diese Insel liefert ausschließlich
 * die drei Zahlen — und `null` heißt „noch keine", nicht „keine".
 */
type OrtskartenState = {
    /** Bestand der Artikelliste. `null`, solange nichts geladen wurde. */
    artikelZahl: number | null
    /** Repositories im Forge-Baum. `null`, solange nichts geladen wurde. */
    repoZahl: number | null
    /** Ist der Screen weg, bevor das Nachladen überhaupt begonnen hat? */
    _dead: boolean
    /** Kennung des angemeldeten Leerlauf-Rückrufs (0 = keiner). */
    _idle: number
    _unsubArtikel: null | (() => void)
    _unsubForge: null | (() => void)
    init(): void
    destroy(): void
    /** Startet die beiden Nachlader — erst nach dem ersten Paint, siehe `init`. */
    _nachladen(): void
    /** Ungelesenes über Räume UND Threads, aus dem globalen Store. */
    ungelesen(): number
    /** Darf dieser Wert die statische Unterzeile ersetzen? (`ortskarten.ts`) */
    zeigt(wert: number | null): boolean
}

/**
 * Bildschirm-Zustand der Artikelliste (P2). Alles Fachliche liegt in `longformFeed.ts`
 * (welshman) und `articleList.ts` (rein: filtern, sortieren, hervorheben).
 */
type ArticlesState = {
    loading: boolean
    /** Deutsche Fehlerzeile, '' = kein Fehler. */
    error: string
    /** Der geladene Bestand, ungefiltert und unsortiert — die Quelle für alles darunter. */
    items: ArticleRowMitMetriken[]
    /** Suchtext, wie getippt. */
    query: string
    /** Die gewählte Ordnung. */
    sort: ArticleSort
    /**
     * Was die Liste gerade zeigt — **ein Feld, keine Methode.**
     *
     * Eine Methode würde je Auswertung im Markup erneut rechnen, und das Markup wertet sie
     * dreimal aus (Trefferzahl, Leerzustand, `x-for`). Als Feld gibt es genau eine
     * Berechnung je Änderung von Bestand, Suchtext oder Ordnung — angestoßen in
     * {@link ArticlesState._project}.
     */
    cards: ArticleCard[]
    /** Basis-Pfad der Artikel-Route, aus Blade gereicht (ohne Schrägstrich am Ende). */
    _base: string
    /** Ist der Screen weg, bevor der dynamische Import zurückkam? */
    _dead: boolean
    _controller: AbortController | null
    _unsub: null | (() => void)
    init(): void
    _boot(): Promise<void>
    destroy(): void
    _load(): Promise<void>
    _project(): void
    isEmpty(): boolean
    href(row: ArticleRow): string
    retry(): void
    /** Die Ordnungen samt Beschriftung, aus Blade gereicht. */
    sortOptions(): ArticleSortOption[]
    /** Beschriftung der gewählten Ordnung — für den Knopf des Popovers. */
    sortLabel(): string
    /** Liegt gerade irgendein Filter an (Suche ODER abweichende Ordnung)? */
    hasFilter(): boolean
    /** Alles zurück auf Anfang: kein Suchtext, Standard-Ordnung. */
    clearFilters(): void
}

/** Bildschirm-Zustand der Artikel-Vollansicht (P7, erweitert in P3). */
type ArticleState = {
    loading: boolean
    /** Hat der Relay geantwortet, ohne den Artikel zu kennen? */
    missing: boolean
    /** Deutsche Fehlerzeile, '' = kein Fehler. Getrennt von `missing` — siehe `_load`. */
    error: string
    article: ArticleView | null
    /** Vollbild eines angeklickten Artikelbilds — dieselbe Fläche wie im Chat (P3). */
    lightboxSrc: string | null
    /** Kennt dieser Browser `navigator.share`? Einmal beim Mount festgestellt (P3). */
    canShare: boolean
    /** 0–100. Nur gültig, solange {@link ArticleState.leseVerfolgbar} steht. */
    lesefortschritt: number
    /** Gibt es überhaupt eine Strecke? `false` bei jedem Artikel, der ins Fenster passt. */
    leseVerfolgbar: boolean
    /** „noch N Min" — 0 heißt: keine Angabe, die Zeile fällt weg. */
    leseRestMinuten: number
    /**
     * Der fertige Satz des Lesestands, in einer von drei Formen.
     *
     * Steht hier und nicht als verschachtelter Ausdruck im Markup: die REGEL, welche Form
     * gilt, liegt geprüft in `articleReader.ts` (`lesestandForm`), und eine dreifache
     * Ternär-Kette in einem Blade-Attribut wäre dieselbe Regel ein zweites Mal — nur
     * ungeprüft.
     */
    lesestandText(): string
    _naddr: string
    _base: string
    /** Ist der Screen weg, bevor der dynamische Import zurückkam? */
    _dead: boolean
    _controller: AbortController | null
    _unsub: null | (() => void)
    /** Aufräumer der Lesefortschritt-Beobachter — `null`, solange keiner hängt. */
    _leseAb: null | (() => void)
    /** Läuft schon ein rAF für die nächste Messung? */
    _leseFrame: number
    /** Beobachtet die HÖHE des Artikeltextes — siehe `_leseAnHeften`. */
    _leseGroesse: ResizeObserver | null
    init(): void
    _boot(): Promise<void>
    destroy(): void
    _load(): Promise<void>
    retry(): void
    hasArticle(): boolean
    /** Ziel des Autoren-Links: `/articles/autor/{npub}` — `''`, solange kein Artikel steht. */
    autorHref(): string
    /** Scroll- und Resize-Zuhörer aufsetzen (siehe dort, warum `capture: true`). */
    _leseBeobachten(): void
    /** Den Höhen-Beobachter an den Artikeltext heften, sobald es ihn gibt. */
    _leseAnHeften(): void
    /** Den Lesefortschritt EINMAL nachmessen (rAF-gedrosselt über `_leseFrame`). */
    messeLesefortschritt(): void
    /** Wohin ein Teilen-Knopf zeigt — oder dass es nirgendwohin zeigt. */
    teilZiel(): TeilZiel
    /** Der EINE Auslöser des Teilen-Knopfes — er entscheidet, was möglich ist. */
    teilenAusloesen(): Promise<void>
    /** Den Link in die Zwischenablage, mit fertiger Erfolgsmeldung. */
    linkKopieren(): void
    /** `navigator.share`, wo es das gibt. */
    teilen(): Promise<void>
    /** Der Grund, warum der Lightning-Einstieg nichts tut — als Toast, nicht als Tooltip. */
    keineLightningAdresse(): void

    // ── P7: Netz schreibend ───────────────────────────────────────────────────────
    /** Ist überhaupt jemand angemeldet? Ohne Signer gibt es nichts zu signieren. */
    angemeldet: boolean
    /** Läuft gerade ein Reaktions-Publish? Sperrt den Knopf gegen den Doppelklick. */
    reagiert: boolean
    /** Entwurf des Kommentars. Bleibt bei einem Fehlschlag stehen — das ist die Zusage. */
    kommentarEntwurf: string
    /** Läuft gerade ein Kommentar-Publish? */
    kommentarLaeuft: boolean
    /**
     * Die Relay-Begründung des letzten fehlgeschlagenen Kommentars, '' = keine.
     *
     * Eine Zeile am Composer und **kein Toast**: der Toast verpufft, während der Entwurf
     * noch dasteht, und der Nutzer sieht dann einen vollen Kasten ohne Erklärung. Dieselbe
     * Bauform wie `sendError` am Chat-Composer.
     */
    kommentarFehler: string
    /** Habe ich schon reagiert? Steuert Beschriftung und Zustand des Knopfes. */
    habeReagiert(): boolean
    /** Reagieren bzw. die eigene Reaktion zurücknehmen — ein Knopf, zwei Richtungen. */
    reaktionUmschalten(): Promise<void>
    /** Darf der Kommentar abgeschickt werden — und wenn nein, warum nicht (leer = ja). */
    kommentarSperrgrund(): string
    /** Verbleibende Zeichen; negativ heißt: über der Grenze. */
    kommentarRest(): number
    /** Den Kommentar publizieren. Bei Fehlschlag bleibt der Entwurf stehen. */
    kommentarAbschicken(): Promise<void>
}

/**
 * Eine Monatsgruppe der Autorenseite **mit ihrer fertigen Beschriftung**.
 *
 * Die Gliederung selbst ist rein (`articleAuthor.ts`, `nachMonat`) und kennt keine
 * Sprache; „August 2026" entsteht erst hier über `formatTimestamp` — also aus
 * `<html lang>` und damit aus `app()->getLocale()`, genau wie jedes andere Datum dieser
 * Fläche. Ein Monatsname im reinen Modul wäre eine zweite Wahrheit über die Sprache.
 */
type ArtikelMonat = Monatsgruppe<ArticleRowMitMetriken> & { label: string }

/**
 * Die Autorenseite (P4, `/articles/autor/{autor}`).
 *
 * **Zwei Phasen, und sie sind nicht dasselbe:** erst wird die ADRESSE aufgelöst (npub
 * synchron, NIP-05 über eine HTTPS-Abfrage), danach werden die ARTIKEL geladen. Beide
 * können scheitern, und zwar aus verschiedenen Gründen — deshalb trägt der Zustand
 * beides getrennt: {@link ArticleAuthorState.fehler} für die Adresse,
 * {@link ArticleAuthorState.error} für den Relay.
 */
type ArticleAuthorState = {
    /** Läuft die AUFLÖSUNG der Adresse noch? (Bei npub genau einen Tick lang.) */
    aufloesend: boolean
    /**
     * Warum es keine Autorenseite gibt — `''` heißt: es gibt eine.
     *
     * Vier Werte, vier Sätze in der Fläche. Nur `nip05-fehlgeschlagen` bekommt einen
     * „Erneut versuchen"-Knopf; die anderen drei sind Eigenschaften des Links bzw. eine
     * Auskunft der Domain und werden beim zweiten Versuch nicht besser.
     */
    fehler: AutorFehler | ''
    /**
     * Die Domain, über die gerade eine Aussage gemacht wird — und **nur** sie.
     *
     * Der rohe Routen-Parameter steht hier bewusst nirgends als Anzeigewert: in eine URL
     * wird auch mal ein `nsec` getippt, und was nicht im Zustand ist, kann kein Markup
     * rendern. Die Domain ist gegen ein enges Muster geprüft (`articleAuthor.ts`).
     */
    fehlerDomain: string
    /** Laufen die ARTIKEL noch? Getrennt von {@link ArticleAuthorState.aufloesend}. */
    loading: boolean
    /** Deutsche Fehlerzeile des Relays, `''` = kein Fehler. */
    error: string
    /** Die Autorenkarte — `null`, solange die Adresse nicht aufgelöst ist. */
    autor: AuthorView['autor'] | null
    /** Die Artikel, nach Erscheinungs-MONAT gegliedert, neuester Monat zuerst. */
    gruppen: ArtikelMonat[]
    /** Wie viele Artikel dieser Autor hier hat. */
    anzahl: number
    /** Das Jahr des ältesten Artikels — `0` heißt „keine Angabe", die Zeile fällt weg. */
    seitJahr: number
    /** Hex-Pubkey, sobald aufgelöst. `''` vorher und in jedem Fehlerfall. */
    pubkey: string
    /** Der rohe Routen-Parameter. Wird gedeutet, nie gerendert. */
    _param: string
    /** Basis-Pfad der Artikel-Route, aus Blade gereicht (ohne Schrägstrich am Ende). */
    _base: string
    /** Ist der Screen weg, bevor der dynamische Import oder die NIP-05-Abfrage zurückkam? */
    _dead: boolean
    _controller: AbortController | null
    _unsub: null | (() => void)
    init(): void
    _boot(): Promise<void>
    /** Adresse endgültig gescheitert — kein Laden, kein Abonnement, kein Netz. */
    _endeMitFehler(grund: AutorFehler): void
    /** Artikel in Monatsgruppen gliedern und Anzahl/Anfangsjahr daraus bilden. */
    _gliedern(artikel: ArticleRowMitMetriken[]): void
    destroy(): void
    _load(): Promise<void>
    /** Ziel der Artikelzeile. Leerer `naddr` (Artikel ohne `d`) ⇒ kein Link. */
    href(row: ArticleRow): string
    /** Steht die Seite? (Adresse aufgelöst, kein Fehlzustand.) */
    hatAutor(): boolean
    /** Hat dieser Autor hier keinen einzigen Artikel — und ist das schon entschieden? */
    istLeer(): boolean
    /** Der Grund, warum der Lightning-Einstieg nichts tut — als Toast, nicht als Tooltip. */
    keineLightningAdresse(): void
    /** Öffentliches Profil auf media. — `''` = die Zeile entfällt. */
    medienUrl(): string
    /** Nur für `nip05-fehlgeschlagen` bzw. einen stummen Relay: von vorn. */
    retry(): void
}

type VereinGateState = {
    show: boolean
    isGuest: boolean
    _access: VereinAccess
    _unsubActive: null | (() => void)
    _unsubAccess: null | (() => void)
    _controller: AbortController | null
    init(): void
    _refresh(): void
    openExternal(url: string, e: Event): void
    destroy(): void
}

/**
 * Der „kein Status"-Wert der Directory-Zeile — eine geteilte, eingefrorene Instanz.
 * Ein frisches Objektliteral je Aufruf sähe für Alpine bei jedem Durchlauf wie eine
 * Änderung aus und triebe die Liste in eine Neuberechnung pro Emit.
 */
const EMPTY_STATUS: { text: string; emoji: string } = Object.freeze({ text: '', emoji: '' })

/** Formular-Zustand einer Rolle (hue 0–360, lightness 0–1; '' id = neu). */
type RoleForm = { id: string; label: string; description: string; hue: number; lightness: number; order: number }

type DirectoryState = {
    ready: boolean
    profilesReady: boolean
    members: MemberView[]
    roles: RoleView[]
    query: string
    gatedOut: boolean
    // NIP-38-Status je Mitglied (P2). Ein einfaches Objekt statt einer Map, weil Alpine
    // nur auf zugewiesene Eigenschaften reagiert; je Emit wird es KOMPLETT ersetzt.
    // Bewusst NICHT in `MemberView` gelegt: `deriveSpaceDirectory` ist die Liste der
    // Mitgliedschaft (13534/33534, relay-signiert), der Status eine flüchtige Beigabe —
    // sie in eine Ableitung zu ziehen hieße, die Liste bei jedem Statuswechsel neu zu
    // bauen und zu sortieren.
    statuses: Record<string, { text: string; emoji: string }>
    statusPending: boolean
    statusOf(pubkey: string): { text: string; emoji: string }
    _unsubStatuses: null | (() => void)
    _unsubStatusPending: null | (() => void)
    // Admin (NIP-86)
    isAdmin: boolean
    rolesFull: SpaceRole[]
    editingMember: MemberView | null
    roleForm: RoleForm
    banned: BannedMember[]
    inviteLink: string
    inviteBusy: boolean
    busy: boolean
    // Melde-Queue (P3, NIP-56 kind 1984)
    reports: ReportView[]
    // Beitritts-Queue (P4b, offene 9021 für closed-Räume)
    joinRequests: JoinRequestView[]
    // Space-Metadaten bearbeiten (P2, NIP-86 changerelay*)
    spaceForm: { name: string; description: string }
    _spaceInitial: { name: string; description: string } // Prefill-Snapshot (Vergleichsbasis: nur GEÄNDERTES senden)
    spaceIconPreview: string // Vorschau: data-URL des neu gewählten Icons ODER aktuelle Icon-URL
    _spaceIconFile: File | null // neu gewähltes Icon (null = unverändert)
    spaceSaving: boolean
    _url: string | null
    _controller: AbortController | null
    _unsubActive: null | (() => void)
    _unsubDir: null | (() => void)
    _unsubRoles: null | (() => void)
    _unsubAdmin: null | (() => void)
    _unsubAccess: null | (() => void)
    _unsubReports: null | (() => void)
    _unsubJoins: null | (() => void)
    _loadedDir: Set<string>
    _loadedProfiles: Set<string>
    _settleStarted: boolean
    init(): void
    destroy(): void
    filtered(): MemberView[]
    reload(): void
    openRoleCreate(): void
    openRoleEdit(role: SpaceRole): void
    saveRole(): Promise<void>
    removeRole(id: string): Promise<void>
    openMemberRoles(m: MemberView): void
    memberHasRole(roleId: string): boolean
    toggleMemberRole(roleId: string): Promise<void>
    removeMember(m: MemberView): Promise<void>
    banMember(m: MemberView): Promise<void>
    loadBanned(): Promise<void>
    unbanMember(pubkey: string): Promise<void>
    restoreMember(pubkey: string): Promise<void>
    loadInvite(): Promise<void>
    copyInvite(): void
    _reportDone(r: ReportView): void
    dismissReport(r: ReportView): Promise<void>
    removeReportedContent(r: ReportView): Promise<void>
    banReportedUser(r: ReportView): Promise<void>
    acceptJoin(j: JoinRequestView): Promise<void>
    rejectJoin(j: JoinRequestView): Promise<void>
    openSpaceEdit(): void
    _prefillSpace(profile?: RelayProfile): void
    pickSpaceIcon(input: HTMLInputElement): void
    saveSpace(): Promise<void>
}

/** Ein @-Mention-Vorschlag (Space-Mitglied) im Composer-Autocomplete. */
type MentionItem = { pubkey: string; npub: string; name: string; picture: string; search: string }

/** Roh-Event-Details für das Nachricht-Info-Modal (C4). */
type MessageInfo = { nevent: string; npub: string; json: string; createdAt: string; seenOn: string[] }

type RoomChatState = {
    h: string
    roomName: string // Anzeigename des Raums (Client-Meta 39000); Fallback = Server-Wert/`h`
    spaceHint: string // Space-Name, NUR wenn der Raum nicht im Vereins-Space liegt; sonst ''
    messages: ChatMessage[] // aufsteigend (Quelle): loadOlder/scrollToMessage arbeiten hierauf
    messagesReversed: ChatMessage[] // newest-first fürs `flex-col-reverse`-Rendering (neweste am Boden)
    loading: boolean
    loadingMore: boolean
    hasMore: boolean
    atBottom: boolean
    unread: number
    firstPaintDone: boolean
    error: string
    joined: boolean
    joining: boolean
    membershipReady: boolean
    gatedOut: boolean // Relay hat den Read verweigert (P11/P8, siehe roomGate.ts) — Raumzustand unbekannt
    _gateRelistens: number // P8: verbrauchte Wiederaufsetz-Versuche nach `channel access revoked` (Schleifen-Deckel)
    draft: string
    sending: boolean
    sendError: string
    replyTo: { id: string; pubkey: string; name: string; text: string } | null
    sharing: boolean // Zitier-Modus (Quote-Only): Composer darf leer bleiben, Label „Zitieren"
    attachment: Attachment | null // hochgeladener Bild-Anhang des HAUPT-Composers (C6a), wartet auf Senden
    threadAttachment: Attachment | null // eigener Bild-Anhang des THREAD-Composers (getrennt → kein Übersprechen)
    _cropSrc: string | null // Object-URL des zu croppenden Bilds (Crop-Overlay, sonst null)
    _cropForThread: boolean // beim Cropper-Öffnen erfasst: Ziel ist der Thread- (true) statt Haupt-Composer
    cropRatio: number // aktives Seitenverhältnis (NaN = frei) — für die Button-Hervorhebung
    uploadingImage: boolean // Crop→Upload läuft (Doppel-Klick-Guard, Busy-Anzeige)
    editingId: string | null // id der gerade bearbeiteten eigenen Nachricht (sonst null)
    activeId: string | null // Nachricht mit eingeblendeten Aktionen (Tap-to-toggle, Touch)
    flashId: string | null // kurz hervorgehobene Nachricht (Sprung zum Zitat)
    lightboxSrc: string | null // Vollbild eines angeklickten Inline-Bilds (Proxy `full`)
    deleting: boolean
    pendingDelete: { id: string; createdAt: number } | null
    reportFor: ChatMessage | null // Zielnachricht des offenen Melde-Modals
    reportReason: string // gewählter NIP-56-Grund (spam/profanity/impersonation/other)
    reportText: string // optionaler Freitext fürs „Fork off!"
    reporting: boolean
    zapFor: ChatMessage | null // Zielnachricht des offenen Zap-Modals (Z3)
    zapResolving: boolean // Zapper des offenen Modals wird noch aufgelöst → „Senden" disabled
    zapUnavailable: boolean // Empfänger nicht bezahlbar (kein erreichbarer LNURL-Endpoint) → Hinweis im Modal
    zapResolveFailed: boolean // Prüfung des Empfängers scheiterte bei UNS (Timeout/Netz) → erneut versuchen
    zapNostrless: boolean // Modal im Plain-Pay-Modus: Empfänger ohne NIP-57 → Zahlung ohne Nostr-Event
    zapAmount: number // gewählter Zap-Betrag in Sats (Default 21 = EINUNDZWANZIG)
    zapContent: string // Zap-Kommentar/Emoji (Default '⚡')
    zapping: boolean // Zap läuft (Doppel-Klick-Guard)
    zapInvoice: string // bolt11 im QR-Fallback (leer = Auto-Pay/noch keine Rechnung)
    zapQr: string // Data-URL des bolt11-QR (QR-Fallback)
    zapsEnabled: boolean // Feature-Flag window.__nostrZapsEnabled (iOS-Kill-Switch)
    zapPresets: number[] // feste Sats-Presets für die Schnellauswahl
    _zapper: Zapper | null // aufgelöster Zapper der zapFor-Nachricht (Vorabgate bestanden)
    _zapSub: AbortController | null // Live-Receipt-Sub im QR-Fallback (Abort bei Close)
    _zapLoadedIds: Set<string> // Nachrichten, deren 9735-History schon geladen wurde
    pollTitle: string // Frage der zu erstellenden Poll (C5)
    pollOptionList: { id: string; value: string }[] // Antwortoptionen des Poll-Formulars
    pollTypeSel: PollType // Einfach-/Mehrfachwahl der zu erstellenden Poll
    pollEndsAt: string // optionales Enddatum (datetime-local-String, '' = kein Ende)
    pollBusy: boolean // Poll wird gerade publiziert
    goalTitle: string // Titel des zu erstellenden Zap-Goals (Z5)
    goalSummary: string // optionale Beschreibung des Zap-Goals
    goalTargetSats: number // Ziel-Betrag in Sats
    goalBusy: boolean // Goal wird gerade publiziert
    _draggedOption: string | null // id der per Griff gezogenen Option (Reorder), sonst null
    isMobile: boolean // native App? → Interaktions-Menü als Vollbild-Modal statt Popover
    menuFor: ChatMessage | null // Nachricht des offenen Interaktions-Menüs (Mobile-Modal)
    _menuInThread: boolean // Mobile-Menü aus dem Thread geöffnet → Raum-only-Aktionen ausblenden, Antworten→setThreadReply
    infoFor: MessageInfo | null // Roh-Event-Details der offenen Nachricht-Info (C4)
    // Moderation (P1, NIP-86): nur wenn der Relay dem User Management-Methoden erlaubt.
    isAdmin: boolean // Admin des aktiven Space? (deriveUserIsSpaceAdmin, reaktiv)
    pendingAdminDelete: ChatMessage | null // Zielnachricht der offenen Admin-Löschen-Bestätigung (banevent)
    banAuthorFor: ChatMessage | null // Ziel-Autor der offenen Bannen-Bestätigung (banpubkey)
    moderating: boolean // banevent/banpubkey läuft (Doppel-Klick-Guard)
    // Thread-Ansicht (C6b, NIP-22): In-Room-Overlay statt eigener Route.
    threadRootId: string | null // Root-Event des offenen Threads (null = Overlay zu)
    threadRoot: ThreadRoot | null // aufgelöster Root (die zitierte Nachricht)
    threadComments: ChatMessage[] // flache chronologische Kommentare (ChatMessage-shaped, P3 4.2)
    threadCount: number // Anzahl Kommentare im offenen Thread
    threadReplyTo: { id: string; name: string } | null // Ziel-Kommentar der nächsten Antwort (null = am Root)
    threadDraft: string // Kommentar-Entwurf im Thread-Composer
    threadFull: boolean // Vollansicht (aus der Übersicht/Deep-Link) statt Modal-über-Chat (aus dem Feed)
    _threadUnsub: null | (() => void) // deriveThread-Subscription
    _threadController: AbortController | null // Live-Sub des offenen Threads
    _threadPrevUrl: string | null // Raum-URL VOR dem Thread-Open (Adressleiste kosmetisch gespiegelt); beim Schließen zurückgesetzt
    _deepThreadNevent: string | null // Deep-Link-nevent aus /rooms/{h}/thread/{nevent}, EINMAL in setup konsumiert
    mentionOpen: boolean // @-Autocomplete-Popover sichtbar (C4)
    mentionQuery: string // aktuelle @-Suchzeichenfolge (nach dem @)
    mentionItems: MentionItem[] // gefilterte Mitglieder-Vorschläge
    mentionIndex: number // hervorgehobener Vorschlag (Tastatur-Navigation)
    _mentionStart: number // Caret-Index des @ im Draft (für den Ersetz-Splice)
    _mentionTarget: 'main' | 'thread' // welcher Composer die @-Mention gerade füttert (draft vs threadDraft)
    _members: MentionItem[] // Space-Mitglieder als Mention-Quelle (Directory)
    _unsubMembers: null | (() => void)
    _unsubAdmin: null | (() => void) // deriveUserIsSpaceAdmin-Subscription (P1)
    // P2/NIP-38: die Relay-Art ist noch `'unknown'` → die Statusspalte zeigt einen
    // Platzhalter statt „kein Status" zu behaupten. Außerhalb des Workspace-Arms
    // konstant false (siehe `userStatus.ts deriveStatusPending`).
    statusPending: boolean
    _unsubStatusPending: null | (() => void)
    // ── Forum-Modus (P3) ─────────────────────────────────────────────────────
    // Ein Kanal mit `["t","forum"]` zeigt eine THEMENLISTE statt des Verlaufs.
    // `isForum` wird REAKTIV aus der Raum-Meta gesetzt (`_unsubRoomMeta`), nie
    // einmal beim Mount gelesen: das 39000 kommt vom Relay und ist beim ersten
    // Frame regelmäßig noch nicht da — ein Schnappschuss stünde dauerhaft auf
    // `false` und der Nutzer sähe im Forum stumm einen leeren Chat (dieselbe
    // Klasse Fehler wie der `spaceIsBuzz()`-Schnappschuss aus P6).
    isForum: boolean
    topics: ForumTopic[]
    topicsLoading: boolean
    _unsubTopics: null | (() => void) // deriveForumTopics-Subscription
    _forumStarted: boolean // Load + Live-Sub des Forums schon aufgezogen? (einmal je setup)
    _unsubRoomMeta: null | (() => void)
    _unsubRelay: null | (() => void) // deriveRelay-Subscription: korrigiert spaceHint nach, wenn NIP-11 nach dem Mount eintrifft (P13)
    _url: string | null
    _lastRead: number
    _onViewport: null | (() => void)
    _onVisible: null | (() => void) // App-Foreground → Live-Subs neu senden (WebView-Background killt den Socket)
    _hiddenAt: number // Zeitpunkt des Hintergrund-Gangs (0 = sichtbar) → Resync nur nach echtem Background
    _initialLoadDone: boolean // erster setup()-Load fertig? Gate gegen Resync mitten im Prewarm-Fenster
    _unsubActive: null | (() => void)
    _unsub: null | (() => void)
    _unsubJoined: null | (() => void)
    _controller: AbortController | null
    _loadedProfiles: Set<string>
    _loadedMsgIds: Set<string> // ROH geladene kind-9-IDs (Pagination-Terminierung, robust ggü. Anzeige-Filter wie Poll-Share-Quotes)
    _scroller: Scroller | null // Auto-Nachlade-Scroller (createScroller) statt Virtualizer; Teardown stoppt ihn
    _destroyed: boolean // Insel via wire:navigate abgebaut, während init() noch auf storageReady wartete (M3 P1)
    _pendingMsgs: ChatMessage[] | null // rAF-Coalescing: letzter Feed-Emit, der noch aufs Rendern wartet
    _rafMsgs: number // laufender requestAnimationFrame-Handle fürs Coalescing (0 = keiner)
    init(): void
    setup(url: string): void
    teardown(): void
    onRoomClosed(url: string, reason: string): void
    resync(): void
    retry(): void
    loadOlder(): void
    onScroll(): void
    scrollToBottom(): void
    scrollToMessage(id: string): void
    openChatLink(url: string, e: Event): void
    autoGrow(el: HTMLTextAreaElement): void
    markRead(): void
    setReply(m: ChatMessage): void
    clearReply(): void
    share(m: ChatMessage): void
    canEdit(m: ChatMessage): boolean
    startEdit(m: ChatMessage): void
    cancelEdit(): void
    saveEdit(content: string): Promise<void>
    refocusComposer(): void
    openMessageMenu(m: ChatMessage, inThread?: boolean): void
    closeMessageMenu(): void
    copyNevent(m: ChatMessage): void
    copyNpub(m: ChatMessage): void
    copyJson(m: ChatMessage): void
    openInfo(m: ChatMessage): void
    openThread(m: ChatMessage, full?: boolean, syncUrl?: boolean): void
    /**
     * Ein Thema der Forum-Liste öffnen — derselbe Thread-Bereich wie im Chat.
     *
     * Bewusst nur eine Übersetzung auf {@link openThread} und keine zweite
     * Ansicht: die Wurzel ist ein 45001 statt eines kind 9, alles danach
     * (Antworten, Zitat-Kopf, Composer, Deep-Link, Escape) ist identisch.
     */
    openTopic(topic: ForumTopic): void
    /** Zieht die Forum-Fläche auf (Bestand, Live-Sub, Themenliste). Idempotent. */
    startForum(url: string): void
    threadHref(m: ChatMessage): string
    closeThread(): void
    /** Kopf-Pfeil im RAUM: history.back() bei App-internem Vorgänger, sonst `upTarget`. */
    originHref(fallback: string): string
    backFromRoom(upTarget: string): void
    backFromThread(): void
    setThreadReply(c: ChatMessage): void
    clearThreadReply(): void
    sendComment(): Promise<void>
    copy(text: string, message: string): void
    onComposerInput(el: HTMLTextAreaElement, target?: 'main' | 'thread'): void
    pickMention(item: MentionItem): void
    closeMentions(): void
    insertEmoji(target: 'main' | 'thread', text: string, emojiTag?: string[], label?: string): void
    react(m: ChatMessage, content: string, emojiTag?: string[], label?: string): Promise<void>
    toggleReaction(m: ChatMessage, r: ReactionChip): Promise<void>
    send(): Promise<void>
    _openCropper(file: File): void
    pickImage(input: HTMLInputElement): void
    pasteImage(e: ClipboardEvent): void
    setCropRatio(r: number): void
    rotateCrop(): void
    flipCrop(): void
    confirmCrop(): Promise<void>
    cancelCrop(): void
    removeAttachment(): void
    askDelete(m: ChatMessage): void
    confirmDelete(): Promise<void>
    remove(id: string, createdAt: number): Promise<void>
    askReport(m: ChatMessage): void
    confirmReport(): Promise<void>
    askAdminDelete(m: ChatMessage): void
    confirmAdminDelete(): Promise<void>
    askBanAuthor(m: ChatMessage): void
    confirmBanAuthor(): Promise<void>
    openZap(m: ChatMessage): Promise<void>
    confirmZap(): Promise<void>
    closeZap(): void
    votePoll(m: ChatMessage, optionId: string): Promise<void>
    openPollCreate(): void
    addPollOption(): void
    removePollOption(id: string): void
    pollDragStart(id: string): void
    pollReorder(targetId: string): void
    pollDragEnd(): void
    submitPoll(): Promise<void>
    openGoalCreate(): void
    submitGoal(): Promise<void>
    join(): Promise<void>
    leave(): Promise<void>
    destroy(): void
}

type SignerBannerState = {
    message: string
    _unsubHealth: null | (() => void)
    _unsubPubkey: null | (() => void)
    _pk: string | null
    _health: SignerHealth
    init(): void
    destroy(): void
}

type ReconnectBannerState = {
    stale: boolean
    _unsub: null | (() => void)
    init(): void
    destroy(): void
    reconnect(): void
}

type SpaceSettingsState = {
    ready: boolean
    spaces: { url: string; label: string; joined: boolean }[]
    active: string | null
    activeJoined: boolean
    activeIsVerein: boolean
    busy: boolean
    _joined: string[]
    _choices: string[]
    _relays: Map<string, RelayProfile>
    _unsubChoices: null | (() => void)
    _unsubActive: null | (() => void)
    _unsubJoined: null | (() => void)
    _unsubRelays: null | (() => void)
    init(): void
    destroy(): void
    choose(url: string): void
    joinActive(): Promise<void>
    leaveActive(): Promise<void>
}

type InviteState = {
    space: string
    label: string
    claim: string
    joining: boolean
    error: string
    done: boolean
    init(): void
    accept(): Promise<void>
}

/** ZAPS.md Z0.4 — vollwertige Lightning-Wallet-Insel (Verbinden/Balance/Senden/Empfangen). */
type WalletState = {
    zapsEnabled: boolean
    connected: boolean
    walletType: '' | WalletType
    lud16: string
    relayUrl: string
    balanceSats: number | null
    weblnAvailable: boolean
    connectUrl: string
    busy: boolean
    error: string
    payReq: string
    payAmountSats: number | null
    paying: boolean
    recvAmountSats: number | null
    recvMemo: string
    recvInvoice: string
    recvQr: string
    receiving: boolean
    profileLud16: string
    profileNip05: string // roher nip05-Wert aus dem Profil ('' = keiner gesetzt)
    nip05Verified: boolean // true nur bei bestätigtem nostr.json↔pubkey-Match (welshman-Handle)
    nip05Settled: boolean // true, sobald die nostr.json-Prüfung abgeschlossen (verifiziert ODER Settle-Timeout) — trennt „prüft noch" von „geprüft, kein Match"
    profileReady: boolean // true erst nach der ersten aufgelösten Profil-Emission (kein „Nicht gesetzt"-Flash beim Laden)
    addressInput: string
    addressTouched: boolean
    savingAddress: boolean
    saveResults: RelayPublishResult[] // Per-Relay-Ergebnis des letzten Speicherns (Diagnose)
    showDiag: boolean // Profil-Diagnose-Panel ein-/ausgeklappt
    _destroyed: boolean
    _nip05Timer: ReturnType<typeof setTimeout> | null
    _unsubProfile: (() => void) | null
    _unsubHandle: (() => void) | null
    init(): Promise<void>
    _apply(w: Wallet): void
    connectNwc(): Promise<void>
    connectWebln(): Promise<void>
    disconnect(): Promise<void>
    refreshBalance(): Promise<void>
    openSend(): void
    sendPayment(): Promise<void>
    openReceive(): void
    createReceiveInvoice(): Promise<void>
    displayRelay(): string
    addressMismatch(): boolean
    useWalletAddress(): void
    saveReceivingAddress(): Promise<void>
    nip05State(): 'verified' | 'unverified' | 'missing' | 'pending'
    saveBlockedByNip05(): boolean
    shortRelay(url: string): string
    npubShort(): string
    copyNpub(): void
    pubkeyHexShort(): string
    copyPubkeyHex(): void
    copy(text: string, message: string): void
    destroy(): void
}

/**
 * „ResizeObserver loop completed with undelivered notifications" schlucken. Das ist eine
 * SPEC-KONFORME, harmlose Browser-Warnung: liefert ein ResizeObserver-Callback nicht alle
 * Messungen in einem Frame aus (weil es selbst Layout ändert), reicht der Browser sie im
 * NÄCHSTEN Frame nach — nichts bricht, kein sichtbarer Ruck. Jede measure-basierte
 * Virtualisierung (unser chatVirtualizer via `measureElement`, ebenso react-virtuoso/TanStack)
 * löst sie im Lade-Burst aus. Chrome dispatcht sie aber als window-`error`-Event → sie flutet
 * `window.onerror` und damit die laravel-boost-Browser-Logs. Nur GENAU diese eine Meldung
 * filtern (Capture-Phase + stopImmediatePropagation → vor boosts Handler), echte Fehler
 * bleiben unberührt. Einmalig (Guard), auch wenn registerNostrComponents mehrfach liefe.
 */
let resizeObserverFilterInstalled = false
function installResizeObserverLoopFilter(): void {
    if (resizeObserverFilterInstalled || typeof window === 'undefined') {
        return
    }
    resizeObserverFilterInstalled = true
    window.addEventListener(
        'error',
        (e) => {
            if (e.message && /ResizeObserver loop/.test(e.message)) {
                e.stopImmediatePropagation()
                e.preventDefault()
            }
        },
        true,
    )
}

// ── Meetup-Filter: Modul-Ebene-Caches (BEWUSST nicht-reaktiv) ────────────────
// Intl-Instanzen dürfen NICHT im Alpine-State liegen: Alpine wickelt den State in
// einen reactive()-Proxy, und `Intl.*.prototype.format/of` über einen Proxy wirft
// „incompatible receiver" (interne Slots brauchen das echte Objekt als this).
// Zugleich vermeidet der Modul-Scope reaktive Writes während des Renderns.
// Die Formatter sind zustandslos → prozessweit teilbar; die Filter-Caches sind
// per Schlüssel invalidiert (Single-Space-Seite → genau eine nostrSpaces-Insel).
// `regionNames` ist seit der gruppierten Rail nach `countryNames.ts` gewandert —
// der Navigator braucht dieselbe Auflösung, und zwei Caches für dieselbe Frage
// wären zwei Wahrheiten. Die Begründung für den Modul-Scope steht dort.
// P3: der Termin-Formatter hängt nicht mehr hier, sondern in `locale.ts` — und
// damit an der gewählten Sprache statt hart an `de-DE`. Der Cache liegt weiterhin
// im Modul-Scope (dort), er trägt die Sprache jetzt nur im Schlüssel.
let _myCCCache: string | undefined
// Aktivitäts-Feld der Datenschicht (`groups.ts lastMessageAtByUrl`). Räume ohne
// bekannte Aktivität sortieren ans Ende und fallen damit auf den Alphabet-Zweig.
const lastMsgAt = (room: RoomView): number => room.lastMessageAt ?? Number.NEGATIVE_INFINITY
type RoomFilterResult = { key: string; mine: RoomView[]; meetups: RoomView[]; other: RoomView[]; proposals: RoomView[] }
let _roomFilterCache: RoomFilterResult | null = null
type CountryOption = { country: string; flag: string; name: string; count: number }
let _countryCache: { key: string; list: CountryOption[] } | null = null

const dateFmt = (): Intl.DateTimeFormat | null => dateTimeFormat({ weekday: 'short', day: 'numeric', month: 'short' })
const myCountryCode = (): string => {
    if (_myCCCache === undefined) {
        try {
            _myCCCache = new Intl.Locale(navigator.language).region?.toUpperCase() ?? ''
        } catch {
            _myCCCache = ''
        }
    }
    return _myCCCache
}

// ── Ungelesen-Punkt (P3): globaler Store + raumübergreifende Aktivität ──────
//
// Beides hängt bewusst NICHT an einer Seiten-Insel, sondern am Insel-Boot: der Punkt
// sitzt in der Bottom-Nav und damit auf JEDER Seite, nicht nur auf der Raumliste.

/** `h` der beigetretenen Räume des aktiven Space (relay-signierte 39002). */
const joinedRoomHs: Readable<string[]> = derived(activeSpaceView, ($view: SpaceView) =>
    $view.userRooms.map((room) => room.h),
)

/**
 * `h` → Anzeigename derselben Räume. Nur die BEIGETRETENEN: ein fehlender Schlüssel
 * heißt in `computeUpdates` „verwaist" (§8) — nähme man `otherRooms` dazu, verlöre die
 * Liste genau die Aussage, die sie treffen soll (der Raum ist weg/nicht mehr meiner).
 */
const joinedRoomNames: Readable<Record<string, string>> = derived(activeSpaceView, ($view: SpaceView) =>
    Object.fromEntries($view.userRooms.map((room) => [room.h, room.name])),
)

/**
 * Frist des „Rückgängig" nach „Alles gelesen" (§8, verbindlich: 10 s). EINE Quelle —
 * die Leiste in `⚡updates.blade.php` hängt an `canUndo()` und führt bewusst keinen
 * eigenen `setTimeout`, sonst gäbe es zwei Wahrheiten über dieselbe Frist.
 */
const UNDO_WINDOW_MS = 10_000

let unreadWired = false
/**
 * Dieselbe REAKTIVE Store-Instanz, die auch die Templates lesen — hier hochgezogen,
 * damit eine Alpine-Komponente eine Ungelesen-TEILSUMME rechnen kann (Entdecken-Zeile
 * der Projektunterstützung), ohne sich auf `this.$store` zu verlassen.
 *
 * Warum nicht `this.$store.unread`: das wäre eine Annahme über Alpine-Magics im
 * `Alpine.data`-Objekt, die dieser Modulbestand nirgends belegt — und ein `undefined`
 * dort ergäbe still eine Pille, die für immer 0 bleibt. Die Referenz hier ist dieselbe,
 * die `wireUnread` schon hält, und `wireUnread` läuft am Anfang von
 * `registerNostrComponents`, also vor jeder Komponenten-Auswertung.
 *
 * Reaktiv bleibt es, weil `Alpine.store(name)` den reaktiven Proxy zurückgibt (genau
 * deshalb liest `wireUnread` den Store nach dem Anlegen erneut aus): ein Lesezugriff
 * innerhalb eines Alpine-Effekts trägt sich als Abhängigkeit ein, ein `store.rooms = …`
 * beim nächsten Emit löst ihn aus.
 */
let unreadStore: UnreadStore | null = null
let activityKey = ''
let activityController: AbortController | null = null

/**
 * S1+S2 für die aktuelle Raum-Menge (neu senden, sobald sich Space ODER Mitgliedschaft
 * ändern). Der Schlüsselvergleich ist Pflicht, nicht Kosmetik: `joinedRoomHs` hängt an
 * `activeSpaceView`, und das emittiert seit `lastMessageAt` bei jeder Aktivitätswelle —
 * ohne ihn risse jede eingehende Nachricht die Live-Subscription ab und baute sie neu auf.
 */
/**
 * **Hier stand eine 300-ms-Sammelfrist. Sie ist wieder draußen — bewusst.**
 *
 * Der Gedanke war richtig gemessen: die relay-signierte 39002 streamt die
 * Mitgliedschaften einzeln, die Raumliste wächst 1 → 2 → 3, und `syncRoomActivity`
 * baute für jede Zwischenstufe neu auf (im Buzz-Mitschnitt derselbe Filter dreimal mit
 * wachsender `#h`-Liste). Die Frist sparte gemessen **5 von 40** zählenden Frames.
 *
 * Sie ist trotzdem weg, weil beide Seiten der Rechnung sich änderten:
 *
 * - **Der Nutzen war nie belegt nötig.** Buzz deckelt 50 Frames je 5 s; der Client lag im
 *   schlimmsten Fenster bei 33, nach der AUTH-Härtung (`authHold.ts`) bei 23. Gerissen
 *   wurde der Deckel nur im E2E-Setup, das den Relay zusätzlich mit `nak`-Seeds belastet.
 *   Ob Produktion ihn je erreicht, ist **nicht gemessen** — der Prod-Relay wird nicht
 *   gescrapet, `buzz_admission_rejections_total` liegt nirgends vor.
 * - **Die Kosten waren offen.** Die Frist verzögert genau die Projektion, an der die
 *   `updates`-Anker hängen, und die fielen danach unter Volllast sporadisch mit
 *   `toBeVisible` (Anker 2, 8, 13, 20 — je isoliert grün). Ein Zusammenhang ist
 *   **unbewiesen**; ihn auszuschließen hätte zwei Messreihen à sechs Vollläufe gekostet.
 *
 * 5 Frames von 50 sind diesen Preis nicht wert. Der eigentliche Defekt dieser Runde — der
 * stille Verlust bei ratenbegrenzten Events — ist ohnehin an seiner Wurzel behoben
 * (`publishResult.ts` meldet jetzt einen Fehler statt zu hängen).
 *
 * Wer sie zurückholt, braucht vorher eine Prod-Messung, dass der Deckel überhaupt greift.
 */

const syncRoomActivity = (url: string, hs: string[]): void => {
    const key = url + '|' + [...hs].sort().join(',')
    if (key === activityKey) {
        return
    }
    activityKey = key
    activityController?.abort()
    activityController = null
    if (hs.length === 0) {
        return // Gast oder noch keine Mitgliedschaft geladen → kein REQ
    }
    activityController = new AbortController()
    void loadRoomActivity(url, hs)
    watchRoomActivity(url, hs, activityController.signal)
}

/**
 * Der `unread`-Store, wie ihn Blade sieht. Die beiden Formatierer liegen ABSICHTLICH am
 * Store und nicht im Template: sonst stünde die Cap-Schwelle (99 bzw. 9) als Literal in
 * jedem `x-text`, und die vier Pillen aus §4.1 könnten auseinanderlaufen.
 */
type UnreadStore = UnreadView & {
    /**
     * Ungelesene ZEILEN von `/updates` — die Zahl der Header-Glocke (§4.1 Nr. 6).
     *
     * Sie liegt hier und nicht in der `nostrUpdates`-Insel, weil die Glocke im Kopf von
     * `⚡spaces.blade.php` sitzt: auf diesem Screen existiert die Insel gar nicht, und
     * ohne globale Quelle könnte die Glocke nie eine Zahl tragen. Gezählt wird in
     * `countUnreadUpdates` — dieselbe Liste, die der Klick auf die Glocke öffnet.
     */
    updates: number
    /**
     * Zahl → fertiger Pillentext, gekappt. EINE Methode für beide Schwellen aus §4.2
     * (99 an den frei stehenden Pillen, 9 an der Glocke) statt zweier benannter: die
     * Schwelle ist eine Eigenschaft des ORTES, an dem die Pille steht, und der Ort ist
     * das Template. `x-group::unread-badge` reicht sie als `cap`-Prop durch.
     *
     * Verträgt `undefined` (gelesener Thread hat keinen Schlüssel, Store noch leer) und
     * gibt dann — wie bei 0 — den leeren String zurück.
     */
    capped(count: number | null | undefined, cap?: number): string
    /**
     * Text der EINEN `aria-live="polite"`-Zählregion des Clients (§4.7), leer = nichts
     * anzusagen. **Feld, kein Getter** — ein Getter würde bei jeder Store-Mutation neu
     * ausgewertet und die Drosselung wäre wirkungslos.
     *
     * Geschrieben wird höchstens alle {@link LIVE_REGION_THROTTLE_MS} (§4.7), und der
     * ERSTE Wert nach einem Space-Wechsel wird verschluckt: das ist der Zustand, in dem
     * die Seite ankommt, keine Änderung. Ohne diesen Riegel spräche der Screenreader bei
     * jedem Seitenaufbau den Zählerstand vor, den der Nutzer nicht angefordert hat —
     * genau die Unbenutzbarkeit, die §4.7 mit „genau eine Region" verhindern will.
     */
    liveText: string
}

/**
 * Registriert den `unread`-Store und hält ihn am Leben. Der Vertrag zur Oberfläche:
 *
 *     Alpine.store('unread') → {
 *         rooms: Record<h, number>,          // Schlüssel fehlt = nicht beigetreten, 0 = gelesen
 *         threads: Record<rootId, number>,   // Schlüssel nur bei > 0 (siehe UnreadView)
 *         any: boolean,                      // Punkt der Bottom-Nav, Ja/Nein der Glocke
 *         roomsTotal: number, threadsTotal: number,   // die beiden Tab-Pillen (§4.4)
 *         updates: number,                   // ungelesene /updates-Zeilen → Header-Glocke
 *         capped(n, cap = 99): string,       // fertiger Pillentext inkl. Cap (99 bzw. 9)
 *         liveText: string,                  // die EINE aria-live-Zählregion (§4.7)
 *     }
 *
 * Das Template rechnet damit NICHT: `x-text="$store.unread.capped(n, 99)"` ist der ganze
 * Aufruf (so ruft `x-group::unread-badge` ihn auf), und `capped()` verträgt `undefined`
 * (gelesener Thread, fehlender Raum) mit einem leeren String.
 *
 * Der Store wird EINMAL angelegt und danach nur noch befüllt — Blade liest ihn defensiv
 * (`$store.unread?.rooms?.[…]`), ein fehlender Store bedeutet dort „kein Marker".
 * Der Guard trägt: `registerNostrComponents` kann mehrfach laufen (Muster:
 * installResizeObserverLoopFilter), zwei Subscriptions wären zwei Netzwerk-Subs.
 */
function wireUnread(Alpine: { store: (name: string, value?: unknown) => unknown }): void {
    if (unreadWired) {
        return
    }
    unreadWired = true
    const initial: UnreadStore = {
        rooms: {},
        threads: {},
        any: false,
        roomsTotal: 0,
        threadsTotal: 0,
        updates: 0,
        capped: (count, cap = BADGE_CAP) => formatUnreadCount(count, cap),
        liveText: '',
    }
    Alpine.store('unread', initial)
    const store = Alpine.store('unread') as UnreadStore
    unreadStore = store
    let unsubUnread: (() => void) | null = null
    let unsubUpdateCount: (() => void) | null = null

    /**
     * Die Drossel der Zählregion (§4.7). Sie lebt hier und nicht im Template, weil
     * „höchstens alle 2 s" Zustand ÜBER ZEIT ist — ein Blade-Ausdruck kann das nicht.
     *
     * `announced` verschluckt den ersten Wert je Space (Ankunftszustand, keine Änderung).
     * `pending` trägt die Nachzügler-Ansage: läuft die Frist noch, gewinnt der ZULETZT
     * gesehene Stand, nicht der erste — eine Ansage, die eine überholte Zahl nennt, wäre
     * schlimmer als eine, die zwei Sekunden spät kommt.
     */
    let liveAnnounced = false
    let liveWrittenAt = 0
    let liveTimer: ReturnType<typeof setTimeout> | null = null
    let livePending: string | null = null

    const writeLiveText = (text: string): void => {
        livePending = null
        liveWrittenAt = Date.now()
        store.liveText = text
    }

    const announceUnread = (count: number): void => {
        const text = updatesLiveText(count)
        if (!liveAnnounced) {
            liveAnnounced = true
            liveWrittenAt = Date.now()
            return // Ankunftszustand: sichtbar ja, hörbar nein
        }
        if (text === store.liveText && livePending === null) {
            return
        }
        if (liveTimer !== null) {
            livePending = text // Frist läuft — der letzte Stand gewinnt
            return
        }
        const delay = liveRegionDelay(liveWrittenAt, Date.now())
        if (delay === 0) {
            writeLiveText(text)
            return
        }
        livePending = text
        liveTimer = setTimeout(() => {
            liveTimer = null
            if (livePending !== null && livePending !== store.liveText) {
                writeLiveText(livePending)
            } else {
                livePending = null
            }
        }, delay)
    }

    activeSpace.subscribe((url: string) => {
        // Space-Wechsel: erst leeren, dann neu ableiten — sonst blieben die Marker des
        // alten Space bis zum ersten Emit des neuen stehen.
        unsubUnread?.()
        unsubUpdateCount?.()
        store.rooms = {}
        store.threads = {}
        store.any = false
        store.roomsTotal = 0
        store.threadsTotal = 0
        store.updates = 0
        // Auch die Region auf Anfang: der Zählerstand des ALTEN Space darf im neuen
        // weder stehen bleiben noch als Änderung angesagt werden.
        if (liveTimer !== null) {
            clearTimeout(liveTimer)
            liveTimer = null
        }
        livePending = null
        liveAnnounced = false
        store.liveText = ''
        unsubUnread = deriveUnread(url, joinedRoomHs).subscribe((view: UnreadView) => {
            store.rooms = view.rooms
            store.threads = view.threads
            store.any = view.any
            store.roomsTotal = view.roomsTotal
            store.threadsTotal = view.threadsTotal
        })
        // Die Glocken-Zahl. Zweite Ableitung über DENSELBEN Bestand — bewusst nicht aus
        // `roomsTotal + threadsTotal` gerechnet: die Glocke führt zu einer LISTE, und
        // deren Zeilen aggregieren Ereignisse (`updates.ts`). Eine Zahl, die sich beim
        // Öffnen der Liste ändert, wäre genau der Fehler, den §4 vermeiden will.
        // Kosten: `deriveUpdates` faltet dieselben zwei Event-Ströme wie `deriveUnread`
        // (throttled 300, kein Netz) plus die Profile — das ist der Preis dafür, dass die
        // Glocke auch auf Screens ohne `nostrUpdates`-Insel eine Zahl trägt.
        unsubUpdateCount = deriveUpdates(url, joinedRoomHs, joinedRoomNames).subscribe((items: UpdateItem[]) => {
            store.updates = countUnreadUpdates(items)
            announceUnread(store.updates)
        })
    })
    // Ohne diese Subscription bewegte sich der Punkt NUR beim Kaltstart aus dem Cache:
    // `watchSpaceRooms` holt bloß Raum-Metadaten, `listenRoom` nur den EINEN offenen Raum.
    joinedRoomHs.subscribe((hs: string[]) => syncRoomActivity(get(activeSpace), hs))
}

export function registerNostrComponents(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
    magic: (name: string, callback: () => unknown) => void
    store: (name: string, value?: unknown) => unknown
}) {
    installResizeObserverLoopFilter()
    wireUnread(Alpine)
    // Desktop-Shell: `$store.viewport.desktop` gatet die EXISTENZ der Rail-Insel
    // (`<template x-if>`), `nostrRail` ist ihre lesende Datenquelle.
    // `$store.viewport.mouse` ist die zweite, unabhängige Frage („echtes Zeigegerät,
    // keine native App?") — `isMobile` kennt nur dieses Modul, also reicht es das durch.
    wireViewport(Alpine, { nativeApp: isMobile })
    wireRail(Alpine)
    // P4 — Befehlspalette (⌘K) und Kürzel-Register. Eigene Insel im Layout, kein
    // Zustand in `nostrRoomChat`; das hier ist alles, was `bridge.ts` von ihr weiß.
    wirePalette(Alpine)
    // P5 — Darstellungs-Schalter der Einstellungen (Zitat-/Profilkarten). Gleiche Bauart
    // und gleiche Begründung wie die Palette: eigene Insel, kein Zustand in `nostrRoomChat`.
    wireDisplayPrefs(Alpine)
    // P6a — Suche im geladenen Verlauf eines Raums. Wieder eigene Insel; die einzige
    // Berührung mit `nostrRoomChat` ist ein `scrollToMessage(id)` aus dem Markup heraus
    // (Scope-Kette), so wie es die Zitat-Vorschau in `chat-row` schon tut.
    wireRoomSearch(Alpine)
    // P6b — Angepinnte Nachrichten. Ausnahmsweise ein STORE statt einer Insel: der
    // Zustand wird an zwei Stellen gebraucht, die einander im DOM nicht sehen (Leiste
    // über dem Verlauf, Eintrag im Nachrichten-Menü innerhalb von `nostrRoomChat`).
    // Zwei Inseln bräuchten zwei Wahrheiten; Begründung im Kopf von `roomPins.ts`.
    // In `nostrRoomChat` entsteht dadurch KEIN neues Feld — das Markup liest
    // `$store.roomPins.*` und reicht `menuFor`/`isAdmin`/`joined` lesend hinein.
    wireRoomPins(Alpine)
    // P5 (Onboarding) — Vereins-Beitritt (`/verein/beitritt`). Wieder eine eigene Insel:
    // der Flow hat seinen eigenen Screen und seinen eigenen Geltungsbereich, und die REINE
    // Logik (Schritt-Entscheid, Fehler→Ausweg, Nachfass-Plan) liegt nochmals daneben in
    // `vereinFlow.ts`, damit sie ohne Browser prüfbar ist. `bridge.ts` weiß von beidem nur
    // diese Zeile.
    wireVerein(Alpine)
    // P6 (Buzz-Workspace) — Forge: Repositories, Issues, Pull Requests, Projekte,
    // Aktivität. Zwei Inseln (`nostrForge`, `nostrForgeRepo`), beide in `forge.ts`
    // registriert; die reine Faltung liegt nochmals daneben in `forgeModels.ts` und
    // `forgeActivity.ts`, damit sie ohne Browser prüfbar ist. `bridge.ts` weiß von
    // allem dreien nur diese Zeile.
    wireForge(Alpine)

    // PLAN4 IMG — `$img(url)` proxifiziert jedes remote Bild (Zuschnitt/WebP) in
    // jedem Alpine-Ausdruck. Zweites Arg = Preset (Default 'avatar').
    Alpine.magic('img', () => (url: unknown, preset?: string) => proxifyImage(url, preset))

    // P7 — `$imgFallback(url)` entscheidet in onerror-Ketten, ob der Zweitversuch
    // die ROHE URL laden darf (nur wenn der Proxy sie nicht schon per Policy
    // ablehnt — Begründung und Grenzen: `imageFallback.ts`). Dieselbe Bauform wie
    // `$img` darüber: die Blade-Türen sollen die Policy nicht nachbauen.
    Alpine.magic('imgFallback', () => (url: unknown) => mayFallbackToRaw(url))

    // MEDIA-VERWEIS — `$extern(url, $event)` öffnet einen externen Link so, dass er auf
    // dem GERÄT auch ankommt.
    //
    // **Ein `target="_blank"`-Anker verpufft in der nativen WebView wirkungslos** — das
    // ist im Haus dreimal beschrieben und dreimal einzeln gelöst: `openChatLink` (Links
    // aus dem Nachrichtentext), `nostrVereinGate.openExternal` (Beitritts-Link) und
    // `verein.ts openExternal` (Checkout). Genau daran waren Chat-Links auf dem Gerät
    // „nicht klickbar", während im Web immer alles funktionierte.
    //
    // Die beiden neuen Profil-Verweise liegen in Inseln, die keine solche Methode haben
    // (`nostrProfileCard`, `nostrArticleAuthor`) — eine VIERTE Kopie wäre die falsche
    // Antwort. Als Magic steht die Regel an einer Stelle und ist aus jedem Blade
    // erreichbar. Im Web passiert nichts (kein `preventDefault`), der Anker bleibt ein
    // gewöhnlicher Anker mit allem, was daran hängt: Mittelklick, „Link kopieren",
    // Tastaturbedienung.
    //
    // Die drei bestehenden Kopien bleiben unangetastet — sie hierher zu ziehen wäre ein
    // eigener Umbau an Flächen, die diese Phase nicht anfasst.
    Alpine.magic('extern', () => (url: unknown, e: Event) => {
        if (isMobile && typeof url === 'string' && isSafeExternalUrl(url)) {
            e.preventDefault?.()
            void nativeBrowserInApp(url)
        }
    })

    // BLOSSOM — `$blossomBind($data, url)` versorgt die Avatar-Fläche mit einem Bild,
    // das der Relay nur gegen einen signierten Header herausgibt (Buzz-`/media/`).
    //
    // **Warum EIN Aufruf und nicht drei Ausdrücke im Blade:** die Fläche braucht drei
    // Zustände (braucht es Auth / fertige `blob:`-URL / gescheitert), und die
    // Entscheidung darüber gehört nicht in ein `x-effect` mit Semikolons. Der Aufruf
    // schreibt sie in den Alpine-Zustand des Avatars; alles andere (eine Signatur je
    // Host, Cache, Freigabe, kein Wiederholen nach 401) liegt in `blossomMedia.ts` und
    // ist dort ohne Browser geprüft.
    Alpine.magic('blossomBind', () => (state: AvatarState, url: unknown) => bindAvatarState(blossomMedia, state, url))

    // BLOSSOM (2) — dasselbe für Bilder, die NICHT in Blade stehen: Chat-Anhänge,
    // Custom-Emoji und Artikelbilder entstehen als HTML-String in JS ([[blossomMarkup]]),
    // dort gibt es kein `x-effect`. Sie tragen stattdessen einen Marker, den dieser EINE
    // Beobachter am Dokument abholt — statt eines Aufrufs an jeder der sieben
    // `x-html`-Einsetzstellen, von denen eine sicher vergessen würde.
    //
    // `pubkey.subscribe` → `rescan()`: beim Sitzungswechsel werden die `blob:`-URLs
    // widerrufen ([[blossomInstance]]); ohne diesen Griff bliebe ein totes `src` stehen.
    // Er wirkt in beide Richtungen — was als Gast still leer blieb, erscheint nach dem
    // Anmelden ohne Seiten-Neuaufbau.
    const blossomHydration = startBlossomHydration(document, (url: string) => blossomMedia.load(url), (onMutation) => new MutationObserver(onMutation), document.body)
    // **Nur bei einem WECHSEL, nicht bei jedem Emit.** `pubkey` ist ein Svelte-Store: er
    // feuert schon beim Abonnieren mit dem aktuellen Wert. Ohne diesen Vergleich liefe
    // unmittelbar nach dem Aufsetzen ein zweiter, anlassloser `rescan()`. Heute ist der
    // folgenlos (an dieser Stelle gibt es noch kein Marker-Bild) — aber `rescan()`
    // nimmt jedem Bild sein `src` und holt es erneut, und die Zeile hinge damit an der
    // Reihenfolge im Init statt an ihrer eigenen Bedingung. Dieselbe Frage, dieselbe
    // Antwort wie `sitzungPruefen()` in `blossomMedia.ts`: die Identität ist der
    // Vergleichswert, nicht ihre bloße Anwesenheit.
    let letzteSitzung = pubkey.get() ?? ''
    pubkey.subscribe(($pubkey: string | null | undefined) => {
        const jetzt = $pubkey ?? ''
        if (jetzt === letzteSitzung) {
            return
        }
        letzteSitzung = jetzt
        blossomHydration.rescan()
    })

    // P3 LOCALE — `$num(1234)` formatiert eine Zahl in der GEWÄHLTEN Sprache
    // („1.234" unter de, „1,234" unter en), in jedem Alpine-Ausdruck. Dieselbe
    // Bauform wie `$img` darüber, und aus demselben Grund: die Blade-Ausdrücke
    // sollen keinen Formatierer nachbauen und erst recht keine Sprache raten.
    // Vorher stand dort `toLocaleString('de-DE')` — hart deutsch, mitten in einer
    // Oberfläche, die acht Sprachen spricht.
    Alpine.magic('num', () => (value: unknown) => formatNumber(Number(value) || 0))

    // P3 NUMERUS — `$plural(n, '1 Raum', ':count Räume')` wählt die Zählform nach
    // den Regeln der GEWÄHLTEN Sprache, nicht nach `n === 1`.
    //
    // Warum als Magic und nicht als `@js(__(…))` im Markup: die Wahl muss im
    // Browser fallen (der Zähler ist reaktiv), und welche Formen eine Sprache
    // überhaupt kennt, weiß erst `Intl` zur Laufzeit. Ein Blade-Ausdruck müsste
    // sonst alle Formen einzeln einbetten und die Auswahl nachbauen. Der Katalog
    // liegt ohnehin komplett im Browser (`window.__nostrI18n`), also schlägt
    // `tPlural` dort direkt nach — dieselbe Quelle, die `__()` serverseitig liest.
    //
    // Deshalb stehen im Markup die deutschen QUELLTEXTE als Schlüssel, nicht
    // `__()`-Aufrufe: unter `de` ist der Katalog leer und der Schlüssel IST die
    // Ausgabe, unter jeder anderen Sprache löst `tPlural` ihn auf.
    Alpine.magic(
        'plural',
        () => (count: unknown, one: string, other: string, replace?: Replacements) =>
            tPlural({ one, other }, Number(count) || 0, replace)
    )

    // PLAN P4 — Kontextueller Auth-Gate (§4.2). EIN globaler Store, den jede
    // gegatete Tab/Aktion (nav-tab, später FAB/„Bearbeiten") konsultiert, statt
    // selbst zu prüfen/navigieren:
    //   eingeloggt → intent.resume() sofort (kein Sheet, kein Redirect).
    //   Gast       → `open-login-sheet` dispatchen (detail.intent). Fängt ein
    //                montiertes Login-Sheet (P6) das per preventDefault ab, bleibt
    //                der Nutzer in-place; sonst harter Fallback auf den Login-View
    //                mit `?return`, damit die Zielroute nach Login wieder aufgeht.
    // Mobile hat KEIN Server-Gate (EnsureNostrAuth lässt lokale single-user-
    // Instanzen durch) → dieser Client-Gate ist dort der EINZIGE Schutz für
    // Chat/Wallet; im Web ist er die sanfte Ebene über dem echten Server-Gate.
    // `intent.label` ist der Kontextzeilen-Vertrag fürs P6-Sheet (§5.4) — hier
    // nur durchgereicht, das Sheet rendert ihn.
    type AuthIntent = { label?: string; returnUrl?: string; resume?: () => void }
    const authGateStore = {
        // P3 — dieselbe Frage wie in `requireAuth`, nur als LESBARER Zustand für
        // Views: „ist hier ein Gast?" (Gast-Composer, Einstiegszeile, Beitreten-
        // Karte in ⚡room). Ohne ihn müsste jede Insel `isAuthed(localStorage…)`
        // selbst nachbauen — dieselbe Sentinel-Falle („undefined"/"null", siehe
        // auth-gate.ts) an vier Orten statt an einem.
        //
        // EINMAL beim Boot gelesen und danach ein normales Store-Feld. Das ist
        // kein Cache-Risiko, sondern folgt dem Lebenszyklus: JEDER Login endet in
        // einer HARTEN Navigation (`location.assign(postLoginRedirect())`), jeder
        // Logout ebenso — der Wert kann sich also nicht ändern, ohne dass dieses
        // Modul neu bootet. Ein Getter auf `localStorage` wäre dagegen bei jedem
        // Render-Tick eine Lesung UND trotzdem nicht reaktiv (localStorage meldet
        // Alpine keine Änderung).
        authed: isAuthed(localStorage.getItem('pubkey')),
        requireAuth(intent: AuthIntent = {}): boolean {
            // Die Wahrheit bleibt localStorage; `authed` wird hier nachgezogen,
            // damit ein Login in einem ZWEITEN Tab die Views dieses Tabs beim
            // nächsten Gate-Tap nicht mehr als Gast behandelt.
            this.authed = isAuthed(localStorage.getItem('pubkey'))
            if (this.authed) {
                intent.resume?.()
                return true
            }
            // Gate-Ziel EINMAL bestimmen: das Sheet (P6) landet nach Login darüber
            // (pendingReturn, §postLoginRedirect), der Fallback-View über `?return`.
            const ret = sanitizeReturnUrl(intent.returnUrl ?? location.pathname + location.search)
            pendingReturn = ret
            const ev = new CustomEvent('open-login-sheet', { detail: { intent }, cancelable: true })
            window.dispatchEvent(ev)
            if (! ev.defaultPrevented) {
                location.assign('/nostr-login' + (ret ? '?return=' + encodeURIComponent(ret) : ''))
            }
            return false
        },
        // Aus der CAPTURE-Phase (mousedown/keydown, VOR dem wire:navigate-Commit):
        // nicht eingeloggt → SPA-Navigation blocken. Eine Methode statt der Logik
        // doppelt in beiden nav-tab-Handlern.
        gateTap(event: Event, intent: AuthIntent = {}): void {
            if (! this.requireAuth(intent)) {
                event.preventDefault()
                event.stopImmediatePropagation()
            }
        },
    }
    Alpine.store('authGate', authGateStore)

    // ── Rückweg: „gibt es einen App-internen Vorgänger?" ─────────────────────────
    // Der Kopf-Pfeil ist UP (Hierarchie), nicht BACK. Trotzdem soll er dorthin führen,
    // wo der Nutzer WAR — inklusive Filterzustand — statt stur auf die Raumliste zu
    // springen. Beides zusammen geht nur, wenn wir die eine Frage beantworten können,
    // die die History-API nicht beantwortet: ist der vorherige Eintrag UNSERER?
    //
    // Gemessen (Playwright/Host-Chromium, 2026-07-22):
    //   /spaces --Klick--> /rooms/welcome  → history.length 3→4 (wire:navigate PUSHT)
    //   dort history.back()                → /spaces, Alpine lebt (kein kalter Reboot)
    // `history.back()` trägt also — aber nur, wenn es einen eigenen Vorgänger gibt.
    // Beim Deep-Link-Kaltstart (Notification-Tap, geteilter Link) gibt es keinen, und
    // ein blindes back() führte aus der App heraus.
    //
    // Der Marker ist bewusst KEIN Pfad-Stack: ein selbst geführter Herkunfts-Stack wäre
    // eine zweite Navigationsgeschichte neben der echten und driftet garantiert
    // (Reload, Resume, Deep-Link). Gespeichert wird nur ein Bit — „in diesem Tab hat
    // schon einmal eine App-interne Navigation stattgefunden". sessionStorage ist
    // tab-lokal, ein frischer Deep-Link-Tab startet also korrekt ohne Marker.
    // Das Event feuert auf dem NOCH aktuellen Dokument, bevor getauscht wird — die
    // Adressleiste zeigt hier also die URL, die wir gerade verlassen. Genau die ist
    // der Vorgänger des gleich entstehenden History-Eintrags.
    document.addEventListener('livewire:navigate', () => {
        try {
            sessionStorage.setItem(APP_NAV_PREV_KEY, window.location.pathname + window.location.search)
        } catch {
            // sessionStorage nicht verfügbar (Private-Mode/Quota) → der Rückweg fällt
            // auf das explizite UP-Ziel zurück. Kein Fehler.
        }
    })

    // Nach einem Browser-Zurück/-Vorwärts wissen wir NICHT mehr, was der Vorgänger des
    // neuen Eintrags ist — der Wert oben beschreibt eine Navigation, die nicht mehr die
    // letzte ist. Ihn stehen zu lassen hieße raten; also löschen. Der Pfeil fällt damit
    // auf das UP-Ziel zurück, und das ist nie falsch, nur manchmal weniger komfortabel.
    window.addEventListener('popstate', () => {
        try {
            sessionStorage.removeItem(APP_NAV_PREV_KEY)
        } catch {
            /* nicht verfügbar — dann war ohnehin nichts gespeichert */
        }
    })

    // PLAN4 B3 — Autor-Profil-Karte (kind 0): öffnet ein Flux-Modal mit
    // display_name/about/website/banner/lud16. Ein `open-profile`-Window-Event
    // (aus Chat/Directory per `$dispatch`) trägt die pubkey herein — so triggert
    // dieselbe Karte aus beiden Inseln. Profil wird lazy via `deriveProfile`
    // geladen (welshman-Outbox); Felder füllen reaktiv nach.
    Alpine.data('nostrProfileCard', (): ProfileCardState => ({
        pubkey: '',
        npub: '',
        name: '',
        picture: '',
        banner: '',
        about: '',
        website: '',
        lud16: '',
        nip05: '',
        status: { text: '', emoji: '' },
        _unsub: null,
        _unsubHandle: null,
        _unsubStatus: null,
        open(pk: string) {
            if (!pk) {
                return
            }
            this._unsub?.()
            this._unsubHandle?.()
            this._unsubStatus?.()
            this.pubkey = pk
            this.npub = nip19.npubEncode(pk)
            const fallback = `${this.npub.slice(0, 12)}…${this.npub.slice(-6)}`
            this.name = fallback
            this.picture = this.banner = this.about = this.website = this.lud16 = this.nip05 = ''
            this.status = { text: '', emoji: '' }
            // NIP-38-Status (P2) des aktiven Space. Die Karte ist die einzige Fläche, die
            // den Status als TEXT zeigt (Chat-Zeile: gekürzt, Avatar: nur das Emoji) — und
            // damit die einzige, an der ein Screenreader ihn vollständig hört. Außerhalb
            // des Workspace-Arms liefert die Ableitung dauerhaft `undefined`.
            const statusUrl = get(activeSpace)
            warmUserStatuses(statusUrl, [pk])
            this._unsubStatus = deriveUserStatus(statusUrl, pk).subscribe((s: UserStatus | undefined) => {
                this.status = { text: s?.text ?? '', emoji: s?.emoji ?? '' }
            })
            // NIP-05: welshman verifiziert den Handle (nostr.json ↔ pubkey); der Store
            // liefert nur bei bestätigtem Match einen Wert → Häkchen erst dann.
            this._unsubHandle = deriveHandleForPubkey(pk).subscribe((handle) => {
                this.nip05 = handle ? displayNip05(handle.nip05) : ''
            })
            this._unsub = deriveMergedProfile(pk).subscribe((p) => {
                this.name = displayProfile(p, fallback)
                this.picture = p?.picture ?? ''
                this.banner = p?.banner ?? ''
                this.about = p?.about ?? ''
                // Website ist untrusted (kind-0) → sanitizeUrl; 'about:blank' = verworfen.
                const href = p?.website ? sanitizeUrl(p.website) : ''
                this.website = href === 'about:blank' ? '' : href
                this.lud16 = p?.lud16 ?? ''
            })
            dispatchModal('profile-card')
        },
        /**
         * In die Zwischenablage, mit fertiger Erfolgsmeldung.
         *
         * **`message` ist der GANZE Satz, nicht das Substantiv** (P3). Vorher
         * stand hier EIN Schlüssel, in den das Nomen als Platzhalter eingesetzt
         * wurde („… kopiert." mit `label` davor). Deutsch trägt das, weil sich „kopiert" nach
         * nichts richtet; in sieben der acht Sprachen richtet sich das Partizip
         * nach Genus und Numerus des Eingesetzten: „Rechnung kopiert." heißt auf
         * Spanisch „Factura copiada", „npub kopiert." aber „npub copiado". Mit
         * EINEM Schlüssel muss der Übersetzer eine der Formen erraten und liegt
         * an der Hälfte der Aufrufstellen daneben.
         *
         * Die Menge ist endlich und steht im Markup (fünf Sätze an zehn
         * Stellen), also bekommt jede Meldung ihren eigenen Schlüssel — derselbe
         * Weg wie bei den Zählformen: getrennte Vollsätze statt eines Satzes mit
         * eingesetztem Wort.
         */
        copy(text: string, message: string) {
            if (text) {
                void navigator.clipboard?.writeText(text).then(() => toast(message, 'success'))
            }
        },
        /**
         * Der Verweis auf die öffentliche Creator-Seite (media.) — **eine Methode, kein
         * Feld.**
         *
         * `this.nip05` trifft ASYNCHRON ein: `open()` setzt es auf `''`, die
         * `deriveHandleForPubkey`-Bindung füllt es nach, sobald die `.well-known` der
         * Domain diese Pubkey bestätigt hat. Ein einmal in `open()` geschriebenes Feld
         * trüge deshalb dauerhaft die npub, auch bei einem Autor mit bestätigtem Handle.
         * Als Methode liest Alpines Effekt `pubkey` und `nip05` mit und rechnet die
         * Adresse neu, sobald eines von beiden steht.
         *
         * **`this.nip05` ist der VERIFIZIERTE Wert** — `deriveHandleForPubkey` liefert
         * den Handle nur bei Übereinstimmung mit dieser Pubkey (welshman `handles.js:82`).
         * Ein Profil-Rohwert darf hier nie hinein; die Begründung steht in
         * `medienProfil.ts`.
         */
        medienUrl() {
            return medienProfilUrl(medienBasis(), this.pubkey, this.nip05)
        },
        destroy() {
            this._unsub?.()
            this._unsubHandle?.()
            this._unsubStatus?.()
        },
    }))

    // ZAPS.md Z0.4 — vollwertige Lightning-Wallet: Verbinden (NWC/WebLN), Hero-
    // Balance, Senden (bolt11 oder lud16) und Empfangen (Rechnung+QR). Der Secret
    // liegt gehärtet in `js/secure-storage.ts` (nie Klartext). Zahlung 100 % im
    // Browser. Der Feature-Flag `__nostrZapsEnabled` (Default true) kann die Wallet
    // hart abschalten (iOS-Build), ohne Code-Umbau.
    Alpine.data('nostrWallet', (): WalletState => ({
        zapsEnabled: zapsEnabled(),
        connected: false,
        walletType: '',
        lud16: '',
        relayUrl: '',
        balanceSats: null,
        weblnAvailable: Boolean(getWebLn()),
        connectUrl: '',
        busy: false,
        error: '',
        payReq: '',
        payAmountSats: null,
        paying: false,
        recvAmountSats: null,
        recvMemo: '',
        recvInvoice: '',
        recvQr: '',
        receiving: false,
        profileLud16: '',
        profileNip05: '',
        nip05Verified: false,
        nip05Settled: false,
        profileReady: false,
        addressInput: '',
        addressTouched: false,
        savingAddress: false,
        saveResults: [],
        showDiag: false,
        _destroyed: false,
        _nip05Timer: null,
        _unsubProfile: null,
        _unsubHandle: null,
        async init() {
            // Z4 — Profil-lud16 (kind 0) als Empfangsadresse spiegeln. SYNCHRON vor
            // jedem `await` abonnieren: sonst könnte destroy() beim schnellen
            // wire:navigate vor der Zuweisung laufen (`?.()`-No-op) und die danach
            // angelegte Sub würde leaken. Das Feld folgt dem Profil, bis der User
            // selbst tippt (`addressTouched`) — so überschreibt ein spätes Update
            // keine Eingabe und ein bewusst geleertes Feld (Adresse entfernen) bleibt leer.
            this._unsubProfile = userProfile.subscribe((p) => {
                this.profileLud16 = p?.lud16 ?? ''
                this.profileNip05 = p?.nip05 ?? ''
                if (!this.addressTouched) {
                    this.addressInput = this.profileLud16
                }
            })
            // pubkey wird async aus localStorage hydratisiert (welshman `sync`) —
            // erst abwarten, sonst liest loadWallet() bei hartem Reload direkt auf
            // /settings/wallet einen leeren pubkey und eine verbundene Wallet erschiene
            // fälschlich als „nicht verbunden" (nostrAuth.init guardet dasselbe Muster).
            await ensureAuthReady()
            // `profileReady` gated „Nicht gesetzt" gegen den Lade-Flash — aber an den
            // ABGESCHLOSSENEN Lade-VERSUCH gekoppelt, nicht an ein vorhandenes Profil:
            // welshman hält `userProfile` für Nutzer OHNE kind-0 (gast-first, frisches
            // nsec) ewig `undefined` → sonst bliebe „Nicht gesetzt" für sie für immer
            // aus und die „Aktuell:"-Zeile leer. loadUserProfile() resolved nach dem
            // Relay-Versuch (mit oder ohne Ergebnis).
            void loadUserProfile().finally(() => {
                this.profileReady = true
            })
            // destroy() kann während `await ensureAuthReady()` gelaufen sein (schnelles wire:navigate);
            // dann NICHT mehr abonnieren, sonst leakt die Handle-Sub auf einer toten Komponente.
            if (this._destroyed) {
                return
            }
            // NIP-05-Verifikation (Diagnose): welshman löst nostr.json↔pubkey live auf und
            // liefert nur bei bestätigtem Match einen Handle → genau die Bedingung, die das
            // Member-Relay zum Publishen verlangt. Der Store emittiert erst `undefined` und
            // re-emittiert nach dem nostr.json-Fetch (800 ms-Batch + Netz). `profileReady`
            // wird aber schon nach dem kind-0-Laden true — deshalb `nip05Settled`: erst wenn
            // verifiziert ODER der Settle-Timeout abgelaufen ist, gilt die Prüfung als fertig.
            // Sonst blitzte „unverifiziert" bei EINEM gültigen NIP-05-Nutzer auf (Review-Fund).
            const pk = get(pubkey)
            if (pk) {
                this._unsubHandle = deriveHandleForPubkey(pk).subscribe((handle) => {
                    this.nip05Verified = Boolean(handle)
                    if (handle) {
                        this.nip05Settled = true
                    }
                })
                this._nip05Timer = setTimeout(() => {
                    this.nip05Settled = true
                }, 6000)
            } else {
                this.nip05Settled = true
            }
            // WebLN wird evtl. erst nach dem Factory-Aufruf injiziert → hier re-evaluieren.
            this.weblnAvailable = Boolean(getWebLn())
            const wallet = await loadWallet()
            if (wallet) {
                this._apply(wallet)
                void this.refreshBalance()
            }
        },
        _apply(w: Wallet) {
            this.connected = true
            this.walletType = w.type
            this.lud16 = getWalletAddress(w) ?? ''
            this.relayUrl = w.type === WalletType.NWC ? w.info.relayUrl : ''
        },
        async connectNwc() {
            if (this.busy) {
                return
            }
            this.busy = true
            this.error = ''
            try {
                const url = this.connectUrl.trim()
                if (!url.startsWith('nostr+walletconnect://')) {
                    throw new Error(t('Ungültige Verbindung (nostr+walletconnect://…)'))
                }
                const { nwc } = await getNwcModule()
                const client = new nwc.NWCClient({ nostrWalletConnectUrl: url })
                const info = await client.getInfo() // validiert die Verbindung
                if (!info) {
                    throw new Error(t('Wallet nicht erreichbar'))
                }
                const wallet: Wallet = { type: WalletType.NWC, info: client.options as unknown as NWCInfo }
                await saveWallet(wallet)
                this._apply(wallet)
                this.connectUrl = ''
                toast(t('Wallet verbunden'), 'success')
                void this.refreshBalance()
            } catch (e) {
                this.error = e instanceof Error ? e.message : t('Verbindung fehlgeschlagen')
                toast(this.error)
            } finally {
                this.busy = false
            }
        },
        async connectWebln() {
            if (this.busy) {
                return
            }
            this.busy = true
            this.error = ''
            try {
                const webln = getWebLn()
                if (!webln) {
                    throw new Error(t('Keine WebLN-Erweiterung gefunden'))
                }
                await webln.enable()
                const info = await webln.getInfo()
                if (!info?.supports?.includes('lightning')) {
                    throw new Error(t('Erweiterung unterstützt kein Lightning'))
                }
                const wallet: Wallet = { type: WalletType.WebLN, info }
                await saveWallet(wallet)
                this._apply(wallet)
                toast(t('Wallet verbunden'), 'success')
            } catch (e) {
                this.error = e instanceof Error ? e.message : t('Verbindung fehlgeschlagen')
                toast(this.error)
            } finally {
                this.busy = false
            }
        },
        async disconnect() {
            await clearWallet()
            this.connected = false
            this.walletType = ''
            this.lud16 = ''
            this.relayUrl = ''
            this.balanceSats = null
            toast(t('Wallet getrennt'), 'success')
        },
        async refreshBalance() {
            if (this.walletType !== WalletType.NWC) {
                return
            }
            try {
                const res = await getWalletBalance()
                this.balanceSats = fromMsats(res.balance)
            } catch {
                // Balance-Fehler tolerant — Hero zeigt dann keinen Betrag.
                this.balanceSats = null
            }
        },
        openSend() {
            this.payReq = ''
            this.payAmountSats = null
            this.error = ''
            dispatchModal('wallet-send')
        },
        async sendPayment() {
            if (this.paying) {
                return
            }
            this.paying = true
            this.error = ''
            try {
                const req = this.payReq.trim()
                if (!req) {
                    throw new Error(t('Rechnung oder Lightning-Adresse eingeben'))
                }
                const isBolt11 = /^ln(bc|tb)/i.test(req)
                let invoice = req
                if (!isBolt11) {
                    if (!this.payAmountSats || this.payAmountSats <= 0) {
                        throw new Error(t('Betrag (Sats) eingeben'))
                    }
                    invoice = await lnurlInvoice(req, this.payAmountSats)
                }
                const { Invoice } = await import('@getalby/lightning-tools/bolt11')
                const parsed = new Invoice({ pr: invoice })
                // Betragslose bolt11 braucht einen expliziten Betrag — sonst ginge 0 msats
                // an payInvoice (dort falsy → kein amount → NWC lehnt kryptisch ab).
                if (parsed.satoshi <= 0 && (!this.payAmountSats || this.payAmountSats <= 0)) {
                    throw new Error(t('Betrag (Sats) eingeben'))
                }
                // Betragslose bolt11 → msats mitgeben (WebLN kann das nicht, payInvoice wirft).
                await payInvoice(invoice, parsed.satoshi > 0 ? undefined : (this.payAmountSats ?? 0) * 1000)
                toast(t('Gesendet: :sats Sats', { sats: formatNumber(parsed.satoshi || this.payAmountSats || 0) }), 'success')
                this.payReq = ''
                this.payAmountSats = null
                dispatchModal('wallet-send', false)
                void this.refreshBalance()
            } catch (e) {
                this.error = e instanceof Error ? e.message : t('Zahlung fehlgeschlagen')
                toast(this.error)
            } finally {
                this.paying = false
            }
        },
        openReceive() {
            this.recvAmountSats = null
            this.recvMemo = ''
            this.recvInvoice = ''
            this.recvQr = ''
            this.error = ''
            dispatchModal('wallet-receive')
        },
        async createReceiveInvoice() {
            if (this.receiving) {
                return
            }
            this.receiving = true
            this.error = ''
            try {
                if (!this.recvAmountSats || this.recvAmountSats <= 0) {
                    throw new Error(t('Betrag (Sats) eingeben'))
                }
                const pr = await createInvoice({
                    sats: this.recvAmountSats,
                    description: this.recvMemo || t('Empfangen via Lightning'),
                })
                this.recvInvoice = pr
                this.recvQr = await QRCode.toDataURL(pr.toUpperCase(), { width: 256, margin: 1 })
                toast(t('Rechnung erstellt'), 'success')
            } catch (e) {
                this.error = e instanceof Error ? e.message : t('Rechnung fehlgeschlagen')
                toast(this.error)
            } finally {
                this.receiving = false
            }
        },
        displayRelay() {
            return displayRelayUrl(this.relayUrl)
        },
        // Z4 — verbundenes Wallet liefert eine lud16, die von einer BEREITS GESETZTEN
        // Profil-Empfangsadresse abweicht (Hinweis „übernehmen?"). Ohne Profil-Adresse
        // kein „andere Adresse"-Banner (widerspräche „Nicht gesetzt"); WebLN hat keine
        // lud16 → false. (flotilla-Guard: profil UND wallet UND ungleich.)
        addressMismatch() {
            return Boolean(this.profileLud16) && Boolean(this.lud16) && this.lud16 !== this.profileLud16
        },
        useWalletAddress() {
            if (this.lud16) {
                this.addressInput = this.lud16
                this.addressTouched = true
            }
        },
        async saveReceivingAddress() {
            if (this.savingAddress) {
                return
            }
            this.savingAddress = true
            this.error = ''
            this.saveResults = []
            try {
                const results = await publishReceivingAddress(this.addressInput, get(userSpaceUrls))
                this.saveResults = results
                const accepted = results.filter((r) => r.ok)
                const rejected = results.filter((r) => !r.ok)
                // Ebene 2: mind. EIN Relay akzeptiert ⇒ das kind-0 IST veröffentlicht.
                // Nur wenn KEIN Relay annimmt, ist es ein echter Fehlschlag.
                if (accepted.length === 0) {
                    this.showDiag = true
                    throw new Error(t('Auf keinem Relay gespeichert — Details in der Diagnose.'))
                }
                this.addressTouched = false
                if (rejected.length > 0) {
                    // Teil-Erfolg: gespeichert, aber ein Relay (i. d. R. das Member-Relay
                    // mit NIP-05-Pflicht) hat abgelehnt. Diagnose aufklappen, damit der User
                    // sieht, WO und WARUM — und was zu tun ist (NIP-05-Hinweis unten).
                    this.showDiag = true
                    toast(t('Gespeichert auf :ok/:total Relays.', { ok: accepted.length, total: results.length }), 'success')
                } else {
                    // Voller Erfolg → nichts zu diagnostizieren: das (evtl. auto-geöffnete) Panel
                    // wieder schließen, damit es nur auftaucht, wenn es etwas zu sehen gibt.
                    this.showDiag = false
                    toast(t('Empfangsadresse gespeichert'), 'success')
                }
            } catch (e) {
                this.error = e instanceof Error ? e.message : t('Speichern fehlgeschlagen')
                toast(this.error)
            } finally {
                this.savingAddress = false
            }
        },
        nip05State() {
            if (!this.profileReady) {
                return 'pending'
            }
            if (this.nip05Verified) {
                return 'verified'
            }
            // NIP-05 gesetzt, aber noch nicht bestätigt UND die Prüfung läuft noch
            // (nostr.json-Fetch nicht durch) → „pending", nicht fälschlich „unverified".
            if (this.profileNip05 && !this.nip05Settled) {
                return 'pending'
            }
            return this.profileNip05 ? 'unverified' : 'missing'
        },
        // Hat ein Relay das Speichern konkret wegen fehlender NIP-05 abgelehnt? Dann
        // den gezielten Reparatur-Hinweis zeigen (statt nur der rohen Relay-Meldung).
        saveBlockedByNip05() {
            return this.saveResults.some((r) => !r.ok && /nip-?0?5/i.test(r.reason))
        },
        shortRelay(url: string) {
            return url.replace(/^wss?:\/\//, '').replace(/\/$/, '')
        },
        npubShort() {
            const pk = get(pubkey)
            if (!pk) {
                return ''
            }
            const npub = nip19.npubEncode(pk)
            return `${npub.slice(0, 12)}…${npub.slice(-6)}`
        },
        copyNpub() {
            const pk = get(pubkey)
            if (pk) {
                this.copy(nip19.npubEncode(pk), 'npub')
            }
        },
        // Der hex-Pubkey ist der Wert, der WÖRTLICH in die nostr.json (`names`-Map) gehört —
        // NICHT der npub. Genau das verlangt NIP-05 (welshman vergleicht names[name] === hex).
        pubkeyHexShort() {
            const pk = get(pubkey)
            return pk ? `${pk.slice(0, 10)}…${pk.slice(-8)}` : ''
        },
        copyPubkeyHex() {
            const pk = get(pubkey)
            if (pk) {
                this.copy(pk, t('Public Key (hex)'))
            }
        },
        /** Wie oben: `message` ist der FERTIGE Satz, nicht das Substantiv (P3). */
        copy(text: string, message: string) {
            if (text) {
                void navigator.clipboard?.writeText(text).then(() => toast(message, 'success'))
            }
        },
        destroy() {
            this._destroyed = true
            if (this._nip05Timer) {
                clearTimeout(this._nip05Timer)
            }
            this._unsubProfile?.()
            this._unsubHandle?.()
        },
    }))

    // Space/Room-Navigation (M2, Single-Space §12): lädt die 10009-Membership,
    // zieht die Room-Metas (39000) des AKTIVEN Space nach und spiegelt genau
    // diesen einen Space nach Alpine. Kein Multi-Space-Layout, keine Rail.
    // AUTH gegen zooid läuft automatisch (Signer aus der Session).
    Alpine.data('nostrSpaces', (): SpacesState => ({
        space: null,
        loading: true,
        gatedOut: false,
        // Tab aus der URL (?tab=…) übernehmen → Startseite ist direkt verlinkbar.
        //
        // Die Whitelist steht in `spacesTab.ts` und nicht hier: sie ist die Gegenprobe
        // zum `$watch` unten, der JEDEN Tab in die Adresse schreibt — `workspaces`
        // wurde geschrieben, aber nie gelesen, und ein geteilter Link landete still
        // auf „Räume". Seit P5 hat die Bar nur noch zwei Einträge; die alte Adresse
        // `?tab=workspaces` fängt eine SERVERSEITIGE Weiterleitung auf `/forge` ab
        // (`⚡spaces.blade.php`), damit sie nicht wortlos auf „Räume" fällt.
        tab: readSpacesTab(window.location.search),
        threads: [],
        isAdmin: false,
        isBuzz: false,
        roomForm: { h: '', name: '', about: '', picture: '', isPrivate: false, isClosed: false, isHidden: false, isRestricted: false },
        _roomEditing: false,
        _roomIconFile: null,
        roomSaving: false,
        pendingRoomDelete: null,
        membersRoom: null,
        roomMembers: [],
        memberNpub: '',
        memberBusy: false,
        _unsubRoomMembers: null,
        meetups: {},
        _unsubMeetups: null,
        // Filterzustand aus der URL übernehmen — spiegelbildlich zu den $watch-Hooks in
        // init(). Ohne das war der Filter reiner Mount-State: aus einem Meetup-Raum
        // zurück landete man IMMER in der ungefilterten Standardliste, egal wie der
        // Zurück-Weg implementiert ist. Die URL ist der einzige Zustand, der eine
        // Navigation überlebt (Alpine wird bei wire:navigate neu aufgebaut).
        roomQuery: new URLSearchParams(window.location.search).get('q') ?? '',
        roomType: parseRoomType(new URLSearchParams(window.location.search).get('rt')),
        roomCountry: (new URLSearchParams(window.location.search).get('cc') ?? '').toUpperCase(),
        _url: null,
        _unsubView: null,
        _unsubActive: null,
        _unsubAccess: null,
        _unsubAdmin: null,
        _unsubIsBuzz: null,
        _unsubThreads: null,
        _controller: null,
        // Raumname zu einem h-Tag (aus den bereits geladenen Space-Räumen) — für die Thread-Liste.
        roomName(h: string): string {
            const rooms = [...(this.space?.userRooms ?? []), ...(this.space?.otherRooms ?? [])]
            return rooms.find((r) => r.h === h)?.name || h
        },
        // Praesentations-Join fuer die Kachel: room.meetupSlug → {flag, portalLink,
        // country, nextEventStart, …}. Null-sicher (Warm-Render: Join-Daten fehlen
        // kurz, bis die Portal-Liste geladen ist) → die Kachel rendert dann ohne Flagge.
        meetup(slug: string): MeetupPresentation | null {
            return (slug && this.meetups[slug]) || null
        },
        // ── P4: Raumübersicht — Standard-Räume default, Kategorien ein bewusster Schritt ─
        // Fokus-Modus = genau EINE Kategorie-Liste (Suche/Sort, Land nur wo es eins
        // gibt). Default sind die Standard-Räume (Meine · Andere); BEIDE Kategorien
        // öffnet je eine Entdecken-Zeile — die Projektunterstützung seit dem Umbau
        // vom 2026-07-27 genau wie die Meetups (vorher: Liste + „Alle anzeigen").
        // Kategorie-agnostisch — jede neue Kategorie erbt das Verhalten (P5).
        focusMode(): boolean {
            return isFocusMode(this.roomType)
        },
        // Die beiden konkreten Fokus-Modi. Getrennt von `focusMode()`, weil mehrere
        // Bausteine WIRKLICH „Meetups" meinen (Land-Filter, Meetup-Kacheln, Zähler)
        // und nicht „irgendein Fokus".
        meetupMode(): boolean {
            return this.roomType === 'meetups'
        },
        proposalMode(): boolean {
            return this.roomType === 'proposals'
        },
        // Land gibt es nur bei Meetups (Portal-Join). Antragsräume tragen keins →
        // im Antrags-Fokus verschwinden die Land-Bedienelemente ganz.
        countryFilterAvailable(): boolean {
            return supportsCountryFilter(this.roomType)
        },
        // Kategorie-Wechsel aus der UI: schaltet den Modus und wirft dabei einen
        // Filter weg, den die Zielkategorie nicht kennt — sonst bliebe ein Land-Chip
        // stehen, der im Antrags-Fokus nichts mehr filtert (stiller Geisterfilter).
        selectRoomType(type: RoomTypeFilter): void {
            this.roomType = type
            if (!supportsCountryFilter(type)) {
                this.roomCountry = ''
            }
        },
        // Gesamtzahl der Meetup-Räume (für die Entdecken-Karte). Unabhängig vom Filter.
        meetupCount(): number {
            return this._meetupPool(true).length
        },
        // Standard-Räume im Default-View (Meine + Andere ohne kategorisierte Räume) —
        // für den „Räume"-Tab-Zähler. Ehrlich: nicht die 304 Meetups mitzählen (die
        // stecken hinter der Entdecken-Zeile) und auch keine fremden Antragsräume
        // (Projektunterstützung). Auch der EIGENE Antragsraum zählt hier nicht mit:
        // er steht seit dem 2026-07-27 nicht mehr in „Meine Räume", sondern hinter
        // der Entdecken-Zeile — und was man nicht sieht, zählt man nicht. Sein
        // Ungelesenes ist trotzdem sichtbar (Pille an der Zeile, `proposalUnread()`)
        // und trotzdem in der Tab-Summe (`roomsTotal` faltet ALLE beigetretenen
        // Räume, kategorieblind).
        standardCount(): number {
            const mine = (this.space?.userRooms ?? []).filter((r) => !r.isProjectSupport).length
            const other = (this.space?.otherRooms ?? []).filter(isStandardRoom).length
            return mine + other
        },
        // Heimatland aus der BROWSER-Sprache (`navigator.language`, z. B. de-DE → DE)
        // für „mein Land zuerst". Bewusst NICHT die Oberflächensprache aus
        // `locale.ts`: die trägt keine Region (Laravel liefert `de`, nicht `de-DE`),
        // und wo jemand wohnt, ist eine andere Frage als in welcher Sprache er liest.
        myCountry(): string {
            return myCountryCode()
        },
        // ISO → Landesname (nativ, kein Datentable). '' → '', unbekannt → Code.
        countryName(iso: string): string {
            if (!iso) {
                return ''
            }
            return regionName(iso)
        },
        countryFlag(iso: string): string {
            return flagEmoji(iso)
        },
        // Nächster Termin → kurzes deutsches Datum („Heute"/„Morgen"/„Di, 4. Feb").
        fmtEventDate(iso: string): string {
            // `ms` statt `t`: `t` ist seit P2 der Übersetzungs-Helfer (`./i18n`),
            // eine lokale Bindung desselben Namens würde ihn hier verdecken.
            const ms = Date.parse(iso)
            if (!iso || Number.isNaN(ms)) {
                return ''
            }
            const d = new Date(ms)
            const startOfToday = new Date().setHours(0, 0, 0, 0)
            const day = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - startOfToday) / 86400000)
            if (day === 0) {
                return t('Heute')
            }
            if (day === 1) {
                return t('Morgen')
            }
            const fmt = dateFmt()
            return fmt ? fmt.format(d) : ''
        },
        // Termin innerhalb der nächsten 7 Tage (und nicht > 1h vergangen) → Akzent.
        isEventSoon(iso: string): boolean {
            const t = Date.parse(iso)
            if (!iso || Number.isNaN(t)) {
                return false
            }
            const diff = t - Date.now()
            return diff >= -3600000 && diff <= 7 * 86400000
        },
        _pres(room: RoomView): MeetupPresentation | null {
            return this.meetup(room.meetupSlug)
        },
        // Texttreffer auf Name ODER Stadt (Stadt kommt aus dem async Join → null-tolerant).
        _matches(room: RoomView, q: string): boolean {
            if (!q) {
                return true
            }
            return room.name.toLowerCase().includes(q) || (this._pres(room)?.city ?? '').toLowerCase().includes(q)
        },
        // Meetup-Pool: im Fokus alle (auch beigetretene), sonst nur entdeckbare.
        // Positiv-Filter auf `isMeetup` → Antragsräume (Projektunterstützung) landen
        // hier nie; der Pool und alles, was daran hängt (meetupCount, Länderliste),
        // bleibt von der neuen Kategorie unberührt.
        _meetupPool(all: boolean): RoomView[] {
            const other = (this.space?.otherRooms ?? []).filter((r) => r.isMeetup)
            if (!all) {
                return other
            }
            const mine = (this.space?.userRooms ?? []).filter((r) => r.isMeetup)
            return [...mine, ...other]
        },
        // Antragsräume (Projektunterstützung) — der Pool HINTER der Entdecken-Zeile
        // und zugleich die Liste des Antrags-Fokus. Wer Mitglied ist (userRooms),
        // sieht seinen Antragsraum IMMER; FREMDE Antragsräume (otherRooms) bekommt
        // nur der Space-Admin (Vorstand) zu sehen. Dedupliziert über `h`, falls ein
        // Raum in beiden Listen auftaucht.
        //
        // Die eigenen bleiben ABSICHTLICH im Pool, obwohl sie in „Meine Räume"
        // schon stehen: dieselbe Doppelung wie bei den Meetups (beigetreten oben,
        // im Fokus nochmal). Der Fokus beantwortet „welche Anträge gibt es", nicht
        // „welche kenne ich noch nicht".
        _proposalPool(): RoomView[] {
            const mine = (this.space?.userRooms ?? []).filter((r) => r.isProjectSupport)
            if (!this.isAdmin) {
                return mine
            }
            const seen = new Set(mine.map((r) => r.h))
            const other = (this.space?.otherRooms ?? []).filter((r) => r.isProjectSupport && !seen.has(r.h))
            return [...mine, ...other]
        },
        // Gesamtzahl der für mich sichtbaren Antragsräume (ungefiltert) — steuert,
        // ob die Entdecken-Zeile existiert, und trägt ihre Umfangszeile.
        proposalCount(): number {
            return this._proposalPool().length
        },
        // Ungelesene Ereignisse HINTER der Entdecken-Zeile — die Pille, die den
        // Zähler der ausgeblendeten Antrags-Zeilen rettet.
        //
        // Eine TEILSUMME derselben `rooms`-Karte, aus der auch jede Zeilen-Pille und
        // die Tab-Pille lesen (`sumUnreadRooms`, node-getestet). Keine zweite
        // Ableitung über die Events: die Zahl an der Zeile ist damit per Konstruktion
        // ein Teil von `roomsTotal` und kann nie darüber liegen.
        //
        // Über den ganzen Pool gefaltet, nicht nur über die eigenen: fremde
        // Antragsräume (Vorstandsblick) haben gar keinen Schlüssel — `computeUnread`
        // Regel 1 vergibt einen nur für beigetretene Räume — und steuern deshalb 0
        // bei, ohne dass es hier eine zweite Rollen-Abfrage braucht.
        proposalUnread(): number {
            return sumUnreadRooms(
                unreadStore?.rooms,
                this._proposalPool().map((room) => room.h),
            )
        },
        // Datensignatur für die Filter-Memoisierung: ändert sich, sobald Filter,
        // die Räume ODER der Meetup-Join wechseln → dann (und nur dann) neu rechnen.
        // Die Getter laufen pro Render mehrfach; ohne Cache würde die 304er-Liste
        // je Tastendruck vielfach neu sortiert.
        //
        // Die Raum-Anteile sind FINGERABDRÜCKE über alle Felder (roomFingerprint.ts),
        // nicht bloß Längen: eine Umbenennung (9002 → neues 39000) ändert weder die
        // Anzahl noch einen Zeitstempel — mit reinen Längen blieb der alte Name bis
        // zum Reload stehen (Anlegen/Löschen fielen nie auf, die ändern die Länge).
        // `lastMessageAt` steckt als Raum-Feld mit drin, die Live-Sortierung nach
        // eingehenden Nachrichten bricht den Cache also weiterhin.
        _dataSig(): string {
            const s = this.space
            return [
                this.roomQuery.trim().toLowerCase(),
                this.roomCountry,
                this.roomType,
                // Der Antragsraum-Pool hängt an der Admin-Rolle (fremde Anträge nur
                // für den Vorstand), also gehört sie in den Schlüssel. `isAdmin` kommt
                // asynchron nach; im Kaltstart (Räume aus dem IndexedDB-Cache sofort,
                // Rolle erst nach dem Relay-Roundtrip) ist es der EINZIGE Teil, der
                // sich dann noch ändert. Im Normalfall bricht die Raum-Signatur den
                // Cache ohnehin mit — der E2E-Lauf bleibt deshalb auch ohne dieses Bit
                // grün; festgenagelt ist es in `roomFingerprint.test.ts` („allein
                // kippendes isAdmin bricht den Schlüssel").
                this.isAdmin ? 'a' : '-',
                roomsFingerprint(s?.userRooms as RoomLike[] | undefined),
                roomsFingerprint(s?.otherRooms as RoomLike[] | undefined),
                Object.keys(this.meetups).length,
            ].join('|')
        },
        _ensureFiltered() {
            const key = this._dataSig()
            if (_roomFilterCache && _roomFilterCache.key === key) {
                return _roomFilterCache
            }
            const q = this.roomQuery.trim().toLowerCase()
            const cc = this.roomCountry
            // Antragsräume raus aus „Meine Räume" — auch die BEIGETRETENEN. Sie
            // gehören ausschließlich hinter die Entdecken-Zeile (Nutzerentscheidung
            // 2026-07-27: „nicht zu den Haupt-Meine-Räume beigemischt"). Beigetretene
            // MEETUPS bleiben hier bewusst drin (dezentes Flaggen-Badge, gleiche
            // Zeilenhöhe) — sie sind Räume wie andere, ein Antrag ist ein Vorgang.
            //
            // Damit verschwindet eine Zeile, die eine Ungelesen-Pille tragen KANN
            // (beigetreten ⇒ Schlüssel in `computeUnread`). Der Zähler wandert
            // deshalb an die Entdecken-Zeile: `proposalUnread()`.
            const mineRooms = (this.space?.userRooms ?? []).filter((room) => !room.isProjectSupport && this._matches(room, q))
            const otherRooms = (this.space?.otherRooms ?? []).filter((room) => isStandardRoom(room) && this._matches(room, q))
            const meetupRows = this._meetupPool(true).filter((room) => {
                if (cc && this._pres(room)?.country !== cc) {
                    return false
                }
                return this._matches(room, q)
            })
            // Sortierung (Brief): primär letzte eingehende Nachricht (neueste zuerst),
            // sekundär alphabetisch. Robust: fehlt lastMessageAt (frische Räume / bis die
            // Datenschicht das Feld live liefert), fallen alle auf den Alphabet-Zweig.
            meetupRows.sort((a, b) => {
                const ta = lastMsgAt(a)
                const tb = lastMsgAt(b)
                if (ta !== tb) {
                    return tb - ta
                }
                return a.name.localeCompare(b.name, 'de')
            })
            // Antragsräume: alphabetisch — es sind wenige, und ein stabiler Platz
            // schlägt hier eine Aktivitäts-Sortierung, die die Zeilen springen lässt.
            const proposalRows = this._proposalPool()
                .filter((room) => this._matches(room, q))
                .sort((a, b) => a.name.localeCompare(b.name, 'de'))
            _roomFilterCache = { key, mine: mineRooms, meetups: meetupRows, other: otherRooms, proposals: proposalRows }
            return _roomFilterCache
        },
        // Real vertretene Länder (aus dem Gesamt-Pool), meins zuerst, dann nach Anzahl.
        // Memoisiert auf Pool-/Join-Größe: baut den Index nur neu, wenn Räume/Join wachsen.
        availableCountries() {
            const key = [this.space?.otherRooms.length ?? 0, this.space?.userRooms.length ?? 0, Object.keys(this.meetups).length, this.myCountry()].join('|')
            if (_countryCache && _countryCache.key === key) {
                return _countryCache.list
            }
            const by = new Map<string, number>()
            for (const room of this._meetupPool(true)) {
                const cc = this._pres(room)?.country
                if (cc) {
                    by.set(cc, (by.get(cc) ?? 0) + 1)
                }
            }
            const mine = this.myCountry()
            const list = Array.from(by.entries())
                .map(([country, count]) => ({ country, count, flag: flagEmoji(country), name: this.countryName(country) }))
                .sort(
                    (a, b) =>
                        (a.country === mine ? -1 : b.country === mine ? 1 : 0) ||
                        b.count - a.count ||
                        a.name.localeCompare(b.name, 'de'),
                )
            _countryCache = { key, list }
            return list
        },
        // Gefilterte + sortierte Meetup-Liste (mein Land → nächster Termin → Name).
        filteredMeetups(): RoomView[] {
            return this._ensureFiltered().meetups
        },
        /**
         * „Meine Räume", nach Typ untergliedert — die mobile Fassung des
         * Gruppenschnitts, den der Desktop-Navigator schon fährt.
         *
         * Die Regel selbst liegt in `railGroups.ts` (`splitMine`, node-getestet)
         * und wird hier nur angewandt: derselbe Schnitt an zwei Orten, nicht zwei
         * Algorithmen für dieselbe Frage. Unter der Schwelle oder bei nur einem
         * vorkommenden Typ kommt genau EINE Sektion zurück — dann sieht der Nutzer
         * exakt das, was er vorher sah.
         *
         * KEINE Sortierung, kein Filter, keine Kappung hier: `filteredMine()` hat
         * beides bereits erledigt, und eine zweite Stelle, die daran dreht, wäre
         * genau die zweite Wahrheit, die dieser Schnitt vermeidet.
         */
        mineSections(): { key: 'rooms' | 'meetups'; rooms: RoomView[] }[] {
            return splitMine(this.filteredMine())
        },
        /**
         * Wie viele Räume könnte die Standardliste zeigen — OHNE Suchtext.
         *
         * Die Zahl entscheidet, ob das Suchfeld erscheint, und muss deshalb
         * unabhängig von der Suche sein: an `filteredMine()` gemessen verschwände
         * das Feld, sobald es wirkt, und der Nutzer verlöre mitten im Tippen sein
         * Werkzeug. Dieselbe Kategorien-Regel wie im Filter, nur ohne `_matches`.
         */
        standardRoomTotal(): number {
            const mine = (this.space?.userRooms ?? []).filter((room) => !room.isProjectSupport)
            const other = (this.space?.otherRooms ?? []).filter((room) => isStandardRoom(room))

            return mine.length + other.length
        },
        /**
         * Ab 10 Zeilen bekommt die Standardliste ein Suchfeld.
         *
         * Nicht ab 8 (dem rechnerischen Break-even aus „7 sichtbare Zeilen + 1 Zeile
         * Eigenkosten"): bei 8 käme und ginge das Feld bei jedem Beitritt oder
         * Austritt, und ein Bedienelement, das erscheint und verschwindet, kostet
         * mehr Orientierung als es an Weg spart.
         *
         * Ab xl gibt es das Feld nicht — dort trägt der Navigator seinen `#`-Prompt,
         * der obendrein über ALLE Gruppen und beide Spaces sucht.
         */
        showRoomSearch(): boolean {
            return this.standardRoomTotal() >= 10
        },
        filteredMine(): RoomView[] {
            return this._ensureFiltered().mine
        },
        filteredOther(): RoomView[] {
            return this._ensureFiltered().other
        },
        filteredProposals(): RoomView[] {
            return this._ensureFiltered().proposals
        },
        // Aktive, entfernbare Filter im Fokus-Modus (Suche + Land). Der Modus selbst
        // ist kein „Filter"-Chip — man verlässt ihn über „Räume anzeigen". Das Land
        // zählt nur, wo es überhaupt filtert (nicht im Antrags-Fokus).
        activeFilterCount(): number {
            return (this.roomQuery.trim() ? 1 : 0) + (this.roomCountry && this.countryFilterAvailable() ? 1 : 0)
        },
        // Land togglen; eine Landwahl setzt zugleich den Meetup-Modus — nur Meetups
        // tragen ein Land, ein Land IST also die Meetup-Auswahl.
        selectCountry(iso: string): void {
            this.roomCountry = this.roomCountry === iso ? '' : iso
            if (this.roomCountry) {
                this.roomType = 'meetups'
            }
        },
        resetRoomFilters(): void {
            this.roomQuery = ''
            this.roomCountry = ''
            this.roomType = DEFAULT_ROOM_TYPE
        },
        // Sichtbare Räume über die aktuell eingeblendeten Sektionen — trägt den
        // Ergebnis-Zähler im Fokus-Kopf und den „keine Treffer"-Leerzustand.
        // Rooms-Modus: Meine+Andere; Fokus: genau die eine Liste.
        //
        // Die Anträge sind aus dem Default-Zweig RAUS (2026-07-27) — sie stehen dort
        // nicht mehr als Liste, sondern hinter einer Entdecken-Zeile, exakt wie die
        // Meetups (die aus demselben Grund nie mitzählten). Auch die beigetretenen:
        // `filteredMine()` filtert sie, der Zähler zählt also weiterhin genau die
        // Zeilen, die untendrunter stehen. Der Zähler misst SICHTBARE ZEILEN, nicht
        // Erreichbares — sonst stünde „7 Räume" über einer Liste mit fünf.
        visibleCount(): number {
            if (this.proposalMode()) {
                return this.filteredProposals().length
            }
            if (this.meetupMode()) {
                return this.filteredMeetups().length
            }
            return this.filteredMine().length + this.filteredOther().length
        },
        // ── P4: Raum-Verwaltung (Admin, NIP-29 9007/9002/9008) ─────────────────
        openRoomCreate() {
            // `h` EINMALIG minten (retry-sicher): schlägt ein Publish-Schritt fehl, füllt
            // ein erneutes Speichern denselben Raum weiter, statt einen zweiten anzulegen.
            // `newRoomId` liefert eine UUIDv4 — Buzz übernimmt nur die (siehe dort).
            this.roomForm = { h: newRoomId(), name: '', about: '', picture: '', isPrivate: false, isClosed: false, isHidden: false, isRestricted: false }
            this._roomEditing = false
            this._roomIconFile = null
            dispatchModal('room-form')
        },
        // Bearbeiten: alle Felder + Flags aus der RoomView vorbelegen (die einzeln
        // getragenen Flags verhindern, dass ein Speichern bestehende wegwirft).
        openRoomEdit(room: RoomView) {
            this.roomForm = {
                h: room.h,
                name: room.name,
                about: room.about,
                picture: room.picture,
                isPrivate: room.isPrivate,
                isClosed: room.isClosed,
                isHidden: room.isHidden,
                isRestricted: room.isRestricted,
            }
            this._roomEditing = true
            this._roomIconFile = null
            dispatchModal('room-form')
        },
        // Raumbild wählen: Datei merken + roomForm.picture als data-URL-Vorschau; der
        // echte Upload läuft erst in saveRoom (Abbrechen lädt nichts). `input.value`
        // leeren, damit dieselbe Datei erneut wählbar bleibt (wie pickSpaceIcon).
        pickRoomPicture(input: HTMLInputElement) {
            const file = input.files?.[0]
            input.value = ''
            if (!file || !file.type.startsWith('image/')) {
                return
            }
            this._roomIconFile = file
            const reader = new FileReader()
            reader.onload = (e) => {
                this.roomForm.picture = String(e.target?.result ?? '')
            }
            reader.readAsDataURL(file)
        },
        // Speichern: neues Bild vorher hochladen, dann anlegen (h leer) oder bearbeiten.
        // Der Live-Sub (watchSpaceRooms) reflektiert das relay-signierte 39000 selbst.
        async saveRoom() {
            const url = this._url
            if (!url || this.roomSaving || !this.roomForm.name.trim()) {
                return
            }
            this.roomSaving = true
            const editing = this._roomEditing
            try {
                if (this._roomIconFile) {
                    const uploaded = await uploadAttachment(this._roomIconFile)
                    this.roomForm.picture = uploaded.url
                    // Datei-Referenz lösen: bei einem Retry liegt die URL schon in
                    // roomForm.picture → kein zweiter Upload (Blossom ist ohnehin
                    // content-addressed, aber der Sign+Upload-Roundtrip entfällt).
                    this._roomIconFile = null
                }
                const input: RoomInput = { ...this.roomForm, name: this.roomForm.name.trim(), about: this.roomForm.about.trim() }
                const err = editing ? await editRoomMeta(url, input) : await createRoom(url, input)
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('room-form', false)
                    toast(editing ? t('Raum gespeichert.') : t('Raum erstellt.'), 'success')
                }
            } catch {
                toast(t('Speichern fehlgeschlagen.'))
            } finally {
                this.roomSaving = false
            }
        },
        askDeleteRoom(room: RoomView) {
            this.pendingRoomDelete = room
            dispatchModal('delete-room')
        },
        async confirmDeleteRoom() {
            const room = this.pendingRoomDelete
            if (!room || !this._url || this.roomSaving) {
                return
            }
            this.roomSaving = true
            try {
                const err = await deleteRoom(this._url, room.h)
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('delete-room', false)
                    this.pendingRoomDelete = null
                }
            } finally {
                this.roomSaving = false
            }
        },
        // Raum-Mitglieder (P4b): live-Liste der 39002 des Raums, +hinzufügen/-entfernen.
        openRoomMembers(room: RoomView) {
            this._unsubRoomMembers?.()
            this.membersRoom = room
            this.roomMembers = []
            this.memberNpub = ''
            if (this._url) {
                this._unsubRoomMembers = deriveRoomMemberViews(this._url, room.h).subscribe((m: RoomMemberView[]) => {
                    this.roomMembers = m
                })
            }
            dispatchModal('room-members')
        },
        closeRoomMembers() {
            this._unsubRoomMembers?.()
            this._unsubRoomMembers = null
            this.membersRoom = null
        },
        // Hinzufügen per npub/hex: erst Space-Zulassung (allowpubkey), dann Raum-Beitritt
        // (kind 9000). Ein noch nicht zugelassener Fremder wird so in EINEM Schritt Mitglied.
        async addRoomMemberByNpub() {
            const room = this.membersRoom
            const raw = this.memberNpub.trim()
            if (!room || !this._url || this.memberBusy || !raw) {
                return
            }
            let pubkey = ''
            try {
                pubkey = raw.startsWith('npub') ? (nip19.decode(raw).data as string) : /^[0-9a-f]{64}$/.test(raw) ? raw : ''
            } catch {
                pubkey = ''
            }
            if (!pubkey) {
                toast(t('Kein gültiger npub / Pubkey.'))
                return
            }
            this.memberBusy = true
            try {
                const allowErr = await addSpaceMember(this._url, pubkey)
                if (allowErr) {
                    toast(allowErr)
                    return
                }
                const err = await addRoomMember(this._url, room.h, pubkey)
                if (err) {
                    toast(err)
                } else {
                    this.memberNpub = ''
                }
            } finally {
                this.memberBusy = false
            }
        },
        // Entfernen: kind 9001 (remove-user) → der Live-Sub aktualisiert die 39002-Liste.
        async kickRoomMember(pubkey: string) {
            const room = this.membersRoom
            if (!room || !this._url || this.memberBusy) {
                return
            }
            this.memberBusy = true
            try {
                const err = await removeRoomMember(this._url, room.h, pubkey)
                if (err) {
                    toast(err)
                }
            } finally {
                this.memberBusy = false
            }
        },
        init() {
            // ── Rückweg aus einem Workspace-Raum ──────────────────────────────────
            // Diese Seite IST der Vereins-Space. Wer hierher zurückkommt — über den
            // Kopf-Pfeil, die Bottom-Nav oder einen Deep-Link — hat den Workspace
            // verlassen, also fällt der ephemere Space weg. Ohne diesen Aufruf zeigte
            // die Raumliste nach einem Besuch im Workspace weiter dessen Räume, und der
            // Nutzer käme nur über die Einstellungen zurück.
            //
            // Steht VOR dem `activeSpace.subscribe` unten: sonst liefe der Aufbau einmal
            // mit der Workspace-URL an und die Liste flackerte.
            clearEphemeralSpace()
            // Filter-Caches (Modul-Scope) beim (Re-)Mount leeren → keine Stale-Arrays
            // aus einer vorherigen Space-Navigation.
            _roomFilterCache = null
            _countryCache = null
            // Tab-Wechsel in die URL spiegeln (replaceState, keine Navigation) → verlinkbar,
            // Reload/Share landen im gleichen Tab. Default „rooms" ohne Param (sauberere URL).
            const syncTabParam = (v: string): void => {
                const u = new URL(window.location.href)
                if (v === DEFAULT_SPACES_TAB) {
                    u.searchParams.delete(SPACES_TAB_PARAM)
                } else {
                    u.searchParams.set(SPACES_TAB_PARAM, v)
                }
                window.history.replaceState(window.history.state, '', u)
            }
            // EINMAL beim Mount, mit dem Wert, den `readSpacesTab` durchgelassen hat.
            // Sonst bliebe ein verworfener Parameter in der Adresse stehen: wer einen
            // `?tab=workspaces`-Link auf einem Client OHNE Workspace öffnet, sähe die
            // Räume, während die Adressleiste weiter „workspaces" behauptet — und
            // teilte diesen Link erneut. Der `$watch` allein räumt das nicht auf, er
            // feuert erst bei einer ÄNDERUNG. Ein `replaceState` auf denselben Wert ist
            // im Normalfall ein No-op; `window.history.state` wird dabei unverändert
            // durchgereicht, Livewires Eintrag bleibt also erhalten.
            syncTabParam(this.tab)
            ;(this as unknown as { $watch(p: string, cb: (v: string) => void): void }).$watch('tab', syncTabParam)
            // Dasselbe für den Filterzustand (Modus/Suche/Land): NUR replaceState, nie
            // pushState — ein eigener History-Eintrag pro Tastendruck im Suchfeld wäre
            // eine Zurück-Falle, und pushState auf einem Livewire-Eintrag löst beim
            // Zurück den kalten Insel-Reboot aus (siehe openThread, gleiche Begründung).
            // Kurze Parameternamen (rt/q/cc), weil sie an jeder Raum-URL mitlaufen.
            const syncFilterParam = (key: string, value: string, isDefault: boolean): void => {
                const u = new URL(window.location.href)
                if (isDefault) {
                    u.searchParams.delete(key)
                } else {
                    u.searchParams.set(key, value)
                }
                window.history.replaceState(window.history.state, '', u)
            }
            const watch = this as unknown as { $watch(p: string, cb: (v: string) => void): void }
            // Jede Kategorie außer dem Default steht in der URL (`rt=meetups`,
            // `rt=proposals`) → Fokus ist verlinkbar und überlebt Reload/Zurück.
            watch.$watch('roomType', (v: string) => syncFilterParam('rt', v, v === DEFAULT_ROOM_TYPE))
            watch.$watch('roomQuery', (v: string) => syncFilterParam('q', v.trim(), v.trim() === ''))
            watch.$watch('roomCountry', (v: string) => syncFilterParam('cc', v, v === ''))
            loadUserGroupList()?.finally(() => {
                this.loading = false
            })
            // Aktiver Space → dessen Rooms als LIVE-Sub abonnieren (Wechsel baut neu
            // auf). Live statt One-Shot: überlebt langsames NIP-42-AUTH → Räume
            // erscheinen auch, wenn der Signer erst spät bestätigt.
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this._url = url
                this._controller?.abort()
                this._controller = new AbortController()
                watchSpaceRooms(url, this._controller.signal)
                // Admin-Status (P4): gatet „+ Raum" + die Kachel-Aktionen.
                this._unsubAdmin?.()
                this._unsubAdmin = deriveUserIsSpaceAdmin(url).subscribe((admin: boolean) => {
                    this.isAdmin = admin
                })
                // Relay-Art des aktiven Space: gatet die Kachel-Aktionen, die es auf
                // Buzz nicht sinnvoll gibt (Löschen, Raum-Mitglieder — siehe
                // `room-tile.blade.php`). Reaktiv über das NIP-11-Doc, nicht synchron:
                // beim ersten Rendern ist das Profil noch unterwegs, ein synchroner
                // Blick meldete verlässlich „kein Buzz" und die Einträge blitzten auf.
                this._unsubIsBuzz?.()
                this._unsubIsBuzz = deriveRelay(url).subscribe((relay) => {
                    this.isBuzz = isBuzzRelay(relay)
                    // Sobald FESTSTEHT, dass der aktive Space ein Buzz-Relay ist: dessen
                    // relay-eigene kind-0 aus Repository und Cache werfen (siehe
                    // [[spaceProfiles]]). Buzz legt beim Onboarding eigene Profile an;
                    // kind 0 ist ersetzbar und der jüngste Zeitstempel gewinnt, also
                    // verdrängen sie app-weit das echte Nostr-Profil.
                    //
                    // Der Aufräumer hing zuerst in `loadMemberProfiles` — zu beiläufig:
                    // die Funktion läuft nur für Autoren, die in DIESER Sitzung noch
                    // nicht geladen waren. Das eigene Profil ist beim Login längst da,
                    // also lief der Aufräumer für genau den Fall nie, der auffiel.
                    if (this.isBuzz) {
                        purgeSpaceLocalProfiles(url)
                    }
                })
                // Threads-Übersicht des Space (C6b): Kommentare + Wurzeln laden, reaktiv anzeigen.
                this._unsubThreads?.()
                this._unsubThreads = deriveSpaceThreads(url).subscribe((t: SpaceThread[]) => {
                    this.threads = t
                })
                void loadSpaceThreads(url)
                // Vereins-Relay & kein Mitglied → die Räume liefert der Relay gar
                // nicht aus. „gatedOut" ersetzt die falsche „keine Räume"-Meldung.
                this._unsubAccess?.()
                this.gatedOut = false
                this._unsubAccess = deriveVereinAccess(url).subscribe((a: VereinAccess) => {
                    this.gatedOut = isVereinGatedOut(a)
                })
            })
            this._unsubView = activeSpaceView.subscribe((view: SpaceView) => {
                this.space = view
            })
            // Meetup-Praesentation EINMAL laden (fail-soft) und den Index reaktiv nach
            // Alpine spiegeln — die Kachel joint dann per room.meetupSlug.
            void loadMeetupPresentations()
            this._unsubMeetups = meetupPresentationBySlug.subscribe((bySlug: Map<string, MeetupPresentation>) => {
                this.meetups = Object.fromEntries(bySlug)
            })
        },
        destroy() {
            this._unsubActive?.()
            this._unsubView?.()
            this._unsubAccess?.()
            this._unsubAdmin?.()
            this._unsubIsBuzz?.()
            this._unsubThreads?.()
            this._unsubRoomMembers?.()
            this._unsubMeetups?.()
            this._controller?.abort()
        },
    }))

    /**
     * Die Workspace-Raumliste (`/forge`, Tab „Workspaces") — P5.
     *
     * Aus `nostrSpaces` hierher gezogen, Code unverändert bis auf die Namen: die Felder
     * hießen dort `workspaceRooms`/`workspaceLabel`/…, weil sie neben einem Dutzend
     * Feldern des Vereins-Space lagen und ein Präfix brauchten. In einer eigenen Insel
     * ist das Präfix Lärm.
     *
     * **Der Netzweg läuft, sobald `/forge` steht — nicht erst beim Tab-Klick.** Die
     * Seite spricht ohnehin ausschließlich mit diesem Relay; ein `x-if` am Panel würde
     * die Insel bei jedem Tab-Wechsel neu bauen und die Abos jedes Mal neu öffnen.
     * Deshalb `x-show` im Markup, wie bei den drei Geschwister-Tabs.
     */
    Alpine.data('nostrWorkspaceRooms', (): WorkspaceRoomsState => ({
        rooms: [],
        label: '',
        loading: true,
        muted: [],
        pinned: [],
        _view: null,
        _prefs: {},
        _controller: null,
        _unsub: null,
        _unsubPrefs: null,
        init() {
            // Ohne konfigurierten Workspace gibt es nichts zu holen — und `/forge`
            // rendert diese Insel dann gar nicht erst (Server-Gate in der Blade). Der
            // Riegel hier ist der zweite Boden gegen einen REQ ohne Ziel.
            if (!hasWorkspace()) {
                this.loading = false

                return
            }
            this._controller = new AbortController()
            watchSpaceRooms(WORKSPACE_URL, this._controller.signal)
            this._unsub = deriveSpaceViewFor(WORKSPACE_URL).subscribe((view: SpaceView) => {
                // Beigetretene zuerst, danach die entdeckbaren — in EINER Liste, ohne
                // Kategorie-Abschnitte. Die Reihenfolge INNERHALB der beiden Hälften
                // bestimmt der in Buzz Desktop gesetzte Sortiermodus
                // (`buildWorkspaceList`).
                this._view = view
                this.label = view.label
                this.loading = false
                this._apply()
            })
            // Kanal-Präferenzen (NIP-78). Diese Fläche ist unterhalb von `xl` die
            // einzige Raumliste des Workspace — die Rail existiert erst darüber.
            this._unsubPrefs = subscribeWorkspacePrefs((prefs: WorkspacePrefs) => {
                this._prefs = prefs
                this._apply()
            })
        },
        destroy() {
            this._unsub?.()
            this._unsubPrefs?.()
            this._controller?.abort()
        },
        /**
         * Die Liste aus Rohsicht + Präferenzen neu bauen.
         *
         * Läuft aus BEIDEN Quellen, weil beide unabhängig voneinander nachziehen: die
         * Räume über `watchSpaceRooms`, die Präferenzen über einen eigenen REQ nach
         * NIP-42-AUTH. Wer nur eine Seite abonniert, zeigt die halbe Wahrheit — meist
         * die ohne Präferenzen, weil sie schneller da ist.
         */
        _apply() {
            const view = this._view
            if (!view) {
                return
            }
            const list = buildWorkspaceList<WorkspaceRoomView>([
                ...view.userRooms.map((r) => ({ ...r, joined: true })),
                ...view.otherRooms.map((r) => ({ ...r, joined: false })),
            ], this._prefs)
            this.rooms = list.rooms
            this.muted = list.muted
            this.pinned = list.pinned
        },
        /**
         * Stummgeschaltet? Gelesen aus der fertigen Liste, nicht neu gerechnet —
         * dieselbe Aufteilung wie in der Rail (`rail.ts isMuted`): das Markup stellt
         * diese Frage EINMAL PRO ZEILE.
         */
        isMuted(room: RoomView) {
            return this.muted.includes(room.h)
        },
        /** Angeheftet? Trägt das Nadel-Icon der Zeile — dieselbe Quelle wie {@link isMuted}. */
        isPinned(room: RoomView) {
            return this.pinned.includes(room.h)
        },
        /**
         * Einen Workspace-Raum öffnen: aktiven Space auf die Workspace-URL stellen und
         * dorthin navigieren. Die 13 Bridge-Komponenten hängen alle an `activeSpace` und
         * ziehen von selbst nach — deshalb ist hier keine weitere Verdrahtung nötig.
         *
         * **`setActiveSpaceEphemeral`, nicht `setActiveSpace`.** Der reguläre Setzer
         * schreibt die Wahl in den localStorage. Für einen Workspace-Raum wäre das eine
         * Falle: nach einem Absturz oder einem harten Reload startete die App im
         * Workspace statt im Vereins-Space, ohne dass der Nutzer das je gewählt hätte.
         * Der Vereins-Space bleibt die persistierte Wahl; der Workspace gilt nur für
         * diese Sitzung.
         *
         * **Die Sitzung ist aber nicht die ganze Wahrheit** — der ephemere Zustand
         * überlebt keinen Reload. Deshalb trägt das Ziel die Zuordnung selbst:
         * {@link roomHref}. Ohne sie stand nach F5 in einem Workspace-Raum wieder das
         * Vereins-Relay als aktiver Space, der Beitritt (9021) ging dorthin und kam als
         * `invalid: group not found` zurück.
         */
        openRoom(room: RoomView) {
            setActiveSpaceEphemeral(WORKSPACE_URL)
            // Die Navigation macht die Blade (`Livewire.navigate`), wie bei der
            // normalen Raum-Kachel — dieses Modul kennt Livewire nicht.
            void room
        },
        /** Ziel der Workspace-Kachel: `/rooms/{h}?space=workspace` (siehe spaceParam.ts). */
        roomHref(room: RoomView) {
            return workspaceRoomHref(room.h)
        },
    }))

    // ── Benachrichtigungen „Neu" (/updates, P4) ────────────────────────────────
    //
    // Screen-Zustand, nichts weiter: die ZEILEN rechnet `updates.ts` fertig (inklusive
    // `href` mit `?from=updates`), das Ordnen/Kappen/Beschriften macht das reine
    // `updatesView.ts`. Hier lebt nur, was ohne Browser nicht geht — Subscriptions,
    // Nachladen, Navigation, Timer.
    //
    // Warum Data-Komponente und nicht Store: der Ungelesen-ZUSTAND (Punkt an drei Orten)
    // gilt über alle Screens und liegt deshalb in `Alpine.store('unread')`; Filter,
    // Seitenlänge und Undo-Frist gelten nur, solange dieser eine Screen offen ist.
    Alpine.data('nostrUpdates', (): UpdatesState => {
        // Der Undo-Puffer liegt ABSICHTLICH in der Closure und nicht als Feld: Alpine
        // proxifiziert jedes Feld, und ein Proxy, der über setRead/writeRows in einen
        // `structuredClone` läuft, endet in DataCloneError. Reaktiv muss ohnehin nur die
        // Frist sein (`_undoUntil`), nicht die Karte.
        let undoSnapshot: ReadState | null = null
        return {
            feed: 'all',
            limit: UPDATES_PAGE,
            loading: true,
            error: '',
            items: [],
            _undoUntil: 0,
            _undoTimer: null,
            _url: '',
            _controller: null,
            _unsubActive: null,
            _unsubItems: null,
            init() {
                // Filterwechsel setzt die Seitenlänge zurück: „Ältere anzeigen" gilt für
                // die Ansicht, die man gerade sieht, nicht für alle drei Tabs zusammen.
                ;(this as unknown as { $watch(p: string, cb: () => void): void }).$watch('feed', () => {
                    this.limit = UPDATES_PAGE
                })
                this._unsubActive = activeSpace.subscribe((url: string) => {
                    this._url = url
                    // Space-Wechsel: erst leeren, dann neu ableiten — sonst blieben die
                    // Zeilen des alten Space bis zum ersten Emit des neuen stehen (gleiche
                    // Regel wie im `unread`-Store).
                    this._unsubItems?.()
                    this.items = []
                    this.limit = UPDATES_PAGE
                    // Räume (39000/9008) + Mitgliedschaften (39002) selbst abonnieren.
                    // OHNE das ist die Liste beim kalten Direkteinstieg (Reload, Bookmark,
                    // geteilter Link) STRUKTURELL leer: `computeUpdates` filtert hart auf
                    // die beigetretenen Räume (Regel 5), und der Screen zeigte „Alles
                    // gelesen" — eine Falschaussage. Über die Glocke fiel das nicht auf,
                    // weil `nostrSpaces` vorher geladen hatte. Live-Sub statt One-Shot aus
                    // demselben Grund wie dort: überlebt langsames NIP-42-AUTH.
                    this._controller?.abort()
                    this._controller = new AbortController()
                    watchSpaceRooms(url, this._controller.signal)
                    this._unsubItems = deriveUpdates(url, joinedRoomHs, joinedRoomNames).subscribe((items: UpdateItem[]) => {
                        this.items = items
                        // Autoren-Profile (kind 0) wärmen — sonst steht in der häufigsten
                        // Zeile der npub statt des Namens (§3.2 ②). `warmProfiles`
                        // entdoppelt intern, der Aufruf pro Emit ist deshalb billig; die
                        // Zeilen ziehen nach, weil `deriveUpdates` an `profilesByPubkey`
                        // hängt.
                        void warmProfiles(updateAuthors(items))
                    })
                    void this._load()
                })
            },
            destroy() {
                this._unsubActive?.()
                this._unsubItems?.()
                this._controller?.abort()
                this._closeUndo() // Timer UND Puffer — der Screen ist weg, die Frist auch
            },
            /**
             * Nachladen aus dem Space. Zwei Quellen, weil die Liste zwei Ereignisarten
             * führt: Raum-Aktivität (9/1068/9041) und Thread-Kommentare (1111 + Lotus'
             * kind 10, die tragen kein `#h` und fallen deshalb aus dem Raum-Filter).
             *
             * Die Reihenfolge ist lasttragend, nicht kosmetisch:
             *  1. Threads sofort anstoßen — sie brauchen weder Lesestand noch Raumliste.
             *  2. `readStateReady` ABWARTEN, bevor die Raum-Aktivität geladen wird:
             *     `loadRoomActivity` leitet sein `since` aus den Wasserzeichen ab. Ohne
             *     geladenen Lesestand wäre das `since` 1 und zöge den ganzen Bestand.
             *     Zugleich liefert `deriveUpdates` bis dahin bewusst eine leere Liste —
             *     der Skeleton darf also nicht vorher gegen „Alles gelesen" tauschen.
             *  3. Auf eine NICHT-leere Raumliste warten. Beim kalten Direkteinstieg sind
             *     die 39002 im ersten Emit noch nicht da; ein synchrones `get()` läse `[]`
             *     und `loadRoomActivity` setzte GAR KEINEN REQ ab (`feeds.ts`: keine
             *     Filter ⇒ `Promise.resolve([])`). `loading`/`error` entschieden sich dann
             *     aus einem Lauf, der nie stattgefunden hat.
             */
            async _load() {
                const url = this._url
                if (!url) {
                    this.loading = false
                    return
                }
                this.loading = true
                try {
                    const threads = loadSpaceThreads(url)
                    await readStateReady
                    const hs = await firstNonEmpty(joinedRoomHs)
                    await Promise.all([threads, loadRoomActivity(url, [...hs])])
                    this.error = ''
                } catch {
                    // Der Gerätespeicher trägt weiter — die Liste ist unvollständig, nicht
                    // falsch. Genau das sagt der Wortlaut (§3.5, Nielsen #1).
                    this.error = t('Der Space ist gerade nicht erreichbar. Ältere Hinweise stammen aus dem Gerätespeicher.')
                } finally {
                    this.loading = false
                }
            },
            /** Gibt es überhaupt etwas? Trägt den Untertitel im Kopf. */
            hasAny() {
                return this.items.length > 0
            },
            /**
             * Gibt es etwas zu quittieren? Trägt den „Alles"-Knopf — bewusst NICHT
             * `hasAny()`: gelesene Zeilen bleiben 24 h stehen, die Liste ist nach dem
             * Quittieren also nicht leer (Begründung in `hasUnreadUpdates`).
             */
            hasUnread() {
                return hasUnreadUpdates(this.items)
            },
            /**
             * Nichts SICHTBARES — der Schalter zwischen Liste und (Skeleton | Leerzustand).
             * Bewusst die gefilterte, gekappte Menge: unter „Erwähnungen" ohne Erwähnungen
             * muss der Leerzustand kommen, nicht eine leere Liste ohne jede Aussage.
             */
            isEmpty() {
                return visibleUpdates(this.items, this.feed, this.limit).length === 0
            },
            /**
             * Ist der FILTER der Grund für die Leere? Trennt die beiden Leerzustände
             * (§3.5): „nie was gewesen" vs. „hier nicht, woanders schon". Wird nur
             * innerhalb von {@link isEmpty} konsultiert, und die beiden Zustände hängen an
             * `isFiltered()` / `!isFiltered()` — sie können deshalb nie beide stehen.
             */
            isFiltered() {
                return this.feed !== 'all' && this.items.length > 0
            },
            hasMore() {
                return hasMoreUpdates(this.items, this.feed, this.limit)
            },
            groups() {
                return groupUpdates(visibleUpdates(this.items, this.feed, this.limit))
            },
            older() {
                this.limit = nextUpdatesLimit(this.limit)
            },
            /**
             * Zeile öffnen. `item.href` ist FERTIG (inkl. `?from=updates`) — hier wird
             * kein Ziel zusammengebaut, sonst gäbe es zwei Erzeuger für denselben Pfad.
             *
             * Verwaist → nichts. Die View schaltet den Knopf bereits per `:disabled` ab;
             * das hier ist der zweite Riegel für den Weg über Tastatur/AT/Programm.
             */
            open(item: UpdateItem) {
                if (item.orphan) {
                    return
                }
                ;(window as unknown as { Livewire: { navigate(u: string): void } }).Livewire.navigate(item.href)
            },
            retry() {
                this.error = ''
                void this._load()
            },
            resetFeed() {
                this.feed = 'all'
                this.limit = UPDATES_PAGE
            },
            /**
             * „Alles gelesen" — mit Rückweg (§8, verbindlich): erst die Karte puffern,
             * dann das globale Wasserzeichen setzen. Ohne Puffer wäre die Aktion
             * irreversibel und bräuchte einen Bestätigungsdialog; der Puffer ist die
             * bessere Wahl (Nielsen #3).
             *
             * Ein ZWEITER Klick innerhalb der Frist behält den ERSTEN Puffer
             * ({@link undoSnapshotFor}) und startet nur die Frist neu — sonst sicherte er
             * als „vorher" den bereits quittierten Zustand, und das Rückgängig ließe nur
             * `{all: …}` übrig.
             */
            markAllRead() {
                undoSnapshot = undoSnapshotFor(undoSnapshot, snapshotReadState())
                if (this._undoTimer) {
                    clearTimeout(this._undoTimer)
                }
                this._undoUntil = Date.now() + UNDO_WINDOW_MS
                // Der Timer lässt die Leiste von selbst verschwinden; die verbindliche
                // Frist ist trotzdem `_undoUntil` (siehe undoMarkAll) — ein gestreckter
                // Timer darf das Zeitfenster nicht verlängern.
                this._undoTimer = setTimeout(() => this._closeUndo(), UNDO_WINDOW_MS)
                markAllReadWatermark()
            },
            /**
             * Ob die Leiste STEHT. Die Frist wird gerechnet, nicht nur getimt: ein
             * gedrosselter Hintergrund-Tab streckt `setTimeout` erheblich.
             *
             * Das allein gattet aber nur die ANZEIGE — und auch die nur, wenn Alpine den
             * Ausdruck überhaupt neu auswertet (`Date.now()` ist keine reaktive
             * Abhängigkeit). Wer den Klick abwehren will, muss ihn im Klick prüfen:
             * {@link undoMarkAll}.
             */
            canUndo() {
                return undoStillOpen(this._undoUntil, Date.now())
            },
            /** Puffer, Frist und Timer in EINEM Schritt schließen — die drei gehören zusammen. */
            _closeUndo() {
                if (this._undoTimer) {
                    clearTimeout(this._undoTimer)
                    this._undoTimer = null
                }
                this._undoUntil = 0
                undoSnapshot = null
            },
            /**
             * Rückgängig — mit eigener Fristprüfung ({@link undoClickAction}), nicht im
             * Vertrauen darauf, dass die Leiste rechtzeitig verschwunden ist. Ein später
             * Klick räumt nur noch auf.
             *
             * `restoreReadState` ERSETZT die Karte, statt Werte zurückzuschreiben —
             * `setRead` ist monoton und bekäme das `all`-Wasserzeichen nie wieder herunter
             * (Begründung im Docstring dort).
             */
            undoMarkAll() {
                const action = undoClickAction(this._undoUntil, Date.now(), undoSnapshot !== null)
                const snapshot = undoSnapshot
                this._closeUndo()
                if (action === 'restore' && snapshot) {
                    void restoreReadState(snapshot)
                }
            },
            labelFor(item: UpdateItem) {
                return updateAriaLabel(item)
            },
            /**
             * Zählt, was gerade STEHT (gefiltert + gekappt) — nicht die Gesamtmenge und
             * schon gar nichts Ungelesenes: eine Ungelesen-Zahl ist eine Behauptung über
             * das Wasserzeichen und bis P6 gesperrt (Begründung in `updatesSubtitle`).
             */
            subtitleText() {
                return updatesSubtitle(visibleUpdates(this.items, this.feed, this.limit), this.isFiltered())
            },
        }
    })

    /**
     * Die Ortskarten-Leiste (P5) — **nur die drei Zahlen**, sonst nichts.
     *
     * Orte, Links und Aktiv-Zustand stehen im Server-Markup
     * (`components/ortskarten.blade.php`). Diese Insel beantwortet genau eine Frage je
     * Karte: „gibt es dazu eine Zahl?".
     *
     * ── Warum das NACH dem ersten Paint läuft und nicht im `init` ──────────────────
     *
     * Die Leiste ist Navigation, ihre Zahlen sind Beiwerk. Sie steht auf `/spaces` über
     * dem Raum-Feed, auf `/articles` über der Artikelliste und auf `/forge` über dem
     * Forge-Baum — überall über dem, wofür der Nutzer gekommen ist. Ein `import()` plus
     * REQ im `init` konkurrierte mit genau dieser Fläche um Netz und Hauptstrang.
     *
     * Der Auslöser ist deshalb `requestIdleCallback` mit einer harten Obergrenze
     * ({@link ORTSKARTEN_NACHLADE_MS}) für Browser, deren Hauptstrang nie ruhig wird —
     * und für Safari, das `requestIdleCallback` bis heute nicht kennt (dort greift
     * unmittelbar der `setTimeout`-Zweig).
     *
     * ── Was die Zahlen NICHT tun ──────────────────────────────────────────────────
     *
     * Sie warten nicht, sie blinken nicht, und sie verschwinden nicht wieder. Bleibt ein
     * Relay stumm, bleibt der Wert `null` und die statische Unterzeile stehen — die Regel
     * dafür ist `zeigeLive` (`ortskarten.ts`), geprüft, und sie gilt für alle drei Karten
     * gleich. `0` fällt ausdrücklich darunter.
     *
     * ── Die Kosten, offen benannt ─────────────────────────────────────────────────
     *
     * `artikelZahl` kostet einen REQ auf den Board-Relay (kind 30023, `ARTICLE_LOAD_LIMIT`)
     * — denselben, den `/articles` ohnehin fährt; wer dort landet, hat ihn schon.
     * `repoZahl` hängt an `subscribeForgeNav`, das modulweit idempotent ist und auf
     * `/forge` und in der Desktop-Rail ohnehin läuft. Auf `/spaces` sind das zwei REQs,
     * die es vorher nicht gab. Das ist der Preis der Live-Zeilen, und er ist der Grund
     * für die Leerlauf-Verzögerung oben.
     */
    Alpine.data('nostrOrtskarten', (): OrtskartenState => ({
        artikelZahl: null,
        repoZahl: null,
        _dead: false,
        _idle: 0,
        _unsubArtikel: null,
        _unsubForge: null,
        init() {
            // `requestIdleCallback` existiert nicht überall (Safari). Der Rückfall ist
            // KEIN sofortiges Laden, sondern derselbe Aufschub per `setTimeout` — sonst
            // wäre ausgerechnet der Browser ohne Leerlauf-API der, der am aggressivsten
            // lädt.
            const ric = (window as unknown as {
                requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
            }).requestIdleCallback
            this._idle = ric
                ? ric(() => this._nachladen(), { timeout: ORTSKARTEN_NACHLADE_MS })
                : (setTimeout(() => this._nachladen(), ORTSKARTEN_NACHLADE_MS) as unknown as number)
        },
        destroy() {
            this._dead = true
            if (this._idle) {
                const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
                if (cic) {
                    cic(this._idle)
                } else {
                    clearTimeout(this._idle)
                }
                this._idle = 0
            }
            this._unsubArtikel?.()
            this._unsubForge?.()
            this._unsubArtikel = null
            this._unsubForge = null
        },
        _nachladen() {
            this._idle = 0
            if (this._dead) {
                return
            }
            // Zwei unabhängige Zweige, bewusst NICHT in einem `Promise.all` und bewusst
            // ohne gemeinsamen Ausstieg: fällt der eine aus, soll der andere trotzdem
            // seine Zahl liefern. Fehler bleiben stumm — eine fehlende Beiwerk-Zahl ist
            // kein Ereignis, über das jemand unterrichtet werden müsste; die statische
            // Zeile trägt weiter.
            //
            // **Kein Chunk ohne Quelle.** `longformFeed` zieht `markdown-it` nach (gemessen
            // 116 kB roh / 50 kB gzip als eigener Chunk). Ohne konfigurierten Board-Relay
            // hat `loadArticles` nichts zu tun (`BOARD_URL` ist dort der Riegel) — dann
            // wäre der Download reine Kosten. Die Frage wird HIER gestellt und nicht im
            // Modul, weil die Antwort sonst erst nach dem Herunterladen feststünde.
            // Dieselbe Quelle wie `BOARD_URL` selbst: `window.__nostrBoard` aus
            // `partials/head.blade.php`, also aus `config('group.board_relay_url')`.
            // `if` und NICHT `return`: ein früher Ausstieg nähme dem Forge-Zweig darunter
            // seinen Lauf mit, und der hat mit dem Board nichts zu tun.
            if ((window as { __nostrBoard?: string }).__nostrBoard) {
                void import('./longformFeed.ts')
                    .then((feed) => {
                        if (this._dead) {
                            return
                        }
                        this._unsubArtikel = throttled(ORTSKARTEN_DROSSEL_MS, feed.deriveArticles()).subscribe(
                            (rows: ArticleRow[]) => {
                                this.artikelZahl = rows.length
                            },
                        )
                        void feed.loadArticles().catch(() => undefined)
                    })
                    .catch(() => undefined)
            }

            // `subscribeForgeNav` STATISCH importiert, anders als `longformFeed`: die
            // Insel-Registrierung `wireForge` hängt ohnehin an `forge.ts`, das Modul liegt
            // also längst im `app`-Chunk. Ein `import()` daneben täuschte eine
            // Code-Trennung vor, die es nicht gibt — Rolldown meldet das als
            // INEFFECTIVE_DYNAMIC_IMPORT und legt das Modul trotzdem in denselben Chunk.
            // Aufgeschoben wird hier ohnehin nicht der DOWNLOAD, sondern das ABO; das
            // erledigt der Leerlauf-Rückruf oben. `subscribeForgeNav` schaltet den Netzweg
            // selbst scharf (idempotent, modulweit) und tut ohne konfigurierten Workspace
            // gar nichts.
            //
            // ── WAS DIESE VIER ZEILEN KOSTEN, gemessen (P5, 2026-08-21) ───────────────
            //
            // Playwright-Socket-Mitschnitt auf `/spaces`, 8 s nach dem Mount, gegen einen
            // lokalen Buzz-Stack; zwischen den Ständen jeweils voller Rebuild:
            //
            //   Fenster < xl (1279 px, keine Rail)   mit:  1 Socket · 7 REQ · 1 AUTH
            //                                        ohne: 0 Sockets · 0 REQ · 0 AUTH
            //   Fenster ≥ xl (1440 px, mit Rail)     mit:  2 Sockets · 12 REQ · 1 AUTH
            //                                        ohne: 2 Sockets · 12 REQ · 1 AUTH
            //
            // Oberhalb `xl` also **null Aufpreis**: die Desktop-Rail ruft `subscribeForgeNav`
            // ohnehin auf, und der Netzweg ist modulweit idempotent. Unterhalb `xl` — wo es
            // keine Rail gibt — kostet die Zahl „7 Repos" eine zweite Relay-Verbindung mit
            // einer NIP-42-AUTH-Runde auf der wichtigsten Fläche des Clients.
            //
            // **Zum Vergleich der Stand VOR P5:** dort fuhr der Workspaces-Tab auf `/spaces`
            // 2 Sockets · 7 REQ · 1 AUTH. Diese Fläche ist mit den vier Zeilen hier also
            // immer noch billiger als vorher, nicht teurer.
            //
            // **Soll die Zahl weg, ist das GENAU DIESE Zuweisung** (`this._unsubForge = …`).
            // Fällt sie, bleibt in der Forge-Karte die statische Unterzeile „Repos" stehen —
            // die Regel dafür (`zeigeLive`) trägt den Fall bereits, es ist kein Umbau.
            // `_unsubForge` bleibt dann dauerhaft `null`, `destroy()` verträgt das.
            this._unsubForge = subscribeForgeNav((data) => {
                this.repoZahl = data.repos.length
            })
        },
        ungelesen() {
            // Räume UND Threads: die Karte führt an den Ort „Chat", und der hat beide
            // Ebenen. Bewusst nicht `$store.unread.updates` — das ist die Glocke, also
            // eine andere Menge (siehe die Begründung am Glocken-Marker).
            const store = Alpine.store('unread') as { roomsTotal?: number; threadsTotal?: number } | undefined

            return (store?.roomsTotal ?? 0) + (store?.threadsTotal ?? 0)
        },
        zeigt(wert: number | null) {
            return zeigeLive(wert)
        },
    }))

    /**
     * Artikelliste (P7, `/articles`) — Longform vom Board-Relay.
     *
     * Dünn mit Absicht: Filter, Rendering und `naddr` liegen in `longform.ts` (rein) und
     * `longformFeed.ts` (welshman). Hier bleibt nur der Bildschirm-Zustand.
     *
     * **Kein Zustand in `nostrRoomChat`** — diese Fläche hat mit dem Raum-Chat nichts zu
     * tun und teilt mit ihm keinen einzigen Wert.
     *
     * ── Warum die Fachmodule per `import()` kommen ─────────────────────────────────
     *
     * `longformFeed.ts` zieht `markdown-it` nach, und das sind gemessene **50 kB
     * gzip** (`gzip -9c` auf das ausgelieferte Browser-Bundle des Pakets). Statisch
     * importiert lägen sie im `app`-Chunk, den JEDE Seite lädt — für einen Screen, den
     * die meisten Sitzungen nie öffnen. Als dynamischer Import entsteht daraus ein
     * eigener Chunk, der genau hier geholt wird.
     *
     * **Sichtbar kostet das nichts:** die Fläche startet ohnehin im Ladezustand, und der
     * Chunk ist da, lange bevor der Relay antwortet. Der Preis ist ein Zustand mehr
     * (`_dead`) — ein `wire:navigate` weg von der Seite kann das `destroy()` vor die
     * aufgelöste Zusage schieben, und ohne den Riegel abonnierte ein Screen, der gar
     * nicht mehr existiert.
     *
     * Ob überhaupt eine Quelle konfiguriert ist, entscheidet die **Blade-Seite** (Server);
     * ohne Quelle wird diese Insel gar nicht erst gerendert. Die Prüfung auf `BOARD_URL`
     * hier ist nur der Riegel dagegen, dass ein REQ ohne Ziel rausgeht.
     */
    Alpine.data('nostrArticles', (base: unknown, sorts: unknown): ArticlesState => {
        // Bewusst in der Closure statt als Feld: Alpine legt jedes Feld in einen
        // reaktiven Proxy, und ein Proxy über ein Modul-Namensraum-Objekt ist teuer und
        // sinnlos — reaktiv muss hier nichts davon sein. Gleiche Begründung wie beim
        // Undo-Puffer in `nostrUpdates`.
        let feed: typeof import('./longformFeed.ts') | null = null
        // Die Projektion trägt ihren Faltungs-Merker (siehe `articleList.ts`). Ein Screen,
        // ein Merker — mit `destroy()` ist er weg, ohne dass jemand ihn leeren muss.
        let list: ArticleListProjector | null = null
        // Die Ordnungen kommen ÜBERSETZT aus Blade, wo `__()` die Request-Locale sieht.
        // Ebenfalls in der Closure: sie ändern sich nie, ein reaktiver Proxy darüber wäre
        // reine Kosten. Dieselbe Haltung wie bei den Platzhaltern in `⚡spaces.blade.php`.
        const sortOptions = (Array.isArray(sorts) ? sorts : []) as ArticleSortOption[]

        return {
            loading: true,
            error: '',
            items: [],
            query: '',
            sort: DEFAULT_ARTICLE_SORT,
            cards: [],
            _base: String(base ?? '').replace(/\/+$/, ''),
            _dead: false,
            _controller: null,
            _unsub: null,
            init() {
                this._controller = new AbortController()
                // Suchtext und Ordnung sind die zwei EINZIGEN Auslöser neben dem Store.
                // Kein `x-effect` und keine Methode im Markup: so gibt es genau eine
                // Berechnung je Änderung, und sie ist im Quelltext auffindbar.
                // Die Cast-Schreibweise ist Hausmuster (`nostrSpaces`, `⚡spaces`):
                // Alpine reicht `$watch` erst zur Laufzeit an, der Zustandstyp kennt es
                // nicht.
                const watch = this as unknown as { $watch(prop: string, cb: () => void): void }
                watch.$watch('query', () => this._project())
                watch.$watch('sort', () => this._project())
                void this._boot()
            },
            /**
             * Fachmodul holen und die Quelle aufziehen.
             *
             * **Das `try` um den Import ist kein Zierrat.** Zwei reale Wege enden hier in
             * einer Ablehnung: (1) eine kaputte `NOSTR_BOARD_URL` — `normalizeRelayUrl`
             * wirft `TypeError: Invalid URL` im Modul-Toplevel von `longformFeed.ts`, und
             * der Server fängt das NICHT ab, weil sein Gate auf LEER prüft und eine
             * kaputte URL nicht leer ist; (2) ein Chunk, der nach einem Deploy nicht mehr
             * liegt. Ohne diesen Riegel lief die Ablehnung an `_load()` samt seinem
             * try/catch vorbei ins Leere (`void this._boot()` ohne `.catch`), und der
             * Bildschirm blieb dauerhaft im Skeleton — im Zustand also, der nichts sagt
             * und nichts anbietet, obwohl zwei Zeilen weiter ein Callout mit
             * Retry-Knopf steht.
             */
            async _boot() {
                try {
                    // Beide Fachmodule in EINEM Zug: sie landen ohnehin in demselben
                    // Chunk (`articleList.ts` importiert `longform.ts`, das auch
                    // `longformFeed.ts` zieht), und ein zweites `await` hintendran wäre
                    // ein zweiter Weg, auf dem `_dead` dazwischenkommen kann.
                    const [feedModule, listModule] = await Promise.all([
                        import('./longformFeed.ts'),
                        import('./articleList.ts'),
                    ])
                    feed = feedModule
                    list = listModule.createArticleList()
                } catch {
                    if (!this._dead) {
                        this.error = t('Die Artikel sind gerade nicht erreichbar.')
                        this.loading = false
                    }

                    return
                }
                if (this._dead) {
                    return
                }
                if (feed.BOARD_URL === '') {
                    this.loading = false

                    return
                }
                // Die Liste hängt am Store, nicht am Ergebnis des `load` — die Artikel
                // erscheinen, sobald sie da sind, und der Autorname zieht nach, wenn das
                // kind-0 eintrifft. Ein einmaliges Auslesen nach dem `await` wäre genau
                // der Schnappschuss, der P6b zurückgeworfen hat.
                this._unsub = feed.deriveArticles().subscribe((rows: ArticleRowMitMetriken[]) => {
                    this.items = rows
                    this._project()
                })
                await this._load()
            },
            destroy() {
                this._dead = true
                this._unsub?.()
                this._controller?.abort()
            },
            async _load() {
                if (!feed) {
                    return
                }
                this.loading = true
                try {
                    const outcome = await feed.loadArticles(this._controller?.signal)
                    // **Ein schweigender Relay ist kein leerer Relay.** `load()` wirft
                    // nicht, wenn niemand antwortet — es löst mit einer leeren Liste auf.
                    // Ohne diese Zeile stünde „Noch keine Artikel." über einem Relay, mit
                    // dem nie gesprochen wurde (Begründung und Messtabelle bei
                    // `LoadOutcome`). Nur wenn auch nichts im Speicher liegt: alles, was
                    // schon da ist, ist mehr wert als eine Fehlerzeile darüber.
                    this.error = outcome.complete || !this.isEmpty() ? '' : t('Die Artikel sind gerade nicht erreichbar.')
                } catch {
                    // Wortlaut wie auf `/updates`: die Liste ist UNVOLLSTÄNDIG, nicht
                    // falsch — was schon im Repository liegt, steht weiter da.
                    this.error = t('Die Artikel sind gerade nicht erreichbar.')
                } finally {
                    this.loading = false
                }
            },
            /**
             * Bestand, Suchtext und Ordnung zu Karten verrechnen — der EINE Ort, an dem
             * das passiert.
             *
             * Vor dem aufgelösten Import gibt es keine Projektion; `cards` bleibt dann
             * leer, und das Markup zeigt in diesem Moment ohnehin sein Skeleton.
             */
            _project() {
                this.cards = list ? list.cards(this.items, this.query, this.sort) : []
            },
            /**
             * Ist der BESTAND leer? — nicht die Trefferliste.
             *
             * Die Unterscheidung trägt zwei verschiedene Leerzustände: „Noch keine
             * Artikel." ist eine Aussage über den Relay, „Keine Artikel gefunden." eine
             * über die Suche. Sie zu vermischen hieße, dem Nutzer zu sagen, es gebe
             * nichts, obwohl 104 Artikel danebenliegen.
             */
            isEmpty() {
                return this.items.length === 0
            },
            /** Ziel der Zeile. Leerer `naddr` (Artikel ohne `d`) ⇒ kein Link. */
            href(row: ArticleRow) {
                return row.naddr ? `${this._base}/${row.naddr}` : ''
            },
            sortOptions() {
                return sortOptions
            },
            sortLabel() {
                return sortOptions.find((option) => option.value === this.sort)?.label ?? ''
            },
            hasFilter() {
                return this.query.trim() !== '' || this.sort !== DEFAULT_ARTICLE_SORT
            },
            clearFilters() {
                this.query = ''
                this.sort = DEFAULT_ARTICLE_SORT
            },
            /**
             * Erneut versuchen — und zwar am richtigen Punkt: kam der Fehler schon beim
             * Import, ist `feed` null und ein `_load()` täte gar nichts. Dann fängt der
             * Versuch beim Import an. (Ein Modul, das beim Auswerten geworfen hat, bleibt
             * fehlerhaft — der zweite Import lehnt wieder ab, und der Fehler steht dann
             * ehrlich wieder da, statt zu verschwinden.)
             */
            retry() {
                this.error = ''
                this._controller?.abort()
                this._controller = new AbortController()
                this.loading = true
                void (feed ? this._load() : this._boot())
            },
        }
    })

    /**
     * Ein einzelner Artikel (P7, `/articles/{naddr}`).
     *
     * Der kalte Direkteinstieg ist der Normalfall dieser Fläche — ein geteilter Link
     * trifft auf ein leeres Repository. Deshalb lädt sie IMMER nach und entscheidet über
     * „gibt es nicht" erst, wenn der Relay geantwortet hat.
     *
     * Der Fachcode kommt per `import()`, aus demselben Grund wie bei `nostrArticles`.
     */
    Alpine.data('nostrArticle', (naddr: unknown, base: unknown): ArticleState => {
        let feed: typeof import('./longformFeed.ts') | null = null

        return {
            loading: true,
            missing: false,
            error: '',
            article: null,
            lightboxSrc: null,
            canShare: false,
            lesefortschritt: 0,
            leseVerfolgbar: false,
            leseRestMinuten: 0,
            _naddr: String(naddr ?? ''),
            // Dieselbe Normalisierung wie in `nostrArticles._base`: `route()` liefert je
            // nach Konfiguration mit oder ohne Schrägstrich am Ende.
            _base: String(base ?? '').replace(/\/+$/, ''),
            _dead: false,
            _controller: null,
            _unsub: null,
            _leseAb: null,
            _leseFrame: 0,
            _leseGroesse: null,
            // ── P7 ──────────────────────────────────────────────────────────────────
            // **Einmal beim Mount, nicht als Ausdruck im Markup.** Wer angemeldet ist,
            // ändert sich innerhalb einer Artikelansicht nicht: der Login führt über
            // `/nostr-login` und endet auf `/spaces`, diese Seite wird dabei neu geladen.
            angemeldet: false,
            reagiert: false,
            kommentarEntwurf: '',
            kommentarLaeuft: false,
            kommentarFehler: '',
            init() {
                this._controller = new AbortController()
                this.angemeldet = Boolean(pubkey.get())
                // **Einmal beim Mount festgestellt, nicht bei jedem Rendern.** `canShare`
                // ist eine Eigenschaft des Browsers und ändert sich innerhalb einer
                // Sitzung nicht; ein Ausdruck im Markup liefe bei jedem Alpine-Durchlauf.
                // `navigator.share` fehlt auf jedem Desktop-Firefox und in jedem
                // unsicheren Kontext — dort bleibt „Link kopieren" der einzige Weg, und
                // das ist kein Mangel, sondern der Normalfall.
                this.canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
                this._leseBeobachten()
                this._leseAnHeften()
                void this._boot()
            },
            /**
             * Den Lesefortschritt an die beiden Flächen hängen, die scrollen können.
             *
             * **Unterhalb `xl` scrollt das Dokument, ab `xl` die Bühne** (`app-shell`
             * setzt dort `xl:overflow-y-auto` auf `main`). Ein Zuhörer am `window` allein
             * verpasste den zweiten Fall vollständig: `scroll` steigt von einem Element
             * NICHT auf. Mit `capture: true` läuft das Ereignis dagegen auf dem Weg NACH
             * UNTEN durch das Fenster — ein Zuhörer, zwei Flächen, kein Wissen darüber,
             * welche gerade die scrollende ist.
             *
             * `resize` deckt die Drehung des Geräts und das Ein-/Ausblenden der
             * Browser-Leiste ab; beides ändert die Fensterhöhe und damit die Strecke.
             */
            _leseBeobachten() {
                if (typeof window === 'undefined') {
                    return
                }
                const messen = (): void => this.messeLesefortschritt()
                window.addEventListener('scroll', messen, { capture: true, passive: true })
                window.addEventListener('resize', messen, { passive: true })
                this._leseAb = () => {
                    window.removeEventListener('scroll', messen, { capture: true })
                    window.removeEventListener('resize', messen)
                }
            },
            /**
             * Die HÖHE des Artikeltextes beobachten — und warum eine einmalige Messung
             * nicht reicht.
             *
             * Am ersten `$nextTick` nach dem Einsetzen steht das Markup zwar im DOM, aber
             * seine endgültige Höhe noch nicht: Bilder haben keine Maße, bis sie geladen
             * sind, die Hausschrift tauscht sich nach dem `font-display`-Wechsel aus, und
             * eingebettete Blossom-Bilder bekommen ihr `src` erst vom Hydrator. Eine
             * einzige Messung an dieser Stelle liefert deshalb eine zu kleine Höhe — und
             * damit **fälschlich „passt ins Fenster"**, also gar keine Leiste. In der
             * E2E-Suite ist genau das aufgetreten (120 Absätze, Leiste blieb aus); am
             * Entwicklungsrechner nicht, weil dort der Cache warm war.
             *
             * Ein `setTimeout` wäre die falsche Antwort — es wartet eine geratene Zeit und
             * ist danach wieder blind. Der `ResizeObserver` misst nach, sooft sich die
             * Höhe ändert, und hört auf, wenn sie steht.
             *
             * **Beobachtet wird die INSEL-Wurzel, nicht der Artikeltext.** Der erste
             * Entwurf hängte den Beobachter an `[data-artikel-text]` — und fand ihn beim
             * Aufsetzen nicht immer: das Element entsteht in einem `<template x-if>`, und
             * ob es zum Zeitpunkt des `$nextTick` schon steht, hängt an der Reihenfolge
             * der Alpine-Effekte. Fand er es nicht, hängte sich nie ein Beobachter ein und
             * die Leiste blieb dauerhaft aus — **gemessen in der E2E-Suite bei 1279 px,
             * während dieselbe Seite bei 1440 px funktionierte.** Ein Beobachter, dessen
             * Ziel erst noch entstehen muss, ist eine Wette; die Wurzel gibt es immer.
             */
            _leseAnHeften() {
                if (typeof ResizeObserver === 'undefined' || this._leseGroesse) {
                    return
                }
                this._leseGroesse = new ResizeObserver(() => this.messeLesefortschritt())
                this._leseGroesse.observe((this as unknown as AlpineMagics).$el)
            },
            /** Siehe die Begründung des `try` bei `nostrArticles._boot`. */
            async _boot() {
                try {
                    feed = await import('./longformFeed.ts')
                } catch {
                    if (!this._dead) {
                        this.error = t('Der Artikel ist gerade nicht erreichbar.')
                        this.loading = false
                    }

                    return
                }
                if (this._dead) {
                    return
                }
                this._unsub = feed.deriveArticle(this._naddr).subscribe((view: ArticleView | null) => {
                    this.article = view
                    if (view) {
                        // Steht der Artikel, ist die Frage beantwortet — auch wenn der
                        // `load` noch läuft (aus dem Kaltstart-Cache kann er schon da sein).
                        this.loading = false
                        this.missing = false
                        this.error = ''
                        // Der Text ist neu (oder zum ersten Mal) da — vorher hatte die
                        // Messung nichts zu messen. `$nextTick`, weil das Markup erst nach
                        // diesem Durchlauf im DOM steht; ohne ihn fände die Sonde ihr
                        // Ziel nicht und meldete korrekt „nicht verfolgbar" — dauerhaft.
                        ;(this as unknown as AlpineMagics).$nextTick(() => {
                            this._leseAnHeften()
                            this.messeLesefortschritt()
                        })
                    }
                })
                await this._load()
            },
            destroy() {
                this._dead = true
                this._unsub?.()
                this._controller?.abort()
                this._leseAb?.()
                this._leseGroesse?.disconnect()
                if (this._leseFrame) {
                    cancelAnimationFrame(this._leseFrame)
                    this._leseFrame = 0
                }
            },
            /**
             * Der Lesefortschritt — gemessen, nicht geschätzt.
             *
             * Gedrosselt über einen einzigen offenen `requestAnimationFrame`: ein
             * `scroll`-Ereignis feuert je Frame mehrfach, und `getBoundingClientRect`
             * erzwingt ein Layout. Ohne die Drosselung wäre genau das der Ruckler, den
             * eine Fortschrittsanzeige anzeigen soll, statt ihn zu verursachen.
             *
             * Die Rechnung selbst steht in `articleReader.ts` und ist dort unter
             * `node --test` festgenagelt — inklusive des Falls, der hier der Normalfall
             * ist: **ein Artikel, der kürzer ist als das Fenster.** 57 der 104 Artikel
             * haben nicht einmal eine Überschrift.
             */
            messeLesefortschritt() {
                if (this._leseFrame || typeof window === 'undefined') {
                    return
                }
                this._leseFrame = requestAnimationFrame(() => {
                    this._leseFrame = 0
                    if (this._dead) {
                        return
                    }
                    // **Fail-closed:** ist der Artikeltext (noch) nicht da, gibt es keine
                    // Messung — und dann auch keine Leiste. Eine Sonde, die für „nichts
                    // gefunden" eine 0 liefert, sähe wie „ganz oben" aus.
                    const text = (this as unknown as AlpineMagics).$el.querySelector('[data-artikel-text]')
                    if (!text) {
                        this.leseVerfolgbar = false
                        this.lesefortschritt = 0
                        this.leseRestMinuten = 0
                        return
                    }
                    const box = text.getBoundingClientRect()
                    const stand = leseFortschritt({
                        top: box.top,
                        height: box.height,
                        viewport: window.innerHeight,
                    })
                    this.leseVerfolgbar = stand.verfolgbar
                    this.lesefortschritt = stand.prozent
                    this.leseRestMinuten = restMinuten(this.article?.readingMinutes ?? 0, stand.prozent)
                })
            },
            /**
             * Drei Formen, ein Satz — die Signatur dieser Fläche.
             *
             * „14 Min Lesezeit" (noch nicht angefangen) · „noch 8 Min" (mittendrin) ·
             * „Ende erreicht" (die letzte Zeile ist sichtbar). Der dritte Zustand ersetzt
             * ein am laufenden Client gemessenes „noch 0 Min": die Zahl stimmte, sie las
             * sich aber wie ein Defekt.
             *
             * Der Satz sagt etwas über die POSITION, nicht über den Leser — „fertig
             * gelesen" wäre eine Behauptung über jemanden, der vielleicht nur nach unten
             * gesprungen ist.
             */
            lesestandText() {
                const gesamt = this.article?.readingMinutes ?? 0
                switch (lesestandForm(this.leseVerfolgbar, this.lesefortschritt, gesamt)) {
                    case 'ende':
                        return t('Ende erreicht')
                    case 'rest':
                        return t('noch :min Min', { min: String(this.leseRestMinuten) })
                    default:
                        return t(':min Min Lesezeit', { min: String(gesamt) })
                }
            },
            teilZiel() {
                return artikelTeilZiel(this._base, this.article?.naddr ?? '', this.article?.title ?? '')
            },
            /**
             * Ein Auslöser, drei Wege — und einer davon ist „geht nicht, und zwar darum".
             *
             * Der inerte Fall geht bewusst über einen TOAST und nicht über ein `title`:
             * ein Tooltip ist auf einem Telefon unerreichbar, und ein Knopf, der beim
             * Antippen einfach nichts tut, wird ein zweites Mal angetippt. Variante
             * `info`, nicht `danger` — es ist kein Fehlschlag, sondern eine Eigenschaft
             * dieses Artikels.
             */
            async teilenAusloesen() {
                const ziel = this.teilZiel()
                if (!ziel.teilbar) {
                    toast(t('Dieser Artikel hat keine Adresse — es gibt keinen Link zum Teilen.'), 'info')

                    return
                }
                if (this.canShare) {
                    await this.teilen()
                } else {
                    this.linkKopieren()
                }
            },
            /** Dasselbe inerte Muster wie beim Teilen — siehe {@link teilenAusloesen}. */
            keineLightningAdresse() {
                toast(t('Dieser Autor hat keine Lightning-Adresse hinterlegt.'), 'info')
            },

            // ── P7: Netz schreibend ─────────────────────────────────────────────────

            habeReagiert() {
                return this.article?.eigeneReaktion !== null && this.article?.eigeneReaktion !== undefined
            },
            /**
             * Ein Knopf, zwei Richtungen — reagieren oder die eigene Reaktion zurücknehmen.
             *
             * **Der Zustand kommt aus der ABLEITUNG, nicht aus einem lokalen Merker.**
             * `article.eigeneReaktion` wird aus denselben Ereignissen berechnet wie der
             * Zähler daneben; ein zweiter, lokal gehaltener Wahrheitswert könnte
             * auseinanderlaufen und zeigte dann einen gedrückten Knopf über einer Null.
             * Der optimistische Publish legt die kind 7 sofort ins Repository, die
             * Ableitung rechnet nach — Knopf und Zähler wechseln gemeinsam.
             *
             * `reagiert` sperrt nur gegen den **Doppelklick**: zwei kind 7 desselben
             * Autors mit demselben Emoji zählen zwar nur einmal (Deduplizierung je
             * (Autor, Emoji)), aber sie liegen beide unwiderruflich auf dem Relay.
             */
            async reaktionUmschalten() {
                if (this.reagiert || !feed || !this.article) {
                    return
                }
                if (!this.angemeldet) {
                    toast(t('Zum Reagieren musst du angemeldet sein.'), 'info')

                    return
                }
                this.reagiert = true
                haptic(10)
                try {
                    const meine = this.article.eigeneReaktion
                    const err = meine
                        ? await feed.nimmArtikelReaktionZurueck(meine.id)
                        : await feed.reagiereAufArtikel(this.article.id)
                    if (err) {
                        // Toast und keine feste Zeile: anders als beim Kommentar gibt es
                        // hier keinen Entwurf, der stehen bleiben müsste — der Knopf ist
                        // nach dem Fehlschlag im selben Zustand wie davor.
                        toast(err)
                    }
                } finally {
                    this.reagiert = false
                }
            },
            kommentarSperrgrund() {
                const grund = kommentarSperre({
                    entwurf: this.kommentarEntwurf,
                    angemeldet: this.angemeldet,
                    laeuft: this.kommentarLaeuft,
                })
                switch (grund) {
                    case 'abgemeldet':
                        return t('Zum Kommentieren musst du angemeldet sein.')
                    case 'zu-lang':
                        return t('Der Kommentar ist zu lang.')
                    // `leer` und `laeuft` bekommen bewusst KEINEN Text: beide sind für den
                    // Nutzer offensichtlich (leeres Feld, laufender Vorgang), und eine
                    // Meldung „das Feld ist leer" unter einem leeren Feld ist Lärm. Der
                    // Knopf ist trotzdem gesperrt — die Sperre und ihre Begründung sind
                    // zwei Fragen.
                    default:
                        return ''
                }
            },
            kommentarRest() {
                return KOMMENTAR_MAX_ZEICHEN - this.kommentarEntwurf.length
            },
            /**
             * Den Kommentar publizieren — und bei einem Fehlschlag **den Entwurf stehen
             * lassen.**
             *
             * Das ist die Zusage dieser Fläche und der Grund für die eigene Fehlerzeile:
             * am Board-Relay ist die Ablehnung der Normalfall für jeden ohne verifizierte
             * NIP-05-Adresse (`blocked: NIP-05 verification needed to publish events`,
             * gemessen 2026-08-21). Ein Composer, der bei diesem Relay-Verdikt leert,
             * vernichtet den Text bei genau den Nutzern, die ihn nicht loswerden können.
             *
             * Geleert wird deshalb **erst nach** dem `''` — nicht optimistisch vorher.
             */
            async kommentarAbschicken() {
                if (!feed || !this.article || kommentarSperre({
                    entwurf: this.kommentarEntwurf,
                    angemeldet: this.angemeldet,
                    laeuft: this.kommentarLaeuft,
                }) !== '') {
                    return
                }
                this.kommentarLaeuft = true
                this.kommentarFehler = ''
                try {
                    const err = await feed.kommentiereArtikel(this.article.id, this.kommentarEntwurf)
                    if (err) {
                        this.kommentarFehler = err

                        return
                    }
                    this.kommentarEntwurf = ''
                    toast(t('Kommentar veröffentlicht.'), 'success')
                } finally {
                    this.kommentarLaeuft = false
                }
            },
            linkKopieren() {
                const ziel = this.teilZiel()
                if (!ziel.teilbar) {
                    return
                }
                void navigator.clipboard?.writeText(ziel.url).then(() => toast(t('Link kopiert.'), 'success'))
            },
            async teilen() {
                const ziel = this.teilZiel()
                if (!ziel.teilbar || !this.canShare) {
                    return
                }
                try {
                    await navigator.share({ title: ziel.titel, url: ziel.url })
                } catch {
                    // **Ein Abbruch ist kein Fehler.** `navigator.share` lehnt auch dann
                    // ab, wenn der Nutzer das Systemblatt einfach wegwischt — eine
                    // Fehlermeldung darauf wäre eine Beschwerde über eine Entscheidung.
                    // Bleibt der echte Fehlschlag: auch dort ist „Link kopieren"
                    // danebengeblieben und tut es.
                }
            },
            async _load() {
                if (!feed) {
                    return
                }
                try {
                    const outcome = await feed.loadArticle(this._naddr, this._controller?.signal)
                    // Drei Ausgänge, und sie dürfen nicht zu zweien verschmelzen:
                    //  - Relay hat geantwortet, kennt den Artikel nicht → `missing`.
                    //    Das ist eine Aussage ÜBER den Relay, und sie ist jetzt gedeckt.
                    //  - Relay hat NICHT geantwortet → `error` samt „Erneut laden".
                    //    Vorher stand hier „Der Link zeigt auf keinen Artikel, den dieses
                    //    Relay kennt." — eine Behauptung, die nie festgestellt wurde.
                    //  - Artikel liegt schon vor (Kaltstart-Cache) → beides bleibt aus.
                    // `missing` bewusst NICHT aus `article === null` ableiten: die
                    // Ableitung meldet ihren ersten Wert, bevor das Netz antwortet, und
                    // eine daraus gezogene Fehlanzeige blitzte bei jedem Aufruf auf.
                    this.missing = outcome.complete && outcome.count === 0 && !this.article
                    this.error = !outcome.complete && !this.article ? t('Der Artikel ist gerade nicht erreichbar.') : ''
                } catch {
                    this.error = this.article ? '' : t('Der Artikel ist gerade nicht erreichbar.')
                } finally {
                    this.loading = false
                }
            },
            /** Siehe die Begründung bei `nostrArticles.retry`. */
            retry() {
                this.error = ''
                this.missing = false
                this._controller?.abort()
                this._controller = new AbortController()
                this.loading = true
                void (feed ? this._load() : this._boot())
            },
            hasArticle() {
                return this.article !== null
            },
            /**
             * Der Weg zur Autorenseite (P5, Schritt 25a).
             *
             * **P4 hat die Route gebaut und nichts hat dorthin verlinkt** —
             * `/articles/autor/{npub}` war ausschließlich über die Adresszeile
             * erreichbar. Eine Route, die niemand findet, ist gebaute Arbeit ohne
             * Wirkung; das ist der ganze Grund für diese sechs Zeilen.
             *
             * **npub und nicht hex**, obwohl die Route beides annimmt (`articleAuthor.ts`
             * löst zusätzlich NIP-05 auf): eine geteilte Adresse soll in jedem anderen
             * Nostr-Client erkennbar bleiben, und `npub1…` ist die Form, die ein Mensch
             * als Identität liest. Der Pubkey liegt seit P1 in `ArticleRow`.
             *
             * `''` statt eines Bruchs, solange nichts steht: das Markup bindet den Wert
             * über `:href="autorHref() || null"` — ohne Ziel entfällt das Attribut, und
             * ein `<a>` ohne `href` ist kein Tabstopp. Dieselbe Bauform wie bei der
             * Artikelkarte ohne `d`-Tag (`href(card) || null`, `⚡articles.blade.php`).
             */
            autorHref() {
                const pk = this.article?.pubkey
                if (!pk) {
                    return ''
                }
                try {
                    return `${this._base}/autor/${nip19.npubEncode(pk)}`
                } catch {
                    // Ein Pubkey, den `npubEncode` nicht annimmt, ist kein Fehler dieser
                    // Fläche — er käme aus einem Event, das der Relay so ausgeliefert
                    // hat. Ohne Ziel steht die Zeile nicht da, und der Artikel bleibt
                    // lesbar.
                    return ''
                }
            },
        }
    })

    /**
     * Die Autorenseite (P4, `/articles/autor/{autor}`).
     *
     * ── Zwei Phasen, zwei Fehlerfamilien ────────────────────────────────────────────
     *
     * Erst muss die ADRESSE aus der URL zu einem Pubkey werden, dann müssen die ARTIKEL
     * kommen. Eine npub löst synchron auf, eine NIP-05-Adresse über eine HTTPS-Abfrage
     * bei einer fremden Domain — und die kann auf zwei verschiedene Arten scheitern
     * („kennt den Namen nicht" gegen „hat nicht geantwortet"). Zusammen mit den beiden
     * unlesbaren Adressformen sind das **vier** Fehlzustände, die die Fläche einzeln
     * benennt. Die Regel dahinter liegt geprüft in `articleAuthor.ts`; hier steht nur,
     * wann sie gefragt wird.
     *
     * **Der Relay-Fehler bleibt davon getrennt** (`error`): „die Domain kennt diesen
     * Namen nicht" und „der Artikel-Relay schweigt gerade" sind zwei verschiedene
     * Auskünfte, und sie in einen Satz zu falten hieße, dem Leser die Entscheidung
     * abzunehmen, ob ein zweiter Versuch etwas bringt.
     *
     * Der Fachcode kommt per `import()`, aus demselben Grund wie bei `nostrArticles`.
     */
    Alpine.data('nostrArticleAuthor', (param: unknown, base: unknown): ArticleAuthorState => {
        let feed: typeof import('./longformFeed.ts') | null = null
        let autorModul: typeof import('./articleAuthor.ts') | null = null

        return {
            aufloesend: true,
            fehler: '',
            fehlerDomain: '',
            loading: true,
            error: '',
            autor: null,
            gruppen: [],
            anzahl: 0,
            seitJahr: 0,
            pubkey: '',
            _param: String(param ?? ''),
            // Dieselbe Normalisierung wie in `nostrArticles._base`.
            _base: String(base ?? '').replace(/\/+$/, ''),
            _dead: false,
            _controller: null,
            _unsub: null,
            init() {
                this._controller = new AbortController()
                void this._boot()
            },
            /** Siehe die Begründung des `try` bei `nostrArticles._boot`. */
            async _boot() {
                try {
                    const [feedModul, adressModul] = await Promise.all([
                        import('./longformFeed.ts'),
                        import('./articleAuthor.ts'),
                    ])
                    feed = feedModul
                    autorModul = adressModul
                } catch {
                    if (!this._dead) {
                        this.error = t('Die Artikel sind gerade nicht erreichbar.')
                        this.aufloesend = false
                        this.loading = false
                    }

                    return
                }
                if (this._dead) {
                    return
                }

                const ziel = autorModul.deuteAutorParam(this._param)
                if (ziel.art === 'ungueltig') {
                    this._endeMitFehler(ziel.grund)

                    return
                }
                if (ziel.art === 'nip05') {
                    // Die Domain steht ab hier im Zustand — sie ist der einzige Teil der
                    // Eingabe, den die Fläche zeigt, und sie ist gegen ein enges Muster
                    // geprüft (kein Port, keine Zugangsdaten, kein Pfad).
                    this.fehlerDomain = ziel.domain
                    const ergebnis = await autorModul.aufloesenNip05(ziel, autorModul.holeNip05Json)
                    // **Nach dem `await` gilt der Riegel wieder.** Ein `wire:navigate` weg
                    // von der Seite kann `destroy()` vor die Antwort schieben; ohne diese
                    // Zeile schriebe die Abfrage in einen Screen, den es nicht mehr gibt.
                    if (this._dead) {
                        return
                    }
                    if (ergebnis.art !== 'gefunden') {
                        this._endeMitFehler(ergebnis.art === 'unbekannt' ? 'nip05-unbekannt' : 'nip05-fehlgeschlagen')

                        return
                    }
                    this.pubkey = ergebnis.pubkey
                } else {
                    this.pubkey = ziel.pubkey
                }
                this.aufloesend = false

                if (feed.BOARD_URL === '') {
                    this.loading = false

                    return
                }
                // Profil und Handle dieses EINEN Autors anstoßen — der Weg über die
                // geladenen Artikel (`warmAuthors`) erreicht ihn nicht, wenn er hier gar
                // keine hat. Dann stünde dauerhaft eine npub-Kurzform über einer leeren
                // Liste statt eines Namens.
                feed.warmAuthor(this.pubkey)
                this._unsub = feed.deriveAuthorPage(this.pubkey).subscribe((view: AuthorView) => {
                    this.autor = view.autor
                    this._gliedern(view.artikel)
                })
                await this._load()
            },
            /**
             * Adresse endgültig gescheitert: kein Laden, kein Abonnement, kein Netz.
             *
             * Alles drei bewusst — ein REQ nach einem Autor, den es nicht gibt, wäre eine
             * Verbindung ohne Frage.
             */
            _endeMitFehler(grund: AutorFehler) {
                this.fehler = grund
                this.aufloesend = false
                this.loading = false
            },
            /**
             * Artikel in Monatsgruppen gliedern und die zwei Zahlen daneben bilden — **aus
             * denselben Zeilen**, die die Seite auch zeigt. Eine Zahl aus einer zweiten
             * Quelle weicht früher oder später von der Liste darunter ab.
             *
             * (Hier stand „in Jahrgänge". Der erste Entwurf gliederte so, der Bestand hat
             * ihn widerlegt — die Messung steht bei `nachMonat` in `articleAuthor.ts`.)
             */
            _gliedern(artikel: ArticleRowMitMetriken[]) {
                if (!autorModul) {
                    return
                }
                // Die Beschriftung entsteht HIER und nicht im reinen Modul: sie hängt an
                // der Sprache, und das reine Modul kennt keine. `stempel` ist ein
                // Zeitpunkt AUS der Gruppe — dieselbe Zahl, nach der gruppiert wurde,
                // also kann das Formatieren nicht in einem anderen Monat landen.
                this.gruppen = autorModul.nachMonat(artikel).map((gruppe) => ({
                    ...gruppe,
                    label: formatTimestamp(gruppe.stempel, { month: 'long', year: 'numeric' }),
                }))
                const grund = autorModul.autorGrunddaten(artikel)
                this.anzahl = grund.anzahl
                this.seitJahr = grund.seitJahr
            },
            destroy() {
                this._dead = true
                this._unsub?.()
                this._controller?.abort()
            },
            async _load() {
                if (!feed) {
                    return
                }
                this.loading = true
                try {
                    // **Der Vollbestand, nicht ein autorenskopierter Load** — die
                    // Ableitung liest den `repository` ohnehin über denselben
                    // Bestandsfilter. Die vollständige Begründung samt der Bedingung,
                    // unter der das kippt, steht bei `deriveAuthorPage` in
                    // `longformFeed.ts`; sie hier zu wiederholen hieße, zwei Fassungen
                    // derselben Entscheidung zu pflegen.
                    const outcome = await feed.loadArticles(this._controller?.signal)
                    // Ein schweigender Relay ist kein leerer Relay — dieselbe
                    // Unterscheidung wie in `nostrArticles._load`. „Von diesem Autor
                    // liegt hier noch kein Artikel" ist eine Aussage ÜBER den Relay und
                    // nur gedeckt, wenn er geantwortet hat.
                    this.error = outcome.complete || this.anzahl > 0 ? '' : t('Die Artikel sind gerade nicht erreichbar.')
                } catch {
                    this.error = this.anzahl > 0 ? '' : t('Die Artikel sind gerade nicht erreichbar.')
                } finally {
                    this.loading = false
                }
            },
            href(row: ArticleRow) {
                return row.naddr ? `${this._base}/${row.naddr}` : ''
            },
            hatAutor() {
                return this.fehler === '' && !this.aufloesend
            },
            /**
             * Leer heißt: der Relay hat geantwortet und kennt von diesem Autor nichts.
             * Solange geladen wird oder ein Fehler steht, ist die Frage NICHT
             * entschieden — und eine Fläche, die „hat nichts geschrieben" sagt, bevor
             * jemand gefragt hat, behauptet etwas über einen Menschen.
             */
            istLeer() {
                return this.hatAutor() && !this.loading && this.error === '' && this.anzahl === 0
            },
            /** Dasselbe inerte Muster wie in der Vollansicht — siehe `nostrArticle`. */
            keineLightningAdresse() {
                toast(t('Dieser Autor hat keine Lightning-Adresse hinterlegt.'), 'info')
            },
            /**
             * Der Verweis auf die öffentliche Creator-Seite (media.) — `''` = keine Zeile.
             *
             * `this.autor` ist `null`, solange die Adresse nicht aufgelöst ist; die Karte
             * steht dann ohnehin nicht. Danach kommt `autor.nip05` aus `verifiedNip05`
             * (`verifiedNip05` in `longformFeed.ts`), ist also der VERIFIZIERTE Handle und nie ein
             * Profil-Rohwert — worauf diese ganze Fläche sicherheitsseitig steht
             * (Begründung in `medienProfil.ts`).
             *
             * Methode und kein Feld, aus demselben Grund wie in `nostrProfileCard`: das
             * kind 0 und die `.well-known` treffen asynchron ein, und `autor` wird beim
             * Nachladen als Ganzes ersetzt.
             */
            medienUrl() {
                // **Die Bindung nennt den Typ, und das ist kein Zierrat.** Der
                // Herkunfts-Riegel (`zapTargetSources.test.ts`) inventarisiert JEDEN
                // Zugriff auf `nip05`/`lud16`/`lud06`/`lnurl` und liest dafür die
                // Bindungszeile des Empfängers — sie muss die Quelle benennen. Ein
                // nacktes `this.autor.nip05` hätte dort die Klasse „unbekannt" bekommen
                // und wäre zu Recht rot geworden. `AuthorView['autor']` IST die Aussage:
                // dieses Feld entsteht ausschließlich in `buildArticleAuthor`, und der
                // bekommt es aus `verifiedNip05(…)` (`verifiedNip05` in `longformFeed.ts`).
                // `satisfies` statt `as`: es prüft, ohne etwas zu behaupten.
                const autor = this.autor satisfies AuthorView['autor'] | null

                return autor ? medienProfilUrl(medienBasis(), autor.pubkey, autor.nip05) : ''
            },
            /**
             * Von vorn — und zwar wirklich von vorn.
             *
             * `retry` fängt hier beim Deuten der Adresse an und nicht erst beim Laden:
             * der wiederholbare Fehlzustand dieser Fläche ist `nip05-fehlgeschlagen`, und
             * der entsteht VOR jedem Artikel. Ein `retry`, das nur `_load()` neu startet,
             * ließe genau den Fall stehen, für den der Knopf da ist.
             *
             * ── Warum hier ALLES fällt, was der vorige Versuch geschrieben hat ───────
             *
             * Bis 2026-08-21 blieben `fehlerDomain`, `pubkey`, `gruppen`, `anzahl` und
             * `seitJahr` stehen. Das war **kein Entwurf, sondern eine Lücke** — sie hing
             * an einer Eigenschaft, die nirgends aufgeschrieben war: beide Knöpfe, die
             * `retry()` heute auslösen, erscheinen nur bei `anzahl === 0`, und dann sind
             * diese Felder ohnehin leer. Die Lücke war also unsichtbar, solange genau
             * diese zwei Aufrufer die einzigen blieben. Ein dritter (P5 verlinkt diese
             * Seite, und eine Wiederholung aus dem Leerzustand liegt nahe) hätte sie
             * geöffnet — und dann stünde nach einem gescheiterten zweiten Versuch die
             * Liste des ERSTEN unter der Fehlermeldung, denn das `x-for` der Monate hängt
             * an `gruppen` und nicht an `hatAutor()`.
             *
             * Der Fall ist auch ohne dritten Aufrufer erreichbar: `_param` bleibt zwar
             * gleich, aber die Antwort der Domain nicht. Ein `_@example.com`, das beim
             * ersten Versuch A liefert und beim zweiten B, wechselt den Autor mitten in
             * einer stehenden Fläche.
             *
             * Die Regel dahinter, ohne Aufzählung: **was eine Aussage über den vorigen
             * Versuch ist, überlebt ihn nicht.** `_param` und `_base` bleiben — sie sind
             * Eigenschaften der Seite, nicht des Versuchs.
             */
            retry() {
                this.fehler = ''
                this.fehlerDomain = ''
                this.error = ''
                this.aufloesend = true
                this.loading = true
                this.autor = null
                this.gruppen = []
                this.anzahl = 0
                this.seitJahr = 0
                this.pubkey = ''
                this._unsub?.()
                this._unsub = null
                this._controller?.abort()
                this._controller = new AbortController()
                void this._boot()
            },
        }
    })

    // Vereins-Gate: zeigt Nicht-Vereinsmitgliedern (nicht in der relay-signierten
    // 13534-Liste) auf einem EINUNDZWANZIG-Vereins-Relay den Beitritts-Hinweis.
    // `show` erst wenn relay.self da ist (Fix A) — kein falsches Aufblitzen.
    Alpine.data('nostrVereinGate', (): VereinGateState => ({
        show: false,
        isGuest: false,
        _access: { gated: false, ready: false, isMember: false, isGuest: false },
        _unsubActive: null,
        _unsubAccess: null,
        _controller: null,
        init() {
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this._unsubAccess?.()
                this._controller?.abort()
                this.show = false
                this._access = { gated: isVereinRelay(url), ready: false, isMember: false, isGuest: false }
                // Directory (13534/33534) als LIVE-Sub laden — auf /spaces tut das
                // sonst niemand. Live statt One-Shot: überlebt langsames NIP-42-AUTH.
                // `access.ready` wird erst nach dem post-AUTH-EOSE wahr (siehe
                // deriveVereinAccess/spaceDirectoryLoaded) → kein verfrühter
                // „kein Mitglied"-Hinweis, und er verschwindet, sobald AUTH durch ist.
                if (this._access.gated) {
                    this._controller = new AbortController()
                    watchSpaceDirectory(url, this._controller.signal)
                }
                this._unsubAccess = deriveVereinAccess(url).subscribe((a: VereinAccess) => {
                    this._access = a
                    this._refresh()
                })
            })
        },
        _refresh() {
            // Zwei Zielgruppen, zwei Bedingungen — und der Gast ist NICHT der
            // Sonderfall des Nicht-Mitglieds, sondern ein eigener Zustand:
            // von ihm wissen wir gar nicht, ob er Mitglied ist. Der Text
            // unterscheidet das (siehe verein-gate.blade.php); hier fällt nur die
            // Entscheidung, ob überhaupt etwas steht. `isVereinGuestGated` kommt
            // ohne `ready` aus — Begründung dort.
            this.isGuest = this._access.isGuest
            this.show = isVereinGatedOut(this._access) || isVereinGuestGated(this._access)
        },
        // Vereins-Beitritts-Link öffnen: in der nativen App via In-App-Browser
        // (Custom Tab / SFSafariViewController) — ein `target=_blank`-Link
        // verpufft in der WebView. Im Web bleibt das normale <a> (kein preventDefault).
        openExternal(url: string, e: Event) {
            if (isMobile) {
                e.preventDefault()
                void nativeBrowserInApp(url)
            }
        },
        destroy() {
            this._unsubActive?.()
            this._unsubAccess?.()
            this._controller?.abort()
        },
    }))

    // Space-Directory (M3): Mitglieder + Rollen des AKTIVEN Space. Gated auf
    // relay.self (Fix A) — bis NIP-11 da ist, Skeleton statt „keine Mitglieder".
    // Client-Suche filtert über Name + npub. Kein Multi-Space (§12).
    Alpine.data('nostrDirectory', (): DirectoryState => ({
        ready: false,
        profilesReady: false,
        members: [],
        roles: [],
        query: '',
        gatedOut: false,
        statuses: {},
        statusPending: false,
        statusOf(pubkey: string) {
            return this.statuses[pubkey] ?? EMPTY_STATUS
        },
        _unsubStatuses: null,
        _unsubStatusPending: null,
        isAdmin: false,
        rolesFull: [],
        editingMember: null,
        roleForm: { id: '', label: '', description: '', hue: 210, lightness: 0.5, order: 0 },
        banned: [],
        inviteLink: '',
        inviteBusy: false,
        busy: false,
        reports: [],
        joinRequests: [],
        spaceForm: { name: '', description: '' },
        _spaceInitial: { name: '', description: '' },
        spaceIconPreview: '',
        _spaceIconFile: null,
        spaceSaving: false,
        _url: null,
        _controller: null,
        _unsubActive: null,
        _unsubDir: null,
        _unsubRoles: null,
        _unsubAdmin: null,
        _unsubAccess: null,
        _unsubReports: null,
        _unsubJoins: null,
        _loadedDir: new Set<string>(),
        _loadedProfiles: new Set<string>(),
        _settleStarted: false,
        init() {
            // Aktiver Space → dessen Directory laden + Subs neu aufbauen.
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this._unsubDir?.()
                this._unsubRoles?.()
                this._unsubAdmin?.()
                this._unsubAccess?.()
                this._unsubReports?.()
                this._unsubJoins?.()
                this._unsubStatuses?.()
                this._unsubStatusPending?.()
                this._controller?.abort()
                this.ready = false
                this.profilesReady = false
                this._settleStarted = false
                this.reports = []
                this.joinRequests = []
                this.members = []
                this.roles = []
                this.statuses = {}
                this.gatedOut = false
                this.editingMember = null
                this._url = url
                this._controller = new AbortController()
                // Sicherheitsnetz: bleibt das Directory-Loaded-Signal (EOSE/CLOSED)
                // aus (Relay-Timeout/Netzfehler), nach 8s trotzdem rendern statt
                // ewig Skeleton — dann eben mit dem bis dahin bekannten Stand.
                setTimeout(() => {
                    if (this._url === url && !this.profilesReady) {
                        this.profilesReady = true
                    }
                }, 8000)
                // Vereins-Relay & kein Mitglied → Mitgliederliste liefert der Relay
                // nicht aus; Suche + falsche „keine Mitglieder"-Meldung ausblenden.
                this._unsubAccess = deriveVereinAccess(url).subscribe((a: VereinAccess) => {
                    this.gatedOut = isVereinGatedOut(a)
                    // `a.ready` = relay.self da UND das Directory (13534/33534) ist
                    // FERTIG geladen — per EOSE (Liste inkl. Mitglieder da) oder
                    // CLOSED (Nicht-Mitglied, keine Liste). ERST jetzt steht die
                    // Mitgliederzahl final. `view.ready` allein (nur relay.self)
                    // triggerte das Gate bei members=0 → profilesReady verfrüht,
                    // die Liste sortierte/animierte danach bei jedem Profil neu.
                    if (a.ready && !this._settleStarted) {
                        this._settleStarted = true
                        const pubkeys = this.members.map((m) => m.pubkey)
                        pubkeys.forEach((pk) => this._loadedProfiles.add(pk))
                        void settleMemberProfiles(url, pubkeys).then(() => {
                            if (this._url === url) {
                                this.profilesReady = true
                            }
                        })
                    }
                })
                if (!this._loadedDir.has(url)) {
                    this._loadedDir.add(url)
                    loadSpaceDirectory(url)
                }
                // watchSpaceDirectory (statt listen): lädt 13534/33534 UND meldet per
                // EOSE/CLOSED, dass das Directory fertig ist ([[spaceDirectoryLoaded]]) —
                // das Signal, an dem `a.ready` oben hängt. Bleibt offen (Live-Updates).
                watchSpaceDirectory(url, this._controller.signal)
                // NIP-38-Statuse (P2): eine Subscription für die ganze Liste, plus der
                // dreiwertige Wartezustand aus P1. `warmUserStatuses` läuft unten mit der
                // Mitgliederliste — hier steht sie noch nicht.
                this._unsubStatusPending = deriveStatusPending(url).subscribe((pending: boolean) => {
                    this.statusPending = pending
                })
                this._unsubStatuses = deriveUserStatuses(url).subscribe((table: ReadonlyMap<string, UserStatus>) => {
                    // Neues Objekt je Emit: Alpine beobachtet Zuweisungen, keine Map-Mutation.
                    const next: Record<string, { text: string; emoji: string }> = {}
                    for (const [pk, status] of table) {
                        next[pk] = { text: status.text, emoji: status.emoji }
                    }
                    this.statuses = next
                })
                this._unsubDir = deriveSpaceDirectory(url).subscribe((view: DirectoryView) => {
                    this.ready = view.ready
                    warmUserStatuses(url, view.members.map((m) => m.pubkey))
                    // Liste im Hintergrund aktuell halten; die View zeigt sie erst,
                    // wenn `profilesReady` steht (x-if, gesetzt vom Access-Gate oben) —
                    // kein progressives Umsortieren einer sichtbaren Liste.
                    this.members = view.members
                    this.roles = view.roles
                    // Falls das Rollen-Modal offen ist, die Auswahl frisch halten.
                    if (this.editingMember) {
                        this.editingMember =
                            view.members.find((m) => m.pubkey === this.editingMember!.pubkey) ?? this.editingMember
                    }
                    // Nachzügler (Live-Admin fügt nach dem Gate Mitglieder hinzu):
                    // deren Profile einzeln nachladen — je pubkey einmal.
                    if (this.profilesReady) {
                        const missing = view.members
                            .map((m) => m.pubkey)
                            .filter((pk) => !this._loadedProfiles.has(pk))
                        missing.forEach((pk) => this._loadedProfiles.add(pk))
                        loadMemberProfiles(url, missing)
                    }
                })
                this._unsubRoles = deriveSpaceRoles(url).subscribe((roles: SpaceRole[]) => {
                    this.rolesFull = roles
                })
                this._unsubAdmin = deriveUserIsSpaceAdmin(url).subscribe((admin: boolean) => {
                    this.isAdmin = admin
                })
                // Melde-Queue (P3): Meldungen (kind 1984) laden + live halten. Die
                // Ableitung ist billig; die UI zeigt sie nur Admins (x-show), also
                // kein Gate auf den (async auflösenden) Admin-Status nötig.
                loadSpaceReports(url)
                watchSpaceReports(url, this._controller.signal)
                this._unsubReports = deriveSpaceReports(url).subscribe((r: ReportView[]) => {
                    this.reports = r
                })
                // Beitritts-Queue (P4b): Räume (39000/39002) UND Join-Requests (9021/9022)
                // laden — auf der Directory-Seite lädt sonst niemand die Räume, dann fehlte
                // der Membership-Abgleich (offene vs. angenommene Anfrage).
                loadSpaceRooms(url)
                watchSpaceRooms(url, this._controller.signal)
                loadSpaceJoinRequests(url)
                watchSpaceJoinRequests(url, this._controller.signal)
                this._unsubJoins = deriveSpaceJoinRequests(url).subscribe((j: JoinRequestView[]) => {
                    this.joinRequests = j
                })
            })
        },
        filtered() {
            const q = this.query.trim().toLowerCase()
            return q ? this.members.filter((m) => m.search.includes(q)) : this.members
        },
        // Nach jeder Admin-Mutation: neu ziehen + Admin-Status re-checken (Fix C).
        // Die Live-Sub reflektiert die relay-signierte Änderung ohnehin.
        reload() {
            if (this._url) {
                loadSpaceDirectory(this._url)
                refreshSpaceAdmin(this._url)
            }
        },
        openRoleCreate() {
            this.roleForm = { id: '', label: '', description: '', hue: 210, lightness: 0.5, order: this.rolesFull.length }
            dispatchModal('role-form')
        },
        openRoleEdit(role: SpaceRole) {
            this.roleForm = {
                id: role.id,
                label: role.label,
                description: role.description,
                hue: parseFloat(role.color.hue) || 0,
                lightness: parseFloat(role.color.lightness) || 0.5,
                order: role.order,
            }
            dispatchModal('role-form')
        },
        async saveRole() {
            if (!this._url || this.busy || !this.roleForm.label.trim()) {
                return
            }
            this.busy = true
            const { id, label, description, hue, lightness, order } = this.roleForm
            const color = { hue: String(hue), saturation: '0.7', lightness: String(lightness) }
            try {
                const err = id
                    ? await editRole(this._url, id, label, description, color, order)
                    : await createRole(this._url, label, description, color, order)
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('role-form', false)
                    this.reload()
                }
            } finally {
                this.busy = false
            }
        },
        async removeRole(id: string) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await deleteRole(this._url, id)
                err ? toast(err) : this.reload()
            } finally {
                this.busy = false
            }
        },
        openMemberRoles(m: MemberView) {
            this.editingMember = m
            dispatchModal('member-roles')
        },
        memberHasRole(roleId: string) {
            return Boolean(this.editingMember?.roleIds.includes(roleId))
        },
        async toggleMemberRole(roleId: string) {
            if (!this._url || !this.editingMember || this.busy) {
                return
            }
            this.busy = true
            const pk = this.editingMember.pubkey
            const has = this.editingMember.roleIds.includes(roleId)
            try {
                const err = has
                    ? await unassignRole(this._url, pk, roleId)
                    : await assignRole(this._url, pk, roleId)
                err ? toast(err) : this.reload()
            } finally {
                this.busy = false
            }
        },
        async removeMember(m: MemberView) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await removeSpaceMember(this._url, m.pubkey)
                err ? toast(err) : this.reload()
            } finally {
                this.busy = false
            }
        },
        async banMember(m: MemberView) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await banSpaceMember(this._url, m.pubkey)
                err ? toast(err) : this.reload()
            } finally {
                this.busy = false
            }
        },
        async loadBanned() {
            if (!this._url) {
                return
            }
            this.banned = await loadBannedMembers(this._url)
        },
        async unbanMember(pubkey: string) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await unbanSpaceMember(this._url, pubkey)
                if (err) {
                    toast(err)
                } else {
                    await this.loadBanned()
                }
            } finally {
                this.busy = false
            }
        },
        async restoreMember(pubkey: string) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await addSpaceMember(this._url, pubkey)
                if (err) {
                    toast(err)
                } else {
                    await this.loadBanned()
                    this.reload()
                }
            } finally {
                this.busy = false
            }
        },
        // Invite-Link generieren: Claim (28935) vom Relay holen → /join?r=&c=.
        async loadInvite() {
            if (!this._url) {
                return
            }
            this.inviteBusy = true
            this.inviteLink = ''
            try {
                const claim = await loadSpaceInviteClaim(this._url)
                const params = new URLSearchParams({ r: displayRelayUrl(this._url), c: claim })
                this.inviteLink = `${window.location.origin}/join?${params}`
            } finally {
                this.inviteBusy = false
            }
        },
        copyInvite() {
            if (this.inviteLink) {
                navigator.clipboard?.writeText(this.inviteLink).then(() => toast(t('Link kopiert.'), 'success'))
            }
        },
        // ── P3: Melde-Queue (NIP-56 kind 1984) ─────────────────────────────────
        // Meldung verwerfen: den Report relay-seitig bannen (banevent) → er
        // verschwindet aus der Queue (optimistisch lokal via removeEvent). Der
        // gemeldete Inhalt bleibt unberührt. Gemeinsames busy-Gate wie die anderen
        // Admin-Mutationen (immer nur eine Aktion offen).
        // Eine erledigte Meldung aus BEIDEN Quellen räumen: dem Repository (zooid,
        // kind 1984) und dem Buzz-Report-Store. Danach frisch nachladen — die
        // Relay-Datenbank ist die Wahrheit, das lokale Entfernen nur die Optik.
        _reportDone(r: ReportView) {
            const url = this._url
            if (!url) {
                return
            }
            repository.removeEvent(r.id)
            forgetBuzzReport(url, r.id)
            void loadSpaceReports(url)
        },
        async dismissReport(r: ReportView) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await resolveReport(this._url, r.id, 'dismiss')
                if (err) {
                    toast(err)
                } else {
                    this._reportDone(r)
                }
            } finally {
                this.busy = false
            }
        },
        // Gemeldeten Inhalt entfernen: das gemeldete Event bannen (banevent) UND die
        // Meldung verwerfen (erledigt → aus der Queue). Beides relay-seitig, lokal
        // optimistisch ausgeblendet.
        async removeReportedContent(r: ReportView) {
            if (!this._url || this.busy || !r.reportedId) {
                return
            }
            this.busy = true
            try {
                // Das `h` durchreichen: Buzz' kind 9005 verlangt Raum-Bezug
                // (`invalid: channel-scoped events must include an h tag`, am laufenden
                // Relay gemessen). Es kommt dort aus `channel_id` des Report-Datensatzes.
                // Auf zooid ist der vierte Parameter folgenlos.
                const err =
                    (await banEvent(this._url, r.reportedId, '', r.roomH)) ||
                    (await resolveReport(this._url, r.id, 'delete'))
                if (err) {
                    toast(err)
                } else {
                    repository.removeEvent(r.reportedId)
                    this._reportDone(r)
                }
            } finally {
                this.busy = false
            }
        },
        // Gemeldeten Autor bannen (banpubkey — entfernt ihn + löscht alle seine
        // Events) UND die Meldung verwerfen. Der Autor-Bann räumt den gemeldeten
        // Inhalt relay-seitig gleich mit weg.
        async banReportedUser(r: ReportView) {
            if (!this._url || this.busy || !r.reportedPubkey) {
                return
            }
            this.busy = true
            try {
                const err =
                    (await banSpaceMember(this._url, r.reportedPubkey)) ||
                    (await resolveReport(this._url, r.id, 'ban'))
                if (err) {
                    toast(err)
                } else {
                    refreshSpaceAdmin(this._url)
                    this._reportDone(r)
                }
            } finally {
                this.busy = false
            }
        },
        // ── P4b: Beitritts-Queue (offene 9021 für closed-Räume) ────────────────
        // Annehmen: kind 9000 (put-user) → Relay trägt den Pubkey in die 39002 ein;
        // der Live-Sub reflektiert das → die Anfrage fällt aus der Queue (jetzt Mitglied).
        // Der Anfragende ist bereits Space-Member (sonst wäre sein 9021 abgelehnt worden),
        // also genügt der Raum-Beitritt (kein zusätzliches allowpubkey nötig).
        async acceptJoin(j: JoinRequestView) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await addRoomMember(this._url, j.h, j.pubkey)
                if (err) {
                    toast(err)
                } else {
                    // Den 9021-Request zurückziehen (wie beim Ablehnen). Sonst bliebe er
                    // im Repository und tauchte nach einem späteren Kick (9001, das kein
                    // 9022 erzeugt) erneut als „offen" auf, weil der Pubkey dann wieder aus
                    // der 39002 fällt. Best-effort: die Mitgliedschaft steht bereits.
                    void banEvent(this._url, j.id)
                    repository.removeEvent(j.id)
                }
            } finally {
                this.busy = false
            }
        },
        // Ablehnen: den 9021-Request bannen (banevent) → aus der Queue (optimistisch lokal).
        async rejectJoin(j: JoinRequestView) {
            if (!this._url || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await banEvent(this._url, j.id)
                if (err) {
                    toast(err)
                } else {
                    repository.removeEvent(j.id)
                }
            } finally {
                this.busy = false
            }
        },
        // ── P2: Space-Metadaten bearbeiten (NIP-86 changerelay*) ───────────────
        // Vorbelegen aus dem NIP-11-Info-Doc + Snapshot (_spaceInitial) als Vergleichs-
        // basis: saveSpace sendet NUR Felder, die der Admin gegenüber dem Prefill wirklich
        // geändert hat → kein Whitespace-No-op, und ein (noch) leeres Feld aus einem nicht
        // geladenen Profil wird NIE als „auf leer gesetzt" gesendet (kein Namens-Wipe).
        // Modal SOFORT mit dem Cache-Snapshot öffnen (nie hinter await blocken,
        // [[zap-modal-open-never-block-on-resolvezapper]]); dann das NIP-11 frisch
        // nachladen (1h-loadRelay-Cache umgehen) und neu vorbelegen — aber nur, wenn der
        // Admin das Formular noch nicht angefasst hat (sonst überschriebe es seine Eingabe).
        openSpaceEdit() {
            const url = this._url
            if (!url) {
                return
            }
            this._prefillSpace(get(relaysByUrl).get(url))
            this._spaceIconFile = null
            dispatchModal('space-edit')
            void forceLoadRelay(url).then(() => {
                const pristine =
                    !this._spaceIconFile &&
                    this.spaceForm.name === this._spaceInitial.name &&
                    this.spaceForm.description === this._spaceInitial.description
                if (this._url === url && pristine) {
                    this._prefillSpace(get(relaysByUrl).get(url))
                }
            })
        },
        _prefillSpace(profile?: RelayProfile) {
            this.spaceForm = { name: profile?.name ?? '', description: profile?.description ?? '' }
            this._spaceInitial = { name: this.spaceForm.name, description: this.spaceForm.description }
            this.spaceIconPreview = profile?.icon ?? ''
        },
        // Neues Icon wählen: lokale Vorschau (data-URL) + Datei merken (Upload erst
        // beim Speichern, damit ein Abbrechen nichts hochlädt). `input.value` leeren,
        // damit dieselbe Datei nach einem Abbruch erneut wählbar bleibt (wie pickImage).
        pickSpaceIcon(input: HTMLInputElement) {
            const file = input.files?.[0]
            input.value = ''
            if (!file || !file.type.startsWith('image/')) {
                return
            }
            this._spaceIconFile = file
            const reader = new FileReader()
            reader.onload = (e) => {
                this.spaceIconPreview = String(e.target?.result ?? '')
            }
            reader.readAsDataURL(file)
        },
        // Speichern: nur gegenüber dem Prefill-Snapshot GEÄNDERTE Felder senden (je ein
        // manageRelay-Call, wie der Referenz-Client), ein neues Icon vorher hochladen.
        // Danach das NIP-11 hart neu laden (forceLoadRelay) → das Branding (Space-Auswahl/
        // Raum-Header) zieht ohne Reload nach. Erster Fehler bricht ab (Modal bleibt offen).
        async saveSpace() {
            if (!this._url || this.spaceSaving) {
                return
            }
            this.spaceSaving = true
            const url = this._url
            try {
                if (this.spaceForm.name !== this._spaceInitial.name) {
                    const err = await setRelayName(url, this.spaceForm.name.trim())
                    if (err) {
                        toast(err)
                        return
                    }
                }
                if (this.spaceForm.description !== this._spaceInitial.description) {
                    const err = await setRelayDescription(url, this.spaceForm.description.trim())
                    if (err) {
                        toast(err)
                        return
                    }
                }
                if (this._spaceIconFile) {
                    const uploaded = await uploadAttachment(this._spaceIconFile)
                    const err = await setRelayIcon(url, uploaded.url)
                    if (err) {
                        toast(err)
                        return
                    }
                }
                // Gespeichert (Relay hat quittiert); das lokale NIP-11 frisch nachziehen,
                // damit das Branding vor dem Toast steht.
                await forceLoadRelay(url)
                dispatchModal('space-edit', false)
                toast(t('Space gespeichert.'), 'success')
            } catch {
                toast(t('Speichern fehlgeschlagen.'))
            } finally {
                this.spaceSaving = false
            }
        },
        destroy() {
            this._unsubActive?.()
            this._unsubDir?.()
            this._unsubRoles?.()
            this._unsubAdmin?.()
            this._unsubAccess?.()
            this._unsubReports?.()
            this._unsubJoins?.()
            this._unsubStatuses?.()
            this._unsubStatusPending?.()
            this._controller?.abort()
        },
    }))

    /**
     * P8: Wie oft die Raum-Sub nach `restricted: channel access revoked` neu
     * aufgesetzt wird, bevor die Fläche gated. Drei reicht mit Abstand für jeden
     * gemessenen Ablauf (ein Austritt = genau ein Grund); der Deckel existiert nur,
     * damit ein Relay, das die frische Sub sofort wieder mit demselben Grund
     * schließt, keine Endlosschleife auslöst.
     */
    const ROOM_GATE_MAX_RELISTENS = 3

    // Room-Chat (M4 lesen + M5 schreiben): Verlauf eines Raums im AKTIVEN Space.
    // Live-Sub (limit:0) + Cursor-Pagination. Senden/Löschen = kind 9/5 (optimistisch).
    // Beitreten/Verlassen = NIP-29 (kind 9021/9022) → relay-autoritative 39002-
    // Mitgliedschaft (persistent); der Composer ist an `joined` gekoppelt.
    Alpine.data('nostrRoomChat', (h: unknown, initialName?: unknown, nevent?: unknown): RoomChatState => ({
        h: String(h),
        _deepThreadNevent: nevent ? String(nevent) : null,
        // SSR-Fallback (Server-Read-Cache/Slug); die Client-Meta (39000) überschreibt
        // ihn reaktiv in setup(), sobald sie vom Relay da ist — der Server-Cache kann
        // den Namen am member-only-Relay ohne AUTH nicht lesen und zeigt sonst den Slug.
        roomName: String(initialName ?? h),
        spaceHint: '',
        messages: [],
        messagesReversed: [],
        loading: true,
        loadingMore: false,
        hasMore: true,
        atBottom: true,
        unread: 0,
        firstPaintDone: false,
        error: '',
        joined: false,
        joining: false,
        membershipReady: false,
        gatedOut: false,
        _gateRelistens: 0,
        draft: '',
        sending: false,
        sendError: '',
        replyTo: null,
        sharing: false,
        attachment: null,
        threadAttachment: null,
        _cropSrc: null,
        _cropForThread: false,
        cropRatio: NaN,
        uploadingImage: false,
        editingId: null,
        activeId: null,
        flashId: null,
        lightboxSrc: null,
        deleting: false,
        pendingDelete: null,
        reportFor: null,
        reportReason: 'spam',
        reportText: '',
        reporting: false,
        zapFor: null,
        zapResolving: false,
        zapUnavailable: false,
        zapResolveFailed: false,
        zapNostrless: false,
        zapAmount: 21,
        zapContent: '⚡',
        zapping: false,
        zapInvoice: '',
        zapQr: '',
        zapsEnabled: zapsEnabled(),
        zapPresets: [21, 210, 2100, 21000],
        _zapper: null,
        _zapSub: null,
        _zapLoadedIds: new Set<string>(),
        pollTitle: '',
        pollOptionList: [],
        pollTypeSel: 'singlechoice',
        pollEndsAt: '',
        pollBusy: false,
        goalTitle: '',
        goalSummary: '',
        goalTargetSats: 21000,
        goalBusy: false,
        _draggedOption: null,
        isMobile,
        menuFor: null,
        _menuInThread: false,
        infoFor: null,
        isAdmin: false,
        isForum: false,
        topics: [],
        topicsLoading: true,
        _unsubTopics: null,
        _forumStarted: false,
        pendingAdminDelete: null,
        banAuthorFor: null,
        moderating: false,
        threadRootId: null,
        threadRoot: null,
        threadComments: [],
        threadCount: 0,
        threadReplyTo: null,
        threadDraft: '',
        threadFull: false,
        _threadPrevUrl: null,
        _threadUnsub: null,
        _threadController: null,
        mentionOpen: false,
        mentionQuery: '',
        _mentionTarget: 'main',
        mentionItems: [],
        mentionIndex: 0,
        _mentionStart: -1,
        _members: [],
        _unsubMembers: null,
        _unsubAdmin: null,
        statusPending: false,
        _unsubStatusPending: null,
        _unsubRoomMeta: null,
        _unsubRelay: null,
        _url: null,
        _lastRead: 0,
        _onViewport: null,
        _onVisible: null,
        _hiddenAt: 0,
        _initialLoadDone: false,
        _unsubActive: null,
        _unsub: null,
        _unsubJoined: null,
        _controller: null,
        _loadedProfiles: new Set<string>(),
        _loadedMsgIds: new Set<string>(),
        _scroller: null,
        _destroyed: false,
        _pendingMsgs: null,
        _rafMsgs: 0,
        init() {
            // ── Welcher Space trägt DIESEN Raum? ──────────────────────────────────
            // Ein Raum lebt auf genau einem Relay, `/rooms/{h}` allein sagt aber nicht,
            // auf welchem. Trägt die URL die Workspace-Markierung (`?space=workspace`,
            // siehe spaceParam.ts), gehört der Raum dem zweiten Space — dann muss der
            // aktive Space DAS sein, und zwar bevor unten das erste Mal `setup()` läuft.
            //
            // Der Aufruf steht deshalb SYNCHRON hier und nicht im `storageReady`-Zweig:
            // sonst liefe der erste Aufbau gegen den Vereins-Space, und mit ihm der
            // Beitritt (kind 9021) — genau der Fehler, der als `invalid: group not found`
            // sichtbar wurde, samt leerem Verlauf. Nur ephemer, wie beim Klick aus dem
            // Workspaces-Tab: persistiert wird die Zuordnung nie, sie steht im Link.
            if (readSpaceParam(window.location.search) !== null && hasWorkspace()) {
                setActiveSpaceEphemeral(WORKSPACE_URL)
            }

            // Aktiver Space → dessen Room-Feed (Wechsel baut Sub + Live neu auf).
            // M3 P1: ERST wenn der Kaltstart-Cache in die repository gespiegelt ist
            // (storageReady) abonnieren — sonst misst der Warm-Peek in setup() ein noch
            // leeres Repo → Skeleton statt Instant-Paint. storageReady rejectet nie und
            // resolved auch ohne Cache/bei IDB-Fehler sofort → der kalte Pfad bleibt
            // unverändert schnell; es verschiebt das Abo nur um einen Micro-/IDB-Tick.
            // P3 zusätzlich `readStateReady`: setup() liest das Wasserzeichen EINMAL für die
            // „Neu"-Trennlinie. Liefe es davor, wäre das Wasserzeichen 0 und die Linie fehlte
            // die ganze Sitzung. Beide Promises starten beim Insel-Boot parallel, rejecten nie
            // und lösen auch ohne Speicher sofort auf → der kalte Pfad bleibt gleich schnell.
            void Promise.all([storageReady, readStateReady]).then(() => {
                if (this._destroyed) {
                    return // Raum schon verlassen, bevor der Cache-Load fertig war → nicht abonnieren
                }
                this._unsubActive = activeSpace.subscribe((url: string) => this.setup(url))
            })
            // Mobil: Tastatur/Adressleiste ändern die Viewport-Höhe — stand man am Boden,
            // dort bleiben. followOnAppend feuert nur bei count-Änderung, ein Viewport-Resize
            // ist keine → explizit re-sticken. WICHTIG: `this.atBottom` (Zustand VOR dem Resize,
            // gepflegt von onScroll/onChange) statt isAtEnd() NACH dem Resize — der geschrumpfte
            // Viewport (Tastatur ~300px) macht isAtEnd sofort false → kein Re-Stick, Nachricht
            // hinge hinter der Tastatur; und eine lockere Schwelle risse einen leicht Hochgescrollten
            // bei Adressleisten-Show/Hide nach unten (derselbe Fight wie das entfernte onMediaLoad).
            this._onViewport = () => {
                if (this.atBottom) {
                    const el = (this as unknown as AlpineMagics).$refs.scroll as HTMLElement | undefined
                    el?.scrollTo({ top: 0 }) // column-reverse: top:0 = Boden (neueste)
                }
            }
            window.visualViewport?.addEventListener('resize', this._onViewport)
            // App-Foreground-Resync: Im Android-WebView friert der Hintergrund die JS-Timer ein
            // und das OS kappt den WebSocket → welshmans Timer-Reconnect läuft nicht sauber an,
            // die Live-REQ (listenRoom) bleibt tot. Beim Zurückkommen (visibilitychange→visible)
            // die Live-Subs neu senden + Verpasstes nachladen, statt bis zum Raum-Neubetreten
            // blind zu bleiben. resync() ist bewusst leicht (kein teardown) → kein Rerender/Blank.
            // Dauer-Schwelle statt isMobile-Gate: ein echter App-Background dauert immer > 2 s, ein
            // kurzer Web-Tab-Blick nicht → im Web (wo welshman ohnehin selbst reconnectet) feuert
            // resync nicht bei jedem Tab-Wechsel (kein unnötiges Sub-Neusenden/Churn).
            this._onVisible = () => {
                if (document.visibilityState === 'hidden') {
                    this._hiddenAt = Date.now()
                    return
                }
                const wasBackgrounded = this._hiddenAt > 0 && Date.now() - this._hiddenAt > 2000
                this._hiddenAt = 0
                if (wasBackgrounded) {
                    this.resync()
                }
            }
            document.addEventListener('visibilitychange', this._onVisible)
        },
        setup(url: string) {
            this.teardown()
            this._url = url
            // **Woher kommt dieser Raum?** Solange er im Vereins-Space liegt — also fast
            // immer — bleibt der Hinweis leer und der Kopf sieht aus wie bisher. Steht der
            // Nutzer aber in einem WORKSPACE-Raum, sagt ihm bis hierher nichts, in welchem
            // Space er ist: der Kopf zeigt nur `# Raumname`, und der Navigator trägt oben
            // weiter den Vereins-Space (am 1440px-Lauf gemessen: Raum aus
            // `ws://localhost:3001/` offen, Rail-Kopf „Zooid Test Space").
            //
            // Verglichen wird gegen die PERSISTIERTE Wahl, nicht gegen `activeSpace`:
            // letzteres IST im Workspace-Raum der Workspace, der Vergleich wäre immer wahr
            // und der Hinweis nie sichtbar.
            const heimat = normalizeRelayUrl(get(activeSpaceUrl) ?? DEFAULT_SPACE_URL)
            this.spaceHint = url === heimat ? '' : spaceBranding(displayRelayUrl(url), getRelay(url)).label
            // P13: Der Read oben ist ein Schnappschuss — bei KALTEM Raum-Lauf (F5/Bookmark/
            // geteilter Link mit ?space=workspace) liest er den leeren Cache und friert den
            // Hinweis auf der URL-Form ein; das NIP-11-Doc trifft erst NACH dem Mount ein
            // (im Browser reproduziert: 10 s nach Ankunft unverändert localhost:3001). Das
            // korrigierende Abo läuft über dieselbe Ableitung, die die Insel für den Admin-
            // Status ohnehin hält (deriveUserIsSpaceAdmin → deriveRelay, members.ts) und die
            // den Fetch anstößt — kein zweiter synchroner Read, kein Poll. Dasselbe Muster
            // wie das isBuzz-Abo der Spaces-Insel. Warm (Cache gefüllt) feuert die Sub sofort
            // mit demselben Wert → No-op.
            this._unsubRelay = deriveRelay(url).subscribe((relay) => {
                this.spaceHint = url === heimat ? '' : spaceBranding(displayRelayUrl(url), relay).label
            })
            this._initialLoadDone = false // Resync erst nach diesem Load wieder erlauben (Prewarm-Race)
            this.loading = true
            this.membershipReady = false
            this.gatedOut = false
            this._gateRelistens = 0
            this.error = ''
            this.messages = []
            this.messagesReversed = []
            this.unread = 0
            this.atBottom = true
            this.hasMore = true // pro Raum zurücksetzen (sonst bliebe „Anfang erreicht" beim Space-Wechsel kleben)
            this.firstPaintDone = false
            // Trennlinien-Grenze EINMAL beim Betreten festhalten (Wall-Clock des letzten
            // Quittierens, `readState`). Bewusst ein Schnappschuss: markRead() schiebt das
            // Wasserzeichen während des Lesens weiter, die „Neu"-Linie darf einem dabei
            // aber nicht unter den Augen wegrutschen.
            this._lastRead = roomWatermark(get(readState), url, this.h)
            this._controller = new AbortController()
            // Deep-Link (C6b): /rooms/{h}/thread/{nevent} öffnet den Thread als Vollansicht —
            // eine DIREKT verlinkbare/teilbare URL (Reload/Bookmark öffnen denselben Thread).
            // Der nevent (bech32) wird zur Wurzel-id dekodiert; openThread lädt Wurzel+Baum
            // per id/#E selbst. EINMAL konsumiert: Reload = neue Insel-Instanz (öffnet erneut),
            // retry() im selben Leben nicht (kein ungewolltes Wieder-Aufpoppen nach Schließen).
            if (this._deepThreadNevent) {
                const nevent = this._deepThreadNevent
                this._deepThreadNevent = null
                try {
                    const dec = nip19.decode(nevent)
                    const rootId = dec.type === 'nevent' ? dec.data.id : dec.type === 'note' ? dec.data : ''
                    if (rootId) {
                        // push=false: die URL IST bereits /rooms/{h}/thread/{nevent} (Deep-Link/Reload) —
                        // kein zusätzlicher history-Eintrag. Back räumt via replaceState auf den Raum zurück.
                        this.openThread({ id: rootId } as ChatMessage, true, false)
                    }
                } catch {
                    // Kaputter nevent im Pfad → kein Thread, kein Fehler.
                }
            }
            // Kein Virtualizer mehr (Flotilla-Ansatz): der `flex-col-reverse`-Container pinnt den
            // Boden NATIV, ältere Nachrichten voranstellen verschiebt die Leseposition nicht → kein
            // Höhen-Messen, kein Spacer, kein Anker-Rechnen, kein Ruckeln. Ältere lädt ein schlichter
            // Scroller nach, sobald man nahe an den oberen (ältesten) Rand scrollt. Pro Raum frisch;
            // in $nextTick, damit $refs.scroll gemountet ist. Teardown stoppt ihn.
            const magics = this as unknown as AlpineMagics
            magics.$nextTick(() => {
                const el = magics.$refs.scroll as HTMLElement | undefined
                if (el && this._url === url) {
                    this._scroller?.stop()
                    this._scroller = createScroller(el, () => this.loadOlder())
                }
            })
            // Raum-Metas + Mitglieder (39002) laden; Live-Sub auf 39002, damit
            // Beitreten/Verlassen sofort reflektiert. `membershipReady` verhindert
            // ein Aufblitzen des Beitreten-Hinweises, bevor die 39002 da ist.
            loadSpaceRooms(url).finally(() => {
                this.membershipReady = true
            })
            listenRoomMembers(url, this._controller.signal)
            // Space-Directory (13534) als @-Mention-Quelle laden + live halten (C4).
            // Der Raum lädt es sonst nicht (nur die Directory-Seite tut das) → ohne
            // dies bliebe die Mitgliederliste leer. Profile lazy nachwärmen, damit
            // Vorschläge Namen statt npub zeigen.
            void loadSpaceDirectory(url)
            watchSpaceDirectory(url, this._controller.signal)
            this._unsubMembers = deriveSpaceDirectory(url).subscribe((dir: DirectoryView) => {
                this._members = dir.members.map((m) => ({
                    pubkey: m.pubkey,
                    npub: m.npub,
                    name: m.name,
                    picture: m.picture,
                    search: m.search,
                }))
                const missing = dir.members.map((m) => m.pubkey).filter((pk) => !this._loadedProfiles.has(pk))
                if (missing.length) {
                    missing.forEach((pk) => this._loadedProfiles.add(pk))
                    loadMemberProfiles(url, missing)
                }
            })
            this._unsubJoined = deriveUserInRoom(url, this.h).subscribe((isMember: boolean) => {
                this.joined = isMember
            })
            // P2/NIP-38: der dritte Zustand der Statusspalte. Er hängt an der Relay-Weiche
            // aus P1 und nicht an den Daten — deshalb eine eigene Subscription und kein
            // abgeleitetes `messages.length === 0`: „noch nicht bekannt" ist eine Aussage
            // über den RELAY, nicht über die Autoren.
            this._unsubStatusPending?.()
            this._unsubStatusPending = deriveStatusPending(url).subscribe((pending: boolean) => {
                this.statusPending = pending
            })
            // Admin-Status des aktiven Space (P1): gatet die Moderations-Einträge im
            // Nachrichten-Menü. Relay-autoritativ (SupportedMethods), pubkey-abhängig →
            // beim Login-Wechsel/Space-Wechsel neu (setup läuft dann ohnehin erneut).
            this._unsubAdmin = deriveUserIsSpaceAdmin(url).subscribe((admin: boolean) => {
                this.isAdmin = admin
            })
            // Raum-Anzeigename aus der Client-Meta (39000) reaktiv nachziehen — der
            // SSR-Header trägt bei member-only-Relays nur den Slug (Server hat keine
            // AUTH). `url` ist bereits normalisiert (activeSpace), roomsByUrl ebenso.
            this._unsubRoomMeta = roomsByUrl.subscribe(($byUrl) => {
                const room = ($byUrl.get(url) ?? []).find((r) => r.h === this.h)
                if (room?.name) {
                    this.roomName = room.name
                    // Meta-/Tab-Titel clientseitig auf den echten Raumnamen setzen: der server-
                    // gerenderte Titel fällt bei SpaceCache-Miss auf die rohe Raum-id zurück
                    // (`# <h>`); sobald die Insel den Namen aus 39000/9007 auflöst, korrigieren.
                    document.title = `# ${room.name}`
                }
                // P3: Forum-Kanal? Dieselbe Quelle, derselbe Emit — der Kanaltyp
                // steht im selben 39000 wie der Name. Sobald er da ist, zieht die
                // Fläche einmal um (Verlauf → Themenliste) und `startForum()`
                // beschafft den Bestand. Der Weg ZURÜCK (`isForum` fällt wieder
                // auf false) ist bewusst nicht gebaut: ein Kanal wechselt seinen
                // Typ am Relay nicht, und ein erfundener Rückweg wäre toter Code.
                // Aus den ROH-Tags des 39000, wie in `buildSpaceView`: welshmans
                // `readRoomMeta` liest `t` nicht, `Room` trägt den Kanaltyp also nicht.
                if (!this.isForum && parseForumTag(room?.event?.tags ?? [])) {
                    this.isForum = true
                    this.startForum(url)
                }
            })
            // P11: Ablehnung des Relays von der Live-Sub ableiten. Für ein
            // ANGEMELDETES Relay-Nicht-Mitglied kommt JEDE Sub dieser Seite mit
            // `CLOSED restricted: …` zurück (gemessen, p11-05) — AUTH wurde
            // angenommen, der Read verweigert. `onClosed(reason)` ist der einzige
            // Weg, der den GRUND trägt (load().onClose feuert ohne Argument und
            // zusätzlich im Timeout-Pfad, siehe feeds.ts listenRoom). Nur das
            // `restricted:`-Präfix setzt den Zustand: andere CLOSED-Gründe (z. B.
            // Rate-Limit) sagen nichts über die Berechtigung und ändern die Fläche
            // nicht. Für einen Gast feuert onClosed nie (`auth-required:` wird vom
            // Auth-Buffer entfernt) — sein Gate regelt weiterhin der `authed`-Zweig
            // aus P4. Kein zweiter Read: die Live-Sub läuft ohnehin (listenRoom).
            // Reaktiv statt Poll: der Zustand steht mit dem ersten restricted-CLOSED
            // (~0,5 s nach Betreten, p11-05) und wird je Raum im setup() zurückgesetzt.
            //
            // P8: Der Grund wird nicht mehr auf sein Präfix reduziert, sondern
            // zugeordnet (siehe roomGate.ts) — `restricted: channel access revoked`
            // ist bei Buzz KEINE Zugriffsverweigerung, sondern die Quittung einer
            // geänderten RAUM-Mitgliedschaft.
            listenRoom(url, this.h, this._controller.signal, (reason: string) => this.onRoomClosed(url, reason))
            // Bestehende Reactions/Tombstones nachladen (Live-Sub liefert nur Neues).
            // Promise fürs Prewarm-Gate behalten: der Reveal wartet (budgetiert) darauf.
            const reactionsReady = loadRoomReactions(url, this.h)
            // Selbstreparatur: gespeicherte NIP-29-9005 (Admin-Löschungen) nachladen und
            // anwenden — holt eine Löschung nach, die dieser Client offline verpasst hat
            // (der Warm-Cache hätte die Nachricht sonst wieder auferstehen lassen).
            void loadRoomDeletes(url, this.h)
            // NIP-22-Kommentare (kind 1111) nachladen, damit die Antworten-Indikatoren
            // schon beim ersten Paint stimmen (Live-Sub = nur Neues). Ohne #h (flotilla-kompat).
            void loadRoomComments(url)
            // Poll-Responses (kind 1018) fürs Tally nachladen — NICHT die Poll-Karten (1068) selbst:
            // die kommen jetzt übers gepagte roomFilter (limit:50 + loadOlder), liegen also IMMER im
            // geladenen Fenster → sofort vermessen → kein Off-screen-Estimate → kein mittiger Sprung.
            // Goals (kind 9041) ebenso: kommen übers Paging, Beiträge über loadRoomZaps (Feed-IDs) —
            // kein eigener Bulk-Load mehr nötig. pollsReady bleibt im Reveal-Gate, damit das Tally
            // einer bodennah geladenen Poll am First Paint stimmt.
            const pollsReady = loadRoomPolls(url, this.h)
            // Custom-Emoji (NIP-30) des eigenen Profils vorwärmen, solange die
            // Relay-Verbindung frisch AUTH'd ist — beim späteren Picker-Öffnen
            // würde ein one-shot-Load gegen den member-only Relay sonst hängen.
            //
            // ERST WENN DER PUBKEY STEHT, und das ist der eigentliche Punkt:
            // `loadUserCustomEmojis()` steigt ohne Pubkey mit einem leeren Ergebnis
            // aus und legt dabei KEINEN Cache-Eintrag an (siehe dort). Lief die
            // Vorwärmung zu früh, verpuffte sie folgenlos — und der volle Load
            // passierte erst beim Öffnen des Pickers, mitsamt den vier zusätzlichen
            // Relay-Verbindungen aus DEFAULT_RELAYS. Jede davon kann NIP-42-AUTH
            // verlangen, und AUTH läuft über den Signer; bei einem NIP-46-Bunker ist
            // das ein Roundtrip pro Relay. Genau dann meldet die Kopfzeile „Signer
            // antwortet langsam" (Schwelle: Mittel über 1000 ms, s. signer-health.ts)
            // — und der Picker wartet, statt aufzugehen.
            //
            // Beim Login per nsec ist der Pubkey sofort da und dieser Zweig kostet
            // nichts. Beim Bunker kommt er erst, wenn die Verbindung steht.
            const warmCustomEmojis = () => {
                if (pubkey.get()) {
                    void loadUserCustomEmojis()
                    return
                }
                let unsub: (() => void) | undefined
                unsub = pubkey.subscribe((pk) => {
                    if (!pk) {
                        return
                    }
                    void loadUserCustomEmojis()
                    unsub?.()
                })
                // Raumwechsel/Abbruch, bevor je ein Pubkey kam: sonst bliebe je
                // besuchtem Raum eine Subscription auf dem Store liegen.
                this._controller?.signal.addEventListener('abort', () => unsub?.(), { once: true })
            }
            warmCustomEmojis()
            // Das Standard-Set (emojibase, ~89 kB gzip als eigener Chunk) ebenfalls
            // vorwärmen — aber erst, wenn der Hauptthread nichts Besseres zu tun hat.
            // Vorher lud es erst BEIM KLICK auf den Picker, und zwar über den ganzen
            // Weg: Download, Modul-Eval, Indizierung, Grid-Aufbau. Im Idle vorgeladen
            // ist beim Öffnen nur noch das Markup zu bauen.
            //
            // `requestIdleCallback` und nicht sofort: der Raum-Init hat hier gerade
            // Feed, Polls und Profile in der Leitung, und ein Emoji-Grid, das niemand
            // geöffnet hat, darf keinem davon die Bandbreite nehmen. Der Timeout ist
            // die Obergrenze, falls der Thread nie ruhig wird. Safari kennt
            // `requestIdleCallback` bis heute nicht — dort der setTimeout-Fallback.
            const warmEmoji = () => {
                void loadEmojiGroups()
            }
            const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
                .requestIdleCallback
            if (typeof ric === 'function') {
                ric(warmEmoji, { timeout: 4000 })
            } else {
                setTimeout(warmEmoji, 2000)
            }
            // Feed-Subscription als Factory: erst NACH dem Viewport-Prewarm abonnieren, damit
            // der erste (synchrone, leading-edge) Emit schon Reaction-/Zap-Chips trägt → First
            // Paint und scrollToBottom sind warm; es folgt keine chip-einblendende zweite Welle.
            // (Handler-Body bewusst nicht umeingerückt gehalten → minimaler Diff.)
            const startFeed = () => {
            // rAF-Coalescing: `deriveRoomMessages` ist bewusst UNgedrosselt (instant own-message),
            // beim Kaltstart streamt der Verlauf aber als Event-Burst herein → ein Emit je Nachricht.
            // Jeder Emit rebuildet die ganze Liste UND morpht das komplette `x-for` (Full-DOM, kein
            // Virtualizer) → der Main-Thread pegt und Touches feuern erst, wenn alles geladen ist.
            // Wir merken nur den LETZTEN Emit und rendern höchstens einmal pro Frame; der Browser
            // arbeitet zwischen den Frames die Touch-Queue ab. Eigene/neue Nachricht: ≤1 Frame (~16ms).
            const applyMsgs = (msgs: ChatMessage[]) => {
                // column-reverse + Full-DOM: der Container pinnt den Boden NATIV — kein manueller
                // scrollTop-Pfad, kein Anker, keine Höhenmessung. Hier nur: Daten übernehmen (inkl.
                // reversed-Sicht fürs Rendering), Profile/Zaps nachladen, Ungelesen-Zähler pflegen.
                const prevIds = new Set(this.messages.map((m) => m.id))
                const prevNewest = this.messages.length ? this.messages[this.messages.length - 1].created_at : 0
                // Stand der Nutzer (nahe) am Boden? Dann klebt column-reverse automatisch an neuen
                // Nachrichten (→ nichts ungelesen); sonst zählen wir sie. atBottom pflegt onScroll.
                const atEnd = !this.firstPaintDone || this.atBottom

                this.messages = msgs
                // Reversed fürs `flex-col-reverse`-Rendering (newest-first als Flex-Items → neweste
                // am Boden). `this.messages` bleibt aufsteigend für loadOlder/scrollToMessage.
                this.messagesReversed = msgs.slice().reverse()

                // Profile neuer Autoren nachladen (einmal je pubkey).
                const missing = msgs
                    .map((m) => m.pubkey)
                    .filter((pk) => !this._loadedProfiles.has(pk))
                if (missing.length > 0) {
                    missing.forEach((pk) => this._loadedProfiles.add(pk))
                    loadMemberProfiles(url, missing)
                }

                // Bestehende Zap-Receipts (9735) neuer Nachrichten laden (je ID einmal).
                // 9735 trägt kein `#h` → über `#e` der geladenen IDs (feeds.loadRoomZaps).
                const newZapIds = msgs.map((m) => m.id).filter((id) => !this._zapLoadedIds.has(id))
                if (newZapIds.length > 0) {
                    newZapIds.forEach((id) => this._zapLoadedIds.add(id))
                    void loadRoomZaps(url, newZapIds)
                }

                // Nur wirklich am Ende angehängte Fremd-Nachrichten zählen (kein loadOlder-Prepend
                // via created_at, keine eigenen) — und nur, wenn wir NICHT am Boden klebten.
                if (!atEnd) {
                    this.unread += msgs.filter(
                        (m) => !prevIds.has(m.id) && !m.mine && m.created_at >= prevNewest,
                    ).length
                }
                if (!this.firstPaintDone) {
                    // column-reverse startet nativ am Boden (scrollTop 0 = neueste) — kein Settle,
                    // kein Anker, keine Messung nötig. Reveal erst nach dem Render (nextTick), damit
                    // kein leerer Frame aufblitzt (Liste ist bis firstPaintDone opacity-0); url-Guard
                    // gegen einen stale Raum bei schnellem Wechsel.
                    ;(this as unknown as AlpineMagics).$nextTick(() => {
                        if (this._url === url) {
                            this.firstPaintDone = true
                        }
                    })
                }
            }
            this._unsub = deriveRoomChat(url, this.h, this._lastRead).subscribe((msgs: ChatMessage[]) => {
                this._pendingMsgs = msgs
                if (this._rafMsgs) {
                    return // schon ein Frame eingeplant → nur den neuesten Stand merken
                }
                this._rafMsgs = requestAnimationFrame(() => {
                    this._rafMsgs = 0
                    const pending = this._pendingMsgs
                    this._pendingMsgs = null
                    if (pending && this._url === url) {
                        applyMsgs(pending)
                    }
                })
            })
            }
            // Viewport-Prewarm (Schritt 2): Verlauf laden, dann die Zap-Receipts des geladenen
            // Fensters sofort nachziehen und den Reveal kurz halten, bis Reactions (raumweit) +
            // Zaps da sind — mit hartem Zeitbudget, damit ein langsamer/abgelehnter Relay den
            // Verlauf nie blockiert. Erst danach startFeed(): der erste Emit ist warm.
            const signal = this._controller?.signal
            const PREWARM_BUDGET_MS = 700

            // Warme Rückkehr: liegt der Raum schon im welshman-Repository (A→B→A), sofort
            // abonnieren → Instant-Paint aus dem Cache (sonst blitzt das Skeleton für die volle
            // load()-Runde, obwohl alles da ist). Chips sind dann ebenfalls warm → kein Nachwachsen.
            // Nur bei KALTEM Repository gaten wir den Reveal über den Prewarm unten.
            let warm = false
            const peek = deriveRoomMessages(url, this.h).subscribe((evs) => {
                warm = evs.length > 0
            })
            peek()
            if (warm) {
                startFeed()
                this.loading = false
            }

            // Kaltstart-Race, siehe finally: kam der Verlauf LEER vom Relay zurück?
            let netloadEmpty = false
            loadRoomMessages(url, this.h)
                .then(
                    (events) => {
                        netloadEmpty = events.length === 0
                        if (signal?.aborted) {
                            return // Raumwechsel während Prewarm → keine verwaisten Loads/State-Bleed
                        }
                        // Zap-Receipts der noch nicht angeforderten IDs laden (statt erst im
                        // Emit-Handler). Filter über _zapLoadedIds: der warme Pfad hat via
                        // startFeed-Handler evtl. schon geladen+markiert → kein Doppel-Load.
                        const ids = events.map((e) => e.id)
                        // Roh geladene IDs merken → loadOlder-Terminierung (hasMore) vergleicht
                        // gegen die tatsächlich GELADENEN kind-9, nicht gegen die gefilterte Anzeige.
                        ids.forEach((id) => this._loadedMsgIds.add(id))
                        const newIds = ids.filter((id) => !this._zapLoadedIds.has(id))
                        newIds.forEach((id) => this._zapLoadedIds.add(id))
                        const zapsReady = loadRoomZaps(url, newIds).catch(() => [])
                        const authors = [...new Set(events.map((e) => e.pubkey))]
                        // Zapper der Autoren früh (fire-and-forget) anwärmen, damit der ⚡-Chip so
                        // früh wie möglich erscheint. BEWUSST NICHT im Reveal-Gate: welshmans
                        // fetchZapper hat ein fixes 800ms-Batch-Fenster (> Budget) nach einem
                        // loadProfile-Roundtrip → wäre nie rechtzeitig warm und würde den Reveal nur
                        // ans Zeitlimit pinnen statt bei Reactions+Zaps (~200-400ms) früh zu gewinnen.
                        warmZappers(authors)
                        // Profile (Name/Avatar) INS Gate (Schritt 4): anders als Zapper/NIP-05 ist der
                        // Server-Cache (GET /nostr/profiles, ProfileCache.php) schnell → Name+Avatar sind
                        // am First Paint warm, kein npub→Name-Flash und kein Breiten-Ruck (Badge/Uhrzeit).
                        // Budget-gekappt; warmProfiles rejectet nie (seedChunk fängt intern).
                        const profilesReady = warmProfiles(authors)
                        return Promise.race([
                            Promise.all([
                                reactionsReady.catch(() => []),
                                zapsReady,
                                profilesReady,
                                pollsReady.catch(() => []),
                            ]),
                            new Promise((resolve) => setTimeout(resolve, PREWARM_BUDGET_MS)),
                        ])
                    },
                    () => {
                        // welshman load() rejected NICHT bei totem/AUTH-ablehnendem Relay (es
                        // resolved leer) → dieser Zweig ist defensiv/selten. Guard trotzdem, damit
                        // ein spät rejectetes altes Room seinen Fehler nicht aufs neue Room klebt.
                        if (signal?.aborted) {
                            return
                        }
                        this.error = t('Der Verlauf konnte nicht geladen werden — Relay nicht erreichbar?')
                    },
                )
                .finally(() => {
                    if (signal?.aborted) {
                        return // Raum inzwischen gewechselt → weder abonnieren noch loading kippen
                    }
                    if (!warm) {
                        startFeed() // kalt: erst nach dem Prewarm → warmer First Paint
                    }
                    this.loading = false
                    this._initialLoadDone = true // ab jetzt darf ein Foreground-Resync greifen
                    // Kaltstart-Race: Ein Notification-Tap lädt die Seite NEU (MainActivity →
                    // webView.loadUrl), während Socket UND NIP-42-AUTH nach langer Pause tot sind.
                    // welshmans load() rejected dabei NICHT (siehe error-Zweig oben) — es resolved
                    // LEER. Ohne Gegenwehr bliebe der Verlauf für immer auf dem Cache-Stand und die
                    // Live-Sub (auf demselben toten Socket gesendet) stumm, bis der Raum neu betreten
                    // wird. Der visibilitychange-Resync greift hier NICHT: diese Insel wurde erst
                    // NACH dem Foreground geboren und sieht nie ein `hidden` (am Emulator gemessen).
                    // Ein leerer Netz-Load bei GEFÜLLTEM Cache ist der Widerspruch, der den Race
                    // verrät: das Relay muss mindestens die Nachrichten haben, die wir schon kennen.
                    // Ein wirklich leerer Raum hat auch keinen Cache → kein Fehlalarm.
                    // ponytail: EIN resync() (sendet die Live-Subs neu + holt nach und bringt seinen
                    // eigenen 2,5s-Nachzügler gegen den Socket-Race mit); kein Reconnect-Framework.
                    if (netloadEmpty && this.messages.length > 0) {
                        this.resync()
                    }
                })
        },
        // Ältere Nachrichten vor der aktuell ältesten laden; Scroll-Position halten.
        loadOlder() {
            // hasMore-Guard MUSS hier sitzen: der rAF-Scroller (createScroller) ruft loadOlder
            // ungebremst, sobald man nahe am ältesten Rand steht. Ohne den Guard würde er nach
            // erschöpfter History die Grenzseite endlos (~alle 300ms) neu vom Relay holen —
            // früher gaten das die entfernten Aufrufer (maybePrefetch/„Ältere laden"-Button).
            if (this.loadingMore || !this.hasMore || !this._url || this.messages.length === 0) {
                return
            }
            this.loadingMore = true
            const oldest = this.messages[0].created_at
            // KEINE eigene Scroll-Mathematik mehr (Schritt 5): der deriveRoomChat-Emit-Handler
            // kompensiert den Prepend anker-basiert (die erste sichtbare Nachricht bleibt an ihrem
            // Viewport-Offset) — EIN Owner für scrollTop, kein Race mit dem Handler, und
            // position-agnostisch, sodass Schritt 6 beliebig früh/off-screen prefetchen kann.
            // loadOlder triggert nur noch den Load; der Handler feuert ohnehin bei jedem Emit.
            loadRoomMessages(this._url, this.h, oldest)
                .then((events) => {
                    // Terminierung gegen die ROH geladenen IDs (welshmans `until` ist inklusiv +
                    // frischer Tracker pro Load → die Grenzseite kommt immer zurück; `length===0`
                    // wäre unerreichbar). Kein STRIKT neues kind-9 = Anfang erreicht. Roh-Vergleich,
                    // weil `this.messages` Poll-Share-Quotes wegfiltert → sonst nie hasMore=false.
                    const gotNew = events.some((e) => !this._loadedMsgIds.has(e.id))
                    events.forEach((e) => this._loadedMsgIds.add(e.id))
                    if (!gotNew) {
                        this.hasMore = false
                    }
                })
                .finally(() => {
                    this.loadingMore = false
                })
        },
        onScroll() {
            const el = (this as unknown as AlpineMagics).$refs.scroll as HTMLElement | undefined
            if (!el) {
                return
            }
            // column-reverse: Boden = scrollTop ≈ 0 (Vorzeichen browserabhängig → Math.abs).
            const offset = Math.abs(el.scrollTop)
            this.atBottom = offset < 60
            if (this.atBottom) {
                this.unread = 0
                this.markRead()
            }
            // WebView-Fallback fürs Nachladen: der rAF-Scroller (createScroller) läuft im Android-
            // WebView beim ersten Raum-Mount nicht immer an (rAF-Drosselung rund um wire:navigate +
            // hinter storageReady verzögertes setup()) → ältere Nachrichten würden bis zum Raum-
            // Neubetreten nie geladen. Das native Scroll-Event feuert dagegen zuverlässig (sonst
            // gäbe es den atBottom-abhängigen Scroll-Button nicht), also hier ebenfalls nahe am
            // ältesten (oberen) Rand nachladen. loadOlder ist per loadingMore/hasMore geguardet
            // (kein Doppel-Load), die Prepend-Anker-Kompensation macht der deriveRoomChat-Handler.
            if (offset + el.clientHeight + 1500 > el.scrollHeight) {
                this.loadOlder()
            }
        },
        // „Zum Ende"-Button + Composer-Fokus: column-reverse → top:0 ist der Boden (neueste).
        scrollToBottom() {
            const el = (this as unknown as AlpineMagics).$refs.scroll as HTMLElement | undefined
            el?.scrollTo({ top: 0, behavior: 'smooth' })
            this.atBottom = true
            this.unread = 0
            this.firstPaintDone = true
            this.markRead()
        },
        // Zur zitierten Original-Nachricht springen + kurz hervorheben. Full-DOM: der Knoten
        // #msg-{id} existiert, sobald die Nachricht geladen ist → scrollIntoView; sonst (älter als
        // der Verlauf) passiert nichts — kein Nachladen (Scope).
        scrollToMessage(id: string) {
            const node = document.getElementById('msg-' + id)
            if (!node) {
                return
            }
            node.scrollIntoView({ block: 'center' })
            this.flashId = id
            // ponytail: schlichter Timeout-Highlight statt Animation-Lib
            setTimeout(() => {
                if (this.flashId === id) {
                    this.flashId = null
                }
            }, 1400)
        },
        // Link aus dem Nachrichtentext öffnen. In der nativen App über den In-App-Browser
        // (Custom Tab / SFSafariViewController) — ein `target=_blank`-Anker verpufft in der
        // WebView WIRKUNGSLOS, genau darum waren Chat-Links auf dem Gerät „nicht klickbar"
        // (im Web hat immer alles funktioniert). Gleiche Behandlung wie der Vereins-Beitritts-
        // Link (nostrVereinGate.openExternal). Im Web kein preventDefault → normaler Anker.
        openChatLink(url: string, e: Event) {
            if (isMobile) {
                e.preventDefault()
                void nativeBrowserInApp(url)
            }
        },
        // Composer-Textarea mit dem Inhalt wachsen lassen (bis ~9rem), dann scrollt sie.
        autoGrow(el: HTMLTextAreaElement) {
            el.style.height = 'auto'
            el.style.height = Math.min(el.scrollHeight, 144) + 'px'
        },
        /**
         * Raum bis hierher gesehen quittieren — mit der **Wall-Clock dieses Geräts**,
         * nicht mit dem `created_at` der jüngsten Nachricht.
         *
         * `created_at` ist autorgesetzt (NIP-01): eine einzige Nachricht mit
         * `created_at = jetzt + 1 Jahr` quittierte vorher alles bis 2027 als gelesen,
         * und das Wasserzeichen ist der einzige Zustand, der die Navigation überlebt.
         * `setRead` schreibt monoton (`Math.max`) → eine rückwärts laufende Uhr kann
         * einen gelesenen Raum nie wieder auf ungelesen ziehen.
         *
         * Die Aufrufer sind alle am Boden geguardet (onScroll nur bei `atBottom`,
         * scrollToBottom setzt es selbst, destroy() prüft es) — „Raum betreten" allein
         * quittiert NICHT. Die frühere Bedingung `messages.length === 0` entfällt: mit
         * Wall-Clock ist „ich habe hingesehen, da war nichts" eine gültige Aussage.
         */
        markRead() {
            if (!this._url) {
                return
            }
            setRead(roomKey(this._url, this.h))
        },
        /**
         * Zieht die Forum-Fläche auf: Bestand laden, Live-Sub, Themenliste
         * abonnieren. Aufgerufen aus der Raum-Meta-Subscription, sobald der
         * Kanaltyp `forum` bekannt ist — nicht in `setup()`, weil er dort noch
         * nicht bekannt IST (das 39000 kommt vom Relay).
         *
         * `_forumStarted` ist der Riegel gegen Mehrfachstart: `roomsByUrl`
         * emittiert bei jedem eintreffenden 39000 des Relays erneut, und ein
         * zweiter Live-Request für denselben Kanal wäre ein zusätzlicher Frame im
         * Ratenbudget des Relays, ohne eine einzige neue Nachricht zu liefern.
         */
        startForum(url: string) {
            if (this._forumStarted) {
                return
            }
            this._forumStarted = true
            this.topicsLoading = true
            const signal = this._controller?.signal
            if (signal) {
                listenForum(url, this.h, signal)
            }
            void loadForumTopics(url, this.h).finally(() => {
                // Nur für DIESEN Raum quittieren: bei schnellem Raumwechsel läuft
                // der alte Load weiter und dürfte die neue Fläche nicht öffnen.
                if (this._url === url) {
                    this.topicsLoading = false
                }
            })
            this._unsubTopics?.()
            this._unsubTopics = deriveForumTopics(url, this.h).subscribe((rows: ForumTopic[]) => {
                this.topics = rows
            })
        },
        openTopic(topic: ForumTopic) {
            // `openThread` braucht von der Wurzel genau zwei Felder: `id` (Thread-Wurzel,
            // Live-Sub, Deep-Link) und `pubkey` (Autor im `nevent`). Den KIND holt
            // `neventFor` selbst aus dem Repository — dort steht 45001, und genau das
            // gehört in den geteilten Link.
            this.openThread({ id: topic.id, pubkey: topic.pubkey } as ChatMessage)
        },
        teardown() {
            this._controller?.abort()
            this._unsub?.()
            this._unsub = null
            if (this._rafMsgs) {
                cancelAnimationFrame(this._rafMsgs) // koaleszierten Render nicht in einen abgebauten/gewechselten Raum feuern
                this._rafMsgs = 0
            }
            this._pendingMsgs = null
            this._unsubJoined?.()
            this._unsubJoined = null
            this._unsubMembers?.()
            this._unsubMembers = null
            this._unsubAdmin?.()
            this._unsubAdmin = null
            this._unsubRoomMeta?.()
            this._unsubRoomMeta = null
            this._unsubRelay?.()
            this._unsubRelay = null
            this._unsubStatusPending?.()
            this._unsubStatusPending = null
            // Forum (P3): Abo lösen UND den Startriegel zurücksetzen — sonst bliebe
            // beim Wechsel Forum → Forum die Liste des ALTEN Kanals stehen, weil
            // `startForum` sich für „schon gestartet" hielte.
            this._unsubTopics?.()
            this._unsubTopics = null
            this._forumStarted = false
            this.isForum = false
            this.topics = []
            this.topicsLoading = true
            this._zapSub?.abort()
            this._zapSub = null
            this._zapLoadedIds.clear()
            evictChatMsgCache(this._loadedMsgIds) // Memo-Cache des verlassenen Raums freigeben (vor clear)
            this._loadedMsgIds.clear()
            this._scroller?.stop()
            this._scroller = null
            this.closeMentions()
            this.cancelCrop() // offenen Cropper + Object-URL freigeben (Raumwechsel)
            this.closeThread() // offenes Thread-Overlay + Live-Sub abbauen (Raumwechsel)
        },
        // App-Foreground-Resync (aus dem visibilitychange-Listener in init()): NUR die Live-
        // Subscriptions auf einem frischen AbortController neu senden + je EIN Catch-up-Load —
        // KEIN teardown, kein Zurücksetzen von messages/scroll/firstPaintDone. Der bestehende
        // deriveRoomChat-`_unsub` (reine Store-Subscription, im Hintergrund nie gestorben) malt
        // die nachgeladenen Events additiv → keine Bewegung/kein Rerender der Seite. Guard auf
        // `_unsub`: läuft erst NACH abgeschlossenem setup() (sonst würde das Abort den initialen
        // load()-Pfad kappen, bevor startFeed() lief). loading==true ⇒ setup arbeitet noch → skip.
        /**
         * P8: Was der Relay meint, wenn er die Raum-Sub schließt.
         *
         * Bis hierher galt jedes `restricted:` als dasselbe — „kein Zugriff", Gate,
         * kein Beitreten-Knopf. Am Buzz-Teststack gemessen (2026-08-17) sind es aber
         * zwei Lagen mit zwei verschiedenen Auswegen:
         *
         * - **`restricted: channel access revoked`** — die RAUM-Mitgliedschaft hat
         *   sich geändert (eigener Austritt per 9022, Entfernen durch einen Admin,
         *   Archivieren, offen→privat — beim Umschalten allerdings NUR an
         *   Nicht-Mitglieder, gemessen in N8, siehe `roomGate.ts`). Der
         *   Relay-Zugang besteht weiter; ob der Raum
         *   noch lesbar ist, sagt der Grund NICHT. Also wird er nicht geraten,
         *   sondern **erfragt**: derselbe Filter wird neu aufgesetzt, und dessen
         *   Antwort entscheidet (`EOSE` → weiterhin lesbar, der Nutzer ist schlicht
         *   kein Raum-Mitglied mehr und sieht den Beitreten-Weg; erneutes
         *   `restricted:` → Gate). Das repariert zugleich die tote Live-Sub: welshman
         *   sendet einen abgerissenen REQ nicht neu, der Raum bliebe sonst auch nach
         *   einem Wiederbeitritt stumm auf dem letzten Stand stehen.
         * - **alles andere mit `restricted:`** — Zugriffsverweigerung, Gate. Das
         *   schließt den unbekannten Grund ausdrücklich ein (Allowlist in
         *   `roomGate.ts`): ein Beitreten-Knopf, der ins Leere klickt, ist teurer als
         *   ein Gate zu viel.
         *
         * Der Deckel begrenzt eine theoretische Schleife (Relay schließt die frisch
         * aufgesetzte Sub sofort wieder mit demselben Grund). Ist er aufgebraucht,
         * wird gegated — dieselbe sichere Richtung wie beim unbekannten Grund.
         */
        onRoomClosed(url: string, reason: string) {
            // Raumwechsel/Teardown während des Fluges: die Antwort gehört nicht mehr hierher.
            if (this._destroyed || this._url !== url) {
                return
            }
            const verdict = classifyRoomClosedReason(reason)
            if (verdict === 'unrelated') {
                return
            }
            // P9 — die Mitgliedschaft NACHFÜHREN, und zwar vor jeder Fläche-Entscheidung.
            //
            // Beide verbleibenden Urteile sagen dasselbe über die eigene Mitgliedschaft:
            // wir können sie nicht mehr belegen. `joined` speiste sich bis hier allein aus
            // der 39002 — und die wurde nur nach dem EIGENEN Join/Leave nachgeladen. Ein
            // Rauswurf durch einen Admin (kind 9001) erreichte die Insel deshalb nie: das
            // Gate stand, und daneben ein Eingabefeld, dessen Absenden am Relay scheitert.
            //
            // Der Aufruf steht bewusst VOR dem Deckel und vor `gatedOut`: ob wir die
            // Raum-Sub noch einmal aufsetzen dürfen, ist eine Frage unseres Budgets —
            // dass der Relay uns gerade die Mitgliedschaft entzogen hat, ist eine Tatsache,
            // die davon nicht abhängt. Der Composer verschwindet danach als FOLGE
            // (`deriveUserInRoom` → `joined`), nicht durch eine eigene Regel.
            void revokeRoomMembership(url, this.h)
            if (verdict === 'blocked') {
                this.gatedOut = true
                return
            }
            if (this._gateRelistens >= ROOM_GATE_MAX_RELISTENS) {
                this.gatedOut = true
                return
            }
            this._gateRelistens += 1
            const signal = this._controller?.signal
            if (!signal) {
                return
            }
            // `gatedOut` bewusst NICHT auf false gesetzt: ein Mitgliedschafts-Wechsel
            // darf ein bereits gesetztes Gate nie aufheben. Er war in dieser Lage
            // ohnehin false — sonst wäre die Sub nie gelaufen.
            listenRoomScoped(url, this.h, signal, (next: string) => this.onRoomClosed(url, next))
        },
        resync() {
            // Guard auf _initialLoadDone (NICHT bloß loading/_unsub): der warme setup()-Pfad setzt
            // loading=false + _unsub schon, während der initiale loadRoomMessages().then noch läuft;
            // ein Resync in diesem Fenster würde dessen Controller abbrechen → _loadedMsgIds bliebe
            // leer (kaputte Pagination-Terminierung). _initialLoadDone kippt erst im setup-finally.
            if (!this._url || this._destroyed || !this._initialLoadDone) {
                return
            }
            const url = this._url
            this._controller?.abort()
            this._controller = new AbortController()
            const signal = this._controller.signal
            // P6: Das Wiederaufsetz-Budget gehört zu EINER Sub-Generation, nicht zur
            // Lebenszeit der Insel. Hier beginnt eine neue: der alte Controller ist
            // abgebrochen, gleich läuft ein frischer `listenRoom`. Ohne das Zurücksetzen
            // stünde ein Nutzer, der die App lange offen hält, irgendwann mit
            // aufgebrauchtem Budget da und bekäme beim nächsten Mitgliedschafts-Wechsel
            // ein Gate, das der Raum nicht hergibt. Der Deckel bleibt wirksam, wo er
            // gemeint ist — gegen die enge Schleife (Relay schließt die frische Sub
            // sofort wieder), denn die läuft ohne Resync dazwischen.
            this._gateRelistens = 0
            // Live-Subs neu senden (der erste REQ-Send öffnet den Socket via socketPolicyConnectOnSend
            // wieder) …
            // Mit demselben `onClosed` wie in setup(): ohne ihn verlöre der Raum nach
            // jedem Foreground-Resync seine Ablehnungs-Auswertung — das Gate (P11) und
            // das Wiederaufsetzen nach einem Mitgliedschafts-Wechsel (P8) hingen dann
            // allein am ersten Betreten.
            listenRoom(url, this.h, signal, (reason: string) => this.onRoomClosed(url, reason))
            listenRoomMembers(url, signal)
            watchSpaceDirectory(url, signal)
            // P2/NIP-38: das Status-Abo hängt NICHT an diesem Controller (es überlebt
            // den Raumwechsel bewusst) — und genau deshalb fällt es hier sonst durchs
            // Raster. Ein WebView im Hintergrund verliert den Socket, welshman sendet
            // ein REQ danach nicht neu, und die Statusspalte fröre ein, ohne dass es
            // aussähe wie ein Fehler.
            resyncUserStatuses(url)
            // P3: Das Forum hängt an DIESEM Controller — mit dem Abbruch oben ist
            // seine Live-Sub tot, und welshman sendet ein REQ von sich aus nicht neu.
            // Ohne diese zwei Zeilen fröre die Themenliste nach dem ersten
            // Hintergrund-Gang auf ihrem Stand ein, ohne dass es nach einem Fehler
            // aussähe (dieselbe Klasse wie der Status-Fall eine Zeile darüber).
            if (this.isForum) {
                listenForum(url, this.h, signal)
                void loadForumTopics(url, this.h)
            }
            // … + einmal nachladen, was im Hintergrund verpasst wurde. loadSpaceRooms backfillt die
            // 39002/39000 (Mitgliedschaft → joined/Composer, Raumname); listenRoomMembers ist limit:0
            // (nur Neues) und deckt das NICHT ab.
            void loadSpaceRooms(url)
            void loadRoomMessages(url, this.h)
            void loadRoomReactions(url, this.h)
            // Verpasste Admin-Löschungen (9005) nachholen — während der Client
            // im Hintergrund/getrennt war, kam kein Live-Broadcast an.
            void loadRoomDeletes(url, this.h)
            void loadRoomComments(url)
            void loadRoomPolls(url, this.h)
            // Zap-Receipts (kind 9735) haben KEINE Live-Sub (kein #h, nicht im listenRoom-Filter) und
            // werden sonst nur je NEUER Nachricht geladen → im Hintergrund auf SCHON geladene
            // Nachrichten eingetroffene Fremd-Zaps blieben stale. Fürs sichtbare Fenster nachladen.
            if (this.messages.length > 0) {
                void loadRoomZaps(url, this.messages.map((m) => m.id))
            }
            // Offenen Thread ebenso neu verdrahten (eigener Controller + Live-Sub, eigener _unsub)
            // inkl. Zap-Nachladen der Kommentare.
            if (this.threadRootId) {
                const rootId = this.threadRootId
                this._threadController?.abort()
                this._threadController = new AbortController()
                void loadThread(url, rootId)
                listenThread(url, rootId, this._threadController.signal)
                if (this.threadComments.length > 0) {
                    void loadRoomZaps(url, this.threadComments.map((c) => c.id))
                }
            }
            // WebView-Race: liefert der OS-Socket-Close erst NACH diesem Tick, sterben die obigen
            // One-shot-Loads leer (welshman autoClose bei Disconnect). Ein einmaliger Nachzügler holt
            // sie, sobald der Socket via connectOnSend/closeInactive wieder steht.
            // ponytail: EINE feste Nachzügler-Runde deckt den Race; kein Reconnect-Backoff-Framework.
            setTimeout(() => {
                if (this._destroyed || this._url !== url || document.visibilityState !== 'visible') {
                    return
                }
                void loadRoomMessages(url, this.h)
                void loadRoomReactions(url, this.h)
                void loadRoomDeletes(url, this.h)
                if (this.messages.length > 0) {
                    void loadRoomZaps(url, this.messages.map((m) => m.id))
                }
            }, 2500)
        },
        // Erneuter Ladeversuch nach einem Fehler (Callout-Button): Sub + Verlauf neu aufbauen.
        retry() {
            if (this._url) {
                this.setup(this._url)
            }
        },
        // Setzt/räumt den Antwort-Kontext (Zitat der ausgewählten Nachricht). Antworten
        // verdrängt Bearbeiten UND Zitieren → beide C3-Flags zurücknehmen (share() setzt
        // `sharing` danach erneut), sonst würde send() fälschlich in saveEdit verzweigen.
        setReply(m: ChatMessage) {
            this.activeId = null
            this.sharing = false
            this.editingId = null
            this.replyTo = { id: m.id, pubkey: m.pubkey, name: m.name, text: m.html.replace(/<[^>]*>/g, '') }
            ;(this as unknown as AlpineMagics).$nextTick(() =>
                (this as unknown as { $refs: Record<string, HTMLElement> }).$refs.composer?.focus(),
            )
        },
        clearReply() {
            this.replyTo = null
            this.sharing = false
        },
        // Zitieren (Quote-Only, C3): teilt eine sichtbare Nachricht ohne Kommentar.
        // Nutzt denselben q/p-Präfix-Mechanismus wie Reply — nur darf der Body leer
        // bleiben (send() erlaubt das bei `sharing`), und der Kontext heißt „Zitieren".
        share(m: ChatMessage) {
            this.closeMessageMenu()
            this.editingId = null
            this.setReply(m) // setzt Zitat-Kontext + Fokus (activeId=null, sharing=false)
            this.sharing = true // danach: Quote-Only-Modus (Body darf leer bleiben)
        },
        // Bearbeitbar? Eigene Nachricht und höchstens 30 Minuten alt. Technisch ginge es
        // dank Single-Space-Relay jederzeit; die Grenze ist eine bewusste UX-Konvention
        // (kein stilles Umschreiben alter History) — vom Referenz-5-min auf 30 min angehoben
        // (Auftraggeber). Zeit ist nicht reaktiv — im Menü bei jedem Öffnen frisch ausgewertet.
        // Polls (kind 1068) NICHT: der Edit-Pfad republisht als kind-9 und zerstörte die Umfrage.
        canEdit(m: ChatMessage): boolean {
            return m.mine && !m.poll && m.created_at >= Math.floor(Date.now() / 1000) - 1800
        },
        // Bearbeiten starten: Composer mit dem Klartext (ohne Zitat-Präfix) vorbefüllen,
        // Reply/Share verwerfen. Guard gegen zu alte Nachrichten (Menü zeigt es zwar nur
        // bei canEdit, aber die Zeitgrenze kann zwischen Render und Klick kippen).
        startEdit(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            if (!this.canEdit(m)) {
                toast(t('Diese Nachricht ist zu alt zum Bearbeiten.'))
                return
            }
            const ev = repository.getEvent(m.id)
            if (!ev) {
                return
            }
            this.replyTo = null
            this.sharing = false
            this.editingId = m.id
            this.draft = bodyWithoutQuote(ev)
            this.sendError = ''
            const magics = this as unknown as AlpineMagics
            magics.$nextTick(() => {
                const c = magics.$refs.composer as HTMLTextAreaElement | undefined
                if (c) {
                    c.focus()
                    this.autoGrow(c)
                }
            })
        },
        cancelEdit() {
            this.editingId = null
            this.draft = ''
            this.sendError = ''
        },
        // Bearbeitung speichern (Delete des Alten + Re-Publish, gleiche created_at).
        // Leerer Text bricht nicht ab — der Senden-Button ist dann ohnehin deaktiviert.
        async saveEdit(content: string) {
            const id = this.editingId
            if (!id || !this._url || this.sending) {
                return
            }
            const original = repository.getEvent(id)
            if (!original) {
                this.cancelEdit()
                return
            }
            this.sending = true
            this.sendError = ''
            const draft = this.draft
            this.draft = ''
            this.editingId = null
            try {
                const err = await editRoomMessage(this._url, this.h, original, content)
                if (err) {
                    // Fehlgeschlagen: Text + Edit-Kontext zurück (aktionable Hinweiszeile).
                    this.sendError = err
                    this.draft = draft
                    this.editingId = id
                } else {
                    this.refocusComposer()
                }
            } finally {
                this.sending = false
            }
        },
        // Composer nach erfolgreichem Senden/Speichern: fokussieren und Höhe auf leer zurücksetzen.
        refocusComposer() {
            const magics = this as unknown as AlpineMagics
            magics.$nextTick(() => {
                // Ist ein Thread offen, gehört der Fokus dem Thread-Composer (der Cropper
                // kann aus beiden Composern geöffnet werden) — sonst dem Haupt-Composer.
                const c = (this.threadRootId ? magics.$refs.threadComposer : magics.$refs.composer) as HTMLElement | undefined
                if (c) {
                    c.focus()
                    c.style.height = 'auto'
                }
            })
        },
        // Interaktions-Menü öffnen (native App: Vollbild-Modal). Merkt die
        // Zielnachricht; die Einträge (Antworten … Reaktion/Löschen/Fork off! folgen
        // mit C1+) lesen `menuFor`. Web nutzt stattdessen das Zeilen-Popover.
        openMessageMenu(m: ChatMessage, inThread = false) {
            this.activeId = null
            this.menuFor = m
            this._menuInThread = inThread // gatet die Raum-only-Einträge im Mobile-Modal (Thread-Kommentar)
            dispatchModal('message-menu')
        },
        closeMessageMenu() {
            dispatchModal('message-menu', false)
            this.menuFor = null
        },
        // ── C4: Kopieren / Info (nur lesen, kein Publish) ──────────────────────
        // In die Zwischenablage + Bestätigungs-Toast (wie die Profilkarte).
        /** Wie oben: `message` ist der FERTIGE Satz, nicht das Substantiv (P3). */
        copy(text: string, message: string) {
            if (text) {
                void navigator.clipboard?.writeText(text).then(() => toast(message, 'success'))
            }
        },
        // `nostr:nevent…` der Nachricht (mit gesehenen Relays als Hints, sonst dem
        // Space-Relay) — teilbar/auflösbar in jedem Nostr-Client (NIP-19/21).
        copyNevent(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            this.copy(neventFor(m, this._url), t('Event-Link'))
        },
        // `npub…` des Autors.
        copyNpub(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            this.copy(nip19.npubEncode(m.pubkey), 'npub')
        },
        // Rohes signiertes Event als hübsches JSON (Debug/Verifikation).
        copyJson(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            const ev = repository.getEvent(m.id)
            if (ev) {
                this.copy(JSON.stringify(ev, null, 2), 'JSON')
            }
        },
        // Nachricht-Info-Modal: Roh-Event, Zeitpunkt, gesehene Relays (tracker).
        openInfo(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            const ev = repository.getEvent(m.id)
            if (!ev) {
                return
            }
            const seen = [...tracker.getRelays(m.id)]
            this.infoFor = {
                nevent: neventFor(m, this._url),
                npub: nip19.npubEncode(m.pubkey),
                json: JSON.stringify(ev, null, 2),
                createdAt: m.fullTime,
                seenOn: seen.map((u) => displayRelayUrl(u)),
            }
            dispatchModal('message-info')
        },
        // ── C6b: Thread-Ansicht (NIP-22 kind 1111 COMMENT) ─────────────────────
        // Öffnet das In-Room-Overlay zu EINER Nachricht: sie selbst ist die Thread-Wurzel
        // (Slack-Modell — jede Nachricht ist thread-fähig, nicht nur Quote-Only). Zeigt die
        // Wurzel + den verschachtelten Kommentar-Baum + Composer. Live-Sub hält ihn aktuell.
        // P2: Teilbarer Deep-Link zum Thread einer Nachricht (/rooms/{h}/thread/{nevent}).
        // Die Antworten-Pille öffnet den Thread WARM in der Insel (kein wire:navigate-Reboot) und
        // spiegelt die URL nur KOSMETISCH per replaceState (`syncUrl`) → teilbar, aber instant statt
        // kaltem Neu-Boot der ganzen Chat-Insel. Deep-Link/setup rufen mit syncUrl=false (URL steht
        // schon). Bech32 ohne `nostr:`-Präfix für den Routen-Param.
        // `withOrigin`: der Herkunfts-Parameter der aktuellen URL wandert MIT in die
        // Thread-URL (§6.2). Ohne ihn verlöre der warme Thread-Wechsel die Herkunft —
        // der Kopf-Pfeil führte aus einem aus „Neu" geöffneten Thread zwar zurück in den
        // Raum, von dort aber auf die Übersicht statt nach „Neu".
        // `withSpace`: dieselbe Pflicht wie bei der Herkunft, aus demselben Grund — die
        // Space-Markierung eines Workspace-Raums muss in die Thread-URL mit, sonst
        // öffnete ein Reload/geteilter Thread-Link ihn gegen den Vereins-Space.
        threadHref(m: ChatMessage): string {
            const base = `/rooms/${encodeURIComponent(this.h)}/thread/${neventFor(m, this._url).replace(/^nostr:/, '')}`
            return withSpace(withOrigin(base, window.location.search), window.location.search)
        },
        openThread(m: ChatMessage, full = true, syncUrl = true) {
            this.activeId = null
            this.closeMessageMenu()
            const rootId = m.id
            if (!rootId || !this._url) {
                return
            }
            this.closeThread() // evtl. noch offenen Thread sauber abbauen (Wechsel)
            // Frischer Thread → eigener, leerer Anhang. Der Haupt-Composer-Anhang bleibt
            // unangetastet (getrennter State), damit ein Thread-Öffnen zum Lesen keinen
            // im Haupt-Composer wartenden Entwurf/Anhang verwirft.
            this.threadAttachment = null
            const url = this._url
            this.threadFull = full // Thread ist stets die volle, raum-erbende Vollansicht (eine Präsentation)
            this.threadRootId = rootId
            // URL nur KOSMETISCH spiegeln (teilbarer Deep-Link in der Adressleiste), OHNE einen eigenen
            // history-Eintrag zu pushen: `replaceState` mit UNVERÄNDERTEM `window.history.state`, nur die
            // URL wechselt. Kein pushState — denn ein Zurück landete sonst auf dem RAUM-Eintrag, den Livewire
            // per `wire:navigate` mit echtem State+Snapshot besitzt → `document.body.replaceWith` +
            // `Alpine.destroyTree` = kalter Insel-Reboot beim SCHLIESSEN (genau das, was hier weg soll).
            // Livewires State bleibt unangetastet → seine History-Integrität ist intakt; beim Schließen
            // (backFromThread) wird die gemerkte Raum-URL per replaceState wiederhergestellt. Deep-Link/
            // setup: syncUrl=false (die Adressleiste zeigt die Thread-URL bereits).
            if (syncUrl) {
                try {
                    this._threadPrevUrl = window.location.pathname + window.location.search
                    window.history.replaceState(window.history.state, '', this.threadHref(m))
                } catch {
                    /* threadHref/neventFor scheiterte (unvollständige Nachricht) → ohne URL-Sync öffnen */
                    this._threadPrevUrl = null
                }
            }
            this._threadController = new AbortController()
            // Root (per id) + bestehende Kommentare nachladen; die Live-Sub liefert nur Neues.
            void loadThread(url, rootId)
            listenThread(url, rootId, this._threadController.signal)
            this._threadUnsub = deriveThread(url, rootId, this.h).subscribe((v) => {
                // Vor dem Update messen: stand der Nutzer (nahe) am Boden — oder ist der
                // Container noch nicht gerendert (frisch geöffnet)? Dann nach dem Render ans
                // Ende scrollen, damit der Thread bei der LETZTEN Antwort startet (analog
                // wasAtBottom des Haupt-Chats). Wer bewusst hochgescrollt hat, bleibt oben.
                const magics = this as unknown as AlpineMagics
                const el = magics.$refs.threadScroll
                const stick = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80
                this.threadRoot = v.root
                this.threadComments = v.comments
                this.threadCount = v.count
                // Zap-Receipts (9735, tragen kein #h) der Kommentare per #e nachladen (je ID einmal,
                // teilt _zapLoadedIds mit dem Raum-Feed) → die ⚡-Chips der Kommentare stimmen.
                const newZapIds = v.comments.map((c) => c.id).filter((id) => !this._zapLoadedIds.has(id))
                if (newZapIds.length > 0) {
                    newZapIds.forEach((id) => this._zapLoadedIds.add(id))
                    void loadRoomZaps(url, newZapIds)
                }
                if (stick) {
                    magics.$nextTick(() => {
                        const s = magics.$refs.threadScroll
                        if (s) {
                            s.scrollTop = s.scrollHeight
                        }
                    })
                    // „Thread offen UND am Boden" ist hier eine Tatsache, keine Vermutung:
                    // `stick` heißt entweder „stand schon unten" oder „Container ist frisch
                    // und wird gleich ans Ende gescrollt" — in beiden Fällen sieht der Nutzer
                    // die jüngste Antwort. Wer bewusst hochgescrollt hat, fällt aus `stick`
                    // heraus und quittiert NICHT (gleiche Regel wie der Raum).
                    //
                    // Thread-Wasserzeichen sind vom Raum-Wasserzeichen ENTKOPPELT: unsere
                    // kind-1111-Kommentare erscheinen nicht im Raum-Feed (eigener, `#h`-loser
                    // Filter), Raum-Lesen kann sie also nicht mitquittieren (NIP-22).
                    setRead(threadKey(rootId))
                }
            })
        },
        closeThread() {
            this._threadController?.abort()
            this._threadController = null
            this._threadUnsub?.()
            this._threadUnsub = null
            this.threadRootId = null
            this.threadRoot = null
            this.threadComments = []
            this.threadCount = 0
            this.threadReplyTo = null
            this.threadDraft = ''
            this.threadFull = false
            this._threadPrevUrl = null
            // War ein Crop AUS dem Thread offen, aufräumen; sonst den Haupt-Cropper NICHT
            // anfassen (der lebt über einem geschlossenen Thread eigenständig weiter).
            if (this._cropForThread) {
                this.cancelCrop()
            }
            this.threadAttachment = null // wartenden Thread-Anhang verwerfen (Haupt bleibt)
        },
        // „Zurück" aus dem Thread (Kopf-Pfeil). Rein WARM: der Thread ist nur ein Ansichts-Wechsel
        // innerhalb derselben Insel (kein Overlay-Abbau, kein Reboot). Nur die Adressleiste wird
        // per replaceState zurückgesetzt — auf die vor dem Öffnen gemerkte Raum-URL, sonst die Raum-
        // Basis (Deep-Link). `window.history.state` bleibt unverändert (der echte Livewire-State des
        // Raum-Eintrags) → Livewires History-Integrität ist intakt, kein Snapshot-Restore/Reboot.
        // „Zurück" aus dem RAUM (Kopf-Pfeil, wenn kein Thread offen ist). Führt dorthin,
        // wo der Nutzer war — samt Filterzustand, der jetzt in der URL steht (rt/q/cc) —
        // statt stur auf die Raumliste zu springen.
        //
        // Warum nicht einfach immer `history.back()`: beim Deep-Link-Kaltstart
        // (Notification-Tap, geteilter Link) gibt es keinen eigenen Vorgänger; back()
        // führte dann aus der App heraus. Warum nicht immer `Livewire.navigate`: das war
        // das bisherige Verhalten und verwarf jeden Filter und jede Scroll-Position.
        //
        // Der Thread hat seinen EIGENEN Weg (backFromThread) und darf hier nie landen:
        // er pusht bewusst keinen History-Eintrag, ein back() spränge also am Raum vorbei
        // direkt in die Übersicht. Gemessen (Playwright, 2026-07-22): aus dem offenen
        // Thread führte history.back() auf /spaces statt auf /rooms/<h>. Die Verzweigung
        // in `⚡room.blade.php` ($backExpr) ist deshalb nicht optional.
        // UP-Ziel aus der Herkunft (§6.2): `?from=updates` führt zurück nach „Neu",
        // alles andere — auch Müll wie `?from=//evil.tld` — auf das übergebene Ziel
        // (die Raumliste). Der Parameter ist fremde Eingabe aus der Adressleiste und
        // wird deshalb gegen eine Whitelist geprüft, nie durchgereicht.
        // Warum Query und nicht `history.state`: der gehört Livewire (siehe openThread).
        originHref(fallback: string): string {
            return originTarget(window.location.search, fallback)
        },
        backFromRoom(upTarget: string) {
            // `history.back()` NUR, wenn der Vorgänger wirklich das UP-Ziel ist — dann
            // kommen Filterzustand und Scrollposition der Liste gratis mit. In jedem
            // anderen Fall (aus einem anderen Raum, aus der Wallet, Deep-Link) wäre es
            // ein Sprung an eine Stelle, die der Pfeil nie versprochen hat.
            if (backLeadsTo(upTarget)) {
                window.history.back()
                return
            }
            ;(window as unknown as { Livewire: { navigate(u: string): void } }).Livewire.navigate(upTarget)
        },
        backFromThread() {
            const prevUrl = this._threadPrevUrl
            this.closeThread() // setzt _threadPrevUrl zurück
            try {
                // Ohne gemerkte Raum-URL (deep-gemounteter Thread: die URL stand schon,
                // `_threadPrevUrl` bleibt null) muss die Herkunft aus der aktuellen Query
                // gerettet werden — sonst schnitte das blanke `/rooms/{h}` das `?from=`
                // weg und der nächste Zurück-Druck landete auf /spaces statt auf „Neu"
                // (siehe threadBackTarget).
                // Dasselbe gilt für die Space-Markierung: das blanke `/rooms/{h}` verlöre
                // sie, und ein Reload nach dem Schließen des Threads stünde wieder im
                // falschen Space. `withSpace` steht INNEN, weil `threadBackTarget` eine
                // gemerkte Raum-URL unverändert vorzieht — die trägt beides schon.
                const roomHref = withSpace('/rooms/' + encodeURIComponent(this.h), window.location.search)
                const target = threadBackTarget(prevUrl, roomHref, window.location.search)
                if (window.location.pathname + window.location.search !== target) {
                    window.history.replaceState(window.history.state, '', target)
                }
            } catch {
                /* history-API nicht verfügbar → Adressleiste bleibt, Thread ist trotzdem zu */
            }
        },
        // Auf einen bestehenden Kommentar antworten (verschachtelt): das nächste
        // Absenden hängt den Kommentar unter `c` statt unter den Root.
        setThreadReply(c: ChatMessage) {
            this.threadReplyTo = { id: c.id, name: c.name }
            ;(this as unknown as AlpineMagics).$nextTick(() =>
                (this as unknown as { $refs: Record<string, HTMLElement> }).$refs.threadComposer?.focus(),
            )
        },
        clearThreadReply() {
            this.threadReplyTo = null
        },
        // Kommentar publizieren (kind 1111). Ziel = Eltern-Kommentar (verschachtelt)
        // oder der Thread-Root. OPTIMISTISCH & nicht-blockierend (Slack-artig): der
        // Composer wird sofort geleert (der Kommentar liegt via publishThunk schon im
        // Repository → erscheint via deriveThread), der Relay-OK wird NICHT abgewartet.
        // Das sofortige Leeren verhindert auch Doppel-Senden (ein zweiter Enter trifft
        // auf leeren Draft). Fehler landen im Hintergrund als Toast (feeds rollt zurück).
        async sendComment() {
            if (!this._url || !this.threadRootId) {
                return
            }
            const content = this.threadDraft.trim()
            if (!content && !this.threadAttachment) {
                return
            }
            const root = repository.getEvent(this.threadRootId)
            let target = repository.getEvent(this.threadReplyTo?.id ?? this.threadRootId)
            if (!target) {
                toast(t('Bezugs-Nachricht noch nicht geladen — kurz warten.'))
                return
            }
            // Antwort auf ein FREMDES Lotus-kind-10 (P4, Interop): das trägt nur lowercase
            // NIP-29-Marker (kein uppercase E/K/P), also würde welshmans tagEventForComment
            // unseren Kommentar fälschlich AUF das kind-10 rooten (E=kind10) → er fiele aus dem
            // `#E`-Thread-Feed + Root-Guard → unsichtbar. Stattdessen auf die echte kind-9-Wurzel
            // rooten (welshman self-rootet kind-9 korrekt, wie beim Top-Level-Reply). Der explizite
            // Parent-Link zum kind-10 entfällt — im flachen Slack-Modell (P3) kosmetisch.
            // ponytail: volle NIP-29→NIP-22-Parent-Übersetzung wäre mehr Code; bei Bedarf nachrüsten.
            if (target.kind === 10 && root) {
                target = root
            }
            // NIP-29-Scoping (Interop, P1): das `h` des Thread-ROOTS (kind 9) mitgeben, damit
            // Lotus/#h-scopende Relays den Kommentar sehen. Vom Root, NICHT vom target — ein
            // verschachtelter Reply-target ist ein h-loses kind-1111. Fehlt der Root (Race),
            // bleibt rootH undefined → kein leeres `["h",""]` (makeComment lässt h dann weg).
            const rootH = root ? getTagValue('h', root.tags) : undefined
            const url = this._url
            // Rohe (NICHT-reaktive) Kopie des Anhangs fürs Event — `imetaTag` ist sonst ein
            // Alpine-Proxy und bricht beim Signieren (DataCloneError), siehe C6a-Message-Send.
            const prevAttachment = this.threadAttachment
            const rawAttachment = prevAttachment
                ? { url: prevAttachment.url, imetaTag: [...prevAttachment.imetaTag] }
                : undefined
            this.threadDraft = ''
            this.threadReplyTo = null
            this.threadAttachment = null
            const err = await sendComment(url, target, content, rawAttachment, rootH)
            if (err) {
                toast(err)
            }
        },
        // ── C4: @-Mention-Autocomplete (NIP-08/NIP-27) ─────────────────────────
        // Bei jeder Composer-Eingabe: steht direkt vor dem Cursor ein `@wort`
        // (am Zeilen-/Wortanfang), Mitglieder-Vorschläge einblenden. `search` ist
        // `name npub` kleingeschrieben (Directory), Query case-insensitiv.
        onComposerInput(el: HTMLTextAreaElement, target: 'main' | 'thread' = 'main') {
            this._mentionTarget = target // merkt, welchen Draft pickMention später splicen muss
            const caret = el.selectionStart ?? el.value.length
            const match = /(?:^|\s)@([^\s@]*)$/.exec(el.value.slice(0, caret))
            if (!match) {
                this.closeMentions()
                return
            }
            this.mentionQuery = match[1]
            this._mentionStart = caret - match[1].length - 1
            const q = this.mentionQuery.toLowerCase()
            this.mentionItems = this._members.filter((mem) => !q || mem.search.includes(q)).slice(0, 8)
            this.mentionIndex = 0
            this.mentionOpen = this.mentionItems.length > 0
        },
        // Vorschlag übernehmen: `@query` (ab dem @) durch `nostr:npub… ` ersetzen,
        // Cursor dahinter setzen. Der Render-Pfad löst das npub zu `@Name` auf.
        pickMention(item: MentionItem) {
            const isThread = this._mentionTarget === 'thread'
            const draft = isThread ? this.threadDraft : this.draft
            const insert = `nostr:${item.npub} `
            const before = draft.slice(0, this._mentionStart)
            const after = draft.slice(this._mentionStart + 1 + this.mentionQuery.length)
            if (isThread) {
                this.threadDraft = before + insert + after
            } else {
                this.draft = before + insert + after
            }
            this.closeMentions()
            const magics = this as unknown as AlpineMagics
            magics.$nextTick(() => {
                const c = (isThread ? magics.$refs.threadComposer : magics.$refs.composer) as HTMLTextAreaElement | undefined
                if (c) {
                    const pos = before.length + insert.length
                    c.focus()
                    c.setSelectionRange(pos, pos)
                    this.autoGrow(c)
                }
            })
        },
        closeMentions() {
            this.mentionOpen = false
            this.mentionItems = []
            this._mentionStart = -1
        },
        // ── C1: Emoji aus dem Composer-Picker einfügen (nur Zeigegerät-Chassis) ──
        // `text` ist das Unicode-Zeichen bzw. `:shortcode:` (NIP-30). Das
        // `["emoji", …]`-Event-Tag entsteht hier BEWUSST nicht: es wird beim Senden
        // aus dem finalen Text abgeleitet (`emojiTagsForContent`) — ein wieder
        // gelöschtes Emoji hinterließe sonst ein verwaistes Tag, ein von Hand
        // getipptes bekäme keins. `emojiTag`/`label` dienen nur der MRU-Reihe.
        // `target` kommt aus dem Markup (welcher Composer den Picker geöffnet hat)
        // und nicht aus `_mentionTarget` — das merkt sich, wo zuletzt GETIPPT wurde,
        // und stünde nach „im Raum tippen, dann Thread öffnen" auf dem falschen Fuß.
        insertEmoji(target: 'main' | 'thread', text: string, emojiTag?: string[], label?: string) {
            const isThread = target === 'thread'
            const magics = this as unknown as AlpineMagics
            const el = (isThread ? magics.$refs.threadComposer : magics.$refs.composer) as HTMLTextAreaElement | undefined
            const draft = isThread ? this.threadDraft : this.draft
            // Caret direkt aus der Textarea: `selectionStart` überlebt den
            // Fokusverlust durch den Picker-Klick — ein mitgeführter Caret-Zustand
            // (wie `_mentionStart`) bräuchte dafür eigene Listener. Nie fokussiert →
            // 0, was beim leeren Entwurf zugleich das Ende ist. Eine markierte
            // Auswahl wird ersetzt (Verhalten jeder Texteingabe).
            const start = el?.selectionStart ?? draft.length
            const end = el?.selectionEnd ?? draft.length
            const next = draft.slice(0, start) + text + draft.slice(end)
            if (isThread) {
                this.threadDraft = next
            } else {
                this.draft = next
            }
            // MRU teilen sich Reagieren und Einfügen (eine Liste, ein localStorage-Key).
            // Frische Strings statt des Alpine-Proxy-Arrays aus dem Picker-Ausdruck.
            pushRecentEmoji(
                emojiTag
                    ? { custom: true, shortcode: emojiTag[1], url: emojiTag[2], src: proxifyImage(emojiTag[2], 'avatar') }
                    : { u: text, label: label ?? text },
            )
            // x-model schreibt den neuen Wert erst im nächsten Tick in die Textarea —
            // erst danach lassen sich Caret und Höhe setzen (wie bei pickMention).
            magics.$nextTick(() => {
                const c = (isThread ? magics.$refs.threadComposer : magics.$refs.composer) as HTMLTextAreaElement | undefined
                if (c) {
                    const pos = start + text.length
                    c.focus()
                    c.setSelectionRange(pos, pos)
                    this.autoGrow(c)
                }
            })
        },
        // Reagiert auf eine Nachricht (kind 7). `content` = Unicode-Emoji bzw.
        // `:shortcode:` (+ `emojiTag` für Custom-Emoji, NIP-30). Optimistisch: die
        // kind-7 landet sofort im Repository → Chip erscheint via deriveRoomChat.
        async react(m: ChatMessage, content: string, emojiTag?: string[], label?: string) {
            this.activeId = null
            this.closeMessageMenu()
            const target = m ? repository.getEvent(m.id) : undefined
            if (!target || !this._url) {
                return
            }
            // MRU vormerken (Nutzung, nicht Relay-Erfolg) → nächstes Öffnen zeigt es
            // in der „Zuletzt benutzt"-Reihe. Custom trägt rohe url + proxifiziertes Bild.
            pushRecentEmoji(
                emojiTag
                    ? { custom: true, shortcode: emojiTag[1], url: emojiTag[2], src: proxifyImage(emojiTag[2], 'avatar') }
                    : { u: content, label: label ?? content },
            )
            const err = await sendReaction(this._url, target, content, emojiTag)
            if (err) {
                toast(err)
            }
        },
        // Chip-Klick: eigene Reaction zurücknehmen (kind 5 auf die eigene kind-7),
        // sonst mit demselben Emoji reagieren (Custom-Emoji originalgetreu nachbauen).
        async toggleReaction(m: ChatMessage, r: ReactionChip) {
            if (!this._url) {
                return
            }
            if (r.mine) {
                const reaction = repository.getEvent(r.mineId)
                if (!reaction) {
                    return
                }
                const err = await removeReaction(this._url, reaction)
                if (err) {
                    toast(err)
                }
            } else {
                await this.react(m, r.content, r.emojiTag ?? undefined, r.label)
            }
        },
        // Nachricht senden (kind 9). Optimistisch: die Live-Sub echot sofort.
        // Fehler (Relay-Reject/AUTH) landen als Toast; der Text kehrt zurück.
        async send() {
            if (this.sending || !this._url) {
                return
            }
            // Autocomplete zu (falls per Senden-Button bei offenem Popover ausgelöst) —
            // sonst zeigte `_mentionStart` gleich auf den geleerten Draft (Phantom-Mention).
            this.closeMentions()
            const content = this.draft.trim()
            // Bearbeiten: eigene Nachricht neu publizieren (braucht Text; leer → nichts tun).
            if (this.editingId) {
                if (content) {
                    await this.saveEdit(content)
                }
                return
            }
            // Zitieren (Quote-Only) ODER ein Bild-Anhang (C6a) darf ohne Kommentar gesendet
            // werden; eine reine Text-Nachricht/Reply nicht.
            if (!content && !this.sharing && !this.attachment) {
                return
            }
            this.sending = true
            this.sendError = ''
            const draft = this.draft
            const prevReply = this.replyTo
            const prevSharing = this.sharing
            const prevAttachment = this.attachment
            // Rohe (NICHT-reaktive) Kopie fürs Event: `this.attachment.imetaTag` ist ein
            // Alpine-Proxy-Array; landete es in den Event-Tags, scheiterte welshmans
            // Event-Klon (structuredClone/postMessage) an „Proxy could not be cloned".
            const rawAttachment = prevAttachment
                ? { url: prevAttachment.url, imetaTag: [...prevAttachment.imetaTag] }
                : undefined
            const reply = prevReply ? { id: prevReply.id, pubkey: prevReply.pubkey } : undefined
            this.draft = ''
            this.replyTo = null
            this.sharing = false
            this.attachment = null
            try {
                const err = await sendRoomMessage(this._url, this.h, content, reply, rawAttachment)
                if (err) {
                    // Fehlgeschlagen: Text + Zitat + Anhang zurück, aktionable Hinweiszeile am
                    // Composer (kein Toast — der verpufft und wäre neben der Zeile doppelt).
                    this.sendError = err
                    this.draft = draft
                    this.replyTo = prevReply
                    this.sharing = prevSharing
                    this.attachment = prevAttachment
                } else {
                    this.scrollToBottom()
                    this.refocusComposer()
                }
            } finally {
                this.sending = false
            }
        },
        // ── C6a: Bild-Anhang (Cropper + Blossom) ─────────────────────────────────
        // Bild-Datei (aus dem +-Menü-Picker ODER Copy&Paste) → Object-URL fürs Crop-
        // Overlay, cropperjs LAZY laden (nur wenn wirklich ein Bild angehängt wird —
        // kein Bundle-Ballast) samt eigenem CSS (co-lokalisiert im Lazy-Chunk → lädt
        // garantiert mit) und auf dem Overlay-<img> initialisieren.
        _openCropper(file: File) {
            if (!file.type.startsWith('image/')) {
                return
            }
            this.cancelCrop() // evtl. offenen Cropper + alte Object-URL freigeben (Re-Pick)
            // Ziel-Composer JETZT erfassen (nicht erst beim Bestätigen): so landet das Bild
            // deterministisch dort, wo der Cropper geöffnet wurde — auch wenn sich der aktive
            // Composer während des Uploads änderte. Thread offen → Thread-Anhang, sonst Haupt.
            this._cropForThread = Boolean(this.threadRootId)
            // `_cropSrc` steuert das Crop-Overlay (x-show) direkt — kein flux:modal, dessen
            // Transition den Cropper mit 0px-Container initialisieren könnte.
            const src = URL.createObjectURL(file)
            this._cropSrc = src
            this.cropRatio = NaN
            const magics = this as unknown as AlpineMagics
            magics.$nextTick(async () => {
                const [{ default: Cropper }] = await Promise.all([import('cropperjs'), import('cropperjs/dist/cropper.css')])
                // Abgebrochen, während der Lazy-Chunk lud (cancelCrop nullte `_cropSrc`)?
                // Dann KEINEN Zombie-Cropper auf dem versteckten <img> bauen.
                const img = magics.$refs.cropImg as HTMLImageElement | undefined
                if (this._cropSrc !== src || !img) {
                    return
                }
                cropperInstance?.destroy()
                cropperInstance = new Cropper(img, { viewMode: 1, autoCropArea: 1, background: false }) as unknown as CropperLike
            })
        },
        // Datei-Picker (+-Menü): Wert danach leeren, damit dieselbe Datei erneut wählbar bleibt.
        pickImage(input: HTMLInputElement) {
            const file = input.files?.[0]
            input.value = ''
            if (file) {
                this._openCropper(file)
            }
        },
        // Copy&Paste ins Eingabefeld: ein reines Bild (Screenshot) öffnet den Cropper.
        // Text hat Vorrang — Tabellenzellen (Excel/Sheets/Calc) legen Text UND ein
        // gerendertes Bild ab; dann NICHT kapern, sondern den normalen Text-Paste
        // durchlassen (kein preventDefault). Kein Bild → ebenfalls durchlassen.
        pasteImage(e: ClipboardEvent) {
            const items = Array.from(e.clipboardData?.items ?? [])
            if (items.some((i) => i.kind === 'string' && i.type === 'text/plain')) {
                return
            }
            const item = items.find((i) => i.type.startsWith('image/'))
            const file = item?.getAsFile()
            if (file) {
                e.preventDefault()
                this._openCropper(file)
            }
        },
        setCropRatio(r: number) {
            this.cropRatio = r
            cropperInstance?.setAspectRatio(r)
        },
        rotateCrop() {
            cropperInstance?.rotate(90)
        },
        // Horizontal spiegeln: aktuelles scaleX umkehren (getData liest den Ist-Zustand).
        flipCrop() {
            if (cropperInstance) {
                cropperInstance.scaleX(cropperInstance.getData().scaleX >= 0 ? -1 : 1)
            }
        },
        // Zuschnitt bestätigen: Canvas (max. 2048px) → WebP-Blob (q=0.85, ersetzt die
        // separate Kompression) → Blossom-Upload. Ergebnis wird zum wartenden Anhang;
        // Fehler bleibt im Overlay (Toast), damit der Nutzer neu zuschneiden/abbrechen kann.
        async confirmCrop() {
            if (!cropperInstance || this.uploadingImage) {
                return
            }
            this.uploadingImage = true
            try {
                const canvas = cropperInstance.getCroppedCanvas({ maxWidth: 2048, maxHeight: 2048 })
                const blob = canvas && (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85)))
                if (!blob) {
                    throw new Error(t('Bild konnte nicht verarbeitet werden.'))
                }
                // `this._url` = Space-Relay: entscheidet, ob der Blob zum Vereins-Blossom
                // oder in den eigenen Medien-Speicher des Buzz-Relays geht (uploads.ts).
                const up = await uploadAttachment(blob, this._url, `${canvas.width}x${canvas.height}`)
                // Vorschau aus den EIGENEN Bytes, nicht aus der Antwort-URL: auf einem
                // Buzz-Space liegt der frische Upload unter `…/media/…` und ist
                // auth-pflichtig — `$img()` gäbe dafür `''` zurück und die Kachel bliebe
                // leer (der Nutzer sähe sein gerade zugeschnittenes Bild nicht). Begründung
                // der Bauform in `uploads.ts` bei {@link thumbDataUrl}.
                const attachment = { ...up, previewUrl: thumbDataUrl(document, canvas) }
                // In den beim Öffnen erfassten Ziel-Composer schreiben (kein Übersprechen).
                if (this._cropForThread) {
                    this.threadAttachment = attachment
                } else {
                    this.attachment = attachment
                }
                this.cancelCrop()
                this.refocusComposer()
            } catch (e) {
                toast(String((e as Error)?.message ?? e))
            } finally {
                this.uploadingImage = false
            }
        },
        // Crop abbrechen/schließen: Cropper zerstören, Object-URL freigeben, Overlay zu
        // (das Nullen von `_cropSrc` blendet es via x-show aus).
        cancelCrop() {
            cropperInstance?.destroy()
            cropperInstance = null
            if (this._cropSrc) {
                URL.revokeObjectURL(this._cropSrc)
                this._cropSrc = null
            }
        },
        removeAttachment() {
            this.attachment = null
        },
        // Löschen anfragen: Aktionsleiste zu, Merker setzen, Bestätigungs-Modal öffnen.
        askDelete(m: ChatMessage) {
            this.activeId = null
            this.pendingDelete = { id: m.id, createdAt: m.created_at }
            dispatchModal('delete-message')
        },
        // Bestätigt löschen: Modal zu, dann publishen (Busy verhindert Doppel-Klick).
        async confirmDelete() {
            const target = this.pendingDelete
            if (!target) {
                return
            }
            dispatchModal('delete-message', false)
            this.pendingDelete = null
            await this.remove(target.id, target.createdAt)
        },
        // Eigene Nachricht löschen (kind 5). Repository blendet sie sofort aus.
        async remove(id: string, createdAt: number) {
            if (!this._url || this.deleting) {
                return
            }
            this.deleting = true
            try {
                const err = await deleteRoomMessage(this._url, this.h, id, createdAt)
                if (err) {
                    toast(err)
                }
            } finally {
                this.deleting = false
            }
        },
        // Fork off! anfragen: Zielnachricht merken, Grund auf Default, Freitext leeren,
        // Fork-off!-Modal öffnen. Wird vom Menü aufgerufen (Web-Popover / native Modal).
        askReport(m: ChatMessage) {
            this.activeId = null
            this.reportFor = m
            this.reportReason = 'spam'
            this.reportText = ''
            dispatchModal('report-message')
        },
        // Bestätigt „Fork off!": kind-1984 publishen (Busy verhindert Doppel-Klick), Modal
        // zu. makeReport braucht nur id + pubkey — beide liegen auf m (kein Repository-Lookup).
        async confirmReport() {
            const m = this.reportFor
            if (!m || !this._url || this.reporting) {
                return
            }
            this.reporting = true
            try {
                const err = await sendReport(this._url, m, this.reportReason, this.reportText.trim())
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('report-message', false)
                    this.reportFor = null
                }
            } finally {
                this.reporting = false
            }
        },
        // ── P1: Admin-Moderation (NIP-86) ──────────────────────────────────────
        // Fremde Nachricht entfernen (banevent): Ziel merken, Bestätigung öffnen.
        // Nur für Admins erreichbar (isAdmin gatet die Menü-Einträge).
        askAdminDelete(m: ChatMessage) {
            this.activeId = null
            this.pendingAdminDelete = m
            dispatchModal('admin-delete-message')
        },
        // Bestätigt: banevent publizieren; bei Erfolg lokal aus dem Repository nehmen
        // (der abgeleitete Feed re-emittiert dann ohne die Nachricht, wie beim Retract
        // eines fehlgeschlagenen Publish). Bei Fehler bleibt die Nachricht sichtbar.
        async confirmAdminDelete() {
            const m = this.pendingAdminDelete
            if (!m || !this._url || this.moderating) {
                return
            }
            this.moderating = true
            try {
                // Live-Propagierung zuerst: NIP-29 9005 (delete-event) ans Space-Relay —
                // andere offene Clients (listenRoom→honorDeleteEvent) lassen die Nachricht
                // sofort verschwinden. Danach der NIP-86-banEvent für die relay-seitige
                // Bann-Liste (verhindert Re-Publish). banEvent-Fehler entscheidet über den
                // Toast; das 9005 ist best-effort für die Live-Sync und blockiert den Erfolg
                // nicht (der Autor bleibt ohnehin lokal + relay-seitig via banEvent entfernt).
                void moderateDeleteMessage(this._url, this.h, m.id)
                const err = await banEvent(this._url, m.id)
                if (err) {
                    toast(err)
                } else {
                    repository.removeEvent(m.id)
                    dispatchModal('admin-delete-message', false)
                    this.pendingAdminDelete = null
                }
            } finally {
                this.moderating = false
            }
        },
        // Autor bannen (banpubkey): Ziel merken, Bestätigung öffnen. Der Ban entfernt
        // den Autor als Space-Mitglied UND löscht relay-seitig ALLE seine Events —
        // das Bestätigungs-Modal sagt das explizit.
        askBanAuthor(m: ChatMessage) {
            this.activeId = null
            this.banAuthorFor = m
            dispatchModal('ban-author')
        },
        async confirmBanAuthor() {
            const m = this.banAuthorFor
            if (!m || !this._url || this.moderating) {
                return
            }
            this.moderating = true
            try {
                const err = await banSpaceMember(this._url, m.pubkey)
                if (err) {
                    toast(err)
                } else {
                    // Admin-Cache invalidieren (Mitgliederliste änderte sich) + die lokal
                    // geladenen Nachrichten des Autors optimistisch ausblenden. ponytail:
                    // nur das geladene Fenster — ältere räumt der nächste Load/die Live-Sub.
                    refreshSpaceAdmin(this._url)
                    // Raum-Feed UND (falls offen) die Kommentare des aktuellen Threads:
                    // Thread-Kommentare (kind 1111) liegen NICHT in this.messages, sondern
                    // in threadComments (deriveThread) → sonst blieben die Antworten des
                    // Gebannten im offenen Overlay stehen (wie confirmAdminDelete am Ziel).
                    for (const msg of [...this.messages, ...this.threadComments]) {
                        if (msg.pubkey === m.pubkey) {
                            repository.removeEvent(msg.id)
                        }
                    }
                    dispatchModal('ban-author', false)
                    this.banAuthorFor = null
                }
            } finally {
                this.moderating = false
            }
        },
        // ── Z3: Zap (NIP-57) ────────────────────────────────────────────────────
        // Zap-Sheet öffnen: Zapper des Autors auflösen (Vorabgate — `getZapResponseFilter`
        // wirft ohne nostrPubkey), Betrag/Emoji auf Default, QR-Reste + alte Live-Sub weg,
        // Modal auf. Kann der Empfänger keine Nostr-Zaps → Info-Toast statt Sheet.
        async openZap(m: ChatMessage) {
            this.activeId = null
            this.closeMessageMenu()
            haptic(10) // Tap kam an — sofortige taktile Quittung
            // Mobile ohne verbundene Wallet: der Zap-Sheet-QR-Fallback ergibt keinen
            // Sinn (der QR liegt auf dem eigenen Gerät, nicht scanbar). Statt Modal
            // direkt in die Wallet-Einstellungen (group.wallet), wo NWC verbunden wird.
            if (isMobile && !(await loadWallet())) {
                location.assign('/settings/wallet')
                return
            }
            // Modal SOFORT öffnen — dass eine lud16 existiert, weiß der Feed bereits (m.zappable).
            // NICHT auf resolveZapper warten: dessen Profil-/Zapper-Fetch läuft über die OUTBOX-
            // Relays des Empfängers und löst dabei NIP-42-AUTH an ein Dutzend fremder Relays aus
            // (jeweils eine 22242-Signatur) → sekundenlang. Das früher davorgeschaltete `await`
            // ließ das Sheet erst nach dieser Lawine (oder gar nicht) aufgehen. Jetzt: Sheet auf,
            // Zapper im Hintergrund; „Senden" wartet über `zapResolving`.
            this._zapSub?.abort()
            this._zapSub = null
            this.zapFor = m
            this._zapper = null
            this.zapNostrless = false
            this.zapUnavailable = false
            this.zapResolveFailed = false
            this.zapResolving = true
            this.zapAmount = 21
            this.zapContent = DEFAULT_ZAP_CONTENT
            this.zapInvoice = ''
            this.zapQr = ''
            dispatchModal('zap-message')
            try {
                // Zapper des Empfängers auflösen — OHNE Outbox-Relays/loadProfile anzufassen.
                // Das Profil liegt bereits im Repository (der Name steht ja im Feed) → `getProfile`
                // liefert die lud16 SYNCHRON. Daraus die lnurl, dann:
                // 1) synchron aus dem gewärmten Zapper-Cache (feeds.ts `warmZappers`, gleicher Cache
                //    wie der ⚡-Tally), sonst
                // 2) den LNURL DIREKT laden (reiner HTTP-Fetch des .well-known/lnurlp, KEINE
                //    Relays, KEIN NIP-42-AUTH). Das frühere `resolveZapper` machte ein
                //    `await loadProfile` über die Outbox-Relays → hing hinter der AUTH-Lawine und
                //    meldete fälschlich „nicht erreichbar" bei validen Adressen (walletofsatoshi.com).
                //
                //    Beides über `loadZapperNow` (js/zaps.ts) statt über welshmans Loader —
                //    aus ZWEI Gründen, die zusammenfallen:
                //
                //    (a) `loadZapper` läuft über welshmans
                //    `makeLoadItem` (@welshman/store repository.js:275) mit EXPONENTIELLEM BACKOFF —
                //    nach n erfolglosen Versuchen liefert es innerhalb von 2^n Sekunden sofort
                //    `undefined` zurück, OHNE zu fetchen. Die Versuche verbraucht `warmZappers`
                //    im Hintergrund für jeden Feed-Autor; tippt der Nutzer danach auf ⚡, kam die
                //    Antwort aus dem Backoff statt vom Server → „Zahlungs-Endpoint nicht erreichbar"
                //    bei einer kerngesunden Adresse. Genau dieses „mal geht's, mal nicht".
                //    Ein expliziter Nutzer-Tap darf nie gedrosselt werden.
                //
                //    (b) `forceLoadZapper` umgeht zwar den Backoff, schleppt aber welshmans
                //    Batcher-Defekt mit: bei totem Endpoint settlet seine Promise NIE (nur der
                //    `withTimeout` unten rettete die UI) und die Rejection ist eine Waise, die
                //    kein Aufrufer abfangen kann — Herleitung in `js/zaps.ts` bei `warmZappers`.
                //    `loadZapperNow` drosselt ebenfalls nicht, settlet aber immer und wirft nie.
                const profile = getProfile(m.pubkey)
                const lnurl = getLnUrl(profile?.lud16 || profile?.lud06 || '')
                let zapper = lnurl ? getZapper(lnurl) : undefined
                // Timeout/Netzwerkfehler von UNSERER Seite streng trennen von „Empfänger kann
                // nichts empfangen". Beides in `zapUnavailable` zu werfen, log dem Nutzer eine
                // Aussage über den EMPFÄNGER auf, obwohl nur unser Fetch nicht durchkam — genau
                // das Muster hinter „mal geht's, mal nicht". `zapResolveFailed` sagt stattdessen,
                // dass es an der Prüfung lag, und bietet einen erneuten Versuch an.
                if (!zapper && lnurl) {
                    try {
                        // 15 s, nicht 8: der LNURL-Fetch des Empfängers braucht gemessen
                        // 1,3–1,6 s, mit Ausreißern bis 5,5 s. Der `withTimeout` bleibt als
                        // Netz gegen einen Server, der die Verbindung offen hält und nie
                        // antwortet — `loadZapperNow` settlet zwar immer, aber „immer" heißt
                        // „sobald der Fetch settlet", und darauf hat der Client keinen Einfluss.
                        zapper = await withTimeout(loadZapperNow(lnurl), 15000)
                    } catch {
                        if (this.zapFor === m) {
                            this.zapResolveFailed = true
                        }
                        return
                    }
                    if (this.zapFor !== m) {
                        return // Sheet zwischenzeitlich geschlossen/gewechselt
                    }
                }
                if (!canPay(zapper)) {
                    this.zapUnavailable = true // gültige lud16, aber kein erreichbarer LNURL-Endpoint
                } else {
                    this._zapper = zapper
                    // Gültiger LNURL, aber KEIN NIP-57 (allowsNostr/nostrPubkey) → Plain-Pay-Modus:
                    // zahlen möglich, erzeugt aber KEIN Nostr-Event (kein 9735) → im Raum unsichtbar.
                    this.zapNostrless = !canZap(zapper)
                }
            } finally {
                if (this.zapFor === m) {
                    this.zapResolving = false
                }
            }
        },
        // Zap senden: Zahlweg-Router (Z2). Wallet verbunden → Auto-Pay (zahlt + lädt das
        // 9735-Receipt), sonst QR-Fallback mit Live-Receipt-Sub. Busy-Guard verhindert
        // Doppel-Zap; Fehler bleiben (Toast) im offenen Modal (wie C2-Report).
        async confirmZap() {
            const m = this.zapFor
            const zapper = this._zapper
            if (!m || !zapper || !this._url || this.zapping) {
                return
            }
            const sats = Math.floor(Number(this.zapAmount))
            if (!Number.isFinite(sats) || sats <= 0) {
                toast(t('Bitte einen gültigen Betrag angeben.'), 'warning')
                return
            }
            this.zapping = true
            try {
                const hasWallet = Boolean(await loadWallet())
                // Ziel-Guard: Schließt/wechselt der Nutzer das Sheet während eines awaits
                // (Escape/Backdrop → closeZap, oder openZap einer anderen Nachricht), NICHT
                // weiterschreiben — sonst verwaiste QR-Sub bzw. fremde Rechnung im Sheet.
                if (this.zapFor !== m) {
                    return
                }
                // Plain-Pay-Modus (Empfänger ohne NIP-57): normale Lightning-Zahlung OHNE
                // 9734/9735 → es entsteht kein Nostr-Event, der „Zap" ist im Raum nicht
                // sichtbar. Kein Receipt-Warten im QR-Fallback (es kommt keins).
                if (this.zapNostrless) {
                    if (hasWallet) {
                        await payZapPlain({ zapper, sats, comment: this.zapContent })
                        if (this.zapFor === m) {
                            haptic(20)
                            toast(t('Zahlung gesendet ⚡ (ohne Nostr-Event — im Raum nicht sichtbar).'), 'success')
                            this.closeZap()
                        }
                    } else {
                        const invoice = await requestPlainInvoice({ zapper, sats, comment: this.zapContent })
                        if (this.zapFor !== m) {
                            return
                        }
                        this.zapInvoice = invoice
                        this.zapQr = await QRCode.toDataURL(invoice.toUpperCase(), { width: 256, margin: 1 })
                        ;(this as unknown as AlpineMagics).$nextTick(() => (this as unknown as AlpineMagics).$refs.zapCopyBtn?.focus())
                    }
                    return
                }
                const input = {
                    pubkey: m.pubkey,
                    zapper,
                    sats,
                    content: this.zapContent.trim() || DEFAULT_ZAP_CONTENT,
                    eventId: m.id,
                    url: this._url,
                }
                if (chooseZapMethod(zapper, hasWallet) === 'auto') {
                    // Gezahlt ist gezahlt: `payZapAuto` wirft nach erfolgreicher Zahlung nicht
                    // mehr. Ob das 9735-Receipt schon da ist, ist eine SEPARATE Aussage —
                    // fehlt es, sagen wir das, statt einen Fehler zu melden (das Geld ist raus).
                    const { receiptSeen } = await payZapAuto(input)
                    toast(receiptSeen ? t('Zap gesendet ⚡') : t('Bezahlt ⚡ — Bestätigung steht noch aus.'), 'success')
                    if (this.zapFor === m) {
                        this.closeZap()
                    }
                } else {
                    // QR-Fallback: Rechnung holen + anzeigen, auf das 9735-Receipt lauschen
                    // (identischer Relay-Satz aus createZapInvoice — NICHT neu berechnen).
                    const { invoice, relays } = await createZapInvoice(input)
                    if (this.zapFor !== m) {
                        return
                    }
                    this.zapInvoice = invoice
                    this.zapQr = await QRCode.toDataURL(invoice.toUpperCase(), { width: 256, margin: 1 })
                    this._zapSub = new AbortController()
                    watchZapReceipt({
                        zapper,
                        pubkey: m.pubkey,
                        eventId: m.id,
                        relays,
                        signal: this._zapSub.signal,
                        onReceived: () => {
                            toast(t('Zahlung erhalten ⚡'), 'success')
                            this.closeZap()
                        },
                    })
                    // Fokus in den neuen QR-Zustand (der „Zap senden"-Button ist jetzt
                    // ausgeblendet → Fokus fiele sonst auf <body>).
                    ;(this as unknown as AlpineMagics).$nextTick(() => (this as unknown as AlpineMagics).$refs.zapCopyBtn?.focus())
                }
            } catch (e) {
                toast(mapZapError(e))
            } finally {
                this.zapping = false
            }
        },
        // Zap-Sheet schließen: Live-Sub abbrechen (Leak-Schutz bei offener QR-Sub),
        // State + Modal zurücksetzen.
        closeZap() {
            this._zapSub?.abort()
            this._zapSub = null
            this.zapFor = null
            this._zapper = null
            this.zapResolving = false
            this.zapUnavailable = false
            this.zapResolveFailed = false
            this.zapNostrless = false
            this.zapInvoice = ''
            this.zapQr = ''
            dispatchModal('zap-message', false)
        },
        // ── C5: Poll-Vote (NIP-88 kind 1018) ───────────────────────────────────
        // Auf eine Poll-Option klicken. Einfachwahl setzt genau diese Option;
        // Mehrfachwahl toggelt sie in der bestehenden Auswahl. Optimistisch (die
        // Response landet sofort im Repository → Balken/eigener Vote aktualisieren).
        async votePoll(m: ChatMessage, optionId: string) {
            // Frische Poll-Sicht aus dem aktuellen Feed holen — das per x-for übergebene
            // `m` kann ein veralteter Closure-Stand sein (schnelles Mehrfach-Toggle läse
            // sonst eine alte Auswahl und verlöre die vorige Stimme).
            const fresh = this.messages.find((x) => x.id === m.id) ?? m
            if (!this._url || !fresh.poll || fresh.poll.closed) {
                return
            }
            const poll = repository.getEvent(m.id)
            if (!poll) {
                return
            }
            let selection: string[]
            if (fresh.poll.multi) {
                const current = fresh.poll.options.filter((o) => o.mine).map((o) => o.id)
                selection = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]
                // Mehrfachwahl komplett abgewählt → keine leere Response senden (wie der Referenz-Client).
                if (selection.length === 0) {
                    return
                }
            } else {
                selection = [optionId]
            }
            const err = await sendPollResponse(this._url, poll, selection)
            if (err) {
                toast(err)
            }
        },
        // Poll-Erstellen öffnen: Formular auf zwei leere Optionen zurücksetzen, Modal auf.
        openPollCreate() {
            this.pollTitle = ''
            this.pollOptionList = [
                { id: crypto.randomUUID(), value: '' },
                { id: crypto.randomUUID(), value: '' },
            ]
            this.pollTypeSel = 'singlechoice'
            this.pollEndsAt = ''
            dispatchModal('create-poll')
        },
        addPollOption() {
            this.pollOptionList.push({ id: crypto.randomUUID(), value: '' })
        },
        removePollOption(id: string) {
            this.pollOptionList = this.pollOptionList.filter((o) => o.id !== id)
        },
        // Optionen per Griff umsortieren (natives HTML5-DnD, wie der Referenz-Client —
        // kein Sortable-Dep). `pollReorder` verschiebt live beim Drüberziehen: die gezogene
        // Option wandert an die Position der überfahrenen.
        pollDragStart(id: string) {
            this._draggedOption = id
        },
        pollReorder(targetId: string) {
            const src = this.pollOptionList.findIndex((o) => o.id === this._draggedOption)
            const tgt = this.pollOptionList.findIndex((o) => o.id === targetId)
            if (src === -1 || tgt === -1 || src === tgt) {
                return
            }
            const [moved] = this.pollOptionList.splice(src, 1)
            this.pollOptionList.splice(tgt, 0, moved)
        },
        pollDragEnd() {
            this._draggedOption = null
        },
        // Poll publizieren (kind 1068). Validiert Frage + ≥2 nicht-leere Optionen +
        // Enddatum in der Zukunft; baut die Options-IDs des Formulars in die `option`-Tags.
        async submitPoll() {
            if (this.pollBusy || !this._url) {
                return
            }
            const title = this.pollTitle.trim()
            if (!title) {
                toast(t('Bitte gib eine Frage ein.'))
                return
            }
            const options = this.pollOptionList
                .map((o) => ({ id: o.id, label: o.value.trim() }))
                .filter((o) => o.label !== '')
            if (options.length < 2) {
                toast(t('Bitte gib mindestens zwei Optionen an.'))
                return
            }
            let endsAt: number | undefined
            if (this.pollEndsAt) {
                const ts = Math.floor(new Date(this.pollEndsAt).getTime() / 1000)
                if (!Number.isFinite(ts) || ts <= Math.floor(Date.now() / 1000)) {
                    toast(t('Das Enddatum muss in der Zukunft liegen.'))
                    return
                }
                endsAt = ts
            }
            this.pollBusy = true
            try {
                const err = await sendPoll(this._url, this.h, { title, options, pollType: this.pollTypeSel, endsAt })
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('create-poll', false)
                    this.scrollToBottom()
                }
            } finally {
                this.pollBusy = false
            }
        },
        // ── Z5: Zap-Goal-Erstellen (NIP-75 kind 9041) ──────────────────────────
        // Goal-Formular zurücksetzen (Default-Ziel 21 000 Sats) + Modal auf.
        openGoalCreate() {
            this.goalTitle = ''
            this.goalSummary = ''
            this.goalTargetSats = 21000
            dispatchModal('create-goal')
        },
        // Goal publizieren (kind 9041). Validiert Titel + Ziel > 0; die Karte
        // erscheint optimistisch im Verlauf (wie eine Poll), Beitragen läuft über
        // den bestehenden Zap-Pfad (openZap auf die Goal-Nachricht).
        async submitGoal() {
            if (this.goalBusy || !this._url) {
                return
            }
            const title = this.goalTitle.trim()
            if (!title) {
                toast(t('Bitte gib dem Ziel einen Titel.'))
                return
            }
            const targetSats = Math.floor(this.goalTargetSats)
            if (!Number.isFinite(targetSats) || targetSats <= 0) {
                toast(t('Bitte gib ein gültiges Ziel in Sats an.'))
                return
            }
            this.goalBusy = true
            try {
                const err = await sendGoal(this._url, this.h, { title, summary: this.goalSummary.trim(), targetSats })
                if (err) {
                    toast(err)
                } else {
                    dispatchModal('create-goal', false)
                    this.scrollToBottom()
                }
            } finally {
                this.goalBusy = false
            }
        },
        // Beitreten (kind 9021). Round-trip: `joined` flippt, sobald die vom Relay
        // aktualisierte 39002 über die Live-Sub eintrifft (kein optimistischer Fake).
        async join() {
            if (!this._url || this.joining) {
                return
            }
            this.joining = true
            try {
                const err = await joinRoom(this._url, this.h)
                if (err) {
                    toast(err)
                    return
                }
                // Mitgliederliste GEZIELT nachladen statt auf die Live-Sub zu hoffen: Buzz
                // schickt die aktualisierte 39002 nicht über den Fan-out (Messung siehe
                // `groups.ts reloadRoomMembership`), der Composer erschiene sonst erst nach
                // einem Reload. Auf zooid ist das ein billiges Zusatz-REQ, das nichts ändert
                // — die Live-Sub war dort meist ohnehin schneller.
                const me = pubkey.get()
                if (me) {
                    await reloadRoomMembership(this._url, this.h, me)
                }
                // P6: Das Wiederaufsetz-Budget des Gates zurücksetzen — und zwar HIER,
                // nicht nur in `resync()`.
                //
                // Der Deckel (`ROOM_GATE_MAX_RELISTENS`) zählt, wie oft die Raum-Sub nach
                // `restricted: channel access revoked` neu aufgesetzt wurde. Jeder
                // AUSTRITT erzeugt genau einen solchen Grund — der Zähler wächst also mit
                // jedem Verlassen, und genullt wurde er bis P6 nur beim Betreten eines
                // ANDEREN Raums (`setup()`). Wer denselben offenen Raum viermal verlässt
                // und wiederbetritt, ohne die Ansicht zu wechseln, lief deshalb beim
                // vierten Austritt ins Gate, obwohl der Raum offen ist.
                //
                // Ein bestätigter Wiederbeitritt ist die saubere Grenze: er ist eine
                // NUTZERAKTION, keine Schleife des Relays. Genau das trennt den Fall, den
                // der Deckel treffen soll (frische Sub wird sofort wieder mit demselben
                // Grund geschlossen, ohne Zutun), von dem, den er nicht treffen darf.
                this._gateRelistens = 0
            } finally {
                this.joining = false
            }
        },
        // Verlassen (kind 9022). `joined` flippt mit der aktualisierten 39002.
        async leave() {
            if (!this._url || this.joining) {
                return
            }
            this.joining = true
            try {
                const err = await leaveRoom(this._url, this.h)
                if (err) {
                    toast(err)
                    return
                }
                // Spiegelbild zu `join()`: Buzz schickt die aktualisierte 39002 auch nach
                // einem Austritt nicht über den Fan-out. Ohne das Nachladen bliebe der
                // Composer stehen, obwohl der Nutzer den Raum verlassen hat — und der
                // nächste Sendeversuch scheiterte am Relay. `false` = warten, bis der
                // eigene Pubkey NICHT mehr in der Liste steht.
                const me = pubkey.get()
                if (me) {
                    await reloadRoomMembership(this._url, this.h, me, false)
                }
            } finally {
                this.joining = false
            }
        },
        destroy() {
            this._destroyed = true // eine noch offene storageReady-Subscription (init) nicht mehr anlaufen lassen
            if (this._onViewport) {
                window.visualViewport?.removeEventListener('resize', this._onViewport)
            }
            if (this._onVisible) {
                document.removeEventListener('visibilitychange', this._onVisible)
            }
            // NUR quittieren, wenn der Nutzer wirklich unten stand. Die beiden anderen
            // markRead()-Aufrufer sind bereits so geguardet (onScroll nur bei atBottom,
            // scrollToBottom setzt es selbst) — destroy() war der einzige unbedingte und
            // damit inkonsistent: wer hochgescrollt liest, während neue Nachrichten
            // einlaufen, und dann weg navigiert, hätte genau diese ungelesenen Nachrichten
            // stillschweigend als gelesen markiert. Das Wasserzeichen ist der einzige
            // Zustand, der die Navigation überlebt — es hier falsch zu setzen ist nicht
            // reparierbar.
            if (this.atBottom) {
                this.markRead()
            }
            this._unsubActive?.()
            this.teardown()
        },
    }))

    // Space-Auswahl (Einstellungen): listet die beigetretenen Spaces und lässt
    // den aktiven wechseln. Der einzige Ort, an dem gewechselt wird (§12).
    Alpine.data('nostrSpaceSettings', (): SpaceSettingsState => ({
        ready: false,
        spaces: [],
        active: null,
        activeJoined: false,
        activeIsVerein: false,
        busy: false,
        _joined: [],
        _choices: [],
        _relays: new Map(),
        _unsubChoices: null,
        _unsubActive: null,
        _unsubJoined: null,
        _unsubRelays: null,
        init() {
            // `ready` erst nach dem ersten Ladeversuch → kein „leer"-Flash vor der Emission (Fix A).
            loadUserGroupList()?.finally(() => {
                this.ready = true
            })
            const rebuild = () => {
                this.spaces = this._choices.map((url: string) => ({
                    url,
                    label: spaceBranding(displayRelayUrl(url), ensureRelayProfile(this._relays, url)).label,
                    joined: this._joined.includes(url),
                }))
                this.activeJoined = Boolean(this.active && this._joined.includes(this.active))
                // Vereins-Relays (lokaler Default-Space + group.einundzwanzig.space)
                // haben KEINEN NIP-29-Selbst-Beitritt — Zugang läuft über die
                // Vereinsmitgliedschaft. Dort den „Beitreten"-Button ausblenden.
                this.activeIsVerein = Boolean(this.active && isVereinRelay(this.active))
            }
            this._unsubJoined = userSpaceUrls.subscribe((urls: string[]) => {
                this._joined = urls
                rebuild()
            })
            this._unsubChoices = groupSpaceChoices.subscribe((urls: string[]) => {
                this._choices = urls
                rebuild()
            })
            this._unsubActive = activeSpace.subscribe((url: string) => {
                this.active = url
                rebuild()
            })
            this._unsubRelays = relaysByUrl.subscribe((byUrl: Map<string, RelayProfile>) => {
                this._relays = byUrl
                rebuild()
            })
        },
        choose(url: string) {
            setActiveSpace(url)
            // Vereins-Relay gewählt → Hinweis als Toast (übersteht die Navigation).
            if (isVereinRelay(url)) {
                flashToast(
                    t('EINUNDZWANZIG-Vereins-Relay — voller Zugang zu Räumen & Chat nur für Vereinsmitglieder. Mitglied werden: verein.einundzwanzig.space'),
                    'info',
                )
            }
            // SPA-Navigation (welshman bleibt warm) statt Full-Reload.
            ;(window as unknown as { Livewire: { navigate: (u: string) => void } }).Livewire.navigate('/spaces')
        },
        // Aktiven Space beitreten/verlassen (Space-Ebene, kind 28934/28936).
        async joinActive() {
            if (!this.active || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await joinSpace(this.active)
                if (err) {
                    toast(err)
                }
            } finally {
                this.busy = false
            }
        },
        async leaveActive() {
            if (!this.active || this.busy) {
                return
            }
            this.busy = true
            try {
                const err = await leaveSpace(this.active)
                if (err) {
                    toast(err)
                }
            } finally {
                this.busy = false
            }
        },
        destroy() {
            this._unsubChoices?.()
            this._unsubActive?.()
            this._unsubJoined?.()
            this._unsubRelays?.()
        },
    }))

    // Invite einlösen (/join?r=&c=): parst den Link, tritt dem Space bei (28934 +
    // Claim) und macht ihn zum aktiven Space. Der Signer signiert im Browser.
    Alpine.data('nostrInvite', (link: unknown): InviteState => ({
        space: '',
        label: '',
        claim: '',
        joining: false,
        error: '',
        done: false,
        init() {
            const data = parseInviteLink(String(link ?? window.location.href))
            if (data) {
                this.space = data.url
                this.label = displayRelayUrl(data.url)
                this.claim = data.claim
            } else {
                this.error = t('Ungültiger Einladungslink.')
            }
        },
        async accept() {
            if (!this.space || this.joining) {
                return
            }
            this.joining = true
            this.error = ''
            try {
                const err = await joinSpace(this.space, this.claim)
                if (err) {
                    this.error = err
                } else {
                    setActiveSpace(this.space)
                    this.done = true
                    ;(window as unknown as { Livewire: { navigate: (u: string) => void } }).Livewire.navigate('/spaces')
                }
            } finally {
                this.joining = false
            }
        },
    }))

    // Nostr-Login: spiegelt den welshman-`pubkey`-Store nach Alpine und bietet
    // die Signer-Pfade (Extension/nsec/Bunker). Signing bleibt im Browser.
    Alpine.data('nostrAuth', (): AuthState => ({
        pubkey: null,
        npub: '',
        signerLabel: t('Nicht verbunden'),
        hasExtension: false,
        keyInput: '',
        bunkerInput: '',
        connectQr: '',
        connectUri: '',
        connecting: false,
        mobile: isMobile,
        busy: false,
        error: '',
        reauthing: false,
        // Reconnect-Modus (?reconnect=1 vom Perms-Nudge): zeigt trotz aktivem pubkey
        // die Verbinden-Optionen und unterdrückt die Auto-Reauth, damit der Nutzer die
        // Amber/Bunker-Verbindung mit den vollständigen Perms neu aufsetzen kann.
        reconnect: new URLSearchParams(location.search).get('reconnect') === '1',
        myName: '',
        myPicture: '',
        myNip05: '',
        myAbout: '',
        _unsub: null,
        _unsubMyProfile: null,
        _unsubMyHandle: null,
        _connectAbort: null,
        _reauthTried: false,
        init() {
            // NIP-07-Extensions (Alby, nos2x …) injizieren `window.nostr` asynchron —
            // oft erst NACH Alpine-init. Deshalb ~3 s pollen statt nur einmal prüfen.
            const hasNostr = () => typeof (window as unknown as { nostr?: unknown }).nostr !== 'undefined'
            this.hasExtension = hasNostr()
            if (!this.hasExtension) {
                let tries = 0
                const timer = setInterval(() => {
                    this.hasExtension = hasNostr()
                    if (this.hasExtension || ++tries > 15) {
                        clearInterval(timer)
                    }
                }, 200)
            }
            this._unsub = pubkey.subscribe((pk: string | undefined) => {
                this.pubkey = pk ?? null
                this.npub = pk ? nip19.npubEncode(pk) : ''
                this.signerLabel = currentSignerLabel()
                // Eigenes Profil (Name/Avatar/nip05/about) für den Space-Kopf auflösen — dasselbe
                // Muster wie die profile-card: pro pubkey frische deriveProfile/-Handle-Subs, Fallback
                // = gekürzter npub, verifizierte nip05 nur bei bestätigtem welshman-Handle.
                this._unsubMyProfile?.()
                this._unsubMyProfile = null
                this._unsubMyHandle?.()
                this._unsubMyHandle = null
                if (pk) {
                    const fallback = `${this.npub.slice(0, 12)}…${this.npub.slice(-6)}`
                    this.myName = fallback
                    this.myPicture = ''
                    this.myAbout = ''
                    this.myNip05 = ''
                    this._unsubMyHandle = deriveHandleForPubkey(pk).subscribe((handle) => {
                        this.myNip05 = handle ? displayNip05(handle.nip05) : ''
                    })
                    this._unsubMyProfile = deriveMergedProfile(pk).subscribe((p) => {
                        this.myName = displayProfile(p, fallback)
                        this.myPicture = p?.picture ?? ''
                        this.myAbout = p?.about ?? ''
                    })
                } else {
                    this.myName = this.myPicture = this.myAbout = this.myNip05 = ''
                }
            })
            // Auto-Reauth: Kommt man mit wiederhergestellter Client-Session (localStorage)
            // auf die Login-Seite, ist meist nur die Laravel-Session weg (Reboot/Ablauf) —
            // das Server-Gate hat hierher geworfen. Handoff (NIP-98) nachholen statt in der
            // „Angemeldet"-Sackgasse zu stecken. Nur auf /nostr-login, einmal, nur wenn
            // wirklich eingeloggt. Web = Handoff; Mobile = direkt /spaces (kein Server-Gate).
            if (location.pathname.startsWith('/nostr-login') && !this.reconnect) {
                void ensureAuthReady().then(async () => {
                    if (this._reauthTried || !pubkey.get()) {
                        return
                    }
                    this._reauthTried = true
                    this.reauthing = true
                    try {
                        window.location.assign(await postLoginRedirect())
                    } catch (e) {
                        // Handoff scheitert (Signer offline / kein Mitglied) → Karte + Fehler.
                        this.reauthing = false
                        this.error = e instanceof Error ? e.message : String(e)
                    }
                })
            }
        },
        // welshman-Login (Signer im Browser). Nach Erfolg zum Login-Ziel (siehe
        // postLoginRedirect). Schlägt ein FRISCHER Login fehl, wird die welshman-Session
        // zurückgerollt, damit Browser- und (auf Web) Laravel-Zustand konsistent bleiben.
        // Im Reconnect-Modus NICHT rollen: dort besteht bereits eine gültige Session,
        // die ein gescheiterter Perms-Reconnect (Amber offline/abgelehnt) nicht zerstören
        // darf — der Nutzer soll weiter angemeldet bleiben.
        async completeLogin(fn) {
            this.busy = true
            this.error = ''
            try {
                await fn()
                window.location.assign(await postLoginRedirect())
            } catch (e) {
                this.error = e instanceof Error ? e.message : String(e)
                if (!this.reconnect) {
                    logout()
                }
            } finally {
                this.busy = false
            }
        },
        loginExtension() {
            return this.completeLogin(loginWithExtension)
        },
        loginNsec() {
            return this.completeLogin(() => loginWithSecretKey(this.keyInput))
        },
        loginBunker() {
            return this.completeLogin(() => loginWithBunker(this.bunkerInput))
        },
        // Amber-QR (nostrconnect://): QR anzeigen, im Hintergrund auf Amber warten,
        // nach Verbindung den NIP-98-Handoff wie bei jedem Login fahren.
        async startConnect() {
            if (this.connecting) {
                return
            }
            this.error = ''
            this.connectQr = ''
            this.connectUri = ''
            this.connecting = true
            // Mobile + lokaler Amber → NIP-55 Offline-Login (App-zu-App, kein Relay,
            // kein nostrconnect-Pairing-Race). Amber öffnet sich für get_public_key; das
            // Ergebnis kommt in-page zurück (native-event, keine Navigation), dann Login.
            if (isMobile && (await nip55Available())) {
                try {
                    const pk = await startNip55Login()
                    loginWithNip55(pk)
                } catch (e) {
                    this.error = e instanceof Error ? e.message : String(e)
                    this.connecting = false
                    return
                }
                // **Ab hier ist die Sitzung gültig.** Vorher lag die Zielbestimmung im
                // selben `try`: scheiterte sie (Netz weg beim NIP-98-Handoff), sah der
                // Nutzer eine Fehlermeldung auf der Login-Seite — angemeldet, aber
                // stehengeblieben. Ein Fehler beim ZIEL darf den geglückten Login nicht
                // wie einen gescheiterten aussehen lassen.
                let ziel = '/spaces'
                try {
                    ziel = await postLoginRedirect()
                } catch {
                    // Default-Ziel; die Insel hält die Session selbst (§7).
                }
                window.location.assign(ziel)
                return
            }
            const abort = new AbortController()
            this._connectAbort = abort
            try {
                await loginWithNostrConnect(async (url) => {
                    this.connectUri = url
                    if (isMobile) {
                        // Mobile: Amber SOFORT per nativem Intent öffnen (nostrconnect://
                        // auf demselben Gerät) — der erste Klick genügt, kein zweiter
                        // Button-Schritt. Rückkanal läuft über die Signer-Relais.
                        this.openAmber()
                    } else {
                        // Desktop: QR zum Scannen mit Amber (kein zweites Gerät im Web).
                        this.connectQr = await QRCode.toDataURL(url, { width: 256, margin: 1 })
                    }
                }, abort.signal)
                window.location.assign(await postLoginRedirect())
            } catch (e) {
                if (!abort.signal.aborted) {
                    this.error = e instanceof Error ? e.message : String(e)
                    // Reconnect-Modus: bestehende Session nicht wegen eines
                    // gescheiterten Perms-Reconnects zerstören (s. completeLogin).
                    if (!this.reconnect) {
                        logout()
                    }
                }
            } finally {
                if (this._connectAbort === abort) {
                    this.connecting = false
                    this.connectQr = ''
                    this._connectAbort = null
                }
            }
        },
        stopConnect() {
            this._connectAbort?.abort()
            this._connectAbort = null
            this.connecting = false
            this.connectQr = ''
            this.connectUri = ''
        },
        // Amber öffnen: die WebView reicht das nostrconnect://-Scheme nicht selbst
        // an externe Apps → nativer Intent DIREKT über die NativePHP-Bridge
        // (Browser.Open), nicht über einen `$wire`-Roundtrip. Genau der Roundtrip
        // schluckte den ersten Tap (Request-Pooling/Morph); der direkte Bridge-
        // fetch öffnet Amber beim ersten Klick. Rückkanal läuft über Signer-Relais.
        openAmber() {
            if (this.connectUri) {
                void nativeBrowserOpen(this.connectUri)
            }
        },
        // npub o. Ä. in die Zwischenablage (Profil-Popover). Gleiches Muster wie profile-card.
        // `message` ist der FERTIGE Satz — Begründung an der Schwester-Implementierung.
        copy(text, message) {
            if (text) {
                void navigator.clipboard?.writeText(text).then(() => toast(message, 'success'))
            }
        },
        async doLogout() {
            this.stopConnect()
            logout()
            try {
                // Mobile hat keine Laravel-Session (§7) — der Server-Logout ist ein No-op
                // gegen tote Routen; nur die welshman-Session (localStorage) räumen.
                if (!isMobile) {
                    await logoutServer()
                }
            } finally {
                // **`finally`, nicht `catch`**: `logoutServer()` ist ein nacktes `fetch`.
                // Ohne diesen Rahmen rejectete `doLogout` bei jedem Netzfehler, Alpine
                // verschluckte die Rejection — und die Navigation unten lief NIE. Die
                // Oberfläche sagte „abgemeldet", die Seite blieb stehen, und mit ihr der
                // ganze Modulzustand (siehe die Sitzungsprüfung in `blossomMedia.ts`,
                // die genau deshalb nicht auf diesen Reload baut).
                this.keyInput = ''
                this.bunkerInput = ''
                window.location.assign('/nostr-login')
            }
        },
        destroy() {
            this._connectAbort?.abort()
            this._unsub?.()
            this._unsubMyProfile?.()
            this._unsubMyHandle?.()
        },
    }))

    // Globaler Signer-Health-Banner (M6): erscheint app-weit, wenn der (NIP-46-)
    // Signer nicht/langsam antwortet — besonders im Raum relevant, wo signiert
    // wird. Nur bei eingeloggtem User; sonst ist der Zustand bedeutungslos.
    Alpine.data('nostrSignerBanner', (): SignerBannerState => ({
        message: '',
        _unsubHealth: null,
        _unsubPubkey: null,
        _pk: null,
        _health: 'ok',
        init() {
            const refresh = () => {
                this.message = this._pk ? signerHealthLabel(this._health) : ''
            }
            this._unsubPubkey = pubkey.subscribe((pk: string | undefined) => {
                this._pk = pk ?? null
                refresh()
            })
            this._unsubHealth = signerHealth.subscribe((health: SignerHealth) => {
                this._health = health
                refresh()
            })
        },
        destroy() {
            this._unsubHealth?.()
            this._unsubPubkey?.()
        },
    }))

    // Reconnect-Nudge: bestehende Amber/Bunker-Verbindungen behalten nach dem Perms-
    // Update ihre alten (unvollständigen) Rechte — welshman verhandelt beim Reload
    // nicht neu. Erkennt das (nip46PermsStale) und bietet einen Einmal-Reconnect an,
    // der die Verbindung mit der vollständigen Perm-Liste neu aufsetzt. Nur NIP-46.
    Alpine.data('nostrReconnectBanner', (): ReconnectBannerState => ({
        stale: false,
        _unsub: null,
        init() {
            // An pubkey koppeln: (Re-)Login/Logout ändern den relevanten Zustand.
            this._unsub = pubkey.subscribe(() => {
                this.stale = nip46PermsStale()
            })
        },
        destroy() {
            this._unsub?.()
        },
        reconnect() {
            window.location.assign('/nostr-login?reconnect=1')
        },
    }))

    // Netzwerk & Relays (App-Shell-Verschmelzung §6.4, read-only): zeigt die
    // NIP-65-Relayliste (kind 10002) des Nutzers. Parst die `r`-Tags direkt
    // (ohne Marker = Lesen+Schreiben) statt über den Router — robust auch, wenn
    // die Router-Relay-Selektion noch nicht warm ist. Editor folgt separat.
    Alpine.data('nostrRelays', (): RelaysState => ({
        relays: [],
        loading: true,
        _unsub: null,
        _unsubEvents: null,
        // pubkey wird async aus localStorage hydriert (@welshman/store sync) — erst
        // nach `ensureAuthReady()` ist er definitiv (sonst wäre die Liste beim harten Reload,
        // dem einzigen Weg hierher, dauerhaft leer). Danach reaktiv: Login/Logout
        // schaltet die Relay-Ansicht mit (gleiche Disziplin wie nostrWallet/nostrAuth).
        async init() {
            await ensureAuthReady()
            this._unsub = pubkey.subscribe((pk: string | undefined) => {
                this._unsubEvents?.()
                this._unsubEvents = null
                if (!pk) {
                    this.relays = []
                    this.loading = false

                    return
                }
                this.loading = true
                const store = deriveEvents({ repository, filters: [{ kinds: [RELAYS], authors: [pk] }] })
                this._unsubEvents = store.subscribe((evs: TrustedEvent[]) => {
                    const ev = evs[0]
                    if (!ev) {
                        return
                    }
                    // NIP-65: r-Tag [ "r", url, ("read"|"write")? ]; ohne Marker = beides.
                    this.relays = ev.tags
                        .filter((t: string[]) => t[0] === 'r' && Boolean(t[1]))
                        .map((t: string[]) => ({ url: t[1], read: !t[2] || t[2] === 'read', write: !t[2] || t[2] === 'write' }))
                    this.loading = false
                })
                load({ filters: [{ kinds: [RELAYS], authors: [pk] }], relays: DEFAULT_RELAYS }).finally(() => {
                    this.loading = false
                })
            })
        },
        destroy() {
            this._unsub?.()
            this._unsubEvents?.()
        },
    }))

    // M0-Smoke: lädt kind:1-Notes ins `repository` und rendert sie live über
    // deriveEvents → subscribe → Alpine. Beweist die komplette Bridge-Kette.
    Alpine.data('nostrSmoke', (): SmokeState => ({
        events: [],
        loading: true,
        error: '',
        _unsub: null,
        init() {
            const store = deriveEvents({ repository, filters: [{ kinds: [1] }] })
            this._unsub = store.subscribe((evs: TrustedEvent[]) => {
                this.events = evs.slice(0, 30)
            })
            load({ filters: [{ kinds: [1], limit: 30 }], relays: DEFAULT_RELAYS })
                .then(() => {
                    this.loading = false
                })
                .catch((e: unknown) => {
                    this.error = String(e)
                    this.loading = false
                })
        },
        destroy() {
            this._unsub?.()
        },
    }))

    // C1-Emoji-Picker: das volle Standard-Set (emojibase, lazy) + ein erster Tab
    // mit den Custom-Emoji (NIP-30) DEINES Profils. Die schweren Emoji-Listen
    // liegen als Closure-Variablen (NICHT im Alpine-Proxy) — sonst würde jedes
    // Öffnen ~1900 Objekte reaktiv wrappen. Reaktiv sind nur `search`/`activeTab`
    // und die wenigen Tab-Metadaten; `results` liest daraus + den rohen Listen.
    // `react(m, …)` kommt per Scope-Chain von der `nostrRoomChat`-Insel.
    type PickerEmoji = (StdEmoji & { custom?: false }) | (CustomEmoji & { custom: true })
    type EmojiPickerState = {
        ready: boolean
        search: string
        activeTab: string
        tabs: { key: string; name: string; icon: string; custom: boolean }[]
        recent: RecentEmoji[]
        customReady: CustomEmoji[]
        customTotal: number
        init(): Promise<void>
        rebuildTabs(): void
        preloadCustom(): void
        readonly results: PickerEmoji[]
        readonly customResults: PickerEmoji[]
        readonly standardResults: PickerEmoji[]
    }
    // Bild-URLs, die in dieser Sitzung schon einmal erfolgreich geladen wurden.
    // AUSSERHALB der Komponente, damit sie das Schließen des Panels überleben —
    // `x-if` verwirft die Instanz bei jedem Zuklappen, und mit ihr fiel bisher auch
    // das Wissen weg, welche Bilder bereits tragen. Begründung an `preloadCustom()`.
    // Nur Erfolge landen hier: ein Bild, das nicht lud, soll beim nächsten Öffnen
    // wieder versucht werden.
    const geladeneEmojiBilder = new Set<string>()
    Alpine.data('emojiPicker', (): EmojiPickerState => {
        let groups: Awaited<ReturnType<typeof loadEmojiGroups>> = []
        let custom: CustomEmoji[] = []
        return {
            ready: false,
            search: '',
            activeTab: '',
            tabs: [],
            // „Zuletzt benutzt"-Reihe (MRU) — beim Öffnen aus localStorage; leer,
            // solange noch nichts benutzt wurde (dann keine Reihe).
            recent: loadRecentEmojis().slice(0, 8),
            // Custom-Emoji (NIP-30), deren Bild FERTIG geladen ist — nur diese kommen
            // ins Grid, progressiv (Reihenfolge = Ladereihenfolge). So sieht man nie
            // plumpe Shortcode-Alt-Texte, sondern eine sich aufbauende Bilderliste.
            customReady: [],
            // Erwartete Custom-Emoji-Zahl (für „lädt noch" vs. „wirklich keine").
            customTotal: 0,
            async init() {
                // Standard-Set zuerst (lokale JSON) → Grid sofort nutzbar. Die
                // Custom-Emoji (NIP-30) ziehen entkoppelt nach: ein hängender/leerer
                // Relay-Load (member-only AUTH) darf das Grid NIE blockieren. Der
                // Load ist beim Raum-Init vorgewärmt (loadUserCustomEmojis) → hier
                // i.d.R. ein Cache-Treffer, kein zweiter Relay-Roundtrip.
                groups = await loadEmojiGroups()
                this.rebuildTabs()
                this.ready = true
                void loadUserCustomEmojis().then((c) => {
                    custom = c
                    this.customTotal = c.length
                    this.rebuildTabs()
                    this.preloadCustom()
                })
            },
            // Jedes Custom-Bild vorladen; erst bei `onload` ans Grid anhängen (fehlende
            // Bilder werden nie gezeigt). Die Reihenfolge ist bewusst egal.
            //
            // Was schon einmal geladen wurde, erscheint SOFORT wieder. Vorher setzte
            // diese Methode `customReady` bei jedem Öffnen auf leer und wartete auf
            // `onload` für jedes einzelne Bild — auch für die, die längst im
            // Browser-Cache lagen. Der Picker mountet bei jedem Öffnen neu (`x-if`),
            // also passierte das JEDES MAL: „Emojis laden…", dann tröpfelten die
            // Kacheln nach. Custom-Emoji-Bilder liegen auf fremden Servern, von denen
            // manche träge sind; genau deshalb fiel es auf.
            //
            // Der Browser-Cache selbst ist nicht das Problem — der Proxy liefert
            // `public, max-age=31536000, immutable` (ImageProxyController), die Bilder
            // kommen also aus dem Cache. Aber auch ein Cache-Treffer läuft über
            // `onload`, und bis der feuert, ist die Kachel leer. Was fehlte, war das
            // WISSEN, dass ein Bild bereits trägt. Das steht jetzt auf Modul-Ebene und
            // überlebt damit das Schließen des Panels.
            preloadCustom() {
                this.customReady = custom.filter((e) => geladeneEmojiBilder.has(e.src))
                for (const emoji of custom) {
                    if (geladeneEmojiBilder.has(emoji.src)) {
                        continue
                    }
                    const img = new Image()
                    img.onload = () => {
                        geladeneEmojiBilder.add(emoji.src)
                        this.customReady.push(emoji)
                    }
                    img.src = emoji.src
                }
            },
            // Tab-Leiste (neu) bauen: „Deine Emojis" (NIP-30) zuerst, dann die
            // Standard-Kategorien. Aktiven Tab behalten, solange er noch existiert.
            rebuildTabs() {
                this.tabs = [
                    ...(custom.length ? [{ key: 'custom', name: t('Deine Emojis'), icon: '⚡', custom: true }] : []),
                    ...groups.map((g) => ({ key: g.key, name: g.name, icon: g.icon, custom: false })),
                ]
                if (!this.activeTab || !this.tabs.some((t) => t.key === this.activeTab)) {
                    this.activeTab = this.tabs[0]?.key ?? ''
                }
            },
            // Sichtbares Emoji-Segment: Suchtreffer, sonst der aktive Tab.
            get results() {
                if (!this.ready) {
                    return []
                }
                if (this.search.trim()) {
                    return searchEmojis(this.search, groups, this.customReady)
                }
                if (this.activeTab === 'custom') {
                    return this.customReady.map((c) => ({ ...c, custom: true as const }))
                }
                return groups.find((g) => g.key === this.activeTab)?.emojis ?? []
            },
            // Getrennt nach Darstellungsart, weil das Markup sonst PRO KACHEL zwei
            // `<template x-if>` bräuchte (Bild oder Zeichen). Gemessen: 171 Kacheln
            // erzeugten 347 Template-Knoten, und der Aufbau des Panels dauerte 148 ms
            // — bei nur 18 ms Modul-Eval und 0,6 ms Indizierung. Jedes `<template>`
            // ist eine eigene Alpine-Reaktivitätseinheit mit eigenem DOM-Klon; zwei
            // davon je Kachel sind der Löwenanteil dieser Zeit. Zwei flache Schleifen
            // über vorsortierte Listen brauchen keine einzige.
            //
            // `results` wird dabei zweimal ausgewertet. Das ist bewusst in Kauf
            // genommen: im Tab-Modus ist es ein `find()` auf neun Gruppen, bei Suche
            // ein Durchlauf über ~1950 Einträge (~1 ms, zusätzlich debounced). Ein
            // Memo dafür wäre ein Cache im reaktiven Objekt — mehr Risiko als Gewinn.
            get customResults() {
                return this.results.filter((e) => 'custom' in e && e.custom)
            },
            // Ungedeckelt, und das ist gemessen und nicht bloß einfacher: ein Versuch,
            // beim Öffnen erst 48 Kacheln zu rendern und den Rest nach dem ersten
            // Paint nachzuschieben, brachte die ersten sichtbaren Kacheln von 86 ms
            // auf 68 ms. 18 ms liegen unter der Wahrnehmungsschwelle und rechtfertigen
            // weder den Zustand (`renderLimit`) noch das doppelte `requestAnimation
            // Frame`, das ihn aufhebt. Wer es erneut versucht, misst bitte den ERSTEN
            // PAINT (Kachelzahl je Frame) — „Tabs sichtbar" bewegt sich dabei nicht
            // und sieht deshalb wie ein Nullergebnis aus.
            get standardResults() {
                return this.results.filter((e) => !('custom' in e) || !e.custom)
            },
        }
    })

    // Web-Popover für das Emoji-Panel: teleportiert ans <body> (kein Clipping im
    // Chat-Scroll-Container) und `fixed` positioniert. Der Inhalt hängt an
    // `x-if="open"` → nur die eine offene Instanz mountet den schweren emojiPicker
    // (kein DOM-Bloat über N Nachrichtenzeilen).
    //
    // Die Rechnung kommt OHNE die Panelhöhe aus — das ist der Kern, nicht ein Detail.
    // Vorher lautete sie `top = trigger.top - panelHöhe - gap`, gemessen einmal im
    // $nextTick nach dem Öffnen. Beim ERSTEN Öffnen einer Sitzung steht dort aber noch
    // „Emojis laden…": 132 px statt 292 px. Das Panel bekam ein `top` für die kleine
    // Höhe, wuchs danach nach unten und stand 98 px unter dem Viewport-Rand — die
    // untersten Emoji-Reihen abgeschnitten, vom Nutzer im Betrieb gemeldet. Dieselbe
    // Klasse traf jede spätere Höhenänderung (Suche filtert, MRU-Reihe erscheint) und
    // beide Trigger, den Reaktions-Popover eingeschlossen (dort 9 px Überlauf).
    //
    // Eine Höhe, die man zum falschen Zeitpunkt misst, ist nicht durch besseres Timing
    // zu retten — sie darf gar nicht erst in die Rechnung. Deshalb ankert das nach oben
    // öffnende Panel an seiner UNTERkante: wächst es, wächst es vom Trigger weg nach
    // oben, und `max-height` verhindert, dass es dabei den Viewport verlässt.
    //
    // Verhaltensänderung, bewusst: die Richtung entscheidet jetzt die größere freie
    // Seite (`above >= below`) statt „oben, außer es passt nicht". Ohne die Panelhöhe
    // ist „passt es?" nicht beantwortbar — und die größere Seite ist ohnehin die
    // bessere Wahl. Für den Composer-Knopf (sitzt unten) ändert das nichts.
    type ReactionPopoverState = {
        open: boolean
        panelStyle: string
        toggle(): void
        reposition(): void
        closeUnless(event: Event): void
    }
    /**
     * `align` — an WELCHER Kante des Triggers das Panel hängt (Default `'end'`:
     * rechte Panel- an rechter Trigger-Kante, also nach links auslaufend).
     *
     * Der Default ist der Bestand und bleibt es: der Reaktions-Trigger sitzt am
     * RECHTEN Ende einer Nachrichtenzeile, dort ist „nach links auslaufen" die
     * einzige Richtung, die im Viewport bleibt. Ein Trigger am LINKEN Rand (der
     * Composer-Emoji-Knopf) braucht das Gegenteil — sonst hängt das Panel über
     * dem, was links davon liegt (gemessen im Desktop-Chassis: 189 von 354 px
     * über der Navigations-Rail). `'start'` legt die linke Panel- an die linke
     * Trigger-Kante; die Viewport-Klemme darunter bleibt für beide dieselbe.
     */
    /**
     * `HIDDEN` — der Zustand VOR der ersten Rechnung. `x-if` mountet das Panel, und
     * `reposition()` läuft erst im `$nextTick` danach: dazwischen liegt ein Frame, in
     * dem `fixed` ohne `top`/`left` das Panel an seiner statischen Stelle stehen lässt.
     * Die ist das Ende des `<body>` — gemessen `top 720` bei `vh 720`, also einen Frame
     * lang voll deckend unterhalb des Fensterrands. Unsichtbar, solange die Seite hoch
     * genug ist; bei einer kurzen läge dieselbe Stelle mitten im Bild.
     *
     * `visibility:hidden` statt `opacity:0`, weil `x-transition.opacity` die Opazität
     * selbst animiert und beide sich sonst überschrieben.
     *
     * Zurückgesetzt wird auf dem ÖFFNUNGS-, nicht auf dem Schließweg — synchron, bevor
     * `open = true` den Mount auslöst. Geschlossen wird nämlich auf vier Wegen, von
     * denen drei an `toggle()` vorbeigehen: Escape und `click.outside` setzen `open`
     * direkt, und `onpick` tut es aus dem Picker heraus. Ein Reset im Schließzweig
     * deckte nur einen davon. Die Komponente überlebt das Unmounten des Panels, ihr
     * `panelStyle` also auch — ein stehengebliebener Wert aus dem letzten Öffnen ist
     * genau der Grund, aus dem der Positionierungsfehler früher nur JEDES ZWEITE Mal
     * auftrat und dadurch so schwer zu fassen war.
     */
    const HIDDEN = 'visibility:hidden'
    Alpine.data('reactionPopover', (options?: unknown): ReactionPopoverState => ({
        open: false,
        panelStyle: HIDDEN,
        toggle() {
            if (!this.open) {
                this.panelStyle = HIDDEN
            }
            this.open = !this.open
            if (this.open) {
                ;(this as unknown as AlpineMagics).$nextTick(() => this.reposition())
            }
        },
        reposition() {
            const refs = (this as unknown as AlpineMagics).$refs
            const trigger = refs.trigger
            const panel = refs.panel
            if (!trigger || !panel) {
                return
            }
            const t = trigger.getBoundingClientRect()
            const pw = panel.offsetWidth
            const pad = 8
            const gap = 6
            const alignStart = (options as { align?: string } | undefined)?.align === 'start'
            const left = Math.min(Math.max(pad, alignStart ? t.left : t.right - pw), window.innerWidth - pw - pad)
            const above = t.top - gap - pad
            const below = window.innerHeight - t.bottom - gap - pad
            // Nach OBEN: die UNTERkante am Trigger festnageln (`bottom`), nach unten die
            // OBERkante (`top`). Beides ohne die Panelhöhe. Die ungenutzte Kante wird
            // ausdrücklich auf `auto` gesetzt, damit ein Richtungswechsel nicht beide
            // stehen lässt. `max-height` ist die Garantie, nicht die Rechnung: mehr Platz
            // als da ist kann das Panel nicht beanspruchen, es scrollt stattdessen.
            const edge = above >= below
                ? `top:auto;bottom:${Math.round(window.innerHeight - t.top + gap)}px;max-height:${Math.round(above)}px`
                : `bottom:auto;top:${Math.round(t.bottom + gap)}px;max-height:${Math.round(below)}px`
            this.panelStyle = `left:${Math.round(left)}px;${edge};overflow-y:auto`
        },
        closeUnless(event: Event) {
            const trigger = (this as unknown as AlpineMagics).$refs.trigger
            if (!trigger?.contains(event.target as Node)) {
                this.open = false
            }
        },
    }))

    Alpine.data('lightboxZoom', createLightboxZoom)
}
