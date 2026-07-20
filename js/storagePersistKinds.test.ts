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
import { shouldPersistEvent } from './storage.ts'

const ev = (kind: number) => ({ kind }) as never

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
