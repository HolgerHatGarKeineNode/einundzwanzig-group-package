/**
 * **Der Riegel zwischen dem reinen Modul, den zwei Inseln und den zwei Flächen.**
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/medienProfilMarkup.test.ts
 *
 * `medienProfil.test.ts` beweist, dass die Adressbildung stimmt. Er beweist NICHT, dass
 * die Flächen sie benutzen — und genau dort liegen die drei Zusagen, die still
 * auseinanderlaufen können:
 *
 *  1. **Die Sicherheitsregel steht an der Aufrufstelle, nicht nur im Modul.** Baut eine
 *     Insel die Adresse künftig selbst zusammen oder reicht sie ein Profil-`nip05` roh
 *     durch, bleibt der reine Test grün — er prüft dann eine Funktion, die niemand mehr
 *     ruft. Dieselbe Klasse wie die zweite Mutation in `articleAuthorMarkup.test.ts`.
 *  2. **Beide Flächen sind echte Anker nach außen.** `target="_blank"` allein verpufft in
 *     der nativen WebView wirkungslos — im Haus dreimal beschrieben, zuletzt bei
 *     `openChatLink`. Ohne `$extern` wäre der Verweis auf dem Gerät ein toter Klick, und
 *     zwar nur dort.
 *  3. **Ohne Ziel gibt es kein `href`.** `:href="medienUrl() || null"` — ein `<a>` ohne
 *     `href` ist kein Tabstopp. Ein leerer String stattdessen erzeugte einen fokussierbaren
 *     Link auf die aktuelle Seite.
 *
 * **Warum als Quelltext-Sonde und nicht als Import:** `bridge.ts` ist die Insel selbst
 * (Alpine, welshman-Stores, `localStorage` beim Boot) und unter `node --test` nicht
 * ladbar; Blade ist ohnehin kein JavaScript. Bauform wie `articleAuthorMarkup.test.ts`:
 * **findet eine Sonde ihren Gegenstand nicht, WIRFT sie.** Eine Sonde, die bei unlesbarer
 * Eingabe „nichts gefunden" meldet, ist fail-open und sähe nach dem nächsten Umbau wie
 * ein bestandener Test aus.
 *
 * ── Mutationsproben (von Hand gefahren, 2026-08-21, jede bytegenau zurückgebaut) ────
 *
 * | Mutation                                                                | gemessen        |
 * |---------------------------------------------------------------------------|-----------------|
 * | `bridge.ts`: `medienProfilUrl(...)` in `nostrProfileCard` → Handbau `${…}/u/${…}` | **rot**, 2 Fälle |
 * | `bridge.ts`: `this.nip05` → `this.lud16` in `nostrProfileCard.medienUrl`   | **rot**, 1 Fall |
 * | `bridge.ts`: `Alpine.magic('extern'` → `'externx'`                         | **rot**, 1 Fall |
 * | `bridge.ts`: `isSafeExternalUrl(url)` aus dem `$extern`-Magic gestrichen    | **rot**, 1 Fall |
 * | `bridge.ts`: `medienBasis()` liest `__nostrMediaX` statt `__nostrMedia`     | **rot**, 1 Fall |
 * | `medienProfil.ts`: eigene `new URL(...)`-Prüfung statt `isSafeExternalUrl`  | **rot**, 1 Fall |
 * | Blade (Karte): `|| null` aus `:href` gestrichen                            | **rot**, 1 Fall |
 * | Blade (Karte): `x-cloak` gestrichen                                        | **rot**, 1 Fall |
 * | Blade (Karte): `font-mono` an der Zeile ergänzt                            | **rot**, 1 Fall |
 * | Blade (Karte): `$medienHost` → Host als Literal                            | **rot**, 1 Fall |
 * | Blade (Autor): `rel="noopener noreferrer"` → `rel="noopener"`               | **rot**, 1 Fall |
 * | Blade (Autor): `x-on:click="$extern(...)"` gestrichen                      | **rot**, 1 Fall |
 *
 * **Zwei dieser Proben waren beim ersten Anlauf grün, und beide Male lag es am
 * Mutationswerkzeug, nicht am Test** — festgehalten, weil der Fehler beim nächsten Mal
 * genauso naheliegt: (a) der Kommentar über der Zeile ZITIERT `:href="medienUrl() || null"`,
 * also traf die erste Ersetzung den Kommentar statt des Ankers; (b) `rel="noopener noreferrer"`
 * steht im Autoren-Blade zweimal, die Website-Zeile kommt zuerst. Beide Anker sind seitdem
 * mit ihrem Kontext eindeutig gefasst. Eine Mutation, die den Gegenstand gar nicht trifft,
 * misst dieselbe Null wie ein blinder Test.
 *
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const JS = import.meta.dirname
const VIEWS = join(JS, '..', 'resources', 'views')
const INSEL = join(JS, 'bridge.ts')
const REIN = join(JS, 'medienProfil.ts')
const FEED = join(JS, 'longformFeed.ts')
const KARTE = join(VIEWS, 'components', 'profile-card.blade.php')
const AUTORSEITE = join(VIEWS, '⚡article-author.blade.php')

/** Quelltext, **werfend** bei fehlender oder leerer Datei. */
const lies = (pfad: string): string => {
    const roh = readFileSync(pfad, 'utf8')
    if (roh.trim() === '') {
        throw new Error(`${pfad} ist leer — die Sonde misst nichts mehr.`)
    }

    return roh
}

/**
 * Rumpf einer Methode innerhalb einer benannten `Alpine.data`-Insel — **werfend**.
 *
 * Gesucht wird über den Namen der Insel und dann über den Methodennamen; findet die
 * Sonde eines von beidem nicht, ist der Gegenstand weg und der Test muss rot werden,
 * nicht grün. Die Einrücktiefe unterscheidet sich zwischen den beiden Inseln
 * (`nostrProfileCard` liegt eine Ebene höher als `nostrArticleAuthor`), deshalb kommt
 * sie als Parameter herein statt als Konstante.
 */
const inselMethode = (insel: string, name: string, tiefe: number): string => {
    const quelle = lies(INSEL)
    const ab0 = quelle.indexOf(`Alpine.data('${insel}'`)
    if (ab0 < 0) {
        throw new Error(`${insel} steht nicht mehr in bridge.ts — die Sonde misst nichts mehr.`)
    }
    const einzug = ' '.repeat(tiefe)
    const ab = quelle.indexOf(`\n${einzug}${name}(`, ab0)
    if (ab < 0) {
        throw new Error(`${name}() steht nicht mehr in ${insel} — die Sonde misst nichts mehr.`)
    }
    const bis = quelle.indexOf(`\n${einzug}},`, ab)
    if (bis < 0) {
        throw new Error(`Kein Ende von ${name}() in ${insel} — die Sonde misst nichts mehr.`)
    }

    return quelle.slice(ab, bis)
}

/**
 * Das `<a data-medien-profil="…">`-Element einer Blade-Datei — **werfend**.
 *
 * **Der Anker trägt einen WERT je Fläche**, und der ist kein Zierrat: die Autorenseite
 * rendert über `app-frame` auch die Profilkarte mit. Ein wertloses `data-medien-profil`
 * stand damit zweimal im selben Dokument, und die serverseitige Prüfung der Autorenseite
 * konnte die eigene Zeile nicht von der fremden unterscheiden — in der Mutationsprobe am
 * 2026-08-21 blieb „Attribut umbenannt" deshalb GRÜN. Gefunden hat es die Probe, nicht
 * das Lesen.
 *
 * Gesucht wird mit dem vollständigen Attribut inklusive Wert; ein `indexOf` auf den
 * bloßen Namen fände auch `data-medien-profilx` und meldete „gefunden", während der
 * Gegenstand weg ist (dieselbe fail-open-Klasse wie in P4 bei `data-autor-karte`).
 */
const verweisZeile = (pfad: string, wert: string): string => {
    const quelle = lies(pfad)
    const attribut = `data-medien-profil="${wert}"`
    const treffer = quelle.indexOf(attribut)
    if (treffer < 0) {
        throw new Error(`${attribut} steht nicht mehr in ${pfad} — die Sonde misst nichts mehr.`)
    }
    const ab = quelle.lastIndexOf('<a ', treffer)
    if (ab < 0) {
        throw new Error(`${attribut} hängt in ${pfad} an keinem <a> mehr — der Verweis ist kein Link.`)
    }
    const bis = quelle.indexOf('</a>', ab)
    if (bis < 0) {
        throw new Error(`Kein Ende des Verweis-Ankers in ${pfad} — die Sonde misst nichts mehr.`)
    }

    return quelle.slice(ab, bis)
}

/** Fläche → [Anzeigename, Blade-Datei, Wert des Ankers]. */
const FLAECHEN: Array<[string, string, string]> = [
    ['Profilkarte', KARTE, 'karte'],
    ['Autorenseite', AUTORSEITE, 'autor'],
]

// ── 1. Die Adresse kommt aus dem geprüften Modul, nicht aus Handarbeit ───────────

test('BEIDE Inseln bauen die Adresse über medienProfilUrl(medienBasis(), …)', () => {
    // Der Kernbeweis dieser Phase an seiner produktiven Stelle. Baute eine Insel die
    // Adresse selbst zusammen, gäbe es über „wie sieht ein media.-Profillink aus" zwei
    // Wahrheiten — und nur eine davon hat Tests.
    for (const [insel, tiefe] of [['nostrProfileCard', 8], ['nostrArticleAuthor', 12]] as Array<[string, number]>) {
        const rumpf = inselMethode(insel, 'medienUrl', tiefe)
        assert.match(
            rumpf,
            /medienProfilUrl\(medienBasis\(\), /,
            `${insel}.medienUrl() baut die Adresse nicht über medienProfilUrl(medienBasis(), …).`,
        )
        assert.equal(
            /\/u\//.test(rumpf),
            false,
            `${insel}.medienUrl() setzt den Pfad selbst zusammen — dann gibt es zwei Wahrheiten über die Adressform.`,
        )
    }
})

test('Die Basis kommt aus __nostrMedia — dem Wert, den beide head-Partials schreiben', () => {
    const quelle = lies(INSEL)
    // Der Variablenname als LITERAL: eine Umbenennung auf einer der beiden Seiten ergibt
    // dauerhaft `undefined` statt eines Fehlers — also dauerhaft keinen Verweis.
    assert.match(
        quelle,
        /const medienBasis = \(\): string => \(globalThis as \{ __nostrMedia\?: string \}\)\.__nostrMedia \?\? ''/,
        'medienBasis() liest nicht mehr globalThis.__nostrMedia — der Server reicht die Basis dorthin.',
    )
})

// ── 2. Die Sicherheitsregel an der Aufrufstelle ─────────────────────────────────

test('Die Profilkarte reicht den VERIFIZIERTEN Handle weiter, kein Profil-Rohfeld', () => {
    // `this.nip05` wird in `open()` ausschließlich aus der Handle-Sammlung gefüllt
    // (`app.use(Handles).forPubkey`), und die liefert den Handle nur bei Übereinstimmung
    // mit dieser Pubkey (welshman `handles.js:82`). Ein Profil-`nip05` ist dagegen eine
    // Selbstauskunft: jeder kann `satoshi@einundzwanzig.space` in sein kind 0 schreiben.
    //
    // Das Muster nennt den 0.9.5-Zugriffspfad, seit die welshman-Fassade steht; die
    // Zusage selbst ist unverändert.
    //
    // **`.forPubkey(pk).$` und nicht mehr `.forPubkey(pk)`:** mit dem Sprung auf 0.9.5
    // gibt `Handles.forPubkey` eine `Projection` zurück (`{get, $}`) statt eines nackten
    // Stores — der Store ist ihr `$`. Reine Formänderung an derselben Quelle.
    const rumpf = inselMethode('nostrProfileCard', 'medienUrl', 8)
    assert.match(rumpf, /this\.pubkey, this\.nip05/, 'Die Karte reicht ein anderes Feld als this.nip05 in die Adresse.')

    const open = inselMethode('nostrProfileCard', 'open', 8)
    assert.match(
        open,
        /app\.use\(Handles\)\.forPubkey\(pk\)\.\$\.subscribe\(\(handle\) => \{\s*this\.nip05 = handle \? app\.use\(Handles\)\.display\(handle\.nip05\) : ''/,
        'this.nip05 kommt nicht mehr aus der verifizierten Handle-Sammlung — die Verifikation hängt daran.',
    )
    // Und NICHT aus dem Profil-Store daneben: `deriveMergedProfile` füllt in derselben
    // Methode name/picture/banner/about/website/lud16 — `nip05` darf dort nie auftauchen.
    const ausProfil = /this\.nip05 = p\?\./.test(open)
    assert.equal(ausProfil, false, 'this.nip05 wird aus dem kind-0-Rohprofil gesetzt — das ist eine Selbstauskunft.')
})

test('Die Autorenseite reicht autor.nip05 weiter — und das kommt aus verifiedNip05', () => {
    const rumpf = inselMethode('nostrArticleAuthor', 'medienUrl', 12)
    assert.match(rumpf, /autor\.pubkey, autor\.nip05/, 'Die Autorenseite reicht ein anderes Feld weiter.')
    assert.match(rumpf, /autor \? medienProfilUrl/, 'Ohne aufgelösten Autor muss medienUrl() leer bleiben.')
    // Die Typ-Bindung ist hier LASTTRAGEND und nicht kosmetisch: der Herkunfts-Riegel
    // `zapTargetSources.test.ts` liest genau diese Zeile, um die Quelle des `nip05` zu
    // klassifizieren (Produzent `autor-modell`). Fällt sie weg, wird der Zugriff dort
    // „unbekannt" — was richtigerweise rot macht, aber erst im anderen Test und ohne
    // Hinweis, warum die Zeile je so aussah.
    assert.match(
        rumpf,
        /const autor = this\.autor satisfies AuthorView\['autor'\] \| null/,
        'Die Typ-Bindung der Autoren-Quelle ist weg — der Herkunfts-Riegel kann das nip05 nicht mehr zuordnen.',
    )

    // Der Hop dahinter: `autor` entsteht in `deriveAuthorPage` über `buildArticleAuthor`,
    // und dessen `nip05` MUSS aus `verifiedNip05(…)` kommen. Dieselbe Zusage bewacht
    // `zapTargetSources.test.ts` für die Zap-Felder; hier hängt die Adresse eines
    // Verweises daran, der eine Empfehlung ausspricht.
    const feed = lies(FEED)
    const treffer = feed.match(/nip05: verifiedNip05\(/g) ?? []
    assert.equal(
        treffer.length,
        2,
        'longformFeed.ts baut nicht mehr genau zwei Autorenkarten über verifiedNip05( — eine davon trägt jetzt einen Rohwert.',
    )
})

test('Das reine Modul benutzt die HAUS-Prüfung für externe Adressen, keine eigene', () => {
    // Zwei Formulierungen derselben Regel sind kein Fehler, solange sie übereinstimmen —
    // und ein Fehler in dem Moment, in dem sich eine ändert.
    const rein = lies(REIN)
    assert.match(rein, /import \{ isSafeExternalUrl \} from '\.\/vereinFlow\.ts'/)
    assert.match(rein, /if \(! isSafeExternalUrl\(basis\) \|\| ! PUBKEY_HEX\.test\(pubkey\)\)/)
    assert.equal(
        /new URL\(/.test(rein),
        false,
        'medienProfil.ts prüft die Basis selbst — dann steht die Schema-Regel zweimal im Baum.',
    )
})

// ── 3. Die zwei Flächen ─────────────────────────────────────────────────────────

test('Beide Flächen binden href fail-closed — ohne Ziel entsteht kein Tabstopp', () => {
    for (const [name, pfad, wert] of FLAECHEN) {
        const anker = verweisZeile(pfad, wert)
        assert.match(anker, /:href="medienUrl\(\) \|\| null"/, `${name}: :href ohne „|| null" — ein leerer Link bleibt fokussierbar.`)
        assert.match(anker, /x-show="medienUrl\(\)"/, `${name}: die Zeile steht auch ohne Ziel da.`)
        assert.match(anker, /x-cloak/, `${name}: die Zeile blitzt vor dem Alpine-Boot auf.`)
    }
})

test('Beide Flächen sind echte externe Anker — inklusive des Wegs auf dem GERÄT', () => {
    for (const [name, pfad, wert] of FLAECHEN) {
        const anker = verweisZeile(pfad, wert)
        assert.match(anker, /target="_blank"/, `${name}: kein target="_blank".`)
        assert.match(anker, /rel="noopener noreferrer"/, `${name}: rel ist nicht „noopener noreferrer".`)
        // Ohne diesen Aufruf ist der Verweis in der nativen WebView ein toter Klick — und
        // zwar nur dort, also unsichtbar für jeden Web-Test.
        assert.match(anker, /x-on:click="\$extern\(medienUrl\(\), \$event\)"/, `${name}: kein $extern — auf dem Gerät verpufft der Link.`)
    }
})

test('Das $extern-Magic ist registriert und öffnet nur http(s)', () => {
    const quelle = lies(INSEL)
    assert.match(quelle, /Alpine\.magic\('extern', \(\) =>/, "Das Magic $extern ist weg — beide Verweise laufen ins Leere.")
    const ab = quelle.indexOf("Alpine.magic('extern'")
    const rumpf = quelle.slice(ab, quelle.indexOf('\n    })', ab))
    assert.match(rumpf, /isMobile/, '$extern greift auch im Web ein — dort soll der Anker ein Anker bleiben.')
    assert.match(rumpf, /isSafeExternalUrl\(url\)/, '$extern öffnet ungeprüfte Adressen im In-App-Browser.')
    assert.match(rumpf, /nativeBrowserInApp\(url\)/, '$extern benutzt nicht mehr den In-App-Browser.')
})

test('Beide Flächen stehen server-seitig hinter der Konfiguration', () => {
    // Nicht bloß `x-show`: ohne Konfiguration soll die Zeile gar nicht erst entstehen —
    // sonst stünde totes Markup samt Beschriftung im Dokument.
    for (const [name, pfad] of FLAECHEN) {
        assert.match(
            lies(pfad),
            /@if \(config\('group\.media_public_url'\)\)/,
            `${name}: die Verweis-Zeile hängt nicht mehr an der Konfiguration.`,
        )
    }
})

test('Die Beschriftung nennt den Host aus der KONFIGURATION, nie als Literal', () => {
    // Steht der Host als Text im Blade, lügt die Zeile, sobald jemand die Basis ändert.
    for (const [name, pfad] of FLAECHEN) {
        const quelle = lies(pfad)
        assert.match(quelle, /__\('Profil auf :host ansehen', \['host' => \$medienHost\]\)/, `${name}: die Beschriftung ist nicht mehr der geprüfte Schlüssel.`)
        assert.equal(
            /media\.einundzwanzig\.space/.test(quelle),
            false,
            `${name}: der Host steht als Literal im Blade — er gehört in die Konfiguration.`,
        )
    }
})

test('Kein font-mono an den neuen Zeilen — das Theme definiert nur --font-sans', () => {
    // `theme.css` setzt ausschließlich `--font-sans`; Tailwind liefert `--font-mono`
    // selbst mit. Ein `font-mono` zöge damit still eine ZWEITE Schriftfamilie herein.
    // (Die npub- und Lightning-Chips der Karte tragen es als Bestand — sie sind nicht
    // Gegenstand dieser Phase; geprüft wird die neue Zeile.)
    for (const [name, pfad, wert] of FLAECHEN) {
        assert.equal(/font-mono/.test(verweisZeile(pfad, wert)), false, `${name}: font-mono an der Verweis-Zeile.`)
    }
})

test('Beide Zeilen tragen dieselbe Bauform — gleiche Klasse, gleiches Aussehen', () => {
    // Zwei Zeilen mit derselben Aufgabe (ein externes Ziel öffnen) sollen nicht
    // auseinanderdriften. Geprüft werden die tragenden Klassen, nicht die ganze Kette:
    // ein Test auf Zeichengleichheit ginge bei jeder Einrückung kaputt.
    for (const [name, pfad, wert] of FLAECHEN) {
        const anker = verweisZeile(pfad, wert)
        for (const klasse of ['pressable', 'rounded-tile', 'border-zinc-200', 'dark:border-zinc-800', 'text-brand-800', 'dark:text-brand-400', 'px-3', 'py-2', 'mt-2', 'gap-2', 'truncate']) {
            assert.match(anker, new RegExp(`(^|[\\s"])${klasse}([\\s"]|$)`), `${name}: „${klasse}" fehlt an der Verweis-Zeile.`)
        }
        // Kein freier Pixelwert — Abstände kommen aus der 4/8-Skala.
        assert.equal(/\[\d+px\]/.test(anker), false, `${name}: freier Pixelwert an der Verweis-Zeile.`)
    }
})
