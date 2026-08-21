/**
 * Der Profil-Verweis nach `media.einundzwanzig.space` — **die reine Adressbildung**.
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/medienProfil.test.ts
 *
 * ── Warum ein eigenes Modul und nicht `handles.ts` ────────────────────────────────
 * `handles.ts` wäre inhaltlich der nächste Ort — es kennt Pubkey und verifizierten
 * Handle. Es ist ausdrücklich die **dünne Hülle um welshmans `handles`-Layer**, und
 * eine Adressbildung für einen FREMDEN Host gehört nicht in diese Hülle: sie kennt
 * welshman nicht, braucht ihn nicht und darf nicht mit ihm zusammen kippen. Das Haus
 * zieht diese Trennung systematisch — `longform.ts` neben `longformFeed.ts`,
 * `vereinFlow.ts` neben `verein.ts`, `articleAuthor.ts` neben der Insel. Hier steht
 * deshalb nur Zeichenkette rein, Zeichenkette raus.
 *
 * (`handles.ts` ist unter `node --test` durchaus ladbar — am 2026-08-21 gemessen, ein
 * Import von `verifiedNip05` läuft. Der Test dieses Moduls nutzt das und prüft die
 * Sicherheitsregel gegen die ECHTE Verifikationsfunktion, nicht gegen eine Nachbildung.
 * Die Trennung hier ist also eine Frage des Zuschnitts, keine der Testbarkeit.)
 *
 * ── Die Route, gegen die hier gebaut wird ─────────────────────────────────────────
 * `media.einundzwanzig.space` ist die öffentliche Creator-Seite aus `~/Code/standup`.
 * Ihr Router ist eine **Hash-Route** (`createWebHashHistory`, `src/router/index.js:1`
 * und `:228`), die einzige öffentliche Profilroute ist `/u/:identifier`
 * (`src/router/index.js:206`), und `:identifier` nimmt eine npub **oder** eine
 * NIP-05-Adresse (`src/views/CreatorPage.vue:112-148`).
 *
 * **Es gibt keine Route für einen einzelnen Artikel** — deshalb verlinkt dieses Modul
 * ausschließlich Profile. Ein Link, der auf die Autorenseite statt auf den Artikel
 * führt, enttäuscht jeden Klick.
 *
 * **Dieses Modul legt sich auf keine der beiden Adressformen fest.** Der Host beantwortet
 * `/#/u/…` (reine SPA-Route) und `/u/…` (leitet in dieselbe SPA, liefert zusätzlich
 * profilspezifische OG-Tags) — am 2026-08-21 beide mit 200 gemessen. Welche gilt,
 * entscheidet allein `basis`, also `group.media_public_url`; hier wird sie wörtlich
 * übernommen. Der Default dort ist seit dem 2026-08-21 der Klarpfad, wegen der Vorschau
 * geteilter Links. Beide Formen stehen im Test dieses Moduls als Literal.
 *
 * ── Die Sicherheitsregel, die dieses Modul trägt ──────────────────────────────────
 * **Nur ein VERIFIZIERTES NIP-05 darf in den Link.** Das `nip05`-Feld aus einem kind 0
 * ist eine Selbstauskunft: jeder kann `satoshi@einundzwanzig.space` in sein Profil
 * schreiben. Landete das hier, führte unser Verweis auf eine FREMDE Person — mit
 * unserer Empfehlung im Rücken. Die Prüfung macht welshman (`handles.ts`,
 * `verifiedNip05`: die `.well-known/nostr.json` der Domain muss auf genau diese Pubkey
 * zeigen, sonst `''`); dieses Modul nimmt die Adresse nur aus dieser Quelle entgegen
 * und fällt sonst auf die npub zurück.
 *
 * **Die npub trägt immer.** Kein kind 0, kein NIP-05, hängender Handle-Load — in jedem
 * dieser Fälle entsteht ein gültiger Link, weil `nip19.npubEncode` an nichts hängt
 * außer am Pubkey selbst.
 */
import * as nip19 from 'nostr-tools/nip19'
import { isSafeExternalUrl } from './vereinFlow.ts'

/**
 * Die Adressform, die media. für `:identifier` als NIP-05 überhaupt annimmt —
 * **enger gefasst als dort**, und das mit Absicht.
 *
 * `CreatorPage.vue:75` prüft `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`. Dieses Muster lässt in
 * beiden Teilen `/`, `#`, `?` und `%` zu; eine Adresse wie `a@b.c/#/u/npub1…` bestünde
 * es und schöbe einen zweiten Pfad in unsere URL. Sie käme zwar nur durch, wenn eine
 * Domain sie bestätigt hat — aber ein Verweis, dessen Unbedenklichkeit an der
 * Gutwilligkeit einer fremden Domain hängt, ist keine Zusage, sondern eine Hoffnung.
 *
 * Deshalb hier der NIP-05-Zeichenvorrat (`[a-z0-9-_.]` für den lokalen Teil) und ein
 * gewöhnlicher Domainname. Damit stellt sich die Frage nach Prozentkodierung gar nicht
 * erst: was hier durchkommt, ist in Pfad UND Fragment unverändert zulässig
 * (RFC 3986, `pchar` bzw. `fragment`). Was nicht durchkommt, wird nicht repariert,
 * sondern durch die npub ersetzt — {@link medienProfilUrl} fällt fail-closed zurück.
 */
export const MEDIEN_NIP05_MUSTER = /^[a-z0-9_.-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i

/**
 * Ein Pubkey ist 32 Byte Hex — **und das prüft `npubEncode` NICHT.**
 *
 * Am 2026-08-21 gegen `nostr-tools` gemessen: `npubEncode` wirft ausschließlich bei
 * ungerader Länge oder Nicht-Hex-Zeichen. Alles andere kodiert es klaglos —
 * `npubEncode('')` liefert `npub106246s`, `npubEncode('ab')` liefert `npub14vcr2qpt`,
 * und 62 wie 66 Hexzeichen ergeben ebenso eine wohlgeformte bech32-Zeichenkette. Ein
 * `try/catch` allein lässt also genau die Werte durch, die man für abgefangen hält, und
 * daraus entstünde ein Verweis auf ein Profil, das es nicht gibt — ein Link, der
 * aussieht wie einer und ins Leere führt, ist schlechter als kein Link.
 *
 * (Derselbe Irrtum steht als Satz im Docblock von `buildArticleAuthor`, `longform.ts` —
 * dort ist er ein Kommentar, hier wäre er ein Fehlverhalten gewesen. Gemeldet, nicht
 * hier mitrepariert.)
 */
const PUBKEY_HEX = /^[0-9a-f]{64}$/i

/*
 * ── Warum die `_@domain`-Wurzelform auf die npub fällt — gemessen, nicht vermutet ──
 *
 * `verifiedNip05` liefert die ANZEIGEFORM (`displayNip05`, `@welshman/app`
 * `handles.js:93`): beginnt die Adresse mit `_@`, gibt sie nur die Domain zurück.
 * `_@einundzwanzig.space` wird so zu `einundzwanzig.space` — einer Zeichenkette **ohne
 * `@`**. Außerhalb dieses Projekts nachgestellt (Node, beide Quellen wörtlich kopiert,
 * 2026-08-21): media. urteilt darüber `invalid_format`, weil sie weder mit `npub1`
 * beginnt noch das dortige NIP-05-Muster erfüllt. Der Verweis führte also auf eine
 * Fehlerseite.
 *
 * Der Rohwert stünde in `deriveHandleForPubkey(...).nip05` bereit und ließe sich
 * durchreichen. Er wird es nicht, und der Grund ist der Bestand: am 2026-08-21 über die
 * **12 Autoren** des Board-Relays gemessen (`nak req -k 30023` → Pubkeys, dann
 * `nak req -k 0 -a <pk> wss://purplepag.es` **einzeln je Schlüssel**, weil ein
 * Sammelabruf mit mehreren `-a` in dieser Shell für alle Schlüssel null liefert) tragen
 * **acht** ein `nip05`, **alle acht** in der Form `name@domain`, **keiner** in der
 * Wurzelform. Die übrigen vier — dieselben vier Podcast-Bridges wie bei `lud16` —
 * haben gar keins und bekommen die npub.
 *
 * Für einen Fall, den der Bestand nicht kennt, eine zweite Datenleitung durch
 * `buildArticleAuthor` zu ziehen, wäre der teurere Weg: die beiden Flächen bekämen
 * verschiedene Eingaben und könnten still auseinanderlaufen. Ändert sich der Bestand,
 * ist der Rohwert die Stelle, an der nachzubessern ist — die Zeile steht in
 * `bridge.ts` bei `deriveHandleForPubkey`.
 */

/**
 * Öffentliche Profiladresse auf media. — oder `''`, wenn es keine geben kann.
 *
 * `''` steht für **„diese Zeile entfällt"** und ist kein Fehlerfall. Die Flächen binden
 * über `:href="medienUrl || null"`: ohne Ziel gibt es kein `href`, und ein `<a>` ohne
 * `href` ist kein Tabstopp. Dieselbe Bauform wie `autorHref()` und `href(card)`.
 *
 * Drei Wege dorthin, alle drei gewollt:
 *  · **`basis` leer** — nicht konfiguriert. Ein eingebauter Default stünde sonst in
 *    jeder fremden Instanz (Portal, Mobile-Build) und zeigte auf einen Host, der zu ihr
 *    nicht gehört. Gleiche Regel wie bei `NOSTR_ARTICLE_METRIC_RELAYS`.
 *  · **`basis` kein http(s)** — die Prüfung ist `isSafeExternalUrl` aus `vereinFlow.ts`,
 *    dieselbe Funktion, die auch `window.open`/den In-App-Browser bewacht. Bewusst
 *    keine zweite Formulierung derselben Regel: zwei Fassungen sind kein Fehler,
 *    solange sie übereinstimmen, und ein Fehler in dem Moment, in dem sich eine ändert.
 *  · **`pubkey` keine 32 Byte Hex** — geprüft gegen {@link PUBKEY_HEX}, nicht gegen
 *    einen `catch`. Ein Ereignis mit kaputtem Pubkey käme über den Relay nicht herein,
 *    aber eine Fläche, die deshalb weiß bleibt, wäre der teurere Fehler (Begründung wie
 *    bei `buildArticleAuthor`) — und ein Verweis auf `npub106246s` der teuerste.
 *
 * @param basis  Vollständiges Präfix VOR `/u/…`, inkl. `#` bei einer Hash-Route
 *               (`group.media_public_url`). Abschließende `/` werden abgeschnitten.
 * @param pubkey Hex-Pubkey des Profils.
 * @param nip05Verifiziert Ergebnis von `verifiedNip05` — **nie** ein Profil-Rohwert.
 */
export const medienProfilUrl = (
    basis: string,
    pubkey: string,
    nip05Verifiziert: string,
): string => {
    if (! isSafeExternalUrl(basis) || ! PUBKEY_HEX.test(pubkey)) {
        return ''
    }

    let npub = ''
    try {
        npub = nip19.npubEncode(pubkey)
    } catch {
        // Heute unerreichbar: `PUBKEY_HEX` lässt nur Eingaben durch, die `npubEncode`
        // nachweislich annimmt. Der Zweig bleibt trotzdem stehen — ein Wurf aus einer
        // künftigen `nostr-tools`-Fassung liefe sonst aus einem Alpine-Getter heraus
        // und nähme die ganze Karte mit, statt nur diese eine Zeile ausfallen zu lassen.
        return ''
    }

    const kennung = MEDIEN_NIP05_MUSTER.test(nip05Verifiziert) ? nip05Verifiziert : npub

    return `${basis.replace(/\/+$/, '')}/u/${kennung}`
}
