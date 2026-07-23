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
    MESSAGE,
    COMMENT,
    DELETE,
    ROOM_DELETE,
    ROOM_DELETE_EVENT,
    ROOM_META,
    ROOM_MEMBERS,
    PROFILE,
    REACTION,
    ZAP_RESPONSE,
} from '@welshman/util'
import { messagesToPrune, shouldPersistEvent } from './storage.ts'

const ev = (kind: number) => ({ kind }) as never

/** Minimal-Event fürs Pruning (nur die Felder, die messagesToPrune liest). */
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
    assert.equal(shouldPersistEvent(ev(ZAP_RESPONSE)), false, 'kind 9735 (Zap-Quittung)')
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
    const drop = new Set(messagesToPrune(comments, NOW, 300, 30 * DAY, 5))
    assert.equal(drop.size, 7, 'von 12 Kommentaren bleiben genau 5 (die juengsten)')
    for (const keep of ['c0', 'c1', 'c2', 'c3', 'c4']) {
        assert.equal(drop.has(keep), false, `${keep} ist unter den juengsten 5 und bleibt`)
    }
    assert.equal(drop.has('c11'), true, 'der aelteste Kommentar faellt raus')
})

test('Der Alters-Backstop gilt fuer Kommentare wie fuer Nachrichten', () => {
    const drop = new Set(
        messagesToPrune([comment('alt', NOW - 31 * DAY), comment('neu', NOW - 1 * DAY)], NOW),
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
    const drop = new Set(messagesToPrune(events, NOW, 2, 30 * DAY, 1))
    assert.equal(drop.has('a3'), true, 'Raum A ist bei cap=2 um eine Nachricht zu voll')
    assert.equal(drop.has('b1'), false, 'Raum B hat nur eine Nachricht und bleibt unberuehrt')
    assert.equal(drop.has('c2'), true, 'der aeltere Kommentar faellt am Kommentar-Deckel')
    assert.equal(drop.has('c1'), false, 'der juengere Kommentar bleibt')
})
