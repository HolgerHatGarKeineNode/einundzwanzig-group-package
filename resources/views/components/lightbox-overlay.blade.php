{{-- **Die Lightbox — eine Fläche, zwei Aufrufer.**

     Sie stand bis P3 wörtlich in `⚡room.blade.php` und ist von dort hierher gewandert,
     unverändert bis auf die Einrückung. Die Artikel-Vollansicht (`⚡article.blade.php`)
     braucht dieselbe Fläche für dieselbe Sache — ein angeklicktes Inline-Bild groß —,
     und eine zweite Kopie wäre die Art Duplikat, das genau einmal repariert wird.

     ── Der Vertrag mit dem Aufrufer, in einem Satz ──

     **Der umschließende Alpine-Scope muss `lightboxSrc` führen** (`string | null`).
     Alles andere bringt diese Datei mit: `lightboxZoom` (`js/lightbox.ts`, global
     registriert) liefert `imageStyle` und die Zeigerhandhabung, `$img`/`$imgFallback`
     sind globale Magics. Heute erfüllen zwei Inseln den Vertrag — `nostrRoom` und
     `nostrArticle` —, und beide haben eigene Auslöser, die `dataset.full` in
     `lightboxSrc` schreiben (`partials/chat-row.blade.php`, `⚡article.blade.php`).

     Kein `x-data` an dieser Wurzel für den Zustand: die Lightbox ist kein eigener
     Bildschirm, sie ist die Vergrößerung eines Bildes, das im Scope des Aufrufers
     angeklickt wurde. Ihn hier zu spiegeln hieße, ihn zweimal zu führen.

     Die Systemleisten-Abstände am ✕ sind der Grund, warum diese Datei in
     `tests/Feature/SafeAreaGateTest.php` steht — der Eintrag ist beim Verschieben
     mitgezogen worden, nicht neu erfunden. --}}
{{-- Lightbox: Vollbild eines angeklickten Inline-Bilds (Proxy-Preset `full`), mit
     Zoom (Pinch/Doppeltipp/Mausrad — s. `js/lightbox.ts`). Proxy-Fehler → Original-URL
     (Offline-Fallback) — nur wenn der Proxy das Ziel nicht per POLICY ablehnt
     ($imgFallback auf das zurückdekodierte Original, P7).

     Schließen geht über Hintergrund-Klick, das ✕ und Escape — NICHT über einen Klick
     aufs Bild: ein schließender Erst-Klick würde den Doppeltipp/-klick zum Zoomen
     verschlucken. Darum stoppt das Bild seinen eigenen Klick, und der Hintergrund-Klick
     trägt den `panned`-Guard, damit ein Zieh-Ende neben dem Bild nicht schließt.

     `touch-none` ist Pflicht: sonst greift der Browser die Pinch-Geste für den
     Seiten-Zoom ab, bevor unsere Pointer-Handler sie sehen. --}}
<div x-show="lightboxSrc" x-cloak x-transition.opacity
     x-data="lightboxZoom" x-effect="lightboxSrc, reset()"
     role="dialog" aria-modal="true" aria-label="{{ __('Bild in voller Größe') }}"
     x-on:click.stop="panned || (lightboxSrc = null)"
     x-on:keydown.escape.window="lightboxSrc = null"
     x-on:pointerdown="onPointerDown($event)"
     x-on:pointermove="onPointerMove($event)"
     x-on:pointerup="onPointerUp($event)"
     x-on:pointercancel="onPointerUp($event)"
     x-on:wheel="onWheel($event)"
     x-on:dblclick.stop="toggleZoom($event.clientX, $event.clientY)"
     x-on:resize.window="clampPan()"
     class="fixed inset-0 z-50 flex touch-none select-none items-center justify-center overscroll-contain bg-black/80 p-4">
    {{-- Der Rückfall Proxy → Original, reaktiv gebunden (2026-08-16).

         Hier stand `$el.dataset.orig = 1, $el.src = …` — Zustand im DOM-Attribut,
         Quelle imperativ gesetzt. Dieselbe Bauart hat in den Raum- und Meetup-Kacheln
         Bilder verschwinden lassen: eine `:src`-Bindung kennt das `dataset` nicht und
         überschreibt die gesetzte Quelle beim nächsten Effekt-Durchlauf wieder mit der
         gescheiterten. Der Lightbox fehlte dafür bisher der Auslöser (kein `x-for`
         darüber, `lightboxSrc` ändert sich nicht, solange sie offen ist) — sie war
         nicht heil, sondern unbeobachtet.

         Der eigene `x-data` am `<img>` erbt den Eltern-Scope (`lightboxSrc`,
         `imageStyle`) und trägt nur den Fallback-Zustand. `x-effect` setzt beide
         Marken zurück, sobald ein ANDERES Bild geöffnet wird — genau der Fall, in dem
         ein veraltetes `dataset.orig` den Rückfall stillgelegt hätte.

         `roh` kommt aus `lightboxSrc` und nicht aus `$el.src`: die Quelle der Wahrheit
         ist die Proxy-URL, die die Lightbox bekommen hat, nicht das, was das Element
         nach einem Fehlversuch gerade trägt. `$imgFallback` bleibt das einzige Tor
         zum Original (P7) — ohne sein Ja bleibt die Anzeige auf der Proxy-URL stehen,
         und der Angreifer-Host wird nie angefragt.

         `data-img-orig`/`data-img-error` sind GEBUNDEN, nicht gesetzt: sie machen den
         Zustand für E2E lesbar, ohne ihn zu halten. --}}
    <img x-ref="img" alt="" x-on:click.stop=""
         x-data="{ imgOrig: false, imgError: false, get roh() { return decodeURIComponent((lightboxSrc || '').split('src=')[1] || '') } }"
         x-effect="lightboxSrc; imgOrig = false; imgError = false"
         :src="imgOrig && roh ? roh : lightboxSrc"
         class="max-h-full max-w-full rounded-card will-change-transform"
         :style="imageStyle"
         :data-img-orig="imgOrig ? '1' : '0'"
         :data-img-error="imgError ? '1' : '0'"
         x-on:error="imgError = true; imgOrig || (roh && $imgFallback(roh) ? (imgOrig = true) : null)" />

    {{-- Sichtbarer Ausgang: seit der Klick aufs Bild zoomt statt schließt, ist das ✕
         auf dem Handy der einzige verlässliche Weg raus (kein Escape).
         `absolute!`: <flux:button> bringt eigenes `position:relative` mit, das in der
         Utility-Kaskade ein blankes `absolute` schlägt (Quellreihenfolge) → der Button
         säße sonst mittig im Bild statt in der Ecke. `!` erzwingt die Positionierung
         (gleiches Muster wie `text-brand-500!` andernorts).

         ── Warum die Ecke die Systemleiste einrechnen MUSS (2026-08-16) ──────────────
         Die Lightbox ist `fixed inset-0` und legt sich damit über den GANZEN Viewport,
         also auch unter Statusleiste und Notch. Ein festes `top-4 right-4` setzte den
         einzigen Ausgang genau dorthin, wo auf dem Telefon Uhr und Akkuanzeige liegen:
         gemeldet 2026-08-16 als „nicht gut klickbar, überdeckt sich mit der
         Akkuanzeige". Das ist kein Schönheitsfehler — der Tap landet im System-UI,
         und weil ein Klick aufs Bild zoomt statt schließt, sitzt man in der Ansicht
         fest.

         `max(env(…), 1rem)` ist die im Repo eingeführte Form (`app-shell.blade.php`,
         `⚡room.blade.php` oben): auf Geräten ohne Aussparung bleibt es beim alten
         Abstand, mit Aussparung rutscht der Knopf darunter. `right` bekommt dieselbe
         Behandlung — im Querformat liegt die Aussparung seitlich. --}}
    <flux:button size="sm" variant="ghost" icon="x-mark"
                 class="icon-btn-touch absolute! top-[max(env(safe-area-inset-top),1rem)] right-[max(env(safe-area-inset-right),1rem)] bg-black/40 text-white"
                 x-on:click.stop="lightboxSrc = null"
                 aria-label="{{ __('Schließen') }}" />
</div>
