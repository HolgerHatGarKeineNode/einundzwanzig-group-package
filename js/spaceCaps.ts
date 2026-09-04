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
 * behobene Fälle derselben Ursache stehen in `bridge.ts` → `nostrSpaces._unsubIsBuzz`
 * (heute `app.use(Relays).one(url).subscribe`, bis 0.9.5 `deriveRelay(url).subscribe` —
 * die freie Funktion gibt es nicht mehr) („ein synchroner
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
 * **Die Zitate hier sind auf 0.9.5 nachgezogen (P4), die Prämisse selbst hat den
 * Sprung überlebt — nachgemessen am installierten Paket, nicht übernommen.** Die alten
 * Pfade (`app/src/relays.js:46`, `store/src/repository.js:294-298`, `relays.js:33-38`,
 * `repository.js:272-274`) gibt es nicht mehr; die Namen `loadRelay`/`forceLoadRelay`/
 * `fetchRelay` ebenso wenig — aus den freien Funktionen sind Methoden des
 * `Relays`-Plugins geworden (`app.use(Relays).one/forceLoad`, so ruft es `defaultDeps`
 * weiter unten auch).
 *
 * `app.use(Relays).one(url)` stößt beim Ableiten nur `load` an, und das ist ein
 * `makeLoadItem`-Wrapper (`@welshman/app/dist/app/src/plugins/base.js:116`): er merkt
 * sich Quelle + Zeitstempel und drosselt Wiederholungen exponentiell — `if
 * (gt(sourceFetched.get(source), now() - Math.pow(2, attempt))) return stale`
 * (`@welshman/app/dist/store/src/repository.js:479-481`), und `attempts` wird nur bei
 * ERFOLG zurückgesetzt (`:494-496`). Ein Fehlversuch verlängert die Sperre also, statt
 * sie zu lösen.
 *
 * `Relays.fetch` schreibt zudem **nur bei Erfolg** in die Sammlung
 * (`plugins/relays.js:35-39`, `this.set(url, relay)` im `if (json)`-Zweig) und **fängt
 * jeden Fehler selbst ab** — der `catch`-Block ist leer, mit dem Kommentar `// pass`
 * (`plugins/relays.js:41-43`). Kein Wurf, kein Eintrag, kein Signal.
 *
 * **Daraus folgt, dass die Wiederholungsschleife weiter nötig ist**, und das ist der
 * Grund, warum dieser Absatz so ausführlich ist: Ein früher Fehlversuch nagelt die
 * Weiche sonst dauerhaft auf `'unknown'` — die Fläche dreht ewig ein Skeleton, ohne dass
 * irgendwo ein Fehler auftaucht. Deshalb beim ersten Abonnenten
 * `app.use(Relays).forceLoad(url)`: `makeForceLoadItem` ruft `loadItem` direkt und kennt
 * weder Drosselung noch Merker (`@welshman/app/dist/store/src/repository.js:449-454`,
 * vier Zeilen ohne jede Bedingung) — und, solange `'unknown'`, drei Wiederholungen mit
 * Backoff 1 s / 4 s / 15 s. Danach `'other'`: ein Aufrufer kann einen sichtbaren Hinweis
 * zeigen statt ewig ein Skeleton zu drehen.
 *
 * Wer diese Schleife für Altlast hält und sie entfernen will, muss vorher zeigen, dass
 * `Relays.fetch` einen Fehlschlag inzwischen meldet. Solange dort `// pass` steht, tut
 * es das nicht.
 *
 * **Der Paketname im Pfad ist nicht willkürlich:** dieselbe Datei liegt auch unter
 * `@welshman/store/dist/store/src/repository.js` — welshman bündelt seine Store-Schicht
 * in mehrere Pakete ein. Zitiert ist die Kopie, die `@welshman/app` tatsächlich lädt.
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
import { app, Relays } from './welshmanApp.ts'
import { normalisiereWorkspaceUrl } from './relayConfig.ts'
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
 * `groups.ts` bootet beim Import den halben App-Graphen; ein `spaceCaps.ts`, das
 * von dort importierte, zöge das in jeden seiner Tests. `groups.ts` re-exportiert
 * beide Namen unverändert weiter — kein Aufrufer ändert sich.
 * (Die frühere, härtere Begründung — `groups.ts` sei wegen endungsloser Importe und
 * eines localStorage-Zugriffs beim Laden aus `node --test` gar nicht ladbar — gilt
 * seit P1/P2 des Plans `js-insel-testbar-machen` nicht mehr.)
 */
/**
 * **Nachsichtig, seit dem 0.9.5-Sprung:** die Normalisierung liegt in
 * `js/relayConfig.ts` ({@link normalisiereWorkspaceUrl}) und wirft nicht mehr.
 *
 * Der Grund gehört hierher, weil diese Zeile die zweite Hälfte des Problems war:
 * `relayConfig.ts` und diese Datei leiteten BEIDE aus `window.__nostrWorkspace` ab, jede
 * mit eigenem `normalizeRelayUrl`-Aufruf auf Modul-Toplevel. Nur eine davon nachsichtig zu
 * machen hätte nichts geheilt — mit `__nostrWorkspace = 'wss:// kaputt/'` gemessen, warf
 * auch dieses Modul „Invalid URL" und nahm die Insel über `welshmanApp.ts` mit. Eine
 * gemeinsame Funktion ist deshalb kein Aufräumen, sondern die Bedingung dafür, dass der
 * Riegel überhaupt wirkt: zwei Ableitungen desselben Rohwerts können sonst auseinander
 * laufen, und dann greift der kind-0-Riegel in `js/welshmanInstance.ts` gegen einen
 * anderen Relay als den, gegen den die Fläche spricht.
 */
export const workspaceUrlFrom = (override?: string): string => normalisiereWorkspaceUrl(override)

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
 * Das NIP-11-Doc, soweit dieser Client hineinsieht — die Felder, die `relayCaps.ts`
 * strukturell prüft. Bewusst KEIN welshman-`RelayInfo`: dessen Typ führt 15
 * Standardfelder, und `supported_extensions`/`limitation.max_not_before_delta` sind
 * keins davon (siehe {@link deriveSpaceProfile}).
 */
export type SpaceProfile = RelayInfoLike & {
    supported_extensions?: string[]
    limitation?: { max_not_before_delta?: number }
}

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
    relayInfo: (url) => app.use(Relays).one(url),
    forceLoad: async (url) => (await app.use(Relays).forceLoad(url)) ?? undefined,
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
         * Versehen.** `Relays.forceLoad` lehnt nie ab: `Relays.fetch` fängt jeden
         * Fehler in einem leeren `catch` mit dem Kommentar `// pass`
         * (`@welshman/app/dist/app/src/plugins/relays.js:41-43`), und
         * `makeForceLoadItem` ist nichts weiter als `await loadItem(key, …); return
         * getItem(key)` (`dist/store/src/repository.js:449-454`). Ein Fehlversuch ist
         * deshalb ein **aufgelöstes `undefined`**, keine Ablehnung — ein `try/catch` um
         * den Aufruf feuerte nie und die Wiederholung liefe gar nicht erst an. Das
         * `.catch()` bleibt trotzdem stehen, damit ein eingesetzter Loader (Test) oder
         * ein künftiges welshman, das doch wirft, die Schleife nicht abreißt.
         *
         * Auf 0.9.5 nachgemessen (P4): unverändert gültig. Der alte Pfad
         * `app/src/relays.js` und die Namen `forceLoadRelay`/`fetchRelay` sind weg, das
         * Verhalten ist dasselbe.
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
 * der neuer Code das NIP-11-Doc (`app.use(Relays).one(url)`, bis 0.9.5 `deriveRelay(url)`)
 * mit `isBuzzRelay` verdrahtet.
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

/**
 * Das **ganze** NIP-11-Doc eines Space, reaktiv — für die Fälle, in denen die
 * dreiwertige Relay-Art nicht reicht.
 *
 * ── Warum das eine eigene Ableitung ist und kein zweites Feld an `deriveSpaceKind` ──
 *
 * `deriveSpaceKind` liefert bewusst `'unknown' | 'buzz' | 'other'` und sonst nichts;
 * 26 Aufrufstellen entscheiden daran eine Ja/Nein-Frage. Sie um das Doc zu erweitern
 * hieße, ihren Typ für einen einzigen Verbraucher zu verbreitern.
 *
 * ── Und warum sie trotzdem auf `deriveSpaceKind` sitzt ─────────────────────────────
 *
 * Weil das Doc **nicht von selbst kommt**: `app.use(Relays).one(url)` stößt beim
 * Ableiten nur ein `load` an, das am eigenen Merker abprallt, sobald einmal ein
 * Versuch lief (Herleitung im Kopf dieser Datei). Die Wiederhol-Schleife mit
 * `forceLoad` steckt in {@link makeSpaceKindStore}, und sie läuft nur, solange
 * jemand abonniert hat. Ein Abo darauf ist deshalb kein Beiwerk, sondern der
 * Antrieb — ohne es bliebe diese Ableitung auf einem stillen Relay ewig
 * `undefined`, und die Fläche darüber wäre dauerhaft aus, ohne Fehler.
 *
 * Der Wert ist **roh**, wie welshman ihn aus dem NIP-11-JSON übernimmt
 * (`Object.assign(this, json, …)`) — also inklusive der Felder, die welshmans
 * `RelayInfo`-Typ nicht kennt (`supported_extensions`, `limitation.max_not_before_delta`).
 * Wer sie liest, prüft ihre Form selbst; `relayCaps.ts` tut genau das.
 */
export const deriveSpaceProfile = (url: string): Readable<SpaceProfile | undefined> =>
    readable<SpaceProfile | undefined>(undefined, (set) => {
        if (!url) {
            return () => {}
        }
        // Hält die Ladeschleife am Leben; ihr Wert interessiert hier nicht.
        const stopLoad = deriveSpaceKind(url).subscribe(() => {})
        const stopDoc = app.use(Relays).one(url).subscribe((info: unknown) => {
            // Nie von „bekannt" zurück auf `undefined` fallen — dieselbe Regel wie im
            // Kind-Store: ein leerer Zwischenwert ist kein Widerruf des Docs.
            if (info) {
                set(info as SpaceProfile)
            }
        })

        return () => {
            stopDoc()
            stopLoad()
        }
    })
