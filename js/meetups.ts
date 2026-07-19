/**
 * Meetup-Praesentations-Join (Store-/Fetch-Schicht). Der Client laedt EINMAL die
 * oeffentliche Portal-Meetup-Liste und haelt einen reaktiven Index slug →
 * `MeetupPresentation` (Flagge, Portal-Deep-Link, naechster Termin). Die
 * Meetup-Raeume (39000) tragen nur den slug (`meetup_slug`) — die Praesentation
 * wird zur Render-Zeit hierueber gejoint (Portal = Source of Truth, null Drift).
 *
 * Reine Logik (Flagge/Deep-Link/Parsing) liegt welshman-frei in
 * `meetupPresentation.ts` (testbar). Hier nur der Svelte-Store + der Fetch.
 */
import { writable, get, type Readable } from 'svelte/store'
import {
    MEETUP_API_URL,
    buildPresentationMap,
    type MeetupApiRecord,
    type MeetupPresentation,
} from './meetupPresentation'

export type { MeetupPresentation } from './meetupPresentation'

/** Reaktiver Join-Index: slug → Praesentation. Leer, bis der Fetch durch ist. */
const _presentationBySlug = writable<Map<string, MeetupPresentation>>(new Map())
export const meetupPresentationBySlug: Readable<Map<string, MeetupPresentation>> = _presentationBySlug

let _loaded = false
let _inflight: Promise<void> | null = null

/**
 * Laedt die Portal-Meetup-Liste EINMAL und fuellt den Join-Index. Idempotent
 * (mehrfacher Aufruf = ein Fetch) und fail-soft: bei Netz-/Portal-Fehler bleibt
 * der Index leer und die Kachel rendert ohne Flagge/Deep-Link weiter (der
 * welshman-Warm-Render toleriert fehlende Join-Daten ohnehin).
 */
export const loadMeetupPresentations = (): Promise<void> => {
    if (_loaded) {
        return Promise.resolve()
    }
    if (_inflight) {
        return _inflight
    }
    _inflight = (async () => {
        try {
            const resp = await fetch(MEETUP_API_URL, { headers: { Accept: 'application/json' } })
            if (!resp.ok) {
                throw new Error(`meetup api ${resp.status}`)
            }
            const records = (await resp.json()) as MeetupApiRecord[]
            _presentationBySlug.set(buildPresentationMap(records))
            _loaded = true
        } catch {
            // fail-soft: Index bleibt leer; ein spaeterer Aufruf darf erneut versuchen.
            _inflight = null
        }
    })()
    return _inflight
}

/** Synchroner Lookup fuer die Render-Zeit ('' = noch nicht geladen / kein Meetup). */
export const getMeetupPresentation = (slug: string): MeetupPresentation | undefined =>
    slug ? get(_presentationBySlug).get(slug) : undefined
