/**
 * Welche Ereignisarten den Kaltstart überleben müssen.
 *
 * Der Anlass: kind 9008 (gelöschter RAUM) fehlte in PERSIST_KINDS, obwohl kind
 * 9005 (gelöschte NACHRICHT) drinstand und der Kommentar das Argument dafür
 * bereits ausbuchstabierte. Folge im Betrieb: Das 39000 eines gelöschten Raums
 * lag im lokalen Cache, sein Grabstein nicht — beim Kaltstart erschien der Raum
 * in „Meine Räume" und verschwand erst, wenn die 9008 vom Relay nachströmte.
 * Ein sichtbares Aufblitzen bei JEDEM Seitenaufbau.
 *
 * Die Regel dahinter, die dieser Test festhält: Ein Grabstein muss immer
 * mindestens so lange überleben wie das, was er begräbt. Wer künftig eine Art
 * zu PERSIST_KINDS hinzufügt, deren Löschung über eine eigene Art läuft, muss
 * beide aufnehmen.
 *
 * Ausführen: node --test packages/einundzwanzig-group/js/storagePersistKinds.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    COMMENT,
    DELETE,
    MESSAGE,
    PROFILE,
    REACTION,
    ROOM_DELETE,
    ROOM_DELETE_EVENT,
    ROOM_MEMBERS,
    ROOM_META,
    ZAP_RECEIPT,
} from './welshmanKinds.ts'
import {
    eventsToPrune,
    forgetRepos,
    isCappedEvent,
    partitionForCache,
    rememberRepos,
    shouldPersistEvent,
} from './storage.ts'

const ev = (kind: number, tags: string[][] = []) => ({ kind, tags }) as never

/** Minimal-Event fürs Pruning (nur die Felder, die eventsToPrune liest). */
const msg = (id: string, createdAt: number, h: string) =>
    ({ id, kind: MESSAGE, created_at: createdAt, tags: [['h', h]] }) as never

const comment = (id: string, createdAt: number, rootId = 'root') =>
    ({ id, kind: COMMENT, created_at: createdAt, tags: [['E', rootId]] }) as never

const NOW = 1_800_000_000
const DAY = 24 * 60 * 60

test('Grabstein und Begrabenes werden gemeinsam gespeichert', () => {
    // Raum-Metadaten und die Löschung des Raums.
    assert.equal(shouldPersistEvent(ev(ROOM_META)), true, '39000 (Raum-Metadaten)')
    assert.equal(
        shouldPersistEvent(ev(ROOM_DELETE)),
        true,
        '9008 (Raum geloescht) — ohne das blitzt ein geloeschter Raum bei jedem Kaltstart auf',
    )

    // Nachricht und die beiden Wege, sie zu löschen.
    assert.equal(shouldPersistEvent(ev(MESSAGE)), true, 'kind 9 (Nachricht)')
    assert.equal(shouldPersistEvent(ev(DELETE)), true, 'kind 5 (eigene Loeschung)')
    assert.equal(shouldPersistEvent(ev(ROOM_DELETE_EVENT)), true, '9005 (Admin-Loeschung)')
})

test('Mitgliedschaft und Profile bleiben gespeichert', () => {
    // Ohne sie stuende beim Kaltstart jeder Raum unter „Andere Raeume“ und
    // saemtliche Namen waeren npub-Kuerzel, bis der Relay nachgeliefert hat.
    assert.equal(shouldPersistEvent(ev(ROOM_MEMBERS)), true, '39002 (Mitglieder)')
    assert.equal(shouldPersistEvent(ev(PROFILE)), true, 'kind 0 (Profil)')
})

test('Was lazy nachlaedt, wird NICHT gespeichert', () => {
    // Gegenprobe: Der Test darf nicht einfach „alles true“ sagen. Reaktionen und
    // Zap-Quittungen haengen an keinem `#h` und kommen nach dem Paint.
    assert.equal(shouldPersistEvent(ev(REACTION)), false, 'kind 7 (Reaktion)')
    assert.equal(shouldPersistEvent(ev(ZAP_RECEIPT)), false, 'kind 9735 (Zap-Quittung)')
})

test('Thread-Kommentare ueberleben den Kaltstart — Lotus-kind-10 bewusst nicht', () => {
    // Ohne kind 1111 im Cache ist der Ungelesen-Punkt eines Threads beim Kaltstart
    // immer aus: die Ableitung liest dieselbe repository, und die waere leer.
    assert.equal(shouldPersistEvent(ev(COMMENT)), true, 'kind 1111 (Thread-Kommentar)')
    // Bekannte Grenze, absichtlich festgenagelt: Lotus' kind-10 (In-Chat-Thread) lesen
    // wir nur fuer die Interop und schreiben ihn nie — sein Marker kommt erst nach dem
    // Netz-Load. Wer das aendert, aendert es hier bewusst, nicht versehentlich.
    assert.equal(shouldPersistEvent(ev(10)), false, 'kind 10 (Lotus In-Chat-Thread)')
})

test('Was gespeichert wird UND waechst, wird auch gekappt', () => {
    // Die eigentliche Bedingung fuer die Aufnahme von kind 1111: Persistenz OHNE
    // Kappung waere ein unbegrenzt wachsender Store. Der Deckel ist global (nicht pro
    // Thread), weil jede Nachricht eine Thread-Wurzel sein kann — ein Per-Root-Cap
    // haette gar keine Obergrenze.
    const comments = Array.from({ length: 12 }, (_, i) => comment('c' + i, NOW - i))
    const drop = new Set(eventsToPrune(comments, NOW, { commentTotal: 5 }))
    assert.equal(drop.size, 7, 'von 12 Kommentaren bleiben genau 5 (die juengsten)')
    for (const keep of ['c0', 'c1', 'c2', 'c3', 'c4']) {
        assert.equal(drop.has(keep), false, `${keep} ist unter den juengsten 5 und bleibt`)
    }
    assert.equal(drop.has('c11'), true, 'der aelteste Kommentar faellt raus')
})

test('Der Alters-Backstop gilt fuer Kommentare wie fuer Nachrichten', () => {
    const drop = new Set(
        eventsToPrune([comment('alt', NOW - 31 * DAY), comment('neu', NOW - 1 * DAY)], NOW),
    )
    assert.equal(drop.has('alt'), true, 'aelter als 30 Tage → weg')
    assert.equal(drop.has('neu'), false, 'innerhalb des Fensters → bleibt')
})

test('Nachrichten-Kappung bleibt per Raum und faellt nicht in den Kommentar-Topf', () => {
    // Gegenprobe gegen den naheliegenden Fehler beim Erweitern: kind 9 und kind 1111
    // duerfen sich ihre Deckel NICHT teilen, sonst verdraengt eine rege Thread-
    // Diskussion den Verlauf eines stillen Raums.
    const events = [
        msg('a1', NOW - 1, 'raum-a'),
        msg('a2', NOW - 2, 'raum-a'),
        msg('a3', NOW - 3, 'raum-a'),
        msg('b1', NOW - 4, 'raum-b'),
        comment('c1', NOW - 5),
        comment('c2', NOW - 6),
    ]
    const drop = new Set(eventsToPrune(events, NOW, { msgPerRoom: 2, commentTotal: 1 }))
    assert.equal(drop.has('a3'), true, 'Raum A ist bei cap=2 um eine Nachricht zu voll')
    assert.equal(drop.has('b1'), false, 'Raum B hat nur eine Nachricht und bleibt unberuehrt')
    assert.equal(drop.has('c2'), true, 'der aeltere Kommentar faellt am Kommentar-Deckel')
    assert.equal(drop.has('c1'), false, 'der juengere Kommentar bleibt')
})

// ── P7: Artikel-Kommentare teilen sich den Topf mit den Thread-Kommentaren ──
//
// **Was gemessen wurde, und warum es hier steht statt nur im Bericht.**
//
// Seit P6 lädt die Artikelfläche kind 1111 von DREI Relays (Board, nos.lol,
// relay.damus.io) über die Union `#A` + `#a` — und `COMMENT` steht in
// `PERSIST_KINDS`. Jede so geladene 1111 landet also im lokalen Cache, im
// SELBEN globalen Deckel wie die Thread-Kommentare des Chats.
//
// Gemessen am 2026-08-21 über alle 104 Artikel-Adressen (`nak req`, beide
// Tagformen, drei Relays, danach über die Event-Id dedupliziert):
//
// | Größe                                   | Wert |
// |-----------------------------------------|-----:|
// | kind 1111 in der Union                  |   64 |
// | davon jünger als 30 Tage                |  **9** |
// | Median-Alter                            | 57 Tage |
// | Rohgröße gesamt                         | 77 kB |
//
// **Der Alters-Backstop nimmt 55 der 64 sofort wieder heraus** — die Fläche
// lässt den Cache also heute nicht wachsen, sie erzeugt Umschlag. Die 9
// verbleibenden sind 1,8 % von `COMMENT_CAP_TOTAL` (500).
//
// **Was daran trotzdem eine Kopplung ist:** Artikel-Kommentare können
// Thread-Kommentare aus dem Deckel verdrängen, und nur die Thread-Kommentare
// haben im Cache eine Aufgabe (den Ungelesen-Punkt beim Kaltstart, siehe oben).
// Ein Artikel-Kommentar wird ohnehin bei jedem Öffnen der Fläche neu vom Netz
// geholt. Heute ist das folgenlos; es wird es nicht mehr sein, wenn der Bestand
// wächst oder die Filterbreite steigt.
//
// **Entschieden wurde: NICHT trennen.** Ein eigener Topf für Artikel-Kommentare
// hieße, `storage.ts` — die Datei, an der der Ungelesen-Punkt hängt — für einen
// Gewinn von 1,8 % anzufassen. Der Test unten hält stattdessen fest, DASS beide
// sich einen Topf teilen: wer das ändern will, ändert ihn bewusst.
//
// Die Zahlen oben sind Bestandszahlen und stehen deshalb im Kommentar und nicht
// in einer Zusicherung — ein `assert(…64)` prüfte den Relay, nicht unseren Code.
// Zugesichert ist die STRUKTUR.

/** Ein Kommentar an einem ARTIKEL: NIP-22-Wurzel ist eine Adresse, kein `E`. */
const artikelKommentar = (id: string, createdAt: number) =>
    ({
        id,
        kind: COMMENT,
        created_at: createdAt,
        tags: [['A', '30023:aa11:mein-artikel'], ['a', '30023:aa11:mein-artikel']],
    }) as never

test('P7: ein Artikel-Kommentar wird gecacht wie ein Thread-Kommentar', () => {
    // Kein Sonderweg: `shouldPersistEvent` sieht nur das Kind, nicht die Wurzelform.
    assert.equal(shouldPersistEvent(artikelKommentar('a1', NOW)), true)
    assert.equal(isCappedEvent(artikelKommentar('a1', NOW)), true)
})

test('P7: Artikel- und Thread-Kommentare teilen sich EINEN Deckel', () => {
    // Der Beleg für die Kopplung oben: bei `commentTotal: 2` und drei Kommentaren
    // — zwei aus einem Artikel, einer aus einem Thread — fällt der älteste, egal
    // aus welcher Quelle er stammt. Gäbe es zwei Töpfe, bliebe hier alles stehen.
    const drop = new Set(
        eventsToPrune(
            [artikelKommentar('artikel-neu', NOW - 1), artikelKommentar('artikel-alt', NOW - 3), comment('thread', NOW - 2)],
            NOW,
            { commentTotal: 2 },
        ),
    )

    assert.deepEqual([...drop], ['artikel-alt'], 'der aelteste faellt — quellenunabhaengig')
})

test('P7: der 30-Tage-Backstop trifft Artikel-Kommentare mit', () => {
    // Am realen Bestand ist das der Normalfall, nicht der Rand: 55 der 64
    // Artikel-Kommentare sind aelter als 30 Tage (2026-08-21).
    const drop = new Set(
        eventsToPrune([artikelKommentar('alt', NOW - 31 * DAY), artikelKommentar('neu', NOW - 1 * DAY)], NOW),
    )

    assert.equal(drop.has('alt'), true, 'aelter als 30 Tage → weg, wie beim Thread-Kommentar')
    assert.equal(drop.has('neu'), false)
})

// ── P10: Forge, Forum, NIP-38-Status ────────────────────────────────────────
//
// Der Anlass ist derselbe wie oben, nur eine Ebene später: die Kinds aus zwei
// ganzen Plänen (Forge, Forum, Status) standen in KEINER Zeile von
// PERSIST_KINDS — drei Flächen luden bei jedem Reload komplett neu. Was hier
// steht, fällt, sobald eines dieser Kinds wieder aus der Liste verschwindet.

/** 30617-Koordinate mit gültigem 64-Hex-Eigentümer. */
const REPO_A = `30617:${'a'.repeat(64)}:demo`
/** Dieselbe Koordinate als ANKÜNDIGUNG — erst sie macht das Repo „bekannt". */
const repoAnnouncement = () =>
    ({ id: 'repo-a', kind: 30617, pubkey: 'a'.repeat(64), created_at: NOW, tags: [['d', 'demo']] }) as never
/** Ein Repo, das nie jemand angekündigt hat — die Koordinate ist trotzdem wohlgeformt. */
const REPO_ERFUNDEN = `30617:${'b'.repeat(64)}:nichtexistentes-repo-xyz`

/** Die Menge „bekannter" Repos, wie sie `shouldPersistEvent` erwartet. */
const bekannt = new Set([REPO_A])

const forumPost = (id: string, createdAt: number, h: string) =>
    ({ id, kind: 45001, created_at: createdAt, tags: [['h', h]] }) as never

const forumReply = (id: string, createdAt: number, h = 'kanal') =>
    ({ id, kind: 45003, created_at: createdAt, tags: [['h', h], ['e', 'wurzel', '', 'reply']] }) as never

const issue = (id: string, createdAt: number) =>
    ({ id, kind: 1621, created_at: createdAt, tags: [['a', REPO_A]] }) as never

const statusEvent = (id: string, createdAt: number, kind = 1632) =>
    ({ id, kind, created_at: createdAt, tags: [['a', REPO_A], ['e', 'wurzel', '', 'root']] }) as never

const forgeComment = (id: string, createdAt: number) =>
    ({ id, kind: 1, created_at: createdAt, tags: [['a', REPO_A], ['e', 'wurzel', '', 'root']] }) as never

test('die Forge-Kinds ueberleben den Kaltstart', () => {
    // Am Teststack gemessen (2026-08-17): jedes dieser Kinds wird von Buzz
    // gespeichert und ist per `nak req` zurueckzulesen — sie sind also
    // legitime Cache-Kandidaten und keine relay-seitig synthetisierten.
    for (const kind of [30617, 30618, 30621]) {
        assert.equal(shouldPersistEvent(ev(kind)), true, `kind ${kind} (Forge, ersetzbar) muss den Reload ueberleben`)
    }
    // Die BLAETTER haengen an einem Repo — und nur an einem BEKANNTEN (siehe der
    // Angriffstest weiter unten). Mit bekanntem Ziel muessen sie durchkommen.
    for (const kind of [1621, 1618, 1619, 1630, 1631, 1632, 1633]) {
        assert.equal(
            shouldPersistEvent(ev(kind, [['a', REPO_A]]), bekannt),
            true,
            `kind ${kind} (Forge-Blatt) muss den Reload ueberleben`,
        )
    }
})

test('P2: die Lesezeichen-Listen ueberleben den Kaltstart — die Mesh-Telemetrie nicht', () => {
    // 10003 und 30003 sind ersetzbar und damit selbst-begrenzt; ohne sie stuende die
    // Lesezeichen-Flaeche bei jedem Kaltstart leer, bis das Netz antwortet.
    assert.equal(shouldPersistEvent(ev(10003)), true, '10003 (NIP-51-Lesezeichenliste)')
    assert.equal(shouldPersistEvent(ev(30003, [['d', 'lesen']])), true, '30003 (Lesezeichen-Set)')

    // Dieselbe Zahl, zwei Bedeutungen — zweiter Fall nach `39005`: 30003 ist bei Buzz
    // auch der Mesh-Mitgliedsstatus des Desktop-Clients, signiert mit DEMSELBEN
    // Pubkey wie die Lesezeichen. `authors:[self]` trennt ihn also nicht; der Cache
    // zoege sonst jede Mesh-Meldung des Nutzers mit.
    const mesh = ev(30003, [['d', 'buzz-mesh-member-status:owner-7'], ['k', 'buzz-mesh-status']])
    assert.equal(shouldPersistEvent(mesh), false, '30003 als Buzz-Mesh-Status')

    // Beide sind ersetzbar → sie duerfen NICHT in die Kappung (ein gekapptes 10003
    // hiesse, die Lesezeichen des Nutzers aus dem Cache zu werfen, waehrend es sie noch gibt).
    assert.equal(isCappedEvent(ev(10003)), false, '10003 ist ersetzbar und bleibt ungekappt')
    assert.equal(isCappedEvent(ev(30003, [['d', 'lesen']])), false, '30003 ist ersetzbar und bleibt ungekappt')
})

test('Forum-Thema, Forum-Antwort und NIP-38-Status ueberleben den Kaltstart', () => {
    assert.equal(shouldPersistEvent(ev(45001)), true, '45001 (Forum-Thema)')
    assert.equal(shouldPersistEvent(ev(45003)), true, '45003 (Forum-Antwort)')
    assert.equal(shouldPersistEvent(ev(30315)), true, '30315 (NIP-38-Status)')
})

test('kind 1 kommt NUR als Forge-Kommentar in den Cache', () => {
    // Die eigentliche Bedingung fuer die Aufnahme von kind 1: es ist das
    // allgemeinste Kind ueberhaupt. Ohne Strukturpruefung zoege jede Notiz jedes
    // Relays in den Cache — genau der Fehler, den `39005` an anderer Stelle
    // vermeidet, nur aus dem umgekehrten Grund.
    assert.equal(shouldPersistEvent(ev(1, [['a', REPO_A]]), bekannt), true, 'kind 1 mit bekannter 30617-Koordinate')
    assert.equal(shouldPersistEvent(ev(1), bekannt), false, 'nackte Notiz ohne a-Tag')
    assert.equal(
        shouldPersistEvent(ev(1, [['a', `30023:${'a'.repeat(64)}:artikel`]]), bekannt),
        false,
        'a-Tag auf einen Artikel',
    )
    assert.equal(shouldPersistEvent(ev(1, [['a', '30617:kurz:demo']]), bekannt), false, 'a-Tag mit unbrauchbarem Eigentuemer')
    assert.equal(shouldPersistEvent(ev(1, [['e', 'irgendwas']]), bekannt), false, 'Antwort ohne Repo-Bezug')
})

test('Buzz’ Thread-Summary (39005) bleibt drausssen, zooids Pin-Liste nicht', () => {
    // Dieselbe Zahl, zwei Bedeutungen: bei Buzz ist 39005 KIND_THREAD_SUMMARY und
    // wird relay-seitig nie gespeichert („synthesized at query time"). Ein
    // persistierter Stand waere dauerhaft veraltet — schlimmer als keiner.
    const summary = { kind: 39005, pubkey: 'r', content: '{"reply_count":3}', tags: [['e', 'wurzel']] } as never
    const pinList = { kind: 39005, pubkey: 'r', content: '', tags: [['-'], ['d', 'raum'], ['e', 'm1']] } as never
    assert.equal(shouldPersistEvent(summary), false, '39005 als Buzz-Thread-Summary')
    assert.equal(shouldPersistEvent(pinList), true, '39005 als zooid-Pin-Liste')
})

test('ALLES, was gespeichert wird UND waechst, laeuft in die Kappung', () => {
    // Der Wächter gegen den unbegrenzten Store: wer ein append-only-Kind zu
    // PERSIST_KINDS hinzufuegt und die Kappung vergisst, faellt hier.
    const wachsend = [
        ev(9, [['h', 'raum']]),
        ev(1111, [['E', 'wurzel']]),
        ev(45001, [['h', 'kanal']]),
        ev(45003, [['h', 'kanal']]),
        ev(1621, [['a', REPO_A]]),
        ev(1618, [['a', REPO_A]]),
        ev(1619, [['a', REPO_A]]),
        ev(1630, [['a', REPO_A]]),
        ev(1631, [['a', REPO_A]]),
        ev(1632, [['a', REPO_A]]),
        ev(1633, [['a', REPO_A]]),
        ev(1, [['a', REPO_A]]),
    ]
    for (const event of wachsend) {
        assert.equal(isCappedEvent(event), true, `kind ${(event as { kind: number }).kind} muss gekappt werden`)
        assert.equal(
            shouldPersistEvent(event, bekannt),
            true,
            `kind ${(event as { kind: number }).kind} wird gespeichert`,
        )
    }
    // Gegenprobe: Ersetzbares ist selbst-begrenzt und darf NICHT in die Kappung —
    // ein gekapptes 30617 hiesse, ein Repo aus dem Cache zu werfen, das es noch gibt.
    for (const kind of [30617, 30618, 30621, 30315, 0, 39000]) {
        assert.equal(isCappedEvent(ev(kind)), false, `kind ${kind} ist ersetzbar und bleibt ungekappt`)
    }
})

test('Forum: Themen pro Kanal, Antworten global — wie Chat und Thread-Kommentar', () => {
    const themen = [
        ...[1, 2, 3].map((i) => forumPost(`a${i}`, NOW - i, 'kanal-a')),
        ...[1, 2].map((i) => forumPost(`b${i}`, NOW - i, 'kanal-b')),
    ]
    const drop = new Set(eventsToPrune(themen, NOW, { forumPostPerRoom: 2 }))
    assert.equal(drop.has('a3'), true, 'Kanal A ist bei cap=2 um ein Thema zu voll')
    assert.equal(drop.has('b1'), false, 'Kanal B bleibt unberuehrt — der Deckel gilt je Kanal')
    assert.equal(drop.has('b2'), false, 'auch das aeltere Thema in Kanal B bleibt')

    // Antworten teilen sich EINEN globalen Deckel, ueber Kanaele hinweg.
    const antworten = [
        forumReply('r1', NOW - 1, 'kanal-a'),
        forumReply('r2', NOW - 2, 'kanal-b'),
        forumReply('r3', NOW - 3, 'kanal-c'),
    ]
    const dropAntworten = new Set(eventsToPrune(antworten, NOW, { forumCommentTotal: 2 }))
    assert.deepEqual([...dropAntworten], ['r3'], 'global gekappt: die aelteste Antwort faellt, egal in welchem Kanal')
})

test('Forge: Wurzeln und Beiwerk teilen sich KEINEN Deckel', () => {
    // Der teure Fehler waere ein gemeinsamer Topf: ein Automat mit vielen
    // Statuswechseln verdraengte dann die Issues selbst — und ein Issue ohne sein
    // Status-Ereignis zeigt „offen", also eine FALSCHE Aussage statt einer fehlenden.
    const events = [
        issue('i1', NOW - 1),
        issue('i2', NOW - 2),
        statusEvent('s1', NOW - 3),
        statusEvent('s2', NOW - 4),
        forgeComment('c1', NOW - 5),
    ]
    const drop = new Set(eventsToPrune(events, NOW, { forgeRootTotal: 1, forgeMetaTotal: 2 }))
    assert.equal(drop.has('i2'), true, 'die aeltere Wurzel faellt am Wurzel-Deckel')
    assert.equal(drop.has('i1'), false, 'die juengere Wurzel bleibt')
    assert.equal(drop.has('c1'), true, 'das aelteste Beiwerk faellt am Beiwerk-Deckel')
    assert.equal(drop.has('s1'), false, 'die juengeren Statuswechsel bleiben — eigener Topf')
    assert.equal(drop.has('s2'), false, 'auch der zweite Statuswechsel bleibt')
})

test('Forum und Forge haben ein LAENGERES Altersfenster als der Chat', () => {
    // 30 Tage sind das Chat-Mass. Ein seit einem halben Jahr offenes Issue ist
    // dagegen die aktuelle Lage — mit dem Chat-Fenster fiele genau der Bestand aus
    // dem Cache, den die Flaeche zeigen soll.
    const events = [
        msg('chat-alt', NOW - 31 * DAY, 'raum'),
        issue('issue-40d', NOW - 40 * DAY),
        forumPost('thema-40d', NOW - 40 * DAY, 'kanal'),
        issue('issue-200d', NOW - 200 * DAY),
    ]
    const drop = new Set(eventsToPrune(events, NOW))
    assert.equal(drop.has('chat-alt'), true, 'Chat: 31 Tage sind zu alt')
    assert.equal(drop.has('issue-40d'), false, 'Forge: 40 Tage bleiben')
    assert.equal(drop.has('thema-40d'), false, 'Forum: 40 Tage bleiben')
    assert.equal(drop.has('issue-200d'), true, 'Forge: 200 Tage reissen den Backstop')
})

// ── Der Angriff: ein erfundenes Ziel besteht jede Formpruefung ──────────────
//
// Gefunden im P10-Gate. `isForgeComment` prueft nur Syntax, und
// `parseRepoAddress` verlangt bloss 64-Hex-Eigentuemer plus nichtleeres `d` —
// `30617:<b×64>:nichtexistentes-repo-xyz` besteht das, obwohl es dieses Repo nie
// gab. Weil die Persistenz auf dem GETEILTEN repository laeuft und dort keine
// Herkunftspruefung stattfindet (die sitzt erst beim Rendern in
// deriveEventsForUrl), haette damit jedes kind 1 aus jeder Quelle, die der Client
// ohnehin empfaengt, in den Forge-Topf gelangen und echte Statuswechsel aus dem
// Deckel verdraengen koennen.

test('ANGRIFF: ein erfundenes Repo-Ziel kommt NICHT in den Cache', () => {
    const gefaelscht = ev(1, [['a', REPO_ERFUNDEN]])
    assert.equal(
        shouldPersistEvent(gefaelscht, bekannt),
        false,
        'kind 1 mit wohlgeformtem, aber unbekanntem Ziel darf nicht persistiert werden',
    )

    // Dieselbe Beweislast fuer die ganze Klasse, nicht nur fuer den mehrdeutigen
    // kind-1-Fall: die Zeichenkette im `a`-Tag ist ueberall nur eine Behauptung.
    for (const kind of [1621, 1618, 1619, 1630, 1631, 1632, 1633]) {
        assert.equal(
            shouldPersistEvent(ev(kind, [['a', REPO_ERFUNDEN]]), bekannt),
            false,
            `kind ${kind} mit erfundenem Ziel darf nicht persistiert werden`,
        )
    }

    // Gegenprobe, damit der Test nicht einfach „alles false" sagt: dasselbe
    // Ereignis mit BEKANNTEM Ziel geht durch.
    assert.equal(shouldPersistEvent(ev(1, [['a', REPO_A]]), bekannt), true, 'bekanntes Ziel bleibt erlaubt')

    // Und ohne jedes Vorwissen faellt auch das echte Ziel — die Existenzfrage ist
    // wirklich die entscheidende, nicht die Form.
    assert.equal(shouldPersistEvent(ev(1, [['a', REPO_A]]), new Set()), false, 'ohne bekanntes Repo: nichts')
})

test('REIHENFOLGE: das Repo im selben Schwung macht seine Blaetter aufnahmefaehig', () => {
    // Der Riegel darf keinen legitimen Kommentar verschlucken. Beim Kaltstart ist
    // die Reihenfolge in der IndexedDB beliebig, deshalb merkt sich der Cache die
    // Repos des BESTANDS, bevor er filtert — hier nachgestellt.
    forgetRepos()
    const kommentar = ev(1, [['a', REPO_A]])
    assert.equal(shouldPersistEvent(kommentar), false, 'ohne Vorwissen (noch) nicht')

    // Blatt VOR Repo in derselben Liste — genau der Fall, den loadCachedEvents und
    // syncEvents mit ihrem Vorlauf abfangen.
    rememberRepos([kommentar, repoAnnouncement()])
    assert.equal(shouldPersistEvent(kommentar), true, 'nach dem Vormerken des Repos: ja')
    assert.equal(shouldPersistEvent(ev(1621, [['a', REPO_A]])), true, 'gilt fuer jedes Blatt desselben Repos')
    assert.equal(shouldPersistEvent(ev(1, [['a', REPO_ERFUNDEN]])), false, 'das erfundene Ziel bleibt draussen')

    // Abmelden loescht das Wissen — ein neues Konto erbt es nicht.
    forgetRepos()
    assert.equal(shouldPersistEvent(kommentar), false, 'nach forgetRepos ist das Repo wieder unbekannt')
})

test('REIHENFOLGE: partitionForCache entscheidet ueber den SCHWUNG, nicht Ereignis fuer Ereignis', () => {
    // Das ist die Funktion, die beide Schreibwege benutzen (Kaltstart-Load und
    // Live-Persistenz). Steht das Blatt VOR seinem Repo, muss es trotzdem
    // durchkommen — sonst waere der Existenz-Riegel ein neuer Datenverlust.
    forgetRepos()
    const kommentar = ev(1, [['a', REPO_A]])
    const issue = ev(1621, [['a', REPO_A]])
    const fremd = ev(1, [['a', REPO_ERFUNDEN]])
    const { keep, drop } = partitionForCache([kommentar, issue, fremd, repoAnnouncement()])
    assert.equal(keep.includes(kommentar), true, 'Kommentar vor seinem Repo: bleibt')
    assert.equal(keep.includes(issue), true, 'Issue vor seinem Repo: bleibt')
    assert.equal(drop.includes(fremd), true, 'das erfundene Ziel faellt auch im Schwung')
    assert.equal(keep.length, 3, 'Repo + zwei Blaetter')
    forgetRepos()
})
