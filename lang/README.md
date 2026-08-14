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
