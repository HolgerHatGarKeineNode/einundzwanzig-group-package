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

/**
 * Thread-Antwort in Buzz-Form: kind 9 mit `h` (des Raums der Wurzel) und `reply`-Marker.
 * Genau deshalb braucht sie hier keinen eigenen Deckel mehr — sie faellt unter den
 * Raum-Cap wie jede andere Nachricht desselben Raums.
 */
const comment = (id: string, createdAt: number, h = 'raum-a', rootId = 'root') =>
    ({ id, kind: MESSAGE, created_at: createdAt, tags: [['h', h], ['e', rootId, '', 'reply']] }) as never

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

test('Thread-Antworten ueberleben den Kaltstart — ohne eigenen Eintrag, weil sie kind 9 sind', () => {
    // Ohne Antworten im Cache ist der Ungelesen-Punkt eines Threads beim Kaltstart immer
    // aus: die Ableitung liest dieselbe repository, und die waere leer. Seit P4 braucht es
    // dafuer KEIN zweites Kind mehr — eine Antwort IST eine kind-9-Nachricht (Buzz-Form).
    assert.equal(shouldPersistEvent(comment('k1', NOW)), true, 'Antwort (kind 9 + reply-Marker)')
    // Gegenprobe, absichtlich festgenagelt: die abgeloesten Thread-Kinds sind RAUS. Wer
    // eines davon zurueckholt, tut es hier bewusst — beide sind bei Buzz nicht annehmbar
    // (`restricted: unknown event kind`, gemessen 2026-07-28).
    assert.equal(shouldPersistEvent(ev(1111)), false, 'kind 1111 (NIP-22) ist abgeloest')
    assert.equal(shouldPersistEvent(ev(10)), false, 'kind 10 (fremdes In-Chat-Thread-Kind) ist abgeloest')
})

test('Antworten wachsen NICHT unbegrenzt — sie fallen unter den Raum-Deckel', () => {
    // Persistenz ohne Kappung waere ein unbegrenzt wachsender Store. Frueher brauchte es
    // dafuer einen zweiten, globalen Deckel fuer kind 1111; jetzt genuegt der Raum-Cap,
    // weil eine Antwort dasselbe `h` traegt wie ihre Wurzel.
    const replies = Array.from({ length: 12 }, (_, i) => comment('c' + i, NOW - i))
    const drop = new Set(messagesToPrune(replies, NOW, 5))
    assert.equal(drop.size, 7, 'von 12 Antworten eines Raums bleiben genau 5 (die juengsten)')
    for (const keep of ['c0', 'c1', 'c2', 'c3', 'c4']) {
        assert.equal(drop.has(keep), false, `${keep} ist unter den juengsten 5 und bleibt`)
    }
    assert.equal(drop.has('c11'), true, 'die aelteste Antwort faellt raus')
})

test('Der Alters-Backstop gilt fuer Antworten wie fuer Nachrichten', () => {
    const drop = new Set(
        messagesToPrune([comment('alt', NOW - 31 * DAY), comment('neu', NOW - 1 * DAY)], NOW),
    )
    assert.equal(drop.has('alt'), true, 'aelter als 30 Tage → weg')
    assert.equal(drop.has('neu'), false, 'innerhalb des Fensters → bleibt')
})

test('Die Kappung bleibt PER RAUM — ein reger Thread verdraengt keinen stillen Raum', () => {
    // Der Deckel gilt pro `h`. Antworten eines Raums konkurrieren mit dessen Nachrichten
    // (richtig so, sie liegen im selben Raum) — aber NIE mit denen eines anderen Raums.
    const events = [
        msg('a1', NOW - 1, 'raum-a'),
        msg('a2', NOW - 2, 'raum-a'),
        comment('c1', NOW - 3, 'raum-a'),
        msg('b1', NOW - 4, 'raum-b'),
        comment('c2', NOW - 5, 'raum-b'),
    ]
    const drop = new Set(messagesToPrune(events, NOW, 2))
    assert.equal(drop.has('c1'), true, 'Raum A ist bei cap=2 um einen Eintrag zu voll — der aelteste faellt')
    assert.equal(drop.has('a1'), false)
    assert.equal(drop.has('a2'), false)
    assert.equal(drop.has('b1'), false, 'Raum B liegt unter dem Deckel und bleibt vollstaendig')
    assert.equal(drop.has('c2'), false, 'die Antwort in Raum B ebenso — Raeume teilen sich keinen Topf')
})
