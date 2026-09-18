/**
 * `nostrVereinMitgliedschaft` — the island of „Ich › Verein" (D11, P5): membership status,
 * contribution year, receipts, and the way into the join flow.
 *
 * The pure half (reading the payloads, deciding the state, the cache rule) is
 * `mitgliedschaftModelle.ts`; everything that needs a signer, a network or a clock is here.
 *
 * ── One page, two doors, the SAME signature ──────────────────────────────────────────
 *
 * Both reads go to the association's signed endpoints (`GET /api/v1/membership/me` and
 * `/payments`, NIP-98). What differs is only the door in front of them:
 *
 *   web  `/api/verein/*`      session + CSRF (`routes/verein.php`), plus the signature
 *   app  `/api/app/verein/*`  no session, no CSRF — the signature IS the identity
 *                             (`routes/verein-app.php`, added by P1)
 *
 * The `u` tag names the ASSOCIATION's URL, never our proxy: the association compares it byte
 * for byte against its own origin plus request URI (`hash_equals`, case-sensitive, query
 * included), so an event signed for the proxy route would never pass there — and our proxy
 * checks the same string beforehand so the mistake surfaces here instead of after a network
 * round trip.
 *
 * Until P5 the app arm had NO `/me` at all: without a signature the association would have
 * been an oracle over other people's membership, which it forbids outright. The signed app
 * routes are what P1 built, and this island is their first caller.
 *
 * ── Why a signature is a scarce resource here ────────────────────────────────────────
 *
 * On an Amber/bunker session every signature is a PROMPT the user has to answer, and NIP-98
 * signs one URL and one method — so `/me` and `/payments` cannot share one. Hence the shape
 * of this island:
 *
 *  · `/me` is read when the page opens: one signature.
 *  · `/payments` is read when the reader asks for the receipts: one more, on demand. The
 *    list is a history, not a status — nobody needs it to learn whether they are a member.
 *  · Both answers are kept in memory for ten minutes (`MITGLIEDSCHAFT_CACHE_MS`), keyed by
 *    pubkey, so leaving the page and coming back costs nothing.
 *  · A 401 shows a RETRY and nothing else. **No silent retry loop**, and that is not
 *    caution: the association burns the event id after the first attempt (replay lock, 150 s)
 *    and its clock tolerance is ±60 s, so a second attempt with the same event is guaranteed
 *    to fail — and an automatic one with a fresh event would be a second prompt the user did
 *    not ask for. Every retry path in this file signs anew, and only on a press.
 */
import { get } from 'svelte/store'
import { pubkey, signer } from './welshmanSession.ts'
import { nip98AuthHeader, type SignedLike } from './nip98.ts'
import { isMobile } from './core.ts'
import { t } from './i18n.ts'
import { escapeLabel, mapVereinError, type MeData, type VereinError } from './vereinFlow.ts'
import {
    cacheIsFresh,
    mitgliedschaftZustand,
    readMembership,
    readPayments,
    type MitgliedschaftZustand,
    type PaymentRow,
} from './mitgliedschaftModelle.ts'

type VereinWindowConfig = {
    /** Origin of the association API — the target of the `u` tag. '' = not set up. */
    api?: string
    /** Origin of our proxy. '' = the same origin as the page (the web instance). */
    proxy?: string
    /** The public association page — the way out when the way inside does not carry. */
    publicUrl?: string
}

const conf = (): VereinWindowConfig => (window as { __nostrVerein?: VereinWindowConfig }).__nostrVerein ?? {}

/** Path prefix of the association's membership API — identical for both doors. */
const API_PREFIX = '/api/v1/membership'

/** Our two proxy prefixes (`bootstrap/app.php`). Never unified: they carry different auth. */
const WEB_PROXY_PREFIX = '/api/verein'
const APP_PROXY_PREFIX = '/api/app/verein'

const csrfToken = (): string =>
    document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''

type Antwort = { ok: boolean; status: number; body: unknown; retryAfter: string | null }

/**
 * One signed GET through our proxy.
 *
 * The signing sits INSIDE the `try`, and that is not a formality — it is the failure class
 * `verein.ts` records at length: the extension rejects (NIP-07 „Reject"), the bunker runs
 * into its timeout, or `crypto.subtle` is missing because the page is not in a secure
 * context. Any of those throws HERE, and a throw that escapes this function leaves the
 * surface in `laden` with no error and no way out but a reload.
 *
 * Mapped onto 401 — not because the association answered (it was never asked), but because
 * the way out is the same and the only one: sign again.
 */
const lese = async (path: string): Promise<Antwort> => {
    const { api = '', proxy = '' } = conf()
    if (api === '') {
        // Fail closed rather than fail confusing: without the base URL the `u` tag could not
        // name the association and every signature would be worthless. Same sentence as the
        // join flow uses for the same state.
        return { ok: false, status: 503, body: { message: t('Die Vereins-Anbindung ist nicht eingerichtet.') }, retryAfter: null }
    }

    const s = get(signer)
    if (!s) {
        return { ok: false, status: 403, body: { message: t('Nicht angemeldet.') }, retryAfter: null }
    }

    const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
    }
    if (!isMobile) {
        // The web door sits in the `web` group and therefore behind CSRF. The app door does
        // not — it is not a browser of our instance.
        headers['X-CSRF-TOKEN'] = csrfToken()
    }

    try {
        headers.Authorization = await nip98AuthHeader(
            (e) => s.sign(e) as Promise<SignedLike>,
            `${api.replace(/\/+$/, '')}${API_PREFIX}${path}`,
            'GET',
        )
    } catch {
        return { ok: false, status: 401, body: null, retryAfter: null }
    }

    let res: Response
    try {
        res = await fetch(`${proxy.replace(/\/+$/, '')}${isMobile ? APP_PROXY_PREFIX : WEB_PROXY_PREFIX}${path}`, {
            method: 'GET',
            headers,
            credentials: 'same-origin',
            // Do not follow redirects: the proxy passes a 3xx through unaltered but withholds
            // the `Location`, and `follow` would run against the same address a second time.
            redirect: 'manual',
        })
    } catch {
        return { ok: false, status: 504, body: null, retryAfter: null }
    }

    let parsed: unknown = null
    try {
        parsed = await res.json()
    } catch {
        parsed = null
    }

    return { ok: res.ok, status: res.status, body: parsed, retryAfter: res.headers.get('Retry-After') }
}

// ── The in-memory cache ────────────────────────────────────────────────────────────────
//
// Module level and keyed by PUBKEY: an account switch must not inherit the previous key's
// membership (the same rule the join flow's progress store follows). Memory only, never
// `localStorage` — this is somebody's membership status, and it has no business surviving the
// tab it was read in.

type Eintrag<T> = { pubkey: string; at: number; value: T }

let meCache: Eintrag<{ me: MeData; membershipStatus: string; ohneAkte: boolean }> | null = null
let paymentsCache: Eintrag<PaymentRow[]> | null = null

const frisch = <T>(entry: Eintrag<T> | null, self: string): T | null =>
    entry !== null && entry.pubkey === self && cacheIsFresh(entry.at, Date.now()) ? entry.value : null

/** Test seam and account-switch guard: forget everything read so far. */
export const resetMitgliedschaftCache = (): void => {
    meCache = null
    paymentsCache = null
}

type MitgliedschaftState = {
    /** The four states of the page — see `mitgliedschaftModelle.mitgliedschaftZustand`. */
    zustand: MitgliedschaftZustand
    /** A read is in flight. */
    laden: boolean
    /** Verbatim error sentence, '' when there is nothing to say. */
    fehler: string
    /** The way out of that error, translated — '' when the error has none. */
    ausweg: string
    /** Was the last failure an auth failure? Then the way out is a FRESH signature. */
    authFehler: boolean
    /** The contribution year the association is talking about, 0 when unknown. */
    jahr: number
    /** The fee of that year and its currency — 0/'' when unknown. */
    beitrag: number
    waehrung: string
    /** Is that year settled? */
    bezahlt: boolean
    /** The receipt of the CURRENT year, when there is one. */
    belegUrl: string
    /** The fee history. Empty until it is asked for. */
    belege: PaymentRow[]
    belegeGeladen: boolean
    belegeLaden: boolean
    /** Is there a session at all? Without one this page has nothing to read. */
    angemeldet: boolean
    /**
     * Is an association configured at all (`window.__nostrVerein.api`)?
     *
     * Read HERE and not on the server, although the value comes from the same config key:
     * the page has no other server state, and a second decision about the same value is a
     * second place to get it wrong. It is also the only form a run can drive — a spec can
     * override the document config (`support/verein.ts`), never the `serve` process's env.
     */
    eingerichtet: boolean
    init(): void
    destroy(): void
    laedt(): Promise<void>
    holeBelege(): Promise<void>
    erneut(): void
    _unsub: (() => void)[]
    _fail(error: VereinError): void
    _applyMe(value: { me: MeData; membershipStatus: string; ohneAkte: boolean }): void
}

const createMitgliedschaft = (): MitgliedschaftState => ({
    zustand: 'unbekannt',
    laden: false,
    fehler: '',
    ausweg: '',
    authFehler: false,
    jahr: 0,
    beitrag: 0,
    waehrung: '',
    bezahlt: false,
    belegUrl: '',
    belege: [],
    belegeGeladen: false,
    belegeLaden: false,
    angemeldet: false,
    eingerichtet: false,
    _unsub: [],

    init(): void {
        this.eingerichtet = (conf().api ?? '') !== ''

        this._unsub.push(
            pubkey.subscribe((next: string | undefined) => {
                const self = next ?? ''
                this.angemeldet = self !== ''
                if (self === '') {
                    // Signed out: everything on this page was about a key that is gone.
                    resetMitgliedschaftCache()
                    this.zustand = 'unbekannt'
                    this.belege = []
                    this.belegeGeladen = false

                    return
                }
                if (!this.eingerichtet) {
                    // No base URL, no `u` tag, no worthwhile signature — and asking anyway
                    // would cost a signer prompt for an answer nobody can give.
                    return
                }
                void this.laedt()
            }),
        )
    },

    destroy(): void {
        for (const off of this._unsub) {
            off()
        }
        this._unsub = []
    },

    async laedt(): Promise<void> {
        const self = get(pubkey) ?? ''
        if (self === '' || this.laden) {
            return
        }

        const cached = frisch(meCache, self)
        if (cached) {
            this._applyMe(cached)

            return
        }

        this.laden = true
        this.fehler = ''
        this.ausweg = ''
        this.authFehler = false
        try {
            const res = await lese('/me')
            /*
             * 404 is „no record yet" and the NORMAL state of somebody who has not applied —
             * not an error. Every other non-2xx is one, and it is SHOWN with its way out
             * rather than folded into an empty page.
             */
            if (res.ok || res.status === 404) {
                const ohneAkte = res.status === 404
                const value = { ...readMembership(res.body), ohneAkte }
                meCache = { pubkey: self, at: Date.now(), value }
                this._applyMe(value)

                return
            }
            this._fail(mapVereinError(res.status, res.body, res.retryAfter, t))
        } finally {
            this.laden = false
        }
    },

    async holeBelege(): Promise<void> {
        const self = get(pubkey) ?? ''
        if (self === '' || this.belegeLaden) {
            return
        }

        const cached = frisch(paymentsCache, self)
        if (cached) {
            this.belege = cached
            this.belegeGeladen = true

            return
        }

        this.belegeLaden = true
        this.fehler = ''
        this.ausweg = ''
        this.authFehler = false
        try {
            const res = await lese('/payments')
            if (res.ok || res.status === 404) {
                const rows = readPayments(res.body)
                paymentsCache = { pubkey: self, at: Date.now(), value: rows }
                this.belege = rows
                this.belegeGeladen = true

                return
            }
            this._fail(mapVereinError(res.status, res.body, res.retryAfter, t))
        } finally {
            this.belegeLaden = false
        }
    },

    /**
     * „Noch einmal versuchen" — and it really does try ANEW.
     *
     * The cache is dropped first, so the next read signs a fresh event: the association burns
     * the event id of the failed attempt (replay lock) and tolerates ±60 s on `created_at`, so
     * re-sending the old one could only fail again. Only reachable from a press; nothing in
     * this file retries on its own.
     */
    erneut(): void {
        resetMitgliedschaftCache()
        this.fehler = ''
        this.ausweg = ''
        this.authFehler = false
        const wollteBelege = this.belegeGeladen || this.belege.length > 0
        this.belegeGeladen = false
        void this.laedt().then(() => (wollteBelege ? this.holeBelege() : undefined))
    },

    /**
     * Show the failure WITH its way out — the one promise this whole surface makes (the rule
     * `verein.ts` states: every error state has a visible escape).
     *
     * `authFehler` is what decides whether that escape signs anew: the association burned the
     * event id of the rejected attempt, so „try again" can only mean „sign again".
     */
    _fail(error: VereinError): void {
        this.fehler = error.message
        this.ausweg = escapeLabel(error.escape, t)
        this.authFehler = error.escape === 'neu-signieren' || error.escape === 'neu-anmelden'
        this.zustand = 'unbekannt'
    },

    _applyMe(value: { me: MeData; membershipStatus: string; ohneAkte: boolean }): void {
        this.zustand = mitgliedschaftZustand({
            gelesen: true,
            ohneAkte: value.ohneAkte,
            me: value.me,
            membershipStatus: value.membershipStatus,
        })
        this.jahr = value.me.year ?? 0
        this.beitrag = value.me.fee ?? 0
        this.waehrung = value.me.currency ?? ''
        this.bezahlt = value.me.paid
        this.belegUrl = value.me.receiptUrl ?? ''
        this.fehler = ''
        this.ausweg = ''
        this.authFehler = false
    },
})

export function wireMitgliedschaft(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
}): void {
    Alpine.data('nostrVereinMitgliedschaft', createMitgliedschaft as (...args: unknown[]) => unknown)
}
