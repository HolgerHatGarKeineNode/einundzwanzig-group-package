# Die Übersetzungskataloge

Sieben Dateien, eine je Zielsprache. **Deutsch hat bewusst keine** — der deutsche
Quelltext IST der Schlüssel, und was hier fehlt, fällt sichtbar auf ihn zurück.

Gelesen werden sie an zwei Stellen aus derselben Quelle: serverseitig von
Laravels `__()` und im Browser von `t()`/`tPlural()` (`js/i18n.ts`), das den
Katalog der aktiven Sprache aus `window.__nostrI18n` bekommt.

## Zwei Regeln, die maschinell bewacht werden

1. **Kein leerer Wert.** Ein `""` ist die Narbe der alten Fragment-Verkettung
   (`__('In ') . $label . __(' suchen')`) — er lässt Text spurlos verschwinden.
   Bewacht in `tests/Feature/GroupI18nTest.php` und `I18nCatalogGateTest.php`.
2. **Alle sieben tragen dieselben Grundschlüssel.** Ein Schlüssel, der nur in
   sechs Dateien steht, fällt in der siebten still auf Deutsch zurück und sieht
   dabei aus wie eine bloß fehlende Übersetzung.

## Zählformen: die `#`-Sonderformen

Ein Zähler steht nie als Fragment neben seinem Wort, sondern immer in **einem
ganzen Satz** — und zwar in zwei Grundformen, die in **allen sieben** Dateien
stehen:

```json
"1 Raum":        "1 pokój",
":count Räume":  ":count pokoi",
```

Welche der beiden gilt, entscheidet nicht `count === 1`, sondern
`Intl.PluralRules` in der Zielsprache (`js/locale.ts`, `pluralCategory`).
Sprachen mit mehr als zwei Zählformen tragen sie als **Sonderform** unter
`<other-Schlüssel>#<CLDR-Kategorie>` — und zwar **nur diese Sprachen**:

| Sprache | Sonderformen | wofür |
|---|---|---|
| `pl` | `#few` | 2–4, 22–24 … — `many` (0, 5–21, 25 …) deckt bereits die Grundform ab |
| `lv` | `#zero`, `#one` | 0 und 11–19 · 1, 21, 31, 101 … |
| `pt` | `#one` | 0 **und** 1 (CLDR `i = 0..1`) |
| `en` `es` `nl` `hu` | — | trennen genau bei 1, die zwei Grundformen genügen |

**Warum auch `one` eine Sonderform braucht:** der Grundschlüssel schreibt die
Eins aus („1 telpa"). In `lv` fällt aber auch die 21 in `one`, in `pt` die 0 —
ohne `":count Räume#one": ":count telpa"` verschluckte die Zeile ihre Zahl.
Deshalb muss **jede** Sonderform `:count` enthalten; ein Test besteht darauf.

**Fehlt eine Sonderform**, erscheint die passende Grundform — also der Stand von
vorher, nie ein roher Schlüssel und nie ein sichtbares `#few`. Der Rückfall
bricht also nichts; genau deshalb braucht er einen Test statt eines Vertrauens.

Neue Zählstelle im Code? `$plural(n, '1 Raum', ':count Räume')` in Blade bzw.
`tPlural({ one: …, other: … }, n)` in TypeScript — die Tests erheben die Paare
aus dem Code und verlangen die Formen von selbst.

## Offen: drei Stellen brauchen ein Muttersprachler-Auge

Die Zählform-**Mechanik** ist gemessen und getestet. Die folgenden **Wortformen**
sind aus dem vorhandenen Vokabular dieser Kataloge nach Grammatikregel
abgeleitet, nicht von Muttersprachlern gesetzt. Sie sind besser als das vorher
Dagewesene (das für diese Zahlen schlicht falsch war), aber sie sind zu prüfen:

- **`pl` — Kasus nach Präposition.** `":groups w :countries"` mit
  `"1 Land": "1 kraju"` und `":count Ländern": ":count krajach"` (Lokativ). Zu
  prüfen ist, ob der Lokativ dort über alle Zählformen hinweg unverändert bleibt
  — angenommen wurde ja, deshalb ist `":count Ländern#few"` gleichlautend.
- **`lv` — Lokativ und Genitiv Plural.** `"1 Land": "1 valstī"`,
  `":count Ländern#zero": ":count valstīs"`. Für die `#zero`-Form wäre sonst der
  Genitiv Plural zu erwarten; im Lokativ ist das nicht dasselbe. Ebenso zu
  prüfen: die `#zero`-Formen der übrigen Substantive (`telpu`, `atbilžu`,
  `ziņu`, `balsu`, `pavedienu`, `paziņojumu`, `atbalstītāju`, `grupu`).
- **`hu` — Ordinalform des Umfrage-Platzhalters.** `"Option :n": ":n. opció"`
  und `"Option :n verschieben": ":n. opció áthelyezése"`. Der Punkt nach der
  Zahl ist die ungarische Ordinalschreibweise; zu prüfen ist, ob das an dieser
  Stelle (Eingabefeld-Platzhalter, Drag-Handle-Label) die übliche Form ist.

Wer eine dieser Stellen korrigiert, streicht den Punkt hier mit.

## Offen: die 19 Schlüssel von P2 (Navigations-Umbau, 2026-09-18)

Konzept C („Ein Eingang") hat Start, Postfach und Ich gebracht, dazu die
Bereichs-Kacheln. **`en` ist von Hand gesetzt, die sechs übrigen Sprachen sind
maschinell übersetzt** (Entscheid D13 des Plans) und stehen damit unter demselben
Vorbehalt wie die drei Zählformen darüber:

`(öffnet das Portal)` · `Alle Bereiche` · `Alles ansehen` · `Artikel und Meetups
kannst du ohne Anmeldung lesen…` · `Gemerkte Nachrichten und Artikel` ·
`Guthaben, senden und empfangen` · `Ich` · `Konto, Space, Darstellung und Sprache` ·
`Kurse` · `Leute` · `Mit deinem Nostr-Schlüssel gehören dir…` · `Mitgliedschaft und
Beitrag` · `Nichts Neues für dich.` · `Noch nicht angemeldet` · `Postfach` ·
`Start` · `Verein` · `Verschlüsselte Nachrichten öffnen` · `Willkommen bei
EINUNDZWANZIG`

**P3 (Angeheftet, Postfach, Wallet-Zeile)** hat elf weitere hinzugefügt, `de`/`en` von
Hand, die sechs anderen maschinell — ungeprüft:

`:was anheften` · `Anheftung von :was aufheben` · `Angeheftet` · `Direkt` · `Im Menü
einer Nachricht kannst du dich später erinnern lassen.` · `Kein Relay hat deine
Anheftungen bestätigt…` · `Keine Erinnerungen.` · `Noch nicht fällig` · `Raum` ·
`nicht verbunden` · `verbunden`

Auch hier zwei Stellen, die kontextlos kurz sind und deshalb besonderes Misstrauen
verdienen:

- **`:was anheften` / `Anheftung von :was aufheben`** tragen einen Platzhalter, der zur
  Laufzeit ein Objektwort wird (`Raum`, `Artikel`, `Repository`, `Person`). Sprachen mit
  Kasus (hu, lv, pl) brauchen das Wort womöglich in einer anderen Form als die, in der es
  einzeln im Katalog steht — die maschinellen Fassungen setzen den Platzhalter einfach
  ein.
- **`verbunden` / `nicht verbunden`** beschreiben die WALLET (feminin im Deutschen), nicht
  das Gerät. `es`/`pl`/`pt` sind entsprechend femininisiert; ob das in der Zeile trägt, ist
  offen.

**P4 (read-only Portal-Seiten + Portal-Sektionen der Palette)** hat 64 weitere
hinzugefügt, `en` von Hand, die sechs anderen maschinell — ungeprüft. Sie tragen die
Meetup-Liste, die Termine, Kurse/Referenten, die Portal-Status-Zeilen und die vier neuen
Palette-Sektionen.

Drei Stellen verdienen hier besonderes Misstrauen:

- **`Referent`/`Referenten`** ist im Portal die Person, die einen Kurs HÄLT. `en` nimmt
  `Lecturer`; ob `Ponente` · `Oktató` · `Pasniedzējs` · `Docent` · `Prelegent` ·
  `Formador` an einer Listenüberschrift dasselbe leisten wie im Satz, ist offen.
- **`Termin`/`Termine`** heißt hier das DATUM eines Meetups, nicht „Verabredung". `en` nimmt
  deshalb `Date(s)` — in den anderen Sprachen steht die wörtliche Entsprechung, und bei
  `nl` (`Data`) ist die Verwechslung mit „Daten" (Plural von Datum UND von data) möglich.
- **`{0}Noch keine Zusagen|{1}…|[2,*]…`** ist die einzige ZÄHLFORM dieser Runde. `pl`, `lv`
  und `hu` haben andere Pluralregeln als Deutsch; die maschinellen Fassungen bilden nur die
  drei deutschen Fälle nach.
- **`Karte`** ist `lv` zeichengleich zum Deutschen (`Karte` heißt dort wirklich „Karte") —
  das ist kein fehlender Eintrag, sondern ein echtes Homograph.

Zwei Stellen verdienen dabei besonderes Misstrauen, weil sie kurz und damit
kontextlos sind:

- **`Ich`** ist die Beschriftung des Avatars und heißt „meine Sachen", nicht das
  Pronomen in einem Satz. `en` nimmt deshalb `You` und nicht `I`; ob `Yo` · `Én` ·
  `Es` · `Ik` · `Ja` · `Eu` an einem Navigationsziel dasselbe leisten, ist offen.
- **`Space`** bleibt in `Konto, Space, Darstellung und Sprache` unübersetzt — es
  ist der Eigenname des Relays in dieser Oberfläche, so wie in den vorhandenen
  Schlüsseln daneben.

Wer eine Sprache prüft, streicht sie hier heraus.
