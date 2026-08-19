/**
 * Abgleich der Raumliste gegen den Relay-Bestand — die **Abwesenheits**-Ableitung.
 *
 * ── Warum es das braucht ────────────────────────────────────────────────────────
 *
 * `groups.ts roomsByUrl` blendet einen Raum genau dann aus, wenn ein **9008**
 * (ROOM_DELETE) mit passendem `h` vorliegt. Das ist die zooid-Semantik, und auf
 * zooid stimmt sie: `zooid/groups.go:108-129 DeleteGroup` löscht beim 9008 alles
 * mit diesem `h` — **außer dem 9008 selbst** (`if event.Kind !=
 * nostr.KindSimpleGroupDeleteGroup`), und `groups.go:294-304 CanRead` gibt für
 * einen Grabstein ohne Metadaten ausdrücklich `true` zurück. Der Grabstein bleibt
 * dort also dauerhaft lesbar und erreicht jeden späteren REQ.
 * (Zeilen gegen zooid `d985857`, Buzz `69107dc3` — Funktionsnamen wandern nicht,
 * Zeilennummern schon.)
 *
 * **Buzz macht das Gegenteil**, und zwar in derselben Transaktion:
 *
 *  1. `buzz-relay/src/handlers/side_effects.rs:1894` `soft_delete_channel` setzt
 *     `channels.deleted_at`.
 *  2. `…:1905` `soft_delete_discovery_events` → `buzz-db/src/lib.rs:4802-4818`
 *     setzt `deleted_at` auf **39000/39001/39002** dieses Kanals. Die 39000 ist weg.
 *  3. Das 9008 selbst wurde vorher regulär gespeichert (`ingest.rs:2936-2947`,
 *     Side-Effects laufen erst danach) — es ist aber **kanal-gescopt**
 *     (`ingest.rs:2241` `requires_h_channel_scope` erzwingt das `h`-Tag → `channel_id`
 *     ist gesetzt). Und `buzz-db/src/channel.rs:754-775 get_accessible_channel_ids`
 *     führt nur Kanäle mit `c.deleted_at IS NULL`. `handlers/req.rs:94` scopet jeden
 *     REQ auf genau diese Liste (`event.rs:408-427`, `channel_id IN (…)`).
 *
 * Am laufenden buzz-test-Stack nachgemessen (2026-08-19, :3004, Wegwerf-Kanal per
 * 9007 angelegt und per 9008 gelöscht):
 *
 * | Abfrage nach der Löschung           | Antwort |
 * |-------------------------------------|---------|
 * | `{kinds:[39000]}` (breit)           | 5 Zeilen (vorher 6) — der Kanal fehlt |
 * | `{kinds:[9008]}`                    | **0 Zeilen** — kein Grabstein |
 * | `{kinds:[39000],"#d":[h]}` gelöscht | **0 Zeilen**, EOSE, kein CLOSED |
 * | `{kinds:[39000],"#d":[h]}` lebend   | **1 Zeile** |
 *
 * Ein Relay, der ein Ereignis löscht, sendet keine Negativ-Meldung; der Client
 * erfährt es nie. Da ROOM_META in `storage.ts PERSIST_KINDS` steht, liegt die 39000
 * dauerhaft in der IndexedDB und der Raum überlebt jeden Reload.
 *
 * ── Zwei Stufen statt einer Vermutung ───────────────────────────────────────────
 *
 * Der Abgleich läuft deshalb in zwei Stufen, und die Trennung ist der Kern:
 *
 *  1. **Breite Abfrage** `{kinds:[39000]}` — sie *schlägt Kandidaten vor* und liefert
 *     die **Positivkontrolle**: mindestens ein sichtbarer Raum beweist, dass Socket,
 *     AUTH und Leserecht in diesem Moment funktionieren.
 *  2. **Einzelprobe** `{kinds:[39000],"#d":[h]}` je Kandidat — sie *entscheidet*.
 *
 * Warum nicht die breite Abfrage allein entscheiden darf: sie kann gekappt sein, und
 * das ist vom Client aus **nicht zuverlässig erkennbar**. Eine frühere Fassung schloss
 * aus „weniger Ereignisse als angefragt ⇒ nichts zurückgehalten" — am Quellcode
 * widerlegt: Buzz filtert nach dem SQL-Zugriff nach und darf dabei beliebig viele
 * Kandidaten verwerfen (`buzz-relay/src/handlers/req.rs:434-439`: „a result smaller
 * than the requested limit remains possible and is not a NIP-11 violation"). Eine
 * kurze Antwort beweist also nicht, dass die Seite vollständig war.
 *
 * Die Einzelprobe hat dieses Problem strukturell nicht: sie fragt **eine** Adresse ab
 * (39000 ist parameterisiert-ersetzbar, `d` = `h`; auf beiden Relays indiziert
 * auflösbar) — eine Antwort der Kardinalität 1 kann nicht gekappt sein.
 *
 * **Dasselbe Signal, zwei Bedeutungen.** `nothing-visible` (EOSE, kein CLOSED, null
 * Räume) ist bei der breiten Abfrage **unbrauchbar** — „hier gibt es keine Räume mehr"
 * und „ich darf hier gerade nichts sehen" sind nicht zu trennen. Bei der Einzelprobe
 * ist genau dasselbe Signal der **Beweis**, weil die breite Abfrage im selben Lauf
 * schon gezeigt hat, dass Lesen gerade geht. Deshalb liest {@link confirmsRoomGone}
 * dieselbe Klassifikation, und deshalb steht das hier und nicht im Aufrufer.
 *
 * ── Warum Abwesenheit trotzdem ein Gate braucht ─────────────────────────────────
 *
 * Alle bekannten Wege, auf denen ein Relay schweigt, ohne dass etwas gelöscht wurde,
 * enden in einem Verdikt ungleich `complete` — und dann wird **nichts** gelöscht:
 *
 *  - **Hängende NIP-42-AUTH:** welshmans Auth-Puffer verschluckt EOSE *und* CLOSED
 *    (`welshmanAuthSwallow.test.ts`). Ohne EOSE gibt es kein `complete`.
 *  - **CLOSED:** `restricted: …` / `auth-required: …` — der Relay hat die Frage
 *    abgelehnt, nicht beantwortet.
 *  - **Abriss/Timeout:** kein EOSE, zusätzlich `sawDisconnect`.
 *  - **Null sichtbare Räume:** keine Positivkontrolle (siehe oben).
 *
 * Dazu ein Deckel auf die **Größe der behaupteten Änderung**: siehe
 * {@link MAX_RECONCILE_CANDIDATES}.
 *
 * ── Der Kompromiss, den dieser Mechanismus NICHT auflösen kann ──────────────────
 *
 * „Gelöscht" und „für mich nicht mehr sichtbar" sehen auf Buzz identisch aus: beide
 * fallen aus `get_accessible_channel_ids` heraus (Löschung über `c.deleted_at`,
 * Rauswurf/`offen→privat` über die fehlende `channel_members`-Zeile). Weder die breite
 * Abfrage noch die Einzelprobe kann die Fälle trennen, weil in beiden **gar nichts**
 * kommt.
 *
 * Die Wahl fällt bewusst auf „beide entfernen die Kachel", denn die Folge ist in
 * beiden Fällen dieselbe: der Raum ist weder lesbar noch betretbar. Eine Kachel, die
 * beim Klick in ein `restricted: not a channel member` läuft, ist schlechter als
 * keine Kachel. Der Preis ist eine Kachel, die nach einem Rauswurf verschwindet statt
 * ein Gate zu zeigen — und ein Wiederbeitritt bringt sie mit dem nächsten REQ zurück.
 *
 * Reines Modul: **keine Imports**, damit es unter `node --test` ohne welshman läuft
 * (`@welshman/app` fasst beim Modul-Load `localStorage` an) — dieselbe Bauform wie
 * `roomGate.ts` und `roomMembership.ts`.
 */

/**
 * `limit` der breiten Abfrage.
 *
 * Es ist eine **Notbremse gegen einen endlos streamenden Relay, kein Messwert**.
 * Aus der Zahl der zurückgekommenen Ereignisse wird ausdrücklich NICHTS mehr
 * geschlossen (Begründung im Modulkopf, `req.rs:434-439`) — die Entscheidung trägt
 * die Einzelprobe.
 */
export const ROOM_RECONCILE_LIMIT = 500

/**
 * So viele verschwundene Räume glaubt ein Lauf höchstens.
 *
 * Zwei Aufgaben in einer Zahl. Erstens **Arbeitsdeckel**: jeder Kandidat kostet eine
 * eigene Einzelprobe. Zweitens **Plausibilität**: eine echte Löschung passiert
 * einzeln; behauptet eine Antwort, dass zwei Dutzend Räume auf einmal weg sind, hat
 * sie eher die Form einer gekappten oder degradierten Seite als die einer Löschung.
 *
 * Das ist der Deckel, der die frühere Kappungs-Heuristik ersetzt — und er ist der
 * bessere, weil er an der **behaupteten Änderung** hängt statt an einer Vermutung
 * über die Seitengröße des Relays. Wird er überschritten, passiert im Lauf gar
 * nichts: nicht löschen, nicht sperren, beim nächsten Einhängen neu versuchen.
 *
 * 25 liegt zugleich unter jedem Subscription-Deckel, der hier auftreten kann (Buzz:
 * 1024, `req.rs:25`; zooid: keiner). Selbst wenn ein Relay die Probenserie
 * abschnitte, wäre die Folge ein CLOSED je Probe — also Nicht-Bestätigung und damit
 * die harmlose Richtung.
 */
export const MAX_RECONCILE_CANDIDATES = 25

/** Was ein REQ vom Relay gesehen hat — breite Abfrage wie Einzelprobe. */
export type RoomAnswerSignals = {
    /** EOSE für alle Filter des REQ eingetroffen. */
    sawEose: boolean
    /** Irgendein CLOSED für diesen REQ. */
    sawClosed: boolean
    /** Socket verließ Open/Opening, bevor der REQ fertig war. */
    sawDisconnect: boolean
    /** Zahl der empfangenen 39000. */
    roomCount: number
}

/**
 * `complete` = der Relay hat vollständig geantwortet UND mindestens einen Raum
 * gezeigt. `nothing-visible` = ordentlich geantwortet, aber ohne Raum — bei der
 * breiten Abfrage unbrauchbar, bei der Einzelprobe der Beweis (siehe Modulkopf).
 */
export type RoomAnswerVerdict = 'complete' | 'closed' | 'disconnected' | 'no-eose' | 'nothing-visible'

/** Ein lokal bekanntes 39000 — Id, sein `h` (das `d`-Tag) und seine Herkunfts-Relays. */
export type KnownRoomEvent = {
    id: string
    h: string
    /** Alle Relays, von denen dieses Ereignis kam (welshman-`tracker`). */
    relays: readonly string[]
}

/**
 * Verdikt über eine Relay-Antwort.
 *
 * Reihenfolge = Aussagekraft des Grundes, nicht Schwere: ein CLOSED ist die
 * präziseste Auskunft („abgelehnt"), ein fehlendes EOSE die unpräziseste
 * („nie beantwortet").
 */
export const classifyRoomAnswer = (signals: RoomAnswerSignals): RoomAnswerVerdict => {
    if (signals.sawClosed) {
        return 'closed'
    }
    if (signals.sawDisconnect) {
        return 'disconnected'
    }
    if (!signals.sawEose) {
        return 'no-eose'
    }
    if (signals.roomCount === 0) {
        return 'nothing-visible'
    }
    return 'complete'
}

/**
 * Kandidaten für eine Löschung: lokal bekannt, in der breiten Antwort nicht enthalten.
 *
 * Zwei Riegel, beide fail-closed:
 *
 *  1. Nur bei `complete`. Ohne Positivkontrolle beweist die Abwesenheit nichts.
 *  2. Nur Ereignisse, deren Herkunft **ausschließlich** dieser Space ist. Der
 *     `repository` ist über alle Spaces geteilt und `removeEvent` wirkt global; ein
 *     Ereignis, das auch von einem anderen Relay kam, wäre dort nach dem Löschen
 *     ebenfalls weg. Die Herkunft ist dabei kein Formalismus, sondern die einzige
 *     Zugehörigkeitsprüfung, die es gibt — ein 39000 trägt kein Tag, das seinen
 *     Space nennt (`groups.ts`-Modulkopf).
 *
 * Ein Kandidat ist ein **Verdachtsfall, keine Entscheidung** — gelöscht wird erst
 * nach {@link confirmsRoomGone}.
 */
export const selectReconcileCandidates = (
    url: string,
    known: readonly KnownRoomEvent[],
    presentHs: ReadonlySet<string>,
    verdict: RoomAnswerVerdict,
): KnownRoomEvent[] => {
    if (verdict !== 'complete') {
        return []
    }
    const candidates: KnownRoomEvent[] = []
    for (const room of known) {
        if (!room.h || presentHs.has(room.h)) {
            continue
        }
        if (room.relays.length !== 1 || room.relays[0] !== url) {
            continue
        }
        candidates.push(room)
    }
    return candidates
}

/** Ist die behauptete Änderung klein genug, um sie zu glauben? Siehe {@link MAX_RECONCILE_CANDIDATES}. */
export const candidatesAreCredible = (candidates: readonly KnownRoomEvent[]): boolean =>
    candidates.length <= MAX_RECONCILE_CANDIDATES

/**
 * Beweist die Einzelprobe, dass dieser Raum weg ist?
 *
 * `nothing-visible` heißt: der Relay hat ordentlich geantwortet (EOSE, kein CLOSED,
 * kein Abriss) und dieses eine 39000 nicht geliefert. Bei einer Abfrage der
 * Kardinalität 1 gibt es dafür genau zwei Erklärungen — gelöscht oder für mich nicht
 * mehr sichtbar — und beide führen zur selben Handlung (siehe Modulkopf).
 *
 * Jeder andere Ausgang ist kein Beweis: `closed`/`disconnected`/`no-eose` sind
 * Nicht-Antworten, `complete` heißt, der Raum steht noch da.
 */
export const confirmsRoomGone = (probe: RoomAnswerSignals): boolean =>
    classifyRoomAnswer(probe) === 'nothing-visible'

/** Alles, was über den Ausgang eines Abgleich-Laufs entscheidet. */
export type ReconcileRun = {
    /** Verdikt der breiten Abfrage. */
    verdict: RoomAnswerVerdict
    /** War der IndexedDB-Cache beim Schnappschuss in das repository gespiegelt? */
    cacheHydrated: boolean
    /** Wie viele lokal bekannte 39000 der Lauf überhaupt beurteilt hat. */
    knownCount: number
    /** Lag die Zahl der Kandidaten unter dem Deckel? */
    candidatesCredible: boolean
}

/**
 * Darf dieser Lauf die Wiederholungssperre setzen?
 *
 * **Der Grund, warum das nicht am Verdikt allein hängen darf** (gemessen am
 * buzz-test-Stack, 2026-08-19): `classifyRoomAnswer` beurteilt die **Relay-Seite**.
 * Über die **lokale** Seite des Vergleichs sagt es nichts — und genau dort saß der
 * Defekt. Nach einem Reload zog der Lauf seinen Schnappschuss, bevor
 * `storage.ts storageReady` den IndexedDB-Cache in das repository gespiegelt hatte.
 * Der Geisterraum existierte nur im Cache, stand also nicht im Schnappschuss und
 * konnte nicht in die Kandidatenliste geraten. Das Verdikt war trotzdem `complete`
 * (EOSE kam; das `auth-required`-CLOSED nimmt `socketPolicyAuthBuffer` aus der
 * Queue) — der leerhändige Lauf galt als Erfolg und sperrte den nächsten für 60 s.
 * Gemessen: Kachel=1/Cache=vorhanden über 30 s nach dem Reload; erst nach Ablauf der
 * Sperre und einem Einhängen ohne Reload Kachel=0/Cache=leer.
 *
 * **Die Antwort auf „kann `verdict === 'complete'` diese Lage von einem echten
 * Erfolg unterscheiden?" ist also: nein, strukturell nicht.** Ein Erfolg braucht
 * beide Seiten: eine brauchbare Relay-Antwort UND einen Bestand, der beurteilt
 * werden konnte. `knownCount > 0` ist dabei die direkte Beobachtung des Defekts —
 * ein Lauf, der nichts verglichen hat, hat nichts zu merken.
 */
export const shouldArmReconcileLock = (run: ReconcileRun): boolean =>
    run.verdict === 'complete' && run.cacheHydrated && run.knownCount > 0 && run.candidatesCredible
