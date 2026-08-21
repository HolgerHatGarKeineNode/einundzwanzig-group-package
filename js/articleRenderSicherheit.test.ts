/**
 * **DER KERNBEWEIS VON P3.** Rot heißt: die Phase ist nicht fertig.
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleRenderSicherheit.test.ts
 *
 * > Die Renderer-Ausgabe enthält über den ganzen Formen-Satz **kein einziges Attribut,
 * > das mit `x-`, `@` oder `:` beginnt.**
 *
 * ── Warum genau diese Zusage, und warum jetzt ────────────────────────────────────────
 *
 * `renderArticleHtml` liefert HTML, das `⚡article.blade.php` über Alpines `x-html`
 * bindet. Alpine ruft dabei `initTree()` auf dem eingefügten Teilbaum. Ein Attribut
 * `x-init`, `@click` oder `:href` in dieser HTML wäre deshalb **kein Markup, sondern ein
 * sofort ausgeführter Alpine-Ausdruck** — in einem Dokument, in dem `window.nostr`
 * (NIP-07) erreichbar ist. Der Modulkopf von `longform.ts` warnt seit P7 wörtlich davor.
 *
 * Bis P3 war das unerreichbar: markdown-it schreibt von sich aus keine solchen Attribute,
 * und Autorentext wird escaped. **P3 fasst die Grenze zum ersten Mal an** — die
 * `image`-Regel schreibt jetzt eigene Attribute (`class`, `data-full`). Beide sind inert;
 * dieser Test ist der Beleg dafür, dass sie es sind und bleiben.
 *
 * ── Was hier strukturell und nicht textuell geprüft wird ─────────────────────────────
 *
 * Ein naives `html.includes('x-')` wäre falsch — und zwar in beide Richtungen. Es fände
 * jedes `x-` in einem Fließtext („Ein x-beliebiger Satz") und meldete Alarm, wo keiner
 * ist; und es fände ein `data:image/png;base64,…@…` in einem `src` und meldete Alarm für
 * einen Wert, der nie ein Attributname wird. Umgekehrt könnte es an einem echten
 * Attributnamen vorbeilaufen, der in einer merkwürdigen Schreibweise steht.
 *
 * Deshalb liest {@link attributnamen} die Ausgabe wie ein Parser: nur INNERHALB eines
 * echten Tags, mit Anführungszeichen-Bewusstsein, und gibt die NAMEN zurück. Nur ein Name
 * kann Alpine auslösen.
 *
 * ── Die Negativ-Kontrolle läuft bei JEDEM Lauf mit ───────────────────────────────────
 *
 * Ein Prüfwerkzeug, das seinen Gegenstand nicht mehr findet und dann „bestanden" sagt,
 * ist fail-open — und die Klasse Fehler, gegen die dieser Test geschrieben ist, wäre
 * damit ausgerechnet im Messgerät. `attributnamen` wird deshalb in jedem Lauf gegen ein
 * von Hand geschriebenes Stück HTML gehalten, das die gefährlichen Attribute WIRKLICH
 * trägt. Meldet die Kontrolle sie nicht mehr, ist der Anker kaputt — nicht der Renderer.
 *
 * ── Mutationsprobe (von Hand gefahren, 2026-08-21) ───────────────────────────────────
 *
 * In `longform.ts`, `md.renderer.rules.image`, zusätzlich
 * `token.attrSet('x-init', 'alert(1)')` gesetzt: **rot**, mit
 * `x-init` in der Fehlermeldung. Zweite Fassung mit `':title'`: ebenfalls rot.
 * Beide zurückgebaut, `git diff --stat` leer.
 *
 * **Dritte Probe (2026-08-21), die BLEND-Eingabe:** dieselbe `x-init`-Mutation, geprüft an
 * `![a<br />b](https://h/x.png)` — also mit einem rohen `>` im `alt`-Attribut VOR dem
 * gefährlichen Attribut. Mit der alten Scanner-Fassung blieb der Kernbeweis dabei GRÜN;
 * mit der quote-bewussten ist er rot. Genau diese Probe ist der Beleg, dass die Reparatur
 * misst und nicht bloß kompiliert.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderArticleHtml, ARTICLE_IMAGE_CLASS, ARTICLE_FULL_ATTR } from './longform.ts'
import { ladeBestand } from './fixtures/longformBestand.ts'

/**
 * Alle Attribut-NAMEN, die in echten Tags der Ausgabe stehen.
 *
 * Der Scanner läuft zeichenweise durch die Ausgabe und respektiert Anführungszeichen —
 * **und zwar in BEIDE Richtungen**, das ist der Punkt:
 *
 *  · Ein `="… foo=bar …"` INNERHALB eines Wertes darf nicht als zweites Attribut zählen,
 *    sonst meldete ein base64-Bild oder ein Link mit Query-String Phantome.
 *  · Ein rohes `>` INNERHALB eines Wertes darf das Tag nicht beenden. Die erste Fassung
 *    suchte Tags mit `/<[a-zA-Z][^>]*>/` und tat genau das — und dieses Repo legt rohe
 *    spitze Klammern in Attributwerte ab: der `BR_SENTINEL`-Rücktausch macht aus
 *    `![a<br />b](…)` ein `alt="a<br>b"`. **Gemessen (2026-08-21):**
 *
 *        Scanner alt : ["src","alt"]                          ← blind ab dem `<br>`
 *        Referenz    : ["src","alt","data-full","class"]
 *
 *    Damit blieb der Kernbeweis auch dann grün, wenn die `image`-Regel zusätzlich ein
 *    `x-init` schrieb — es stand hinter dem `<br>`. Über die heutigen zwölf Events ist die
 *    Abweichung 0, die Aussage war also für den eingefrorenen Satz wahr; **robust war sie
 *    nicht**, und der Satz ist zum Neuziehen vorgesehen. Der Fall ist unten sowohl als
 *    Negativ-Kontrolle als auch als Regression festgenagelt.
 *
 * Bewusst KEIN DOM: dieses Modul läuft unter `node --test` ohne Browser, und ein
 * eingeschleppter HTML-Parser wäre eine zweite Wahrheit darüber, was ein Attribut ist.
 */
export const attributnamen = (html: string): string[] => {
    const namen: string[] = []
    let i = 0
    while (i < html.length) {
        // Ein Tag beginnt mit `<` gefolgt von einem Buchstaben; alles andere (`&lt;`, ein
        // Kleiner-als im Fließtext) ist keins. Genau diese Unterscheidung trägt auch der
        // Sanitizer-Nachweis in `longform.test.ts`.
        if (html[i] !== '<' || !/[a-zA-Z]/.test(html[i + 1] ?? '')) {
            i++
            continue
        }
        i++
        while (i < html.length && !/[\s/>]/.test(html[i]!)) {
            i++
        }
        // Bis zum ECHTEN Tag-Ende — eines außerhalb jedes Anführungszeichens.
        while (i < html.length && html[i] !== '>') {
            if (/[\s/]/.test(html[i]!)) {
                i++
                continue
            }
            let name = ''
            while (i < html.length && !/[\s=/>]/.test(html[i]!)) {
                name += html[i]!
                i++
            }
            if (name !== '') {
                namen.push(name)
            }
            while (i < html.length && /\s/.test(html[i]!)) {
                i++
            }
            if (html[i] !== '=') {
                continue
            }
            i++
            while (i < html.length && /\s/.test(html[i]!)) {
                i++
            }
            const quote = html[i]
            if (quote === '"' || quote === "'") {
                i++
                // Der Wert wird IM GANZEN übersprungen — mitsamt allem, was darin nach
                // Markup aussieht. Das ist die Reparatur.
                while (i < html.length && html[i] !== quote) {
                    i++
                }
                i++
            } else {
                // Unquotierter Wert: er endet an Leerraum oder am Tag-Ende (HTML-Regel).
                while (i < html.length && !/[\s>]/.test(html[i]!)) {
                    i++
                }
            }
        }
        i++
    }

    return namen
}

/**
 * Ein Name, den Alpine als Direktive, Ereignis oder Bindung liest.
 *
 * ── Warum `wire:` dazugehört, obwohl es nach Serverkram klingt ───────────────────────
 *
 * `⚡article.blade.php` ist eine Livewire-Full-Page-Komponente, und Livewire hängt sich
 * per `Alpine.interceptInit` in **jede** Element-Initialisierung ein
 * (`vendor/livewire/livewire/dist/livewire.esm.js:13650`) — also auch in den Teilbaum, den
 * Alpines `x-html` gerade eingesetzt hat. Dort mappt es `wire:*` auf `x-on:*` **mit
 * Ausdrucksauswertung** (`:14960`) und `wire:intersect` auf `x-intersect` (`:14833`).
 * **`wire:init` läuft ohne jede Nutzerhandlung.** Ein `wire:`-Attribut in der
 * Renderer-Ausgabe wäre also genauso ein Ausführungspfad wie ein `x-`.
 *
 * ── Warum kleingeschrieben verglichen wird ───────────────────────────────────────────
 *
 * `startsWith` ist zeichengenau, HTML-Attributnamen sind es nicht: der Parser
 * normalisiert `X-INIT` zu `x-init`, im DOM wäre es live. Ein Vergleich ohne
 * `toLowerCase()` ließe genau diese Schreibweise durch — und der Scanner liest den
 * ROHEN String, nicht das DOM, also muss er die Normalisierung selbst tun.
 */
const istAlpineTraeger = (name: string): boolean => {
    const klein = name.toLowerCase()

    return klein.startsWith('x-') || klein.startsWith('wire:') || klein.startsWith('@') || klein.startsWith(':')
}

// ── Negativ-Kontrolle: misst der Anker überhaupt noch? ───────────────────────────────

test('NEGATIV-KONTROLLE: der Scanner findet Alpine-Traeger, wenn welche da sind', () => {
    // Von Hand geschrieben, absichtlich gefährlich, NIE durch den Renderer gelaufen.
    const boesartig =
        '<p>Text</p><img src="a.png" x-init="alert(1)" alt="x"><a @click="fetch(1)" :href="u">k</a><div x-on:click="x">d</div>'
    const traeger = attributnamen(boesartig).filter(istAlpineTraeger)
    assert.deepEqual([...traeger].sort(), ['@click', ':href', 'x-init', 'x-on:click'].sort())
    assert.equal(traeger.includes('x-init'), true, 'Der Scanner sieht `x-init` nicht mehr.')
    assert.equal(traeger.includes('@click'), true, 'Der Scanner sieht `@click` nicht mehr.')
    assert.equal(traeger.includes(':href'), true, 'Der Scanner sieht `:href` nicht mehr.')
    assert.equal(traeger.includes('x-on:click'), true, 'Der Scanner sieht `x-on:click` nicht mehr.')
})

test('NEGATIV-KONTROLLE: ein rohes `>` im Attributwert blendet den Scanner NICHT', () => {
    // **Die Kontrolle, die der ersten Fassung gefehlt hat.** Ihr Handschrift-HTML trug
    // kein `<br>` in einem Attributwert — genau deshalb fiel nicht auf, dass der Scanner
    // ab dem ersten `>` innerhalb eines Wertes blind war. Das gefährliche Attribut steht
    // hier ABSICHTLICH DAHINTER: davor stehend fände es auch die kaputte Fassung.
    const boesartig = '<img src="a.png" alt="a<br>b" x-init="alert(1)" data-full="x"><p title="1 > 0" @click="alert(2)">t</p>'
    const namen = attributnamen(boesartig)
    assert.deepEqual(namen, ['src', 'alt', 'x-init', 'data-full', 'title', '@click'])
    assert.deepEqual(namen.filter(istAlpineTraeger).sort(), ['@click', 'x-init'])
})

test('NEGATIV-KONTROLLE: `wire:` und GROSSSCHREIBUNG zaehlen ebenfalls als Traeger', () => {
    // `wire:init` läuft ohne Nutzerhandlung (Begründung samt Fundstelle bei
    // `istAlpineTraeger`), und der HTML-Parser macht aus `X-INIT` ein `x-init`.
    const boesartig = '<div wire:init="x" WIRE:CLICK="y" X-INIT="z" X-ON:CLICK="q">d</div>'
    assert.deepEqual(
        attributnamen(boesartig).filter(istAlpineTraeger).sort(),
        ['WIRE:CLICK', 'X-INIT', 'X-ON:CLICK', 'wire:init'].sort(),
    )
})

test('NEGATIV-KONTROLLE: der Scanner faellt NICHT auf Attributnamen in Werten herein', () => {
    // `src` trägt einen Query-String und eine data-URI mit `@`, `:` und `=` — nichts davon
    // ist ein Attributname. Ein Scanner, der hier Alarm schlägt, machte den Kernbeweis
    // unbrauchbar (Falsch-Positiv), lange bevor er einen echten Fund hätte.
    const harmlos =
        '<img src="https://h/p.png?a=1&amp;x-y=2&amp;@z=3" alt="ein x-beliebiger :test @wert"><img src="data:image/png;base64,AA@BB:CC=">'
    assert.deepEqual(attributnamen(harmlos).filter(istAlpineTraeger), [])
    assert.deepEqual([...new Set(attributnamen(harmlos))], ['img', 'src', 'alt'].slice(1))
})

// ── DER KERNBEWEIS ──────────────────────────────────────────────────────────────────

const bestand = ladeBestand()

test('KERNBEWEIS P3: ueber den GANZEN Formen-Satz traegt die Ausgabe kein x-/@/:-Attribut', () => {
    // Die Schranke zuerst: ein leerer Satz bestünde diesen Test sonst mühelos.
    assert.equal(bestand.events.length, 13, 'Der Formen-Satz hat nicht mehr dreizehn Einträge.')
    // Und die Lage, an der diese Sonde blind WAR, muss im Satz wirklich vorkommen —
    // sonst prüft der Kernbeweis sie nicht, egal wie viele Einträge er zählt.
    assert.equal(
        bestand.events.some((event) => /!\[[^\]]*<br\s*\/?>/i.test(event.content)),
        true,
        'Kein Event mit <br> im Bild-Alt — die Blend-Lage ist aus dem Satz verschwunden.',
    )

    const funde: string[] = []
    for (const event of bestand.events) {
        // MIT Proxy gerendert — das ist der Produktivpfad (`longformFeed.ts`,
        // `renderCached`) und der einzige, in dem die neue `image`-Regel überhaupt
        // Attribute schreibt. Ein Lauf ohne Proxy prüfte den alten Zustand.
        const html = renderArticleHtml(event.content, (url) => `/img/full?src=${encodeURIComponent(url)}`)
        for (const name of attributnamen(html)) {
            if (istAlpineTraeger(name)) {
                funde.push(`${event.id.slice(0, 12)}: ${name}`)
            }
        }
    }
    assert.deepEqual(funde, [], `Alpine-Träger in der Renderer-Ausgabe: ${funde.join(' · ')}`)
})

test('KERNBEWEIS P3: auch gezielte Angriffsformen erzeugen kein x-/@/:-Attribut', () => {
    // Der Formen-Satz deckt den BESTAND ab, nicht die Absicht. Diese Eingaben versuchen,
    // einen Alpine-Träger durch den Renderer zu bekommen — über rohes HTML, über einen
    // Bild-Alt-Text, über eine URL und über die Sprachklasse eines Code-Zauns.
    const vektoren = [
        '<div x-init="alert(1)">a</div>',
        '<img src=x @click="alert(1)">',
        '![:href="alert(1)"](https://h/b.png)',
        '![b](https://h/b.png" x-init="alert(1))',
        '[k](https://h/s?x-init=alert%281%29)',
        '```x-init="alert(1)"\ncode\n```',
        '# x-init="alert(1)"',
        // Die BLEND-Form: ein rohes `<br>` im Alt-Text schiebt alles Folgende hinter ein
        // `>` innerhalb eines Attributwerts. Sie steht hier, damit der Vektorsatz die
        // Lage abdeckt, an der der Scanner blind war.
        '![a<br />b](https://h/x.png)',
        '<div wire:init="alert(1)">a</div>',
        '| x-init="a" | @click="b" |\n|---|---|\n| :href="c" | d |',
    ]
    for (const content of vektoren) {
        const html = renderArticleHtml(content, (url) => `/img/full?src=${encodeURIComponent(url)}`)
        const traeger = attributnamen(html).filter(istAlpineTraeger)
        assert.deepEqual(traeger, [], `Vektor ${JSON.stringify(content)} erzeugte: ${traeger.join(', ')} — ${html}`)
    }
})

// ── Die beiden neuen Attribute sind da, und sie sind die einzigen neuen ──────────────

test('die image-Regel schreibt genau `class` und `data-full` dazu — nicht mehr', () => {
    const html = renderArticleHtml('![Alt](https://h/b.png)', (url) => `/img/full?src=${encodeURIComponent(url)}`)
    // Reihenfolge inklusive: `src` und `alt` bringt markdown-it mit, die beiden neuen
    // hängen hinten dran. Ein fünftes Attribut fiele hier auf, egal wie harmlos es aussieht.
    assert.deepEqual(attributnamen(html), ['src', 'alt', 'data-full', 'class'])
    assert.match(html, /class="article-image"/)
    assert.match(html, /data-full="\/img\/full\?src=https%3A%2F%2Fh%2Fb\.png"/)
})

test('REGRESSION: ein `<br>` im ALT-TEXT verdeckt die neuen Attribute nicht mehr', () => {
    // Der Riegel unter der Reparatur von 2026-08-21, mit der Eingabe, die den Fund
    // ausgelöst hat. `renderArticleHtml` legt hier ein rohes `<br>` MITTEN IN das
    // `alt`-Attribut (der `BR_SENTINEL`-Rücktausch) — die beiden neuen Attribute stehen
    // dahinter. Die alte Fassung sah sie nicht und war trotzdem grün.
    const html = renderArticleHtml('![a<br />b](https://h/x.png)', (url) => `/img/full?src=${encodeURIComponent(url)}`)
    assert.match(html, /alt="a<br>b"/, 'Die Eingabe erzeugt kein rohes <br> im Attributwert mehr — dann misst dieser Test nichts.')
    assert.deepEqual(attributnamen(html), ['src', 'alt', 'data-full', 'class'])
})

test('ARTICLE_IMAGE_CLASS und ARTICLE_FULL_ATTR stehen WOERTLICH fest', () => {
    // Literale, kein Symbolvergleich: der Auslöser in `⚡article.blade.php` und der
    // Hydrator (`blossomHydrate.ts`) kennen beide Zeichenketten, und keiner von beiden
    // importiert diese Konstanten. Wer sie hier ändert, muss dort mitziehen — und das
    // fällt nur auf, wenn der Wert festgenagelt ist.
    assert.equal(ARTICLE_IMAGE_CLASS, 'article-image')
    assert.equal(ARTICLE_FULL_ATTR, 'data-full')
})

test('ohne Proxy entsteht KEIN anklickbares Bild — keine Lightbox auf eine ungepruefte URL', () => {
    // `proxify` fehlt nur dort, wo niemand über die Ziel-URL geurteilt hat (Pure-Tests,
    // künftige Aufrufer). Dann bekommt das Bild weder Klasse noch `data-full`: die
    // Lightbox zeigt nichts, statt eine ungeprüfte Fremd-URL groß zu öffnen.
    const html = renderArticleHtml('![Alt](https://fremd.example/b.png)')
    assert.equal(html.includes(ARTICLE_IMAGE_CLASS), false)
    assert.equal(html.includes(ARTICLE_FULL_ATTR), false)
})

test('F4: eine LEERE Bild-URL erzeugt kein `src=""` — und sieht auch nicht anklickbar aus', () => {
    // `![]()` ist gültiges Markdown. Bis zur Sicherheitsfreigabe zu P3 entstand daraus
    // `<img src="" alt="" data-full="" class="article-image">` — ein `src=""`, obwohl
    // dieselbe Datei 20 Zeilen tiefer begründet, warum das zu vermeiden ist (Browser, die
    // es gegen die Dokument-Adresse auflösen und die Seite selbst nachladen). Neu an P3
    // war nur, dass so ein Bild zusätzlich anklickbar AUSSAH.
    const html = renderArticleHtml('![]()', (url) => `/img/full?src=${encodeURIComponent(url)}`)
    assert.equal(/\ssrc=/.test(html), false, `Es entsteht wieder ein src: ${html}`)
    assert.equal(html.includes(ARTICLE_FULL_ATTR), false, `Lightbox-Attribut ohne Quelle: ${html}`)
    assert.equal(html.includes(ARTICLE_IMAGE_CLASS), false, `Zoom-Cursor ohne Ziel: ${html}`)
    // Der Alternativtext des Autors überlebt — die Werksregel bleibt zuständig.
    assert.match(html, /<img alt=""/)
})

test('F4-Gegenprobe: eine NICHT leere URL bleibt vollstaendig ausgestattet', () => {
    // Die Schranke unter dem Test darüber: ein `original !== ''`, das versehentlich
    // ALLE Bilder in den Leer-Zweig schickte, wäre dort grün und hier rot.
    const html = renderArticleHtml('![Alt](https://h/b.png)', (url) => `/img/full?src=${encodeURIComponent(url)}`)
    assert.deepEqual(attributnamen(html), ['src', 'alt', 'data-full', 'class'])
})
