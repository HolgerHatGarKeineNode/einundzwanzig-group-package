@props([
    'chrome' => true,
    // 'read' = Lesedeckel (62 rem) — der Default, unverändert seit der Desktop-Shell.
    // 'wide' = Bühnenbreite (96 rem) für Flächen, die RASTER zeigen statt Fließtext.
    'width' => 'read',
])

{{-- Die EINE Shell (§3.1). Verschmilzt Shell A (mobile.blade Companion) und
     Shell B (einundzwanzig.blade Chat-Takeover) zu einem Chassis: Chat ist ein
     Tab darin, kein Vollbild-Takeover mehr. Der Doc-Layout (`einundzwanzig.blade`,
     html/head/body/scripts) bleibt drumherum — app-shell ist der Body-Rumpf.

     Aufbau:
       status-strip  ← beide Signer-Banner, global, eine Höhe
       $header       ← kontextueller <x-group::app-header> der Seite (optional)
       <main …>      ← wire:navigate-Ziel, der Tab-Inhalt ($slot)
       bottom-nav    ← config-getriebene Nav (§8.2)

     `chrome=false` (Onboarding): rendert nur den nackten main-Outlet — eine
     Regel, ein Ort (§3.1). FAB kommt erst mit P7, hier bewusst weggelassen.
     Der Outlet steht einmal; nur das padding-bottom hängt an der fixen Nav
     (pb-28 mit Chrome, pb-8 ohne). Beide Literale bleiben im Quelltext → JIT.

     EIN Wurzel-Element (`display:contents`, layout-neutral): die Shell dient in
     P2 als Root eines Livewire-Full-Page-SFC (`group::spaces` etc.), und Livewire
     erlaubt nur genau eine Wurzel je Komponente. status-strip/nav sind `fixed`,
     `main` bleibt im Fluss — der Wrapper erzeugt keine Box, das Layout ist
     identisch zu den drei vorherigen Geschwistern. --}}
{{-- Seit der Desktop-Shell ist die Wurzel `app-frame` statt eines nackten
     `contents`-Divs. Unterhalb xl ist das dasselbe DOM wie zuvor (`app-frame`
     rendert dort ebenfalls nur `contents`), ab xl wird daraus das zweispaltige
     Grid mit dem Navigator links. `chrome=false` (Onboarding) schaltet beides
     zusammen ab — eine Regel, ein Ort. --}}
<x-group::app-frame :rail="$chrome">
    @if ($chrome)
        <x-group::status-strip />

        @isset($header)
            {{ $header }}
        @endisset
    @endif

    {{-- Die Breitenklammer bleibt für Mobil/Tablet zeichengleich stehen. Ab xl
         hebt `xl:max-w-none xl:mx-0` sie auf: die Bühne bringt ihre eigene,
         großzügigere Inhaltsspalte mit, und der Deckel wandert eine Ebene tiefer.
         `xl:overflow-y-auto` macht die Bühne zur scrollenden Fläche — ab xl
         scrollt nicht mehr das Dokument, sondern die Spalte.
         `pb-28` (Platz für die fixe Bottom-Bar) fällt ab xl weg: dort gibt es
         keine Bottom-Bar mehr, der Abstand wäre toter Boden.

         ── …ABER NUR IM WEB-HOST, und das war hier ein Fehler ────────────────
         Die Begründung darüber stimmt für die Web-Shell und war im App-Host
         falsch. Dort bleibt die Bottom-Bar auf JEDER Breite stehen — genau
         darum trägt `bottom-nav.blade.php:52` ihr `xl:hidden` hinter
         `! $native`. Ab 1280 px (Tablet quer) fiel der Abstand hier trotzdem
         von 112 px auf 32 px, und die fixe Bar überlappte den Inhalt.
         Gemessen am 2026-08-23 bei `NATIVEPHP_RUNNING=true`, 1366 × 1024.

         **Der Host ist die richtige Frage, nicht die Breite** — dieselbe
         Unterscheidung wie in `app-frame.blade.php:44` und
         `bottom-nav.blade.php:41`, und aus demselben Grund: eine
         Breitenschwelle beschreibt das Chassis der Web-Shell, nicht die
         Anwesenheit einer fixen Leiste.

         Alle drei Literale (`pb-28`, `xl:pb-8`, `pb-8`) stehen weiterhin
         vollständig im Quelltext — Tailwind scannt Quelltext, ein
         zusammengesetzter Klassenname entstünde im JIT nie.

         ── Das Seitenpolster wächst STETIG statt in Stufen (P2, 2026-08-26) ──
         Hier standen zwei Stufen: `xl:px-8` und `2xl:px-12`. Die zweite machte
         den Inhaltsdeckel NICHT-MONOTON — er FIEL um 31 px, wenn das Fenster
         wuchs. Gemessen am gerenderten Element über 641 Breiten: 1535 px → 1151 px
         Deckel, 1536 px → **1120 px**. Ursache ist arithmetisch und nicht subtil:
         an der 2xl-Schwelle springt das Polster von 32 auf 48 px, die Spalte
         wächst aber nur um 1 px mit.

         `clamp(2rem, 2.5vw, 3rem)` trifft BEIDE bisherigen Endpunkte exakt
         (bei 1280 px sind 2,5 vw genau 32 px, bei 1920 px genau 48 px) und
         verbindet sie stetig. Die Ableitung des Deckels ist damit
         `0,95 · Breite − Rail`, also überall positiv — Monotonie per
         Konstruktion, nicht per Nachmessen. Bewacht in
         `tests/e2e/desktop-schwelle.spec.ts` (Host-Repo), über alle 641 Breiten.

         Unterhalb `xl` bleibt `px-4` als feste Zahl stehen, und das ist Absicht:
         dort ist die Bühne durch `max-w-*` gedeckelt, ein mitwachsendes Polster
         würde den Inhalt SCHRUMPFEN lassen, während das Fenster wächst — genau
         der Fehler, der hier gerade repariert wird, nur eine Stufe tiefer
         (gerechnet: 1024 px → 621 px, 1279 px → 608 px). --}}
    {{-- ── Warum die Bühne ab `xl` `relative` ist ────────────────────────────────
         **Ein Scrollport, der kein enthaltender Block ist, klippt seine absolut
         positionierten Nachfahren nicht — sie hängen dann am DOKUMENT.**

         `xl:overflow-y-auto` macht diese `main` zum Scrollport. Ein `absolute`
         darin sucht sich seinen enthaltenden Block aber beim nächsten
         POSITIONIERTEN Vorfahren, und den gab es bis hierher nicht: er landete
         beim initialen enthaltenden Block. Ein Kasten, dessen enthaltender Block
         ausserhalb eines Scrollports liegt, wird von dessen `overflow` NICHT
         geklippt und zählt zum Scroll-Überlauf des Dokuments.

         Gemessen am 2026-08-28 im Code-Reiter eines Repositories (1440×900,
         42 Dateizeilen): jede Zeile trägt ein `<span class="sr-only">` für die
         Art (Verzeichnis/Datei), und `sr-only` ist in Tailwind
         `position: absolute` (`.sr-only{…;position:absolute;overflow:hidden}` im
         gebauten Stylesheet). Die 42 Spannen meldeten `offsetParent === BODY`;
         die unterste stand bei y = 2041 — und exakt das war
         `document.scrollingElement.scrollHeight`: **2041 statt 900.** Folge: ein
         ZWEITER, dokumentweiter Bildlauf neben dem der Bühne, und das ganze
         `xl:h-dvh`-Chassis (samt Rail) schob sich beim Scrollen nach oben aus dem
         Bild — die gemeldete „aufbrechende" Rail. Im selben Lauf: Datei geöffnet
         (Baum weg) → 900, Reiter Issues/Pull Requests/Aktivität/Patches → 900.

         **Warum hier und nicht an der Baumzeile:** `sr-only` ist das
         Haus-Muster für Textalternativen und steht in jeder längeren Liste
         (`/forge` 2, `/updates` 1, `/spaces` 2 …). Sichtbar wird der Fehler nur,
         wenn eine Liste über die Falzkante hinausreicht — die nächste tut es
         wieder. Ein `relative` an den zwei Baumzeilen hätte diesen Baum geheilt
         und die Regel offen gelassen; hier steht sie einmal, für jede Fläche, die
         in dieser Bühne scrollt.

         **Kein Symptomdeckel:** `overflow: hidden` weiter oben würde den Überlauf
         nur verstecken (und die Bühne mit klippen). `relative` beseitigt ihn,
         indem es den Bezug richtigstellt — der `sr-only`-Kasten gehört in den
         Scrollport, in dem sein Text steht.

         **Blast-Radius, gemessen statt geschätzt:** betroffen sind
         ausschliesslich `absolute`-Kästen, deren Bezug bisher der initiale
         enthaltende Block war (`fixed` bleibt unberührt, `relative` mit `z-index:
         auto` eröffnet keinen Stapelkontext, `sticky` klebt weiter am Scrollport).
         Die Geometrie ALLER sichtbaren absolut/fest positionierten Elemente wurde
         auf sieben Flächen vorher/nachher verglichen (Repo-Code-Reiter 46, /forge 5,
         /articles 9, /directory 5, /spaces 11, /updates 3, /settings 5) —
         **jede einzelne Position unverändert**, die 42 `sr-only`-Spannen
         eingeschlossen: sie haben keine eigenen Versätze, stehen also weiter an
         ihrer statischen Position und wechseln nur den Bezug.
         Unterhalb `xl` ändert sich nichts: dort scrollt das
         Dokument absichtlich, und die Klasse trägt den `xl:`-Riegel. --}}
    @php($nativeShell = \Einundzwanzig\Group\Chassis::istApp())
    <main data-tab-outlet id="buehne" {{ $attributes->class('mx-auto max-w-md px-4 pt-[max(env(safe-area-inset-top),1.5rem)] md:max-w-lg lg:max-w-2xl xl:relative xl:mx-0 xl:min-h-0 xl:max-w-none xl:flex-1 xl:overflow-y-auto xl:px-[clamp(2rem,2.5vw,3rem)] xl:pt-6 '.($chrome ? ($nativeShell ? 'pb-28' : 'pb-28 xl:pb-8') : 'pb-8')) }}>
        {{-- Ab xl bekommt der Seiteninhalt einen eigenen Deckel, statt die ganze
             Spaltenbreite zu füllen — eine Bühne ohne Deckel ist Slacks
             Lesbarkeitsfehler.

             ── Zwei Deckel, und warum es genau zwei sind (P5) ────────────────────
             `read` (62 rem) ist für Flächen mit FLIESSTEXT und einspaltigen Listen:
             darüber reißt die Zeilenlänge das Lesemaß von 45–75 Zeichen. `wide`
             (96 rem) ist für Flächen mit einem RASTER — Artikelkarten, Forge-Kacheln,
             Repo-Listen. Dort ist die Zeilenlänge eine Eigenschaft der Kachel und
             nicht der Bühne, und der Deckel kostet auf einem breiten Schirm nur Platz.

             **Was `wide` bei den üblichen Breiten wirklich tut, gemessen am
             gerenderten Element (2026-08-21, mit Desktop-Rail):** bei 1440 px ist die
             Inhaltsspalte 66 rem breit, bei 1700 px 80,3 rem. Der 96-rem-Deckel bindet
             dort also noch gar nicht — er ist die Obergrenze für sehr breite Schirme.
             Die messbare Wirkung bei 1440/1700 px ist, dass der 62-rem-Deckel NICHT
             mehr bindet: die Artikelliste trägt damit drei bzw. vier Spalten statt zwei.

             BEIDE Klassen stehen als volles Literal im Quelltext. Ein zusammengesetzter
             Name (`xl:max-w-[{{ $breite }}]`) entstünde erst zur Laufzeit — Tailwind
             scannt aber den QUELLTEXT, die Klasse existierte im gebauten Stylesheet
             also nie, und die Fläche fiele stumm auf die volle Spaltenbreite zurück.
             Dieselbe Regel und derselbe Grund wie beim `pb-28`/`pb-8` oben. --}}
        <div @class([
            'xl:mx-auto xl:w-full',
            'xl:max-w-[62rem]' => $width !== 'wide',
            'xl:max-w-[96rem]' => $width === 'wide',
        ])>
            {{ $slot }}
        </div>
    </main>

    @if ($chrome)
        <x-group::bottom-nav />
    @endif
</x-group::app-frame>
