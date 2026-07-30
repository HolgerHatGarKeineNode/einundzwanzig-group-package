/**
 * Pure-Tests fuer die Publish-Auswertung (welshman-frei).
 *   node --test packages/einundzwanzig-group/js/publishResult.test.ts
 *
 * Der Kern: `timeout` und `aborted` sind FEHLER. welshmans `waitForThunkError` meldet
 * fuer beide `''` (Erfolg), weil `thunkIsComplete` nur `sending`/`pending` als „laeuft
 * noch" kennt. Genau das liess in `buzz-moderation:95` ein nie gesendetes 9005 als
 * zugestellt durchgehen — der Client machte mit dem 9044 weiter und schloss die
 * Meldung, waehrend der Inhalt am Relay liegen blieb.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publishError } from './publishResult.ts'

test('alle Relays melden success → leerer String (Erfolg)', () => {
    assert.equal(publishError({ 'wss://a': { status: 'success' }, 'wss://b': { status: 'success' } }), '')
})

test('noch nichts entschieden → undefined, nicht Erfolg', () => {
    assert.equal(publishError({}), undefined)
    assert.equal(publishError(undefined), undefined)
    assert.equal(publishError({ 'wss://a': { status: 'sending', detail: 'sending...' } }), undefined)
    assert.equal(publishError({ 'wss://a': { status: 'pending' } }), undefined)
})

test('ein Relay laeuft noch → das Ergebnis der anderen zaehlt noch nicht', () => {
    assert.equal(publishError({ 'wss://a': { status: 'success' }, 'wss://b': { status: 'pending' } }), undefined)
})

test('failure liefert die Begruendung des Relays', () => {
    assert.equal(publishError({ 'wss://a': { status: 'failure', detail: 'invalid: bad tag' } }), 'invalid: bad tag')
})

test('TIMEOUT ist ein Fehler — welshman meldet hier faelschlich Erfolg', () => {
    assert.equal(publishError({ 'wss://a': { status: 'timeout', detail: 'timed out' } }), 'timed out')
})

test('ABORTED ist ein Fehler — dieselbe Luecke', () => {
    assert.equal(publishError({ 'wss://a': { status: 'aborted', detail: 'aborted' } }), 'aborted')
})

test('ohne detail faellt die Begruendung auf den Status zurueck (nie leer)', () => {
    assert.equal(publishError({ 'wss://a': { status: 'timeout' } }), 'timeout')
})

test('unbekannter Status gilt als Fehler, nicht als Erfolg', () => {
    // Die Auswertung ist bewusst „alles ausser success ist ein Fehler" — ein kuenftiger
    // welshman-Status darf nicht still als zugestellt durchgehen.
    assert.equal(publishError({ 'wss://a': { status: 'irgendwas-neues' } }), 'irgendwas-neues')
    assert.equal(publishError({ 'wss://a': {} }), 'Publish fehlgeschlagen')
})

test('ein schlechtes Relay unter mehreren gewinnt', () => {
    assert.equal(
        publishError({ 'wss://a': { status: 'success' }, 'wss://b': { status: 'timeout', detail: 'timed out' } }),
        'timed out',
    )
})
