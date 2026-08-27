/**
 * **Der Riegel über die VERDRAHTUNG des Ausgangs — nicht über sein Verhalten.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/forumWriteVerdrahtung.test.ts
 *
 * ── Warum dieser Riegel existiert ──────────────────────────────────────────
 *
 * Buzz beantwortet ein ratenbegrenztes `EVENT` mit einer nackten `NOTICE` statt
 * mit dem von NIP-01 verlangten `OK`. welshman ordnet Publish-Ergebnisse über die
 * Event-Id aus dem `OK` zu — **ohne `OK` bleibt der Thunk für immer `pending`.**
 * Genau daran ist in diesem Haus schon eine Moderations-Löschung spurlos
 * verschwunden: kein Fehler, keine Meldung, der Knopf blieb `busy`.
 *
 * `js/publishResult.ts` löst das (`waitForPublishError` +
 * `PUBLISH_VERDICT_TIMEOUT_MS`) und ist dafür selbst gründlich getestet — vier
 * Fälle allein für die Zeitgrenze. **Was diese Tests NICHT sagen können, ist, ob
 * der neue Schreibpfad sie überhaupt benutzt.** Ein `forumWrite.ts`, das
 * stattdessen welshmans `waitForThunkError` riefe, ließe jeden dieser Fälle grün
 * und wäre im Ratenbegrenzer-Fall trotzdem ein Dauer-Spinner. Ein Verhaltenstest
 * über die richtige Funktion ist blind dafür, dass sie nicht gefragt wird.
 *
 * ── Warum AST und nicht `grep` ─────────────────────────────────────────────
 *
 * Hier ist das nicht theoretisch, sondern gemessen: `waitForThunkError` kommt im
 * Paket **sechsmal** vor und **jedes Mal in einem Kommentar** — die Erklärungen
 * in `publishResult.ts`, `profiles.ts` und `forumWrite.ts` nennen die Funktion
 * wörtlich, um zu sagen, dass sie NICHT benutzt wird. Ein Textmuster meldete
 * genau diese Erklärungen als Verstoß. `ts.createSourceFile` sieht denselben Baum
 * wie der Compiler; Kommentare tauchen darin gar nicht erst als Code auf.
 *
 * Der Scanner ist derselbe wie im P6-Riegel (`workspaceQuelleGate.ts`) — er wird
 * hier wiederverwendet und nicht nachgebaut.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
    MIN_MODULE,
    importiertAus,
    liesDatei,
    ruftAuf,
    sammleModule,
} from './workspaceQuelleGate.ts'

const JS_DIR = import.meta.dirname
const befund = (name: string) => liesDatei(join(JS_DIR, name), name)

/**
 * Untergrenze der Aufrufe, die der Scanner in `forumWrite.ts` sehen MUSS.
 *
 * Kalibrierung, kein Stil — ohne sie meldete ein kaputter Scanner dasselbe wie
 * ein sauberer Baum („ruft `waitForThunkError` nicht auf" ist auch wahr, wenn
 * gar nichts gelesen wurde). **Gemessen am 2026-08-27: 19 Bezeichner-Aufrufe**
 * in `forumWrite.ts`. Gezählt werden nur Aufrufe über einen BEZEICHNER (`f(…)`),
 * nicht über eine Eigenschaft (`pending.update(…)`, `inFlight.add(…)`) — deshalb
 * ist die Zahl kleiner, als die Dateilänge vermuten lässt. Die Schwelle liegt
 * bei 8: sie soll einen blinden Scanner fangen, nicht die nächste Umstellung.
 */
const MIN_AUFRUFE_FORUMWRITE = 8

test('KALIBRIERUNG: der Scanner sieht `forumWrite.ts` wirklich', () => {
    const f = befund('forumWrite.ts')
    assert.ok(
        f.aufrufe.length >= MIN_AUFRUFE_FORUMWRITE,
        `nur ${f.aufrufe.length} Aufrufe gesehen (mindestens ${MIN_AUFRUFE_FORUMWRITE} erwartet) — der Scanner misst hier nichts`,
    )
    // Und ein Aufruf, der mit der Sache NICHTS zu tun hat: sonst meldete ein
    // Scanner, der nur `waitFor*` findet, dieselbe Zahl wie ein sauberer.
    assert.ok(ruftAuf(f, 'makeEvent'), 'der Scanner sieht den Ereignisbau nicht')
})

test('KERNBEWEIS: der Themen-Schreibpfad wartet über `waitForPublishError`', () => {
    const f = befund('forumWrite.ts')
    assert.ok(
        importiertAus(f, 'waitForPublishError', './publishResult.ts'),
        '`forumWrite.ts` importiert die ehrliche Auswertung nicht',
    )
    assert.ok(ruftAuf(f, 'waitForPublishError'), '… und ruft sie nicht auf')
})

test('… und rahmt den Ausgang über `publishFehlermeldung`', () => {
    // Die zweite Hälfte des sichtbaren Ausgangs: `waitForPublishError` MACHT aus
    // dem ausbleibenden `OK` einen Endzustand, `publishFehlermeldung` macht daraus
    // einen Satz, der handlungsleitend ist und keine Ablehnung erfindet. Ohne
    // diesen Schritt stünde beim Ratenbegrenzer nur der englische Relay-Wortlaut
    // (bzw. gar keiner) an der Fläche.
    const f = befund('forumWrite.ts')
    assert.ok(importiertAus(f, 'publishFehlermeldung', './publishResult.ts'))
    assert.ok(ruftAuf(f, 'publishFehlermeldung'))
})

test('… und NIEMAND im Paket ruft welshmans `waitForThunkError`', () => {
    // Paketweit statt nur in `forumWrite.ts`: sonst stünde die nächste Fläche,
    // die morgen publiziert, ohne Riegel da — und die Lücke fiele wieder erst
    // dann auf, wenn ein Ratenbegrenzer sie trifft.
    const module = sammleModule(JS_DIR)
    assert.ok(module.length >= MIN_MODULE)

    const verstoesse = module
        .map((name) => befund(name))
        .filter((f) => ruftAuf(f, 'waitForThunkError') || importiertAus(f, 'waitForThunkError', '@welshman/app'))
        .map((f) => f.datei)

    assert.deepEqual(
        verstoesse,
        [],
        'welshmans `waitForThunkError` wertet `timeout`/`aborted` als ERFOLG und wartet beim NOTICE-Fall ewig — '
            + 'stattdessen `waitForPublishError` aus `publishResult.ts` benutzen.',
    )
})

test('GEGENPROBE: der Scanner findet den Namen sehr wohl, wenn er als CODE dasteht', () => {
    // Ohne diesen Fall wäre der Test darüber auch dann grün, wenn der Scanner
    // den Namen grundsätzlich nicht erkennt. Und er belegt zugleich, warum hier
    // AST und nicht `grep` steht: derselbe Name steht im Paket sechsmal in
    // Kommentaren und wird oben korrekt NICHT gemeldet.
    const gegenprobe = liesDatei(join(JS_DIR, 'publishResult.ts'), 'publishResult.ts')
    assert.equal(ruftAuf(gegenprobe, 'waitForThunkError'), false, 'dort steht der Name nur im Kommentar')

    // Derselbe Text als echter Aufruf — jetzt muss der Scanner ihn sehen.
    // (Über die reine `lies`-Schnittstelle, ohne eine Datei anzulegen.)
    const f = befund('forumWrite.ts')
    assert.ok(ruftAuf(f, 'publishThunk'), 'ein echter Aufruf desselben Musters wird gefunden')
})
