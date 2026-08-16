@props([
    'rail' => true,
])

{{-- Das Desktop-Chassis (Plan „Desktop-Shell", P1).

     Unterhalb `xl` ist dieser Wrapper `display:contents` — er erzeugt KEINE Box.
     Das Layout darunter ist damit zeichengleich zu dem, was vor der Desktop-Shell
     hier stand; es gibt keinen zweiten Codepfad für Mobil, sondern denselben.
     Genau deshalb steht `contents` unbedingt und die Grid-Klassen bedingt: fiele
     der Wrapper unter `xl` weg, wäre jede Seite ein anderes DOM als vorher.

     Ab `xl` wird derselbe Knoten zum zweispaltigen Grid: Navigator (20rem) neben
     Bühne (Rest). `h-dvh` + `overflow-hidden` machen die Seite zur App-Fläche —
     gescrollt wird ab da INNERHALB der Spalten, nicht im Dokument.

     ── Warum `grid-rows-1` unverzichtbar ist ─────────────────────────────────
     Das Grid hat DREI Kinder im Fluss: Rail, Bühne — und die `profile-card` ganz
     unten. Die ist ein Overlay (geschlossenes `<dialog>`, 0px hoch), aber sie ist
     eben doch ein Grid-Item und wurde per Auto-Placement in eine ZWEITE, implizite
     Zeile gesetzt. Beide Zeilen sind dann `auto`, und `align-content: stretch`
     (der Default) verteilt den freien Platz GLEICHMÄSSIG auf beide: die Rail
     bekam nur ihre Inhaltshöhe plus die Hälfte des Rests und endete sichtbar vor
     dem unteren Fensterrand — gemessen 672 px statt 1291 px bei 1291 px Viewport,
     darunter der nackte Seitengrund. `grid-rows-1` (= `minmax(0,1fr)`) macht die
     erste Zeile zur einzigen, die Platz bekommt; die implizite bleibt bei 0.
     Das gilt für JEDES künftige Overlay am Ende dieses Rahmens, nicht nur für
     die Profilkarte — deshalb die Zeilenachse am Container, nicht ein Sonderweg
     an der Karte.

     ── Warum der NativePHP-Ausschluss KEIN Breakpoint ist ────────────────────
     Ein iPad Pro 12,9" quer misst 1366 CSS-px und läge damit über `xl`. Die
     Mobile-App würde dort ihren eigenen 4-Tab-Satz samt `config('group.exit')`
     in eine Desktop-Rail rendern, für die sie nie entworfen wurde. Der Host ist
     hier die richtige Frage, nicht die Breite — dasselbe Muster und derselbe
     Grund wie in `bottom-nav.blade.php` beim backdrop-blur.

     `rail=false` schaltet das Chassis pro Seite ab (Onboarding, Vollbild-Views):
     dann bleibt der Wrapper auf jeder Breite `contents`, und die Seite rendert
     exakt wie vor der Desktop-Shell.

     EIN Wurzel-Element: die Shell ist Root eines Livewire-Full-Page-SFC, und
     Livewire erlaubt nur genau eine Wurzel. `app-frame` liefert genau ein <div>. --}}
@php($desktop = $rail && ! config('nativephp-internal.running'))

<div @class([
    'contents',
    'xl:grid xl:h-dvh xl:grid-cols-[20rem_minmax(0,1fr)] xl:grid-rows-1 xl:overflow-hidden' => $desktop,
])>
    @if ($desktop)
        {{-- WCAG 2.4.1 (Blöcke überspringen): ab xl liegen 25+ Tab-Stopps der Rail
             vor dem eigentlichen Inhalt. Der Sprung-Link ist die einzige Tastatur-
             Abkürzung daran vorbei. Sichtbar erst bei Fokus. --}}
        <a href="#buehne"
           class="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-tile focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:ring-2 focus:ring-accent dark:focus:bg-zinc-900">
            {{ __('Zum Inhalt springen') }}
        </a>

        <x-group::desktop-rail />
    @endif

    {{-- Die Bühne. Unterhalb xl ebenfalls `contents` — der Slot-Inhalt hängt dann
         direkt im Dokumentfluss, so wie vorher. --}}
    <div @class(['contents', 'xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden' => $desktop])>
        {{ $slot }}
    </div>

    {{-- P4: Die Profilkarte stand bis hierher dreimal einzeln (Raum, Directory,
         Spaces). Die Befehlspalette adressiert Mitglieder von JEDER Seite aus —
         auf Einstellungen, Wallet und Neu wäre die Zeile sonst ein Klick ohne
         Wirkung.

         Bewusst hier und nicht im Layout: `app-frame` ist die Wurzel genau der
         Seiten, die hinter dem Gate liegen (Spaces, Directory, Updates,
         Einstellungen, Wallet, Raum) — Login und Beitritt tragen sie nicht. Das
         ist dieselbe Menge, die `EnsureNostrAuth` schützt, ohne dessen Bedingung
         ein zweites Mal auszuschreiben. Die Insel ist bis zum ersten
         `open-profile` untätig (keine Abos im `init`). --}}
    <x-group::profile-card />
</div>
