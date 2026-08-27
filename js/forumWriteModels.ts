/**
 * Ein Forum-Thema **anlegen** — der reine Teil.
 *
 * Gegenstück zu `forumWrite.ts` (Signer, Relay, Store). Hier steht nur, was ohne
 * Browser prüfbar ist: die Ereignisform, der Inhalts-Riegel und die Frage, WELCHE
 * der zwei Bauformen die Fläche gerade zeigt. Relative Importe MIT `.ts`-Endung —
 * die Datei muss aus Vite UND aus dem Node-Test-Runner ladbar sein.
 *
 * ══ Die Ereignisform, am BUZZ-QUELLCODE belegt ═══════════════════════════════
 *
 * `forumModels.ts` protokolliert die Form so, wie sie am Teststack GEMESSEN wurde.
 * Was hier steht, ist die zweite, unabhängige Quelle: der Erzeuger selbst, in
 * Buzz' eigenem Repo (`/home/user/Code/buzz`, Commit `69107dc3`, gelesen 2026-08-27).
 *
 * ```rust
 * // crates/buzz-sdk/src/builders.rs:284-297
 * /// Build a forum post thread root (kind 45001).
 * pub fn build_forum_post(channel_id: Uuid, content: &str,
 *                         mentions: &[&str], media_tags: &[Vec<String>]) -> … {
 *     check_content(content, 64 * 1024)?;
 *     let mut tags = vec![tag(&["h", &channel_id.to_string()])?];
 *     mention_tags(mentions, &mut tags)?;   // je Erwähnung ["p", <hex, lowercase>]
 *     imeta_tags(media_tags, &mut tags)?;
 *     Ok(EventBuilder::new(Kind::Custom(45001), content).tags(tags).allow_self_tagging())
 * }
 * ```
 *
 * Buzz **Desktop** baut dasselbe Ereignis ein zweites Mal, in Rust, im Tauri-Kern —
 * `desktop/src-tauri/src/events.rs:317-329` (`build_forum_post`), aufgerufen aus
 * `desktop/src-tauri/src/commands/messages.rs:515` mit **`content.trim()`**. Beide
 * Fassungen stimmen in allem überein, was auf den Draht geht:
 *
 *   kind   45001
 *   tags   `["h", <kanal-uuid>]`  ← **das einzige Pflicht-Tag**
 *          `["p", <hex>]` je Erwähnung, kleingeschrieben, ohne Wiederholung
 *          `["imeta", …]` je Anhang (hier nicht gebaut, siehe unten)
 *   content der Rumpf, getrimmt
 *
 * **Es gibt KEIN Titel-Tag.** Weder `subject` noch `title` noch `d`. Wer einen
 * Titel als eigenes Feld erfände, schriebe ein Ereignis, dessen Titel in Buzz
 * Desktop niemand je zu sehen bekommt — dort rendert `ForumPostCard.tsx` die
 * Karte **ohne jeden Titel**: Avatar, Name, Zeit und `content.slice(0, 200)` als
 * Markdown-Vorschau (`desktop/src/features/forum/ui/ForumPostCard.tsx:59-63`,
 * `:118-129`). Der Composer daneben hat entsprechend **ein einziges Feld**
 * (`ForumComposer.tsx:53`, `useState("")`), Platzhalter „Write your post…"
 * (`ForumView.tsx:182`).
 *
 * **Das ist die eine Stelle, an der wir bewusst MEHR tun als Buzz Desktop** — und
 * es ist eine reine ANZEIGE-Entscheidung, die den Draht nicht berührt:
 * {@link forumTopicTitle} liest die erste Zeile als Titel, den Rest als Vorschau.
 * Beide Clients lesen dasselbe Ereignis; nur unsere Liste gliedert es. Deshalb
 * sagt die Fläche dem Verfasser auch ausdrücklich, dass die erste Zeile der Titel
 * wird — sonst verspräche sie ein Feld, das es nicht gibt.
 *
 * ── Was der RELAY zusätzlich verlangt (`crates/buzz-relay/src/handlers/`) ────
 *
 * - `#h` ist Pflicht: `ingest.rs:612-641 requires_h_channel_scope` führt
 *   `KIND_FORUM_POST` auf; fehlt das Tag →
 *   `invalid: channel-scoped events must include an h tag` (`ingest.rs:2241-2243`).
 * - Schreibrecht: `Scope::MessagesWrite` am Kanal (`ingest.rs:390-392`) — also
 *   **Kanalmitgliedschaft**, im privaten Forum per kind 9000 vergeben.
 * - `created_at` muss innerhalb von ±900 s der Serverzeit liegen
 *   (`ingest.rs:2005-2011`). Wir setzen nichts eigenes; `makeEvent` nimmt „jetzt".
 * - Inhaltsgrenze am Relay: 256 KiB (`ingest.rs:2014`). Buzz' eigene Clients
 *   riegeln schon bei **64 KiB** ab, und genau danach richtet sich
 *   {@link TOPIC_CONTENT_MAX_BYTES} — ein Thema, das der Relay annimmt und Buzz
 *   Desktop nie hätte schreiben können, ist kein Kompatibilitätsgewinn.
 * - **Leeren Inhalt lehnt der Relay NICHT ab** (kein `content.is_empty()`-Gate für
 *   45001 in `ingest.rs`). Der Riegel muss deshalb im Client stehen, und er steht
 *   auch bei Buzz dort (`ForumComposer.tsx:221`, `contentRef.current.trim()`).
 *
 * ── Was hier bewusst FEHLT ──────────────────────────────────────────────────
 *
 * Kein `imeta`: Anhänge an einem Thema sind ein eigener Weg (Upload, Blossom-Auth,
 * Vorschau) und keine Zeile in einem Tag-Builder. Bis dahin schreibt diese Fläche
 * Text — Buzz Desktop liest ihn vollständig, der Unterschied ist ein fehlendes
 * Bild und kein kaputtes Ereignis.
 */

/**
 * Buzz und Buzz Desktop riegeln beide bei 64 KiB ab (`builders.rs:290`,
 * `desktop/src-tauri/src/events.rs:23`). Gezählt werden **Bytes**, nicht Zeichen:
 * `String::len()` in Rust ist die UTF-8-Länge. Ein Riegel über `content.length`
 * ließe 64 K Emoji durch (4 Bytes je Zeichen) und der Relay nähme es zwar an,
 * Buzz Desktop könnte dasselbe Thema aber nie verfassen.
 */
export const TOPIC_CONTENT_MAX_BYTES = 64 * 1024

/** UTF-8-Länge, wie Rusts `String::len()` sie zählt. */
export const byteLength = (text: string): number => new TextEncoder().encode(text).length

/**
 * Der Inhalt, so wie er auf den Draht geht: **getrimmt**, wie in Buzz Desktop
 * (`commands/messages.rs:515`, `events::build_forum_post(channel_uuid, content.trim(), …)`).
 *
 * Nicht kosmetisch: unser Titel ist die erste nicht-leere Zeile. Ohne Trim trüge
 * ein Thema, das mit einer Leerzeile beginnt, in Buzz Desktop führende Umbrüche
 * in der 200-Zeichen-Vorschau — und bei uns entstünde derselbe Titel aus einem
 * anderen Ereignis. Ein Client, zwei Ereignisse, ein Ergebnis: das ist die
 * Definition eines Rundungsfehlers, der später niemandem mehr erklärbar ist.
 */
export const normalizeTopicContent = (raw: string): string => (raw ?? '').trim()

/**
 * Die Tags eines 45001 — **`h` zuerst, danach die Erwähnungen**, in genau der
 * Reihenfolge, in der `build_forum_post` sie baut.
 *
 * Die Reihenfolge ist keine Vertragsbedingung des Relays (er liest Tags
 * mengenweise), aber sie ist die einzige, die sich am Vorbild belegen lässt —
 * und ein Ereignis, das Zeichen für Zeichen dieselbe Form hat wie das des
 * Vorbilds, erspart der nächsten Runde die Frage, ob die Abweichung Absicht war.
 *
 * Erwähnungen werden **kleingeschrieben und dubletten-frei** übernommen, wie in
 * `mention_tags` (`builders.rs:193-205`). Ein leerer/kaputter Eintrag fällt raus:
 * `mentionPubkeys()` liefert nur dekodierte Schlüssel, aber diese Funktion ist
 * die Engstelle und darf sich darauf nicht verlassen.
 */
export const buildTopicTags = (h: string, mentions: readonly string[] = []): string[][] => {
    const tags: string[][] = [['h', h]]
    const seen = new Set<string>()
    for (const raw of mentions) {
        const pk = (raw ?? '').trim().toLowerCase()
        if (pk === '' || seen.has(pk)) {
            continue
        }
        seen.add(pk)
        tags.push(['p', pk])
    }

    return tags
}

/**
 * Warum ein Thema NICHT abgeschickt werden kann — als sprachfreier GRUND, nicht
 * als Satz. Dieses Modul bleibt frei von `i18n.ts` (wie `forumModels.ts`), damit
 * es unter `node --test` ohne Katalog läuft; den Satz macht die Fläche.
 *
 * `''` heißt: es spricht nichts dagegen.
 */
export type TopicContentProblem = '' | 'leer' | 'zu-lang'

export const topicContentProblem = (raw: string): TopicContentProblem => {
    const content = normalizeTopicContent(raw)
    if (content === '') {
        return 'leer'
    }

    return byteLength(content) > TOPIC_CONTENT_MAX_BYTES ? 'zu-lang' : ''
}

/**
 * ══ WELCHE der zwei Bauformen den Weg zum Thema öffnet ═══════════════════════
 *
 * Dieselbe Konstruktion wie {@link ../forgeAnlegen.ts anlegeForm} und aus
 * demselben Grund: die **Ausschließlichkeit** ist die eigentliche Zusage. Zwei
 * sichtbare Auslöser für dieselbe Handlung sind schlimmer als ein schlecht
 * platzierter — dann fragt sich der Leser, ob sie dasselbe tun. Als EINE Funktion
 * mit EINEM Rückgabewert sind zwei Formen zugleich nicht ausdrückbar, nicht nur
 * unwahrscheinlich.
 *
 * ── Und warum die zwei Formen NICHT dieselbe sind ───────────────────────────
 *
 * `'kopf'` (Desktop-Chassis): ein beschrifteter Knopf **über der Themenliste**,
 * genau dort, wo Buzz Desktop seinen „Start a new post…"-Streifen hat
 * (`ForumView.tsx:184-197`: ein volle Breite einnehmender, gestrichelt umrandeter
 * Knopf am Kopf der Liste). Wer am Desktop ein Forum liest, liest von oben; der
 * Weg zum eigenen Beitrag gehört an denselben Rand.
 *
 * `'leiste'` (Mobil-Chassis): ein Knopf **in der unteren Zone**, dort wo im Chat
 * der Composer steht. Drei Gründe, und keiner davon ist Geschmack:
 *   1. Der Kopf der Liste ist auf dem Telefon nach drei Zeilen weggescrollt. Ein
 *      Auslöser dort ist nach dem ersten Wischen unerreichbar.
 *   2. Die untere Zone ist der Daumenbereich und in jedem anderen Kanaltyp
 *      genau die Stelle, an der man etwas verfasst. Dieselbe Stelle für dieselbe
 *      Absicht.
 *   3. Ein aufklappender Composer AM KOPF der Liste (die Desktop-Form) schöbe auf
 *      dem Telefon die Liste unter die Bildschirmtastatur und stünde selbst zur
 *      Hälfte darunter. Deshalb öffnet die mobile Form ein **Blatt** statt eines
 *      Aufklappers — dieselbe Blattform wie `⚡forge-repo.blade.php` („Neues
 *      Issue") und `components/login-sheet.blade.php`.
 *
 * `'keins'`: kein Forum, keine Mitgliedschaft, keine Handlung. Ein Knopf, der
 * garantiert scheitert, ist schlimmer als keiner — die Fläche zeigt dann den
 * Beitreten-Weg, den sie ohnehin schon hat.
 *
 * ── Warum die BREITE hereingereicht wird ────────────────────────────────────
 * Weil sie im Aufrufer reaktiv gelesen werden MUSS: Alpines `$store` wird aus
 * einem `Alpine.data`-Objekt heraus nicht als Abhängigkeit erfasst. In der
 * Blade-Zeile (`topicComposerZiel($store.viewport.desktop)`) findet die Lesung
 * innerhalb des Alpine-Effekts statt und wird verfolgt. Die Schwelle selbst steht
 * weiterhin genau einmal, in `viewport.ts` (`DESKTOP_QUERY`).
 */
export type TopicComposerZiel = 'kopf' | 'leiste' | 'keins'

export const topicComposerZiel = (desktop: boolean, isForum: boolean, joined: boolean): TopicComposerZiel => {
    if (!isForum || !joined) {
        return 'keins'
    }

    return desktop ? 'kopf' : 'leiste'
}
