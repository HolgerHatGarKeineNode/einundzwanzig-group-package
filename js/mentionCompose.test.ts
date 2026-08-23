/**
 * Die Mechanik des @-Autocomplete — geprüft an den Fällen, in denen ein
 * Vorschlag entweder GAR NICHT erscheinen darf oder den Entwurf verstümmelt.
 *
 * Die Regel steht seit dem Chat-Composer im Haus, hatte aber nie einen Test:
 * sie lag inline in einer Alpine-Methode (`bridge.ts onComposerInput`), und
 * inline heißt hier „nur über einen Browser prüfbar". Mit dem Forge-Composer
 * gäbe es eine zweite Kopie — deshalb steht sie jetzt in `mentionCompose.ts`
 * und wird hier festgehalten.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/mentionCompose.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mentionQueryAt, spliceMention } from './mentionCompose.ts'

test('ein frisches `@` öffnet den Vorschlag mit leerer Suche', () => {
    const treffer = mentionQueryAt('Hallo @', 7)
    assert.deepEqual(treffer, { query: '', start: 6 })
})

test('das getippte Wort hinter dem `@` ist die Suche', () => {
    assert.deepEqual(mentionQueryAt('Hallo @ce', 9), { query: 'ce', start: 6 })
})

test('am Zeilenanfang zählt das `@` genauso', () => {
    assert.deepEqual(mentionQueryAt('@ceo', 4), { query: 'ceo', start: 0 })
})

/**
 * **Der Fall, der die Regel überhaupt begründet.** Ohne die Wortanfang-Bedingung
 * öffnete jede E-Mail-Adresse im Text ein Vorschlagsfenster — und mit `Enter`
 * (der Sendetaste des Chats) übernähme der Nutzer ungewollt eine Erwähnung.
 */
test('mitten im Wort — etwa in einer E-Mail-Adresse — öffnet nichts', () => {
    assert.equal(mentionQueryAt('schreib an post@example.org', 27), null)
    assert.equal(mentionQueryAt('post@ex', 7), null)
})

/**
 * Ein bereits übernommener Vorschlag steht als `nostr:npub1…` im Entwurf. Träfe
 * die Suche darin ein `@`, ginge das Fenster mitten in einer bech32-Zeichenkette
 * wieder auf.
 */
test('ein zweites `@` beendet die Suche', () => {
    assert.equal(mentionQueryAt('@a@b', 4), null)
})

test('ein Leerzeichen nach dem `@wort` schließt den Vorschlag', () => {
    assert.equal(mentionQueryAt('Hallo @ceo ', 11), null)
})

/**
 * Der Cursor, nicht das Textende, ist maßgeblich: wer mittendrin nachträgt, soll
 * denselben Vorschlag bekommen wie beim Tippen am Ende.
 */
test('gesucht wird bis zur Schreibmarke, nicht bis zum Textende', () => {
    assert.deepEqual(mentionQueryAt('Hallo @ce und mehr', 9), { query: 'ce', start: 6 })
})

test('eine Schreibmarke jenseits des Textes wird auf das Ende geklemmt', () => {
    assert.deepEqual(mentionQueryAt('@ceo', 999), { query: 'ceo', start: 0 })
})

// ── Übernahme ───────────────────────────────────────────────────────────────

test('die Übernahme ersetzt `@query` und setzt die Marke dahinter', () => {
    const { text, caret } = spliceMention('Hallo @ce', 6, 2, 'nostr:npub1abc ')
    assert.equal(text, 'Hallo nostr:npub1abc ')
    assert.equal(caret, text.length)
})

/**
 * Der nachfolgende Text bleibt **unverändert** stehen — samt seines eigenen
 * Leerzeichens. Zusammen mit dem nachlaufenden Leerzeichen der Einfügeform
 * (`mentionInsert`, Vertrag in `interactions.ts:214`) stehen danach zwei
 * Leerzeichen im Entwurf. Das ist der Ist-Zustand des Chats seit C4 und hier
 * bewusst festgehalten statt stillschweigend „aufgeräumt": das Leerzeichen der
 * Einfügeform trägt eine Zusage (ohne es läse `MENTION` das nächste getippte
 * Zeichen mit), das des Nutzers gehört ihm.
 */
test('Text hinter der Schreibmarke bleibt stehen', () => {
    const { text, caret } = spliceMention('Hallo @ce und mehr', 6, 2, 'nostr:npub1abc ')
    assert.equal(text, 'Hallo nostr:npub1abc  und mehr')
    // Die Marke steht hinter dem Eingefügten — nicht am Textende.
    assert.equal(caret, 'Hallo nostr:npub1abc '.length)
})

/**
 * `start === -1` ist der Zustand „kein Vorschlag offen" (so setzt ihn
 * `closeMentions`). Ohne diesen Riegel schriebe eine verirrte Übernahme an den
 * Textanfang und fräße das erste Zeichen.
 */
test('ohne offenen Vorschlag bleibt der Entwurf unangetastet', () => {
    assert.deepEqual(spliceMention('Hallo', -1, 0, 'X'), { text: 'Hallo', caret: 5 })
})
