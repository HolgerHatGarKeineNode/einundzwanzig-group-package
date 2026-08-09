@props([
    // Der SICHTBARE Text im Feld — dasselbe Wort wie im echten Composer daneben
    // („Nachricht schreiben…" im Raum, „Im Thread antworten…" im Thread).
    'placeholder',
    // Kontextzeile des Login-Sheets (§4.2 `intent.label`): warum es gerade aufgeht.
    'intent',
    // Optionaler `x-ref`-Name, damit ein Leerzustand den Fokus hierher übergeben
    // kann. Leer = kein Ref (der Thread-Fuß braucht keinen).
    'ref' => null,
])

{{-- Der gatende Composer für Gäste (P3.3). Er bleibt SICHTBAR und gatet beim
     Schreibversuch, statt zu verschwinden — ein unsichtbarer Composer erzeugt
     keine Absicht.

     Ein feld-förmiger Knopf statt der echten Eingabezeile, und das ist keine
     Abkürzung: jedes Bedienelement des echten Composers (Bild, Umfrage,
     Zap-Ziel, Emoji-Panel, @-Mention, Senden) braucht einen Signer und wäre für
     einen Gast eine eigene Sackgasse — sechs Wege, die alle an derselben Wand
     enden. Hier ist es EIN Ziel mit EINER Aufgabe.

     `requireAuth` statt eines handgeschriebenen `open-login-sheet`: derselbe Weg
     wie bei jeder gegateten Tab (`nav-tab`). Er dispatcht dasselbe Event, merkt
     aber ZUSÄTZLICH den Rückweg vor (`pendingReturn` → `postLoginRedirect`) und
     trägt den Fallback auf den Login-View, falls kein Sheet montiert ist. Ein
     direkter Dispatch verlöre beides still.

     Der Name für Hilfstechnik wächst aus dem SICHTBAREN Text plus einem
     sr-only-Zusatz (Muster wie in `nav-tab`), nicht aus einem `aria-label`: ein
     Label, das den sichtbaren Text nicht enthält, bricht WCAG 2.5.3 (Label in
     Name) und macht Sprachsteuerung unbedienbar.

     Das Schloss trägt hier Information (kein Dekor) und steht deshalb auf
     `text-muted` statt auf dem dekorativen `zinc-400` der Leerzustände —
     zinc-400 hält gegen die Kartenfläche nur 2,52:1 und risse WCAG 1.4.11.

     `min-h-11`: dieselbe Höhe wie das Composer-Skeleton (`h-11`) und zugleich
     44px Tap-Ziel. --}}
<button type="button" @if ($ref) x-ref="{{ $ref }}" @endif
        x-on:click="$store.authGate.requireAuth({ label: @js($intent) })"
        {{ $attributes->class('pressable surface-card flex min-h-11 w-full items-center gap-2 px-4 text-left') }}>
    <span class="min-w-0 flex-1 truncate text-sm text-muted">{{ $placeholder }}</span>
    <span class="sr-only">, {{ __('anmelden erforderlich') }}</span>
    <flux:icon.lock-closed variant="mini" class="size-5 shrink-0 text-muted" />
</button>
