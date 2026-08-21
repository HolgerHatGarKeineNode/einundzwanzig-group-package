/**
 * Zwei Ebenen Space-Gating: **gibt es die Fläche** (synchron, Konfiguration) und
 * **wie verhält sie sich** (dreiwertig, nachziehend, aus NIP-11).
 *
 * ── Die Falle, die dieses Modul auflöst ──
 *
 * `spaceIsBuzz(url)` (`buzzAdmin.ts:85-92`) liest den welshman-Cache **synchron**
 * und meldet `false`, solange das NIP-11-Doc unterwegs ist — per Design, damit die
 * bestehende zooid/NIP-86-Strecke unverändert bleibt. Beim Mount ist das Doc aber
 * IMMER noch unterwegs: wer den Wert in `x-init` einmal liest, hält für den Rest
 * der Sitzung „kein Buzz" fest, und die Fläche tut stumm nichts. Zwei bereits
 * behobene Fälle derselben Ursache stehen in `bridge.ts` → `nostrSpaces._unsubIsBuzz` (`deriveRelay(url).subscribe`) („ein synchroner
 * Blick meldete verlässlich ‚kein Buzz' und die Einträge blitzten auf") und
 * `roomPins.ts:315` („hier stand vorher `spaceIsBuzz(url)` — synchron und genau
 * einmal") — beide mussten von synchron auf reaktiv umgebaut werden.
 *
 * Der Fehler ist nicht „false statt true", sondern dass **ein zweiwertiger Typ
 * keinen Platz für „weiß ich noch nicht" hat**. Deshalb hier drei Werte:
 * `'unknown'` ist ein eigener Zustand und **kein** „false" — ein Aufrufer hängt
 * daran ein Skeleton und trifft dabei keine Entscheidung.
 *
 * ── Aktiver Anstoß statt Warten ──
 *
 * `deriveRelay(url)` stößt beim Ableiten nur `loadRelay` an, und das ist ein
 * `makeLoadItem`-Wrapper (`@welshman/app/dist/app/src/relays.js:46`): er merkt
 * sich URL + Zeitstempel und drosselt Wiederholungen exponentiell
 * (`@welshman/store/dist/store/src/repository.js:294-298`), liefert danach also
 * ohne erneuten Fetch. `fetchRelay` schreibt zudem **nur bei Erfolg** in
 * `relaysByUrl` (`relays.js:33-38`). Ein früher Fehlversuch nagelt die Weiche
 * damit dauerhaft auf `'unknown'`. Deshalb beim ersten Abonnenten
 * `forceLoadRelay(url)` — es umgeht den Merker
 * (`makeForceLoadItem`, `repository.js:272-274`) — und, solange `'unknown'`, drei
 * Wiederholungen mit Backoff 1 s / 4 s / 15 s. Danach `'other'`: ein Aufrufer
 * kann einen sichtbaren Hinweis zeigen statt ewig ein Skeleton zu drehen.
 *
 * Warum diese Schleife Rückgabewerte prüft statt zu fangen, steht bei ihr selbst
 * (siehe `loadUntilKnown` weiter unten) — es ist eine gemessene Abweichung von
 * der zitierten welshman-API und gehört an die Stelle, die sie erklärt.
 *
 * Alles Netz- und Store-Nahe steckt in `defaultDeps` und ist injizierbar
 * (`makeSpaceKindStore`) — deshalb läuft `spaceCaps.test.ts` ohne Relay, ohne
 * Netz und ohne echte Sekunden. Relative Importe tragen ihre `.ts`-Endung, sonst
 * lädt der Node-Test-Runner das Modul nicht.
 */
import { readable, type Readable } from 'svelte/store'
import { deriveRelay, forceLoadRelay } from '@welshman/app'
import { normalizeRelayUrl } from '@welshman/util'
import { isBuzzRelay } from './relayCaps.ts'

// ── Ebene 1: gibt es die Fläche? Konfiguration, kein Netz ───────────────────

/**
 * Der zweite, FESTE Space des Tabs „Workspaces" — ein Buzz-Relay neben dem
 * zooid-Space. Aus `config('group.workspace_url')` per `window.__nostrWorkspace`
 * injiziert (siehe `partials/head.blade.php`); **leer = das Feature ist aus**.
 *
 * Bewusst KEIN Store und keine Liste: es ist genau einer, konfiguriert, nicht
 * wählbar. Damit bleibt die App beim Single-Space-Fokus (§12) und bekommt nur eine
 * zweite, klar benannte Bühne daneben.
 *
 * **Stand hier statt in `groups.ts`** (dort bis P1 des Buzz-Workspace-Plans):
 * `groups.ts` ist über seine endungslosen Importe und den localStorage-Zugriff
 * beim Laden aus `node --test` nicht ladbar. Ein `spaceCaps.ts`, das von dort
 * importierte, wäre selbst untestbar. `groups.ts` re-exportiert beide Namen
 * unverändert weiter — kein Aufrufer ändert sich.
 */
export const workspaceUrlFrom = (override?: string): string => (override ? normalizeRelayUrl(override) : '')

/** Siehe {@link workspaceUrlFrom}. Einmal beim Laden aus `window.__nostrWorkspace`. */
export const WORKSPACE_URL = workspaceUrlFrom((globalThis as { __nostrWorkspace?: string }).__nostrWorkspace)

/**
 * Ist der Workspaces-Tab konfiguriert? Steuert, ob er überhaupt im DOM erscheint.
 *
 * **Synchron, ohne Netz, ohne Rennen** — und genau deshalb die richtige Ebene für
 * die Existenzfrage: hätte sie NIP-11 im kritischen Pfad, wäre die Mount-Falle
 * oben wieder da. Ob der konfigurierte Space Buzz spricht, beantwortet
 * {@link deriveSpaceKind}; ob es ihn gibt, diese Funktion.
 */
export const hasWorkspace = (): boolean => WORKSPACE_URL !== ''

// ── Ebene 2: wie verhält sie sich? Dreiwertig und nachziehend ──────────────

/**
 * `'unknown'` = NIP-11 noch nicht da (Skeleton zeigen, **nichts** entscheiden),
 * `'buzz'` = Buzz-Relay (Block Inc., Rust), `'other'` = alles andere, inklusive
 * „nach allen Versuchen nicht erreichbar".
 */
export type SpaceKind = 'unknown' | 'buzz' | 'other'

/** Das Stück NIP-11-Doc, das die Weiche braucht (`isBuzzRelay` prüft `software`). */
export type RelayInfoLike = { software?: string }

/**
 * Wartezeiten der Wiederholungen. Ein Sofortversuch beim ersten Abonnenten plus
 * bis zu drei Wiederholungen nach 1 s / 4 s / 15 s; scheitert auch die letzte,
 * steht `'other'`.
 */
export const RETRY_BACKOFF_MS: readonly number[] = [1000, 4000, 15000]

/** Alles Netz-/Store-Nahe an einer Stelle, damit der Test es ersetzen kann. */
export type SpaceKindDeps = {
    /** Reaktives NIP-11-Doc; `undefined` = noch nicht bekannt. */
    relayInfo: (url: string) => Readable<RelayInfoLike | undefined>
    /** Erzwungener Fetch am Merker vorbei; `undefined` = Fehlversuch (wirft nicht). */
    forceLoad: (url: string) => Promise<RelayInfoLike | undefined>
    /** Wartefunktion — injizierbar, damit der Test keine echten Sekunden verbraucht. */
    delay: (ms: number) => Promise<void>
}

const defaultDeps: SpaceKindDeps = {
    relayInfo: (url) => deriveRelay(url),
    forceLoad: async (url) => (await forceLoadRelay(url)) ?? undefined,
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/**
 * Der Store hinter {@link deriveSpaceKind}, mit eingesetzten Abhängigkeiten.
 * Startwert ist immer `'unknown'`; die Ladeschleife läuft erst beim ersten
 * Abonnenten an und wird beim letzten Abmelden abgebrochen.
 *
 * **Leere URL → `'other'`, nicht `'unknown'`.** Ohne Relay gibt es nichts zu
 * laden; ein ewiges Skeleton wäre die schlechtere Lüge. Die Existenzfrage
 * beantwortet {@link hasWorkspace}, nicht dieser Store.
 */
export const makeSpaceKindStore = (
    url: string,
    deps: SpaceKindDeps = defaultDeps,
    backoffMs: readonly number[] = RETRY_BACKOFF_MS,
): Readable<SpaceKind> => {
    if (!url) {
        return readable<SpaceKind>('other')
    }

    // Der Startwert `'unknown'` ist über den Svelte-Contract kaum zu beobachten:
    // `subscribe()` ruft erst `start(set)` — und damit unten `publish()` — und
    // reicht erst danach den Wert an den Abonnenten. Wer hier `'other'` einsetzt,
    // bricht deshalb nur den einen Fall, in dem der Doc-Store beim Abonnieren
    // schweigt: die Weiche entschiede dann ohne jede Grundlage. Genau dafür steht
    // in `spaceCaps.test.ts` der Fall „ein Doc-Store, der beim Abonnieren
    // schweigt" — ohne ihn schlüpft eine Änderung an dieser Zeile durch.
    return readable<SpaceKind>('unknown', (set) => {
        let cancelled = false
        // Merker statt eines direkten `set('other')` am Ende der Leiter: meldet der
        // Doc-Store später erneut `undefined`, hält er das Urteil fest, statt zurück
        // auf 'unknown' zu fallen.
        let exhausted = false
        let info: RelayInfoLike | undefined

        const publish = () => {
            if (info) {
                set(isBuzzRelay(info) ? 'buzz' : 'other')
            } else {
                set(exhausted ? 'other' : 'unknown')
            }
        }

        // Ein bereits bekanntes Doc liegt hier synchron an — der erste Abonnent
        // sieht dann gar kein 'unknown'.
        const unsubscribe = deps.relayInfo(url).subscribe((next) => {
            // Nie von „bekannt" zurück auf `undefined` fallen: ein leerer Zwischenwert
            // ist kein Widerruf des Docs.
            info = next ?? info
            publish()
        })

        /**
         * Lädt, bis das Doc da ist oder die Backoff-Leiter verbraucht ist.
         *
         * **Geprüft wird der Rückgabewert, nicht der Wurf — und das ist kein
         * Versehen.** `forceLoadRelay` lehnt nie ab: `fetchRelay` fängt jeden
         * Fehler in einem leeren `catch` (`@welshman/app/dist/app/src/relays.js:41-43`),
         * und `makeForceLoadItem` hängt nur ein `.then(() => getItem(key))` an.
         * Ein Fehlversuch ist deshalb ein **aufgelöstes `undefined`**, keine
         * Ablehnung — ein `try/catch` um den Aufruf feuerte nie und die
         * Wiederholung liefe gar nicht erst an. Das `.catch()` bleibt trotzdem
         * stehen, damit ein eingesetzter Loader (Test) oder ein künftiges
         * welshman, das doch wirft, die Schleife nicht abreißt.
         */
        const loadUntilKnown = async (): Promise<void> => {
            for (let attempt = 0; ; attempt++) {
                if (cancelled || info) {
                    return
                }
                const loaded = await deps.forceLoad(url).catch(() => undefined)
                if (cancelled) {
                    return
                }
                if (loaded) {
                    info = loaded
                    publish()
                    return
                }
                // Ein anderer Abonnent (oder ein anderes Modul) kann das Doc
                // zwischenzeitlich in den welshman-Cache geschrieben haben —
                // publiziert hat es dann bereits die Doc-Subscription oben.
                if (info) {
                    return
                }
                if (attempt >= backoffMs.length) {
                    exhausted = true
                    publish()
                    return
                }
                await deps.delay(backoffMs[attempt])
            }
        }

        void loadUntilKnown()

        return () => {
            cancelled = true
            unsubscribe()
        }
    })
}

const storesByUrl = new Map<string, Readable<SpaceKind>>()

/**
 * Die Relay-Art eines Space, dreiwertig und nachziehend — die einzige Stelle, an
 * der neuer Code `deriveRelay(url)` + `isBuzzRelay` verdrahtet.
 *
 * Pro URL genau **ein** Store: sonst führte jeder Abonnent seine eigene
 * Wiederholungsschleife und ein Bildschirm mit fünf Flächen schickte fünf
 * NIP-11-Fetches. Der Store ist „lazy" — die Schleife läuft nur, solange
 * mindestens ein Abonnent hängt, und startet bei einem späteren Remount neu.
 */
export const deriveSpaceKind = (url: string): Readable<SpaceKind> => {
    let store = storesByUrl.get(url)
    if (!store) {
        store = makeSpaceKindStore(url)
        storesByUrl.set(url, store)
    }
    return store
}
