/**
 * Die schmale Auszeichnungs-Schicht des Chats — `**fett**` und `~~durchgestrichen~~`.
 *
 * Bewusst OHNE welshman-Importe und ohne Markdown-Bibliothek (gleiches Prinzip wie
 * `chatLinks.ts` und `nostrEventLink.ts`), damit die Regeln unter `node --test` ohne
 * Browser- oder Store-Runtime prüfbar sind:
 *   node --test packages/einundzwanzig-group/js/chatMarkup.test.ts
 *
 * ── Warum kein Markdown-Parser ────────────────────────────────────────────────────────
 * Der Chat bekommt KEINEN vollen Markdown-Support, und das ist eine Entscheidung, keine
 * Sparmaßnahme (Nutzer, 2026-08-16: „die grundlegendsten Markdowns eventuell dann schon").
 * Vier Elemente wurden ausdrücklich ausgeschlossen, jedes aus einem eigenen Grund:
 *
 *   - `# Überschrift` — `#` ist die SIGNATUR dieses Clients: Raum-Präfix, Sprungliste,
 *     Raumtitel. Und welshman parst `#thema` bereits als Topic. Eine Zeile „#bitcoin"
 *     würde zur Überschrift statt zum Thema.
 *   - `> Zitat` — der Chat hat Zitate als MECHANIK (Reply-Vorschau, Zitatkarte). Ein
 *     zweites, rein textuelles Zitat daneben erklärt niemandem den Unterschied.
 *   - `- Liste` — der Textkörper trägt `whitespace-pre-wrap`, eine getippte Aufzählung
 *     steht also schon richtig da. Ein echter Listen-Renderer brächte nur Einzüge und
 *     Abstände, die die dichte Chat-Zeile sprengen.
 *   - `[Text](URL)` — versteckt das Ziel hinter frei wählbarem Text. In einem Netz, in
 *     dem jede Nachricht von jedem kommen kann, ist das keine Bequemlichkeit, sondern
 *     eine Phishing-Fläche. Links werden ohnehin automatisch erkannt (`chatLinks.ts`).
 *
 * `*kursiv*`/`_kursiv_` fehlt bewusst: der EINFACHE Stern trifft Multiplikation und das
 * Zensur-Sternchen, der Unterstrich trifft jeden Bezeichner (`foo_bar_baz` würde in der
 * Mitte kursiv). Beide Zeichen kommen in normalem Text vor — `**` und `~~` praktisch nie.
 *
 * ── Warum das auf ESCAPTEM HTML arbeitet ──────────────────────────────────────────────
 * {@link applyInlineMarkup} bekommt die bereits von welshman gerenderte (und damit
 * escapte) Fassung EINES Text-Knotens, nicht den Rohtext. Das ist die Sicherheitsgrenze:
 * die Funktion fügt ausschließlich eigene, feste Tags ein und kann aus Nutzereingaben
 * kein Markup erzeugen — `<` ist zu diesem Zeitpunkt schon `&lt;`. Sie darf deshalb NIE
 * auf Rohtext angewendet werden, und ebenso wenig auf Knoten, die selbst Markup
 * mitbringen (Links, Emoji, Mentions) — dort stünde ihr Muster plötzlich in einem
 * Attributwert.
 *
 * ── Grenze am Knoten, nicht am Satz ───────────────────────────────────────────────────
 * Auszeichnung gilt innerhalb EINES Textknotens. `**Schaut auf nostr:npub1… und das**`
 * bleibt deshalb unausgezeichnet: welshman zerlegt das in drei Knoten, und die Sterne
 * landen in verschiedenen. Das ist die ehrliche Grenze eines Ansatzes, der bewusst kein
 * Dokument-Modell aufbaut — und sie fällt nur dort auf, wo jemand eine Erwähnung mitten
 * in eine Hervorhebung setzt.
 */

/**
 * Ein Auszeichnungspaar: Marker, erzeugtes Element, und wie es im Rohtext heißt.
 *
 * `(?=\S)` und `\S` an den Enden sind kein Zierrat: ohne sie würde „2 ** 3 ** 4"
 * (Potenzschreibweise) zu einer Hervorhebung, und ein Sternchenpaar am Zeilenende
 * fräße den Abstand davor. Der Inhalt darf keine Zeilenumbrüche enthalten — sonst
 * fände ein einzelnes `**` am Anfang seinen Partner drei Absätze später und zöge den
 * ganzen Text dazwischen fett.
 */
const PAARE: readonly { muster: RegExp; tag: string }[] = [
    { muster: /\*\*(?=\S)([^\n]*?\S)\*\*/g, tag: 'strong' },
    { muster: /~~(?=\S)([^\n]*?\S)~~/g, tag: 'del' },
]

/**
 * Setzt `**fett**` und `~~durchgestrichen~~` in einem bereits escapten HTML-Fragment um.
 *
 * Nur für Text-Knoten (siehe Kopf). Reihenfolge der Paare ist bedeutungslos, weil sich
 * die Marker nicht überschneiden; verschachtelt (`**~~x~~**`) funktioniert beides.
 */
export const applyInlineMarkup = (html: string): string =>
    PAARE.reduce((acc, { muster, tag }) => acc.replace(muster, `<${tag}>$1</${tag}>`), html)

/**
 * Entfernt dieselben Marker aus ROHTEXT — für jede Stelle, die einen Ausschnitt ANZEIGT,
 * ohne HTML rendern zu können.
 *
 * Das sind mehr, als man beim Bauen denkt: Antwort-Vorschau, Zitatkarte, die Zeilen der
 * Update-Liste und deren `aria-label`. Ohne diesen Schritt stünde dort sichtbar
 * `**21Meetup**` — die Auszeichnung wäre an genau den Stellen wieder zu sehen, an denen
 * sie niemand lesen will, und ein Screenreader spräche die Sterne mit.
 *
 * Code-Marker (`` ` ``) fallen hier mit, obwohl sie im Chat gerendert werden: im
 * Ausschnitt ist ihre Auszeichnung ohnehin nicht darstellbar, und ein nacktes Backtick
 * ist im Vorschautext nur Rauschen.
 */
export const stripInlineMarkup = (text: string): string =>
    PAARE.reduce((acc, { muster }) => acc.replace(muster, '$1'), text)
        .replace(/```([^]*?)```/g, '$1')
        .replace(/`([^\n`]+)`/g, '$1')
