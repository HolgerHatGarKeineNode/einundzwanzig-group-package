/**
 * Die REINE Logik der Artikel-Vollansicht (P3) — Lesefortschritt und Teilen.
 *
 * Wie `longform.ts` ohne welshman, ohne DOM und ohne Uhr: alles hier ist Arithmetik über
 * Zahlen und Zeichenketten, die der Aufrufer misst. Das ist kein Selbstzweck — beide
 * Funktionen haben genau einen gefährlichen Zustand, und der lässt sich nur so
 * festnageln:
 *
 *  · **Der Lesefortschritt teilt.** Ein Artikel, der kürzer ist als das Fenster, hat eine
 *    Bezugsgröße von 0 oder eine, die kleiner ist als die Strecke — beides erzeugt
 *    `NaN` oder `Infinity`, und ein `NaN` in `style="width: NaN%"` ist kein Absturz,
 *    sondern eine Leiste, die einfach nichts tut. **Bei 57 von 104 Artikeln ohne jede
 *    Überschrift ist das nicht der Rand, sondern der Normalfall.**
 *  · **Teilen braucht eine Adresse, die es nicht immer gibt.** Ein Artikel ohne `d`-Tag
 *    hat keinen `naddr` und damit keinen Link. Die Fläche muss das TRAGEN, nicht abfangen.
 */

/**
 * Was der Aufrufer am DOM misst — alles in CSS-Pixeln.
 *
 * `top` ist `getBoundingClientRect().top` des Artikeltextes: positiv, solange der Text
 * noch unter der Fensterkante beginnt, negativ, sobald man in ihn hineingescrollt ist.
 */
export type Lesemessung = {
    /** Oberkante des Artikeltextes relativ zur Fensterkante. */
    top: number
    /** Höhe des Artikeltextes. */
    height: number
    /** Sichtbare Höhe des Fensters bzw. des scrollenden Behälters. */
    viewport: number
}

export type Lesestand = {
    /**
     * Gibt es überhaupt etwas zu verfolgen?
     *
     * `false`, wenn der Artikel vollständig ins Fenster passt — dann ist er in dem
     * Moment gelesen, in dem er erscheint, und eine Leiste, die dauerhaft auf 100 % steht,
     * ist kein Fortschritt, sondern Dekor. `false` auch bei jeder unbrauchbaren Messung
     * (Höhe 0, weil der Text noch nicht da ist; NaN, weil noch nichts gelayoutet wurde).
     */
    verfolgbar: boolean
    /** 0–100, ganzzahlig. **Nie `NaN`, nie negativ, nie über 100.** */
    prozent: number
}

/** Eine Zahl, mit der man rechnen darf. `NaN`, `Infinity` und Fremdtypen fallen durch. */
const istBrauchbar = (wert: number): boolean => typeof wert === 'number' && Number.isFinite(wert)

/**
 * Wie weit ist der Leser im Artikel?
 *
 * Gemessen wird am **unteren** Fensterrand: gelesen ist, was ihn passiert hat. Der
 * Fortschritt steht deshalb auf 100 %, sobald die letzte Zeile sichtbar wird — und nicht
 * erst, wenn sie oben aus dem Bild wandert (was für die letzte Bildschirmhöhe eines jeden
 * Artikels nie passiert).
 *
 * **Der Kurzartikel ist der Normalfall, nicht der Rand.** Passt der Text ganz ins
 * Fenster, gibt es keine Strecke — dann meldet die Funktion `verfolgbar: false` und
 * `prozent: 0`, und die Fläche zeigt gar keine Leiste. Das ist die einzige ehrliche
 * Antwort: „100 %" wäre richtig, sähe aber aus wie ein Fehler, und „0 %" wäre falsch.
 */
export const leseFortschritt = ({ top, height, viewport }: Lesemessung): Lesestand => {
    if (!istBrauchbar(top) || !istBrauchbar(height) || !istBrauchbar(viewport)) {
        return { verfolgbar: false, prozent: 0 }
    }
    // Die Strecke, über die überhaupt gescrollt werden kann. `<= 0` deckt beides ab: den
    // leeren Text (Höhe 0, noch nicht gerendert) und den kurzen (passt ins Fenster).
    // **Hier wird die Division abgefangen, nicht hinterher der `NaN` weggerechnet** —
    // ein `Number.isNaN(x) ? 0 : x` am Ende hätte dieselbe Zahl geliefert und dabei
    // verschwiegen, dass es zwei verschiedene Zustände sind.
    const strecke = height - viewport
    if (strecke <= 0) {
        return { verfolgbar: false, prozent: 0 }
    }

    // `-top` ist die bereits nach oben herausgescrollte Strecke.
    const gelesen = -top

    return { verfolgbar: true, prozent: Math.min(100, Math.max(0, Math.round((gelesen / strecke) * 100))) }
}

/**
 * Wie viele Minuten bleiben — die Angabe, nach der ein Leser tatsächlich fragt.
 *
 * Nicht „38 % gelesen", sondern „noch 4 Min": die erste Zahl muss man erst in die zweite
 * umrechnen, um etwas mit ihr anzufangen. Aufgerundet, damit die Angabe nie zu optimistisch
 * ist; `0` erscheint ausschließlich am Ende und ist dann auch wahr.
 *
 * `gesamtMinuten === 0` heißt **keine Angabe** (so wie in `ArticleRow.readingMinutes`) und
 * bleibt 0 — die Fläche lässt die Zeile dann weg, statt „noch 0 Min" zu behaupten.
 */
export const restMinuten = (gesamtMinuten: number, prozent: number): number => {
    if (!istBrauchbar(gesamtMinuten) || !istBrauchbar(prozent) || gesamtMinuten <= 0) {
        return 0
    }
    const anteil = Math.min(1, Math.max(0, prozent / 100))

    return Math.ceil(gesamtMinuten * (1 - anteil))
}

/** Wohin ein Teilen-Knopf zeigt — oder dass es nirgendwohin zeigt. */
export type TeilZiel = {
    /**
     * Gibt es einen Link? `false` genau dann, wenn dem Artikel das `d`-Tag fehlt.
     *
     * Die Fläche macht daraus einen **sichtbar inerten** Knopf mit Grund, keinen
     * versteckten und keinen still grauen: ein Knopf, der ohne Erklärung verschwindet,
     * lässt den Nutzer nach ihm suchen.
     */
    teilbar: boolean
    /** Die vollständige, teilbare Adresse — `''`, wenn es keine gibt. */
    url: string
    /** Der Titel, wie ihn `navigator.share` bekommt. */
    titel: string
}

/**
 * Die teilbare Adresse eines Artikels.
 *
 * `basis` ist die **absolute** Adresse der Artikelliste (`route('group.articles')`,
 * dieselbe Quelle, aus der die Liste ihre `href`s baut). Sie kommt herein statt hier
 * gebaut zu werden: eine zweite Stelle, die den Routenpfad kennt, liefe beim nächsten
 * Routen-Umbau still auseinander.
 *
 * Geteilt wird der **kanonische** `naddr` aus dem Event (mit Relay-Hinweisen), nicht die
 * Adresszeile des Browsers. Beide zeigen auf denselben Artikel, aber nur der kanonische
 * sagt einem fremden Client auch, WO er ihn findet.
 */
export const artikelTeilZiel = (basis: string, naddr: string, titel: string): TeilZiel => {
    const stamm = String(basis ?? '').replace(/\/+$/, '')
    if (!naddr || !stamm) {
        return { teilbar: false, url: '', titel: titel ?? '' }
    }

    return { teilbar: true, url: `${stamm}/${naddr}`, titel: titel ?? '' }
}

/**
 * Welche der drei Formen der Lesestand gerade annimmt.
 *
 * `gesamt` = „14 Min Lesezeit" · `rest` = „noch 8 Min" · `ende` = „Ende erreicht".
 */
export type Lesestandform = 'gesamt' | 'rest' | 'ende'

/**
 * Die Form des Lesestands — **drei Zustände, und der dritte ist der Grund für diese
 * Funktion.**
 *
 * Am laufenden Client gemessen (2026-08-21, 14-Minuten-Artikel, 1440×900): bei 100 %
 * stand dort „noch 0 Min". Die Zahl war richtig — die letzte Zeile ist sichtbar, es
 * bleibt nichts —, aber sie LAS sich wie ein Fehler. Eine Angabe, die stimmt und trotzdem
 * nach Defekt aussieht, ist eine schlechte Angabe.
 *
 * `ende` sagt deshalb etwas über die POSITION, nicht über den Leser: „Ende erreicht" ist
 * nachprüfbar wahr, „fertig gelesen" wäre eine Behauptung über jemanden, der vielleicht
 * nur schnell nach unten gesprungen ist.
 */
export const lesestandForm = (verfolgbar: boolean, prozent: number, gesamtMinuten: number): Lesestandform => {
    if (!verfolgbar || !istBrauchbar(prozent) || prozent <= 0) {
        return 'gesamt'
    }
    if (prozent >= 100) {
        return 'ende'
    }

    return gesamtMinuten > 0 ? 'rest' : 'gesamt'
}
