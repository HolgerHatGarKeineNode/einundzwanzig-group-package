<?php

use Einundzwanzig\Group\ImageProxy;
use Einundzwanzig\Group\Nostr\SpaceCache;
use Illuminate\Support\Facades\View;
use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Space-Seite (Single-Space §12) als Livewire-Full-Page-SFC. Die Klasse ist ein
 * dünner Shell — der reaktive Zustand lebt in der welshman/Alpine-Insel (`x-data`).
 * Titel + OG-Bild kommen aus dem NIP-11-Read-Cache (B5): Space-Name statt „Space",
 * Space-icon als OG. Cache-Miss = Fallback „Space"/Marken-OG; die Insel füllt live.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public string $spaceName = 'Space';

    public ?string $ogImage = null;

    public function mount(SpaceCache $cache): void
    {
        $info = $cache->relayInfo(SpaceCache::spaceUrl());
        $this->spaceName = $info['name'] ?: 'Space';
        $this->ogImage = $info['icon'] ? url(ImageProxy::url($info['icon'], 'og')) : null;
    }

    public function render()
    {
        View::share('ogImage', $this->ogImage);

        return $this->view()->title($this->spaceName);
    }
}; ?>

<x-group::app-shell>

    {{-- Genau EIN fixierter Space + seine Räume (kein Multi-Space-Layout, §12).
         Der `nostrSpaces`-Scope umschließt auch den Header, damit dessen Titel den
         echten Space-Namen (NIP-11) zeigen kann (B1). --}}
    <div x-data="nostrSpaces" class="page-enter">

        {{-- Kopfbereich neu (B1/B6): zwei getrennte Identitäts-Zonen statt einer
             gedrängten Zeile. WER bin ich = Profil-Chip oben rechts (Avatar+Name+✓,
             Details/Abmelden hinter einem Tap). WO bin ich = Space-Block darunter
             (Icon+Name+Beschreibung). `nostrAuth` umschließt beides und erbt
             `space?.…` aus dem `nostrSpaces`-Page-Scope. --}}
        @php($exit = config('group.exit'))
        <div x-data="nostrAuth" class="mb-6">

            {{-- Utility-Zeile: links der Host-Ausgang (Mobile-App-Takeover — repliziert
                 app-headers exit-Zweig, ohne ihn säße der Nutzer fest), rechts das
                 eigene Profil. Kein Brand-Mark im Web: die Startseite braucht keinen
                 Home-Link auf sich selbst, und `space.icon` unten ist die eine Marke. --}}
            <div class="mb-3 flex min-h-[44px] items-center justify-between gap-3">
                <div class="min-w-0">
                    @if ($exit)
                        <a href="{{ route($exit['route']) }}" wire:navigate
                           aria-label="{{ __('Zurück zu :label', ['label' => $exit['label']]) }}"
                           class="pressable -ms-1 inline-flex shrink-0 items-center gap-0.5 rounded-full py-1.5 pe-3 ps-1.5 text-sm font-semibold text-accent">
                            <flux:icon.chevron-left variant="micro" class="size-5" />
                            <span class="max-w-[9rem] truncate">{{ $exit['label'] }}</span>
                        </a>
                    @endif
                </div>

                <div class="flex shrink-0 items-center gap-1">

                    {{-- Glocke → Benachrichtigungen („Neu", P4). Der Einstieg sitzt HIER
                         und nicht in der Bottom-Nav: ein Nav-Tab ist ein ORT, Ungelesenes
                         ist ein ZUSTAND ÜBER Orte — und ein fünfter Tab bräche
                         `bottom-nav.blade.php` still auf drei Spalten (Drei-Repo-Release).
                         Marker ist seit P6 eine ZAHL (§4.1 Nr. 6) — und zwar die der
                         ungelesenen /updates-ZEILEN (`$store.unread.updates`), nicht die
                         Summe der Nachrichten: die Glocke führt zu einer Liste, und eine
                         Zahl, die sich beim Öffnen der Liste ändert, wäre genau die zweite
                         Wahrheit, die §4 verhindern soll.
                         Cap 9+ statt 99+ (§4.2): die Glocke sitzt zwischen exit-Link und
                         Profil-Chip, dreistellig drückte sie die max-w-[7rem]-Namenszeile.
                         Der Zustand steckt zusätzlich im `aria-label` — es ändert sich
                         reaktiv mit und wird beim Fokussieren vorgelesen. `?.` durchgehend:
                         fehlt der Store (Gast, Ladephase, Fremdhost ohne Datenstrang),
                         bleibt es beim schlichten „Neu". Die 44×44-Fläche (size-11) erfüllt
                         WCAG 2.5.8/Apple; die Zeile trägt bereits min-h-[44px].

                         ── Der Glocken-Marker trägt ZWEI Ausgänge ohne Umbau ──────────────
                         Ob `$store.unread.updates` überhaupt existiert, hängt an einer noch
                         offenen Kostenmessung des Datenstrangs (die Zahl muss aus DERSELBEN
                         Quelle kommen, die die /updates-Liste füllt — `rooms + threads` ist
                         eine andere Menge, und eine Glocke, die „12" sagt, während die Liste
                         7 Zeilen zeigt, ist dauerhaft verbrannt). Deshalb steht hier keine
                         Entweder-oder-Entscheidung, sondern ein Fallback:
                           Feld vorhanden → Zahl-Pille, Cap 9+ (§4.1 Nr. 6).
                           Feld FEHLT     → der P3-PUNKT aus `any`, bewusste Abweichung.
                         Unterschieden wird über `=== undefined`, NICHT über Falsy: `0` heißt
                         „nichts ungelesen" und muss marker-los bleiben, `undefined` heißt
                         „diese Zahl gibt es nicht". Wer beides gleich behandelt, macht aus
                         dem Fallback einen Dauerpunkt. Fällt das Feld weg, ist das eine
                         Zeile weniger — kein Umbau. --}}
                    <a href="{{ route('group.updates') }}" wire:navigate
                       {{-- Die Leerzeichen stehen IN den Literalen, nicht zwischen den
                            Operanden: `'Neu, ' + 1 + 'ungelesener Hinweis'` ergäbe
                            „Neu, 1ungelesener Hinweis" — im Markup unsichtbar, im
                            Screenreader hörbar (vom E2E-Anker gefangen, nicht vermutet).
                            Dritter Zweig = derselbe Fallback wie beim Marker: ohne Zahl die
                            P3-Formulierung, damit der Hinweis nicht mit der Pille verschwindet. --}}
                       :aria-label="$store.unread?.updates ? @js(__('Neu, ')) + $store.unread.updates + ($store.unread.updates === 1 ? @js(' '.__('ungelesener Hinweis')) : @js(' '.__('ungelesene Hinweise'))) : ($store.unread?.updates === undefined && $store.unread?.any ? @js(__('Neu, ungelesene Nachrichten')) : @js(__('Neu')))"
                       class="pressable relative flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                        <flux:icon.bell class="size-5 text-muted" />
                        {{-- `sr=false` an beiden Formen: der Hinweis steckt im aria-label des
                             <a> (siehe oben), ein sr-only-Geschwister wäre dort totes Markup.
                             Der Ring in Seitenhintergrundfarbe trennt den Marker vom Icon.
                             Beide rendern per `x-if` und schließen sich gegenseitig aus —
                             gleichzeitig sichtbar können sie nicht sein. --}}
                        <x-group::unread-badge count="$store.unread?.updates" :cap="9" size="sm" :sr="false"
                                               badge-class="absolute end-1.5 top-1.5 ring-2 ring-zinc-50 dark:ring-zinc-950" />
                        <x-group::unread-dot when="$store.unread?.updates === undefined && $store.unread?.any" :sr="false"
                                             dot-class="absolute end-2.5 top-2.5 ring-2 ring-zinc-50 dark:ring-zinc-950" />
                    </a>

                    {{-- Die EINE Zählregion des Clients (§4.7). Sie steht neben der Glocke,
                         weil dort die einzige Zahl sitzt, die über ALLE Orte spricht — 20
                         gleichzeitig aktualisierende Badges in Live-Regions machen einen
                         Screenreader unbenutzbar, deshalb hat kein anderes Badge eine.
                         Die DROSSELUNG (≥ 2 s) liegt im Store und nicht hier: „höchstens
                         alle 2 s" ist Zustand über Zeit, den ein Blade-Ausdruck nicht
                         halten kann. `liveText` ist deshalb ein FELD, kein Getter — und es
                         verschluckt den Ankunftszustand, sonst spräche der Screenreader bei
                         jedem Seitenaufbau einen Zählerstand vor, den niemand angefordert hat.
                         Abgegrenzt: der Lade-Hinweis weiter unten ist eine STATUS-Region
                         (existiert nur, solange der Space lädt) und der Chat-Verlauf in
                         ⚡room beschreibt INHALT — beide zählen nicht, §4.7 spricht von
                         Zählregionen. --}}
                    <span class="sr-only" aria-live="polite" x-text="$store.unread?.liveText ?? ''"></span>

                    {{-- Profil-Chip → simples Alpine-Popover (kein flux:dropdown/-menu: das
                         verschluckt rohe Alpine-Kinder). Nur `open` lokal, Rest aus nostrAuth. --}}
                    <div x-data="{ open: false }" class="relative shrink-0">
                        <button type="button" x-on:click="open = !open" aria-haspopup="true" :aria-expanded="open"
                                :aria-label="@js(__('Angemeldet als ')) + myName"
                                class="pressable flex min-h-[44px] items-center gap-2 rounded-full py-1 pe-2 ps-1 ring-1 ring-black/5 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:ring-white/10 dark:hover:bg-white/5">
                            <x-group::nostr-avatar picture="myPicture" name="myName" size="2rem" />
                            <span class="min-w-0 max-w-[7rem] truncate text-sm font-semibold text-zinc-900 sm:max-w-[12rem] dark:text-zinc-100" x-text="myName"></span>
                            <x-group::nostr-nip05 nip05="myNip05" />
                            <flux:icon.chevron-down variant="micro" class="size-4 shrink-0 text-muted transition-transform" ::class="open ? 'rotate-180' : ''" />
                        </button>

                        {{-- Popover: volles Profil + sekundäre Infos + Abmelden. --}}
                        <div x-show="open" x-cloak x-transition
                             x-on:click.outside="open = false" x-on:keydown.escape.window="open = false"
                             class="surface-card absolute end-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] origin-top-right p-4 shadow-lg">
                            <div class="flex items-start gap-3">
                                <x-group::nostr-avatar picture="myPicture" name="myName" size="2.75rem" />
                                <div class="min-w-0 flex-1">
                                    <div class="flex min-w-0 items-center gap-1">
                                        <span class="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" x-text="myName"></span>
                                        <x-group::nostr-nip05 nip05="myNip05" />
                                    </div>
                                    <div x-show="myNip05" x-cloak class="truncate text-xs text-muted" x-text="myNip05"></div>
                                </div>
                            </div>

                            <p x-show="myAbout" x-cloak class="mt-3 line-clamp-3 text-sm leading-normal text-muted" x-text="myAbout"></p>

                            <div class="mt-3 border-t border-zinc-200/60 pt-3 dark:border-zinc-800/60">
                                {{-- npub: 1-Klick-Kopieren (copy() im nostrAuth-Island, „Kopiert"-Toast). --}}
                                <button type="button" x-on:click="copy(npub, 'npub')" aria-label="{{ __('npub kopieren') }}"
                                        class="pressable group/npub flex w-full items-start gap-2 rounded-tile text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                                    <span class="min-w-0 flex-1 break-all font-mono text-[0.7rem] leading-relaxed text-muted" x-text="npub"></span>
                                    <flux:icon.clipboard variant="micro" class="mt-0.5 size-3.5 shrink-0 text-muted transition-colors group-hover/npub:text-brand-500" />
                                </button>
                                <div x-show="signerLabel" x-cloak class="mt-1.5 inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-[0.7rem] font-medium text-brand-800 dark:text-brand-400">
                                    <flux:icon.key variant="micro" class="size-3 shrink-0" />
                                    <span x-text="@js(__('Angemeldet über ')) + signerLabel"></span>
                                </div>
                            </div>

                            <flux:button variant="ghost" size="sm" icon="arrow-right-start-on-rectangle" class="mt-3 w-full" x-on:click="doLogout()">{{ __('Abmelden') }}</flux:button>
                        </div>
                    </div>
                </div>
            </div>

            {{-- NIP-11-Kopfbild (B6): breiter Space-Banner. Proxifiziert (banner-Preset,
                 3:1), Fade nach unten trägt den Space-Avatar darunter. Kein Banner →
                 nichts. Dekorativ → einstufiger onerror (Bild weg statt Chip). --}}
            <template x-if="space?.banner">
                <div class="relative overflow-hidden rounded-card ring-1 ring-black/5 dark:ring-white/10">
                    <img :src="$img(space.banner, 'banner')" alt="" loading="lazy"
                         class="h-28 w-full object-cover md:h-32"
                         x-on:error="$el.parentElement.remove()" />
                    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-zinc-50 to-transparent dark:from-zinc-950"></div>
                </div>
            </template>

            {{-- Space-Identität: Icon + Name (H1) + Beschreibung. Steht NUR hier (kein
                 npub mehr — der lebt im Profil-Chip). Beschreibung 2 Zeilen mit
                 Fließtext-Zeilenhöhe statt hartem Abschnitt (behebt „abgeschnitten").
                 Bei Banner: Avatar überlappt dessen Fade (Profil-Header-Signatur),
                 der Ring in Hintergrundfarbe hebt ihn ab — ohne Banner unsichtbar. --}}
            {{-- `@js()` gehört NICHT in ein statisches Attribut einer Blade-KOMPONENTE:
                 der ComponentTagCompiler läuft als Precompiler und gießt den Attributwert
                 als PHP-String in einen rohen PHP-Block — compileEchos/compileStatements
                 sehen ihn danach nie wieder, die Directive landet ROH in der Alpine-
                 Expression („Invalid or unexpected token"). Wie im Raum-Kopf
                 (⚡room.blade.php) daher json_encode vorab: nostr-avatar echot `name` via
                 `{{ }}`, das escapt das rohe JS-Literal genau EINMAL attributsicher.
                 Bewusst die INLINE-Form (Klammern statt Block): Blades Raw-Block-Regex
                 paart die Inline-Zuweisung weiter oben im File mit dem Ende eines
                 späteren Blocks — alles dazwischen bliebe uncompiliert. --}}
            @php($spaceNameExpr = 'space?.label || '.json_encode($spaceName))
            <div class="flex items-start gap-3" :class="space?.banner ? 'relative z-10 -mt-6' : ''">
                <span class="shrink-0 rounded-full ring-4 ring-zinc-50 dark:ring-zinc-950">
                    <x-group::nostr-avatar picture="space?.icon" :name="$spaceNameExpr" size="3rem" />
                </span>
                <div class="min-w-0 flex-1 pt-0.5">
                    <flux:heading level="1" size="xl" class="truncate">
                        <span x-text="space?.label || @js($spaceName)">{{ $spaceName }}</span>
                    </flux:heading>
                    <p x-show="space?.description" x-cloak class="mt-0.5 line-clamp-2 text-sm leading-normal text-muted" x-text="space?.description"></p>
                </div>
            </div>
        </div>

        {{-- Vereins-Gate: Nicht-Vereinsmitglieder auf einem EINUNDZWANZIG-Vereins-Relay --}}
        <x-group::verein-gate context="{{ __('Räume und Chat') }}" class="mb-4" />

        {{-- Erstes Laden: Space-Meta noch nicht da → Skeleton-Card statt nackte Fläche. --}}
        <div x-show="!space && loading" x-cloak class="surface-card p-4" aria-busy="true">
            <span class="sr-only" aria-live="polite">{{ __('Space wird geladen…') }}</span>
            <div class="flex items-center gap-2">
                <div class="skeleton size-4"></div>
                <div class="skeleton h-4 w-32"></div>
            </div>
            <div class="mt-3 space-y-2">
                <div class="skeleton h-4 w-40"></div>
                <div class="skeleton h-4 w-28"></div>
                <div class="skeleton h-4 w-36"></div>
            </div>
        </div>

        {{-- Räume UND Threads als Tabs OBEN (Flux, Alpine-getrieben): die Räume-Liste kann
             lang werden — ein Tab-Umschalter hält beide auf einer Ebene, ohne Scrollen.
             Kein Bottom-Nav (das bräuchte ein neues Mobile-App-Icon). Erster Tab = Räume. --}}
        <div x-show="space" x-cloak>
            <flux:tab.group>
                <flux:tabs variant="segmented" x-model="tab">
                    {{-- Die Tab-Badges zeigen seit P6 UNGELESENES, nicht mehr den Bestand
                         (§4.4). Der Bestand steht als graue Mono-Zahl über der Liste. Grund:
                         sobald daneben irgendwo eine Ungelesen-Pille in derselben getönten
                         Form stand, las jeder Nutzer beide gleich — zwei Bedeutungen in einem
                         Zeichen (Nielsen #4).
                         Der Zählhinweis kommt als sr-only AUS DER KOMPONENTE (`sr=true`) und
                         NICHT als `::aria-label` am Flux-Tag: `flux:tab` reicht `$attributes`
                         an `button-or-link` durch und rendert `{{ $slot }}` als Kind, der
                         Accessible Name wächst also mit dem sr-Text von selbst — und ein
                         `@js()` in einer Flux-ATTRIBUTLISTE würde nicht ausgeführt, sondern
                         landete wörtlich im Alpine-Ausdruck (P5, am kompilierten View
                         gemessen). Der billigere Weg ist hier auch der richtige. --}}
                    <flux:tab name="rooms" icon="hashtag">
                        {{ __('Räume') }}
                        <x-group::unread-badge count="$store.unread?.roomsTotal" badge-class="ms-1.5"
                                               :sr-one="__('ungelesene Nachricht')" :sr-many="__('ungelesene Nachrichten')" />
                    </flux:tab>
                    <flux:tab name="threads" icon="chat-bubble-left-right">
                        {{ __('Threads') }}
                        <x-group::unread-badge count="$store.unread?.threadsTotal" badge-class="ms-1.5"
                                               :sr-one="__('neue Antwort')" :sr-many="__('neue Antworten')" />
                    </flux:tab>
                </flux:tabs>

                {{-- Tab „Räume" --}}
                <flux:tab.panel name="rooms" class="mt-3">
                    {{-- Admin: neuen Raum anlegen. Nur im Standard-Modus (Meetups sind Portal-verwaltet). --}}
                    <div x-show="isAdmin && !focusMode()" x-cloak class="mb-2 flex justify-end">
                        <flux:button size="sm" variant="primary" icon="plus" x-on:click="openRoomCreate()">{{ __('Raum') }}</flux:button>
                    </div>

                    {{-- ── Fokus-Kopf: Zurück · Suche · Land · Anzahl ────────────────────────
                         Standard-Räume sind der Default; eine Kategorie-Liste (Meetups über
                         die Entdecken-Karte, Projektunterstützung über „Alle anzeigen") öffnet
                         man bewusst. Der Kopf ist kategorie-agnostisch: nur der Land-Filter
                         hängt an den Meetups, weil allein sie ein Land tragen. --}}
                    <div x-show="space && focusMode()" x-cloak class="mb-2 space-y-2">
                        <button type="button" x-on:click="resetRoomFilters()"
                                class="pressable -ms-1 inline-flex min-h-[2.75rem] items-center gap-0.5 rounded-full py-1.5 pe-3 ps-1 text-sm font-semibold text-accent">
                            <flux:icon.chevron-left variant="micro" class="size-5" />
                            {{ __('Räume anzeigen') }}
                        </button>
                        {{-- Der Platzhalter wechselt mit der Kategorie. Die Texte hängen an
                             einem ROHEN Wrapper-Element, nicht am Flux-Attribut: Blade führt
                             `@js()` in einer Komponenten-Attributliste NICHT aus (es landete
                             wörtlich im Alpine-Ausdruck und der Platzhalter blieb leer —
                             gemessen am kompilierten View). Das Kind erbt den Alpine-Scope,
                             `x-model="roomQuery"` trifft also weiterhin nostrSpaces. --}}
                        <div x-data="{ phMeetups: @js(__('Meetup oder Stadt suchen…')), phProposals: @js(__('Antragsraum suchen…')) }">
                            <flux:input x-model="roomQuery" icon="magnifying-glass" clearable
                                        ::placeholder="proposalMode() ? phProposals : phMeetups" />
                        </div>

                        <div class="flex flex-wrap items-center gap-2">
                            {{-- Land-Auswahl → Alpine-Popover (kein flux:dropdown: das verschluckt
                                 rohe Kinder). Nur real vertretene Länder, meins zuerst.
                                 Nur im Meetup-Fokus: Antragsräume tragen kein Land. --}}
                            <div x-data="{ open: false }" x-show="countryFilterAvailable()" x-cloak class="relative">
                                <button type="button" x-on:click="open = !open"
                                        aria-haspopup="true" :aria-expanded="open"
                                        class="pressable inline-flex min-h-[2.75rem] items-center gap-2 rounded-pill px-3 text-sm font-medium ring-1 ring-inset transition-colors"
                                        :class="roomCountry ? 'bg-brand-500/10 text-brand-700 ring-brand-500/30 dark:text-brand-400' : 'text-zinc-700 ring-black/10 hover:bg-black/5 dark:text-zinc-200 dark:ring-white/15 dark:hover:bg-white/5'">
                                    <span x-show="!roomCountry" class="inline-flex items-center gap-1.5">
                                        <flux:icon.globe-alt variant="micro" class="size-4" />
                                        {{ __('Land') }}
                                    </span>
                                    <span x-show="roomCountry" x-cloak class="inline-flex items-center gap-1.5">
                                        <span x-text="countryFlag(roomCountry) + ' ' + countryName(roomCountry)"></span>
                                    </span>
                                    <flux:icon.chevron-down variant="micro" class="size-4 text-muted transition-transform" ::class="open ? 'rotate-180' : ''" />
                                </button>

                                <div x-show="open" x-cloak x-transition
                                     x-on:click.outside="open = false" x-on:keydown.escape.window="open = false"
                                     class="surface-card absolute start-0 z-30 mt-2 max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto p-1 shadow-lg">
                                    <button type="button" x-on:click="selectCountry(''); open = false"
                                            class="pressable flex min-h-[2.75rem] w-full items-center gap-2 rounded-tile px-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                            :class="!roomCountry ? 'font-semibold text-brand-700 dark:text-brand-400' : ''">
                                        <flux:icon.globe-alt class="size-4 shrink-0 text-muted" />
                                        <span class="flex-1">{{ __('Alle Länder') }}</span>
                                        <flux:icon.check x-show="!roomCountry" x-cloak class="size-4 shrink-0 text-brand-700 dark:text-brand-400" />
                                    </button>
                                    <template x-for="c in availableCountries()" :key="c.country">
                                        <button type="button" x-on:click="selectCountry(c.country); open = false"
                                                class="pressable flex min-h-[2.75rem] w-full items-center gap-2 rounded-tile px-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                                :class="roomCountry === c.country ? 'font-semibold text-brand-700 dark:text-brand-400' : ''">
                                            <span class="shrink-0 text-base leading-none" x-text="c.flag" aria-hidden="true"></span>
                                            <span class="min-w-0 flex-1 truncate" x-text="c.name"></span>
                                            <span class="shrink-0 font-mono text-xs text-muted" x-text="c.count"></span>
                                        </button>
                                    </template>
                                </div>
                            </div>
                        </div>

                        {{-- Aktive Filter (Suche + Land) sichtbar + einzeln/gesamt entfernbar. --}}
                        <div x-show="activeFilterCount() > 0" x-cloak class="flex flex-wrap items-center gap-1.5">
                            <template x-if="roomCountry && countryFilterAvailable()">
                                <button type="button" x-on:click="roomCountry = ''"
                                        class="chip-in pressable inline-flex items-center gap-1 rounded-pill bg-brand-500/10 py-1 pe-1.5 ps-2.5 text-xs font-medium text-brand-700 hover:bg-brand-500/20 dark:text-brand-400">
                                    <span aria-hidden="true" x-text="countryFlag(roomCountry)"></span>
                                    <span x-text="countryName(roomCountry)"></span>
                                    <flux:icon.x-mark variant="micro" class="size-3.5" />
                                </button>
                            </template>
                            <template x-if="roomQuery.trim()">
                                <button type="button" x-on:click="roomQuery = ''"
                                        class="chip-in pressable inline-flex items-center gap-1 rounded-pill bg-zinc-100 py-1 pe-1.5 ps-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                                    <span>„<span x-text="roomQuery.trim()"></span>"</span>
                                    <flux:icon.x-mark variant="micro" class="size-3.5" />
                                </button>
                            </template>
                            <button type="button" x-on:click="roomQuery = ''; roomCountry = ''"
                                    class="pressable ms-0.5 rounded-pill px-2 py-1 text-xs font-semibold text-accent hover:underline">
                                {{ __('Filter leeren') }}
                            </button>
                        </div>
                    </div>

                    {{-- Bestands-/Ergebniszähler (§4.4). Stand HIER schon immer, aber nur im
                         Fokus-Kopf — seit P6 in BEIDEN Modi, weil das Tab-Badge daneben jetzt
                         Ungelesenes trägt. Damit gilt im ganzen Client eine Regel, die man
                         ohne Legende liest: FARBIGE PILLE = ungelesen, GRAUE MONO-ZAHL =
                         Bestand. Zwei Zahlen in derselben Form (getönte Pille) wären zwei
                         Bedeutungen in einem Zeichen — Nielsen #4.
                         `visibleCount()` ist in beiden Modi das, was die Liste unten zeigt
                         (Standard: Meine+Andere+Anträge, Fokus: genau die eine gefilterte
                         Liste) — keine zweite Zählwahrheit neben der sichtbaren Liste.
                         Bei 0 keine Zeile: der Leerzustand in der Karte darunter sagt es
                         besser als eine „0". --}}
                    <div x-show="space && visibleCount() > 0" x-cloak class="mb-1 flex justify-end px-2">
                        <span class="shrink-0 font-mono text-xs text-muted">
                            <span x-text="visibleCount()"></span> {{ __('Räume') }}
                        </span>
                    </div>

                    <div class="surface-card overflow-hidden p-2">
                        {{-- Räume laden noch --}}
                        <template x-if="loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0">
                            <div class="space-y-2 p-1">
                                <div class="skeleton h-11 rounded-tile"></div>
                                <div class="skeleton h-11 rounded-tile"></div>
                            </div>
                        </template>

                        {{-- Vereins-gated: die Räume liefert der Relay gar nicht aus → erklärende Zeile. --}}
                        <template x-if="!loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0 && gatedOut">
                            <div class="empty-state py-6 text-center">
                                <flux:icon.lock-closed class="mx-auto size-8 text-zinc-400" />
                                <flux:text class="mt-2 text-sm">{{ __('Räume sind nur für Vereinsmitglieder sichtbar.') }}</flux:text>
                            </div>
                        </template>

                        {{-- Wirklich leer: kein einziger Raum (auch kein Meetup). --}}
                        <template x-if="!loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0 && !gatedOut">
                            <div class="empty-state py-6 text-center">
                                <flux:icon.hashtag class="mx-auto size-8 text-zinc-400" />
                                <flux:text class="mt-2 text-sm">{{ __('Dieser Space hat noch keine Räume.') }}</flux:text>
                            </div>
                        </template>

                        {{-- ── Standard-Modus: Meine · Andere · Entdecken ──────────────────── --}}

                        {{-- Meine Räume (beigetreten laut 39002). Einheitliche room-tile-Zeilen —
                             beigetretene Meetups tragen NUR ein dezentes Flaggen-Badge am Icon
                             (gleiche Zeilenhöhe). Die reiche Meetup-Kachel bleibt der
                             Entdecken-Liste (focusMode) vorbehalten. --}}
                        <template x-if="!focusMode() && filteredMine().length > 0">
                            <div>
                                <p class="px-2 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Meine Räume') }}</p>
                                <div class="space-y-0.5">
                                    <template x-for="room in filteredMine()" :key="room.h">
                                        <x-group::room-tile />
                                    </template>
                                </div>
                            </div>
                        </template>

                        {{-- Andere Räume (entdeckbar; ohne kategorisierte: kein Meetup, keine Projektunterstützung). --}}
                        <template x-if="!focusMode() && filteredOther().length > 0">
                            <div :class="filteredMine().length > 0 ? 'mt-2' : ''">
                                <p class="px-2 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Andere Räume') }}</p>
                                <div class="space-y-0.5">
                                    <template x-for="room in filteredOther()" :key="room.h">
                                        <x-group::room-tile />
                                    </template>
                                </div>
                            </div>
                        </template>

                        {{-- Projektunterstützung (Antragsräume, ["t","project-support"]).
                             Eigene Sektion statt verstreut zwischen den Standard-Räumen.
                             Der Pool ist bereits gegated: eigene Anträge sieht jeder
                             Antragsteller, FREMDE nur der Vorstand (isAdmin) — siehe
                             _proposalPool(). Keine Sektion, wenn nichts sichtbar ist. --}}
                        <template x-if="!focusMode() && filteredProposals().length > 0">
                            <div :class="(filteredMine().length > 0 || filteredOther().length > 0) ? 'mt-2' : ''">
                                {{-- Kopfzeile mit Einstieg in den Fokus: ein schlichter Textlink,
                                     KEINE Entdecken-Karte. Gemessen (P0/M2, Prod-Relay) gibt es
                                     zwei Antragsräume — eine Karte versteckte zwei Zeilen hinter
                                     einem Klick und machte die Sektion unsichtbar. --}}
                                <div class="flex items-center gap-2 px-2 pb-1">
                                    <p class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Projektunterstützung') }}</p>
                                    <button type="button" x-on:click="selectRoomType('proposals')"
                                            class="pressable ms-auto shrink-0 rounded-pill px-1.5 py-0.5 text-[0.7rem] font-semibold text-accent hover:underline">
                                        {{ __('Alle anzeigen') }}
                                    </button>
                                </div>
                                <div class="space-y-0.5">
                                    <template x-for="room in filteredProposals()" :key="room.h">
                                        <x-group::room-tile />
                                    </template>
                                </div>
                            </div>
                        </template>

                        {{-- Noch keine Standard-Räume, aber Meetups existieren → kurzer Hinweis. --}}
                        <template x-if="!focusMode() && !loading && space && !gatedOut && (space.userRooms.length + space.otherRooms.length) > 0 && filteredMine().length === 0 && filteredOther().length === 0 && filteredProposals().length === 0">
                            <p class="px-2 py-3 text-sm text-muted">{{ __('Noch keine Standard-Räume in diesem Space.') }}</p>
                        </template>

                        {{-- Entdecken-Karte: der bewusste Schritt in die Meetup-Liste. Zeigt
                             Umfang (Gruppen · Länder) an, damit der Klick sich lohnt. --}}
                        <template x-if="!focusMode() && meetupCount() > 0">
                            <button type="button" x-on:click="selectRoomType('meetups')"
                                    :class="(filteredMine().length > 0 || filteredOther().length > 0) ? 'mt-2 border-t border-zinc-200/60 dark:border-zinc-800/60' : ''"
                                    class="pressable group flex w-full items-center gap-3 rounded-tile p-2 text-left transition-colors hover:bg-brand-500/5">
                                <span class="flex size-10 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-brand-700 dark:text-brand-400">
                                    <flux:icon.map-pin class="size-5" />
                                </span>
                                <span class="min-w-0 flex-1">
                                    <span class="block font-medium">{{ __('Meetup-Räume entdecken') }}</span>
                                    <span class="mt-0.5 block text-[0.8rem] text-muted">
                                        <span x-text="meetupCount()"></span> {{ __('Gruppen in') }} <span x-text="availableCountries().length"></span> {{ __('Ländern') }}
                                    </span>
                                </span>
                                <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5" />
                            </button>
                        </template>

                        {{-- ── Meetup-Fokus: aktivitätssortierte Liste (2-spaltig auf lg) ────── --}}

                        {{-- Filter greift leer → Treffer-Leerzustand; „Filter leeren" bleibt im Modus. --}}
                        <template x-if="meetupMode() && !loading && meetupCount() > 0 && filteredMeetups().length === 0">
                            <div class="empty-state py-8 text-center">
                                <flux:icon.magnifying-glass class="mx-auto size-8 text-zinc-400" />
                                <flux:text class="mt-2 text-sm">{{ __('Keine Meetups passen zu deiner Suche.') }}</flux:text>
                                <div class="mt-3">
                                    <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="roomQuery = ''; roomCountry = ''">{{ __('Filter leeren') }}</flux:button>
                                </div>
                            </div>
                        </template>

                        {{-- Die Liste: 1 Spalte mobil, 2 Spalten auf lg (nutzt die Breite). --}}
                        <template x-if="meetupMode() && filteredMeetups().length > 0">
                            <div class="grid grid-cols-1 gap-x-3 gap-y-0.5 lg:grid-cols-2">
                                <template x-for="room in filteredMeetups()" :key="room.h">
                                    <x-group::meetup-tile />
                                </template>
                            </div>
                        </template>

                        {{-- ── Antrags-Fokus (Projektunterstützung): dieselben room-tile-Zeilen
                             wie in der Sektion. Keine reiche Kachel — Antragsräume haben
                             keinen Portal-Join (kein Land, kein Termin, keine Flagge).
                             Der Pool ist gegated (eigene Anträge jeder, fremde nur der
                             Vorstand) — siehe _proposalPool(). --}}
                        <template x-if="proposalMode() && filteredProposals().length > 0">
                            <div class="space-y-0.5">
                                <template x-for="room in filteredProposals()" :key="room.h">
                                    <x-group::room-tile />
                                </template>
                            </div>
                        </template>

                        {{-- Suche greift leer → Treffer-Leerzustand des Antrags-Fokus. --}}
                        <template x-if="proposalMode() && !loading && proposalCount() > 0 && filteredProposals().length === 0">
                            <div class="empty-state py-8 text-center">
                                <flux:icon.magnifying-glass class="mx-auto size-8 text-zinc-400" />
                                <flux:text class="mt-2 text-sm">{{ __('Keine Antragsräume passen zu deiner Suche.') }}</flux:text>
                                <div class="mt-3">
                                    <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="roomQuery = ''">{{ __('Filter leeren') }}</flux:button>
                                </div>
                            </div>
                        </template>

                        {{-- Antrags-Fokus ohne einen einzigen sichtbaren Antragsraum (z. B. per
                             Deep-Link `?rt=proposals` geöffnet): erklären statt leer bleiben. --}}
                        <template x-if="proposalMode() && !loading && space && proposalCount() === 0">
                            <div class="empty-state py-8 text-center">
                                <flux:icon.document-text class="mx-auto size-8 text-zinc-400" />
                                <flux:text class="mt-2 text-sm">{{ __('Keine Antragsräume für dich sichtbar.') }}</flux:text>
                                <div class="mt-3">
                                    <flux:button size="sm" variant="ghost" icon="arrow-left" x-on:click="resetRoomFilters()">{{ __('Räume anzeigen') }}</flux:button>
                                </div>
                            </div>
                        </template>
                    </div>
                </flux:tab.panel>

                {{-- Tab „Threads" (C6b): aktive Threads des Space, RAUMÜBERGREIFEND. Klick öffnet
                     den Thread direkt im jeweiligen Raum (Deep-Link ?thread=). Slack-Stil:
                     Gesichter + Autor + Raum-Badge + „N Antworten · vor …". --}}
                <flux:tab.panel name="threads" class="mt-3">
                    {{-- Dieselbe Bestandszeile wie im Räume-Tab (§4.4). Sie steht hier, weil
                         das Threads-Tab-Badge dieselbe Wanderung mitmacht: die Bestandszahl
                         verlässt die Pille, sonst hätte der eine Tab eine Regel und der
                         andere eine Ausnahme. --}}
                    <div x-show="threads.length > 0" x-cloak class="mb-1 flex justify-end px-2">
                        <span class="shrink-0 font-mono text-xs text-muted">
                            <span x-text="threads.length"></span> {{ __('Threads') }}
                        </span>
                    </div>

                    <div class="surface-card overflow-hidden">
                        <template x-if="threads.length === 0">
                            <div class="empty-state py-8 text-center">
                                <flux:icon.chat-bubble-left-right class="mx-auto size-8 text-zinc-400" />
                                <flux:text class="mt-2 text-sm">{{ __('Noch keine Threads. Antworte im Thread auf eine Nachricht, um einen zu starten.') }}</flux:text>
                            </div>
                        </template>
                        <div x-show="threads.length > 0" x-cloak class="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                            <template x-for="t in threads" :key="t.rootId">
                                <button type="button"
                                        x-on:click="Livewire.navigate('/rooms/' + encodeURIComponent(t.roomH) + '/thread/' + t.nevent)"
                                        :disabled="!t.roomH"
                                        {{-- aria-label ERSETZT den Kindtext → der Ungelesen-Hinweis muss hier
                                             hinein, ein sr-only im Marker käme nie an. Defensiv: fehlt der
                                             `unread`-Store, liefert der Ausdruck '' (kein Hinweis).
                                             ZWEI Zahlen in einem Label, darum verschieden benannt: `t.count`
                                             ist der BESTAND („4 Antworten"), die Store-Zahl das UNGELESENE
                                             („2 neue Antworten"). Ungekappt — siehe unread-badge. --}}
                                        :aria-label="(t.authorName || @js(__('Nachricht'))) + ': ' + t.snippet + ' — ' + t.count + @js(__(' Antworten, öffnen')) + ($store.unread?.threads?.[t.rootId] ? ', ' + $store.unread.threads[t.rootId] + ($store.unread.threads[t.rootId] === 1 ? @js(' '.__('neue Antwort')) : @js(' '.__('neue Antworten'))) : '')"
                                        class="pressable flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-brand-500/5 disabled:cursor-default disabled:opacity-60">
                                    <span class="min-w-0 flex-1">
                                        {{-- Raum-Kontext (raumübergreifende Liste): nur zeigen, wenn `roomName`
                                             gegen die geladenen Space-Räume real auflöst — sonst nichts (kein roher h-Tag). --}}
                                        <span x-show="roomName(t.roomH) !== t.roomH" x-cloak
                                              class="mb-1 flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
                                            <flux:icon.hashtag class="size-3 shrink-0" />
                                            <span class="truncate" x-text="roomName(t.roomH)"></span>
                                        </span>
                                        {{-- Autor: Hierarchie durch Kontrast, nicht nur Größe (Refactoring UI).
                                             Ungelesen trägt hier ZWEIFACH — Punkt am Zeilenende plus Gewicht
                                             am Titel: anders als in der Raum-Zeile steht der Marker weit vom
                                             Titel entfernt (drei Zeilen Inhalt dazwischen). Rohes <span> →
                                             einfaches `:class`, KEIN `::class` (das ist die Flux-Konvention).
                                             Ohne Store fällt der Ausdruck auf font-medium, also auf „gelesen". --}}
                                        <span class="block truncate text-sm text-zinc-900 dark:text-zinc-100"
                                              :class="$store.unread?.threads?.[t.rootId] ? 'font-bold' : 'font-semibold'"
                                              x-text="t.authorName || @js(__('Nachricht'))"></span>
                                        {{-- Vorschau: bis zu 2 Zeilen mit Fließtext-Zeilenhöhe statt 1 harter Zeile
                                             (das Kern-Lesbarkeitsproblem). KEIN `block` daneben: `line-clamp-2`
                                             setzt `display: -webkit-box` selbst, und `-webkit-line-clamp` wirkt
                                             NUR darauf. Gleiche Spezifität, `.block` steht im gebauten Bundle
                                             später → die Kappung fiel still aus und ein langer Thread-Auszug
                                             sprengte die Zeilenhöhe. Gemessen, nicht gerechnet. --}}
                                        <span class="mt-1 text-sm leading-normal text-muted line-clamp-2"
                                              x-text="t.snippet || @js(__('(Nachricht wird geladen…)'))"></span>
                                        {{-- Meta: Teilnehmer-Gesichter (überlappend, jüngste zuerst) neben Anzahl + Zeit —
                                             ein Akzent (Anzahl) pro Zeile, der Rest dezent. --}}
                                        <span class="mt-2 flex items-center gap-2 text-xs">
                                            <span x-show="t.faces.length > 0" class="flex shrink-0 -space-x-1.5">
                                                <template x-for="f in t.faces" :key="f.pubkey">
                                                    <span class="inline-flex rounded-full ring-2 ring-white dark:ring-zinc-900">
                                                        <x-group::nostr-avatar picture="f.picture" name="f.name" size="1.25rem" />
                                                    </span>
                                                </template>
                                            </span>
                                            <span class="min-w-0 truncate">
                                                <span class="font-semibold text-brand-800 dark:text-brand-400" x-text="t.count + (t.count === 1 ? @js(__(' Antwort')) : @js(__(' Antworten')))"></span>
                                                <span class="text-muted" x-text="' · ' + t.lastLabel"></span>
                                            </span>
                                        </span>
                                    </span>
                                    {{-- Ungelesen: Zähler-Pille rechts, vor dem Chevron — dieselbe Stelle wie
                                         in Raum- und Meetup-Kachel. `sr=false`: siehe aria-label des Buttons.
                                         Der Titel oben trägt ZUSÄTZLICH mit (font-bold): anders als in der
                                         Raum-Zeile liegen hier drei Zeilen Inhalt zwischen Titel und Marker. --}}
                                    <x-group::unread-badge count="$store.unread?.threads?.[t.rootId]" :sr="false" />
                                    <flux:icon.chevron-right class="size-4 shrink-0 text-muted" />
                                </button>
                            </template>
                        </div>
                    </div>
                </flux:tab.panel>
            </flux:tab.group>
        </div>

        {{-- ── Raum-Verwaltung (P4, Admin) ──────────────────────────────────── --}}

        {{-- Raum anlegen/bearbeiten (NIP-29 9007/9002). Leeres roomForm.h = Anlegen. --}}
        <flux:modal name="room-form" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg" x-text="roomForm.h ? @js(__('Raum bearbeiten')) : @js(__('Neuer Raum'))"></flux:heading>

                {{-- Raumbild: runde-eckige Vorschau + „wählen". Upload erst beim Speichern. --}}
                <div class="flex items-center gap-3">
                    <div class="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-tile bg-zinc-100 dark:bg-zinc-800">
                        <img x-show="roomForm.picture" :src="roomForm.picture" alt="" class="size-full object-cover" />
                        <span x-show="!roomForm.picture" class="font-mono text-lg font-semibold text-zinc-400">#</span>
                    </div>
                    <flux:button size="sm" variant="ghost" icon="photo" x-on:click="$refs.roomPic.click()">{{ __('Bild wählen') }}</flux:button>
                    <input type="file" accept="image/*" class="hidden" x-ref="roomPic" x-on:change="pickRoomPicture($event.target)" />
                </div>

                <flux:input label="{{ __('Name') }}" x-model="roomForm.name" placeholder="{{ __('z.B. Allgemein') }}" />
                <flux:textarea label="{{ __('Beschreibung') }}" x-model="roomForm.about" rows="2" placeholder="{{ __('Optional') }}" />

                {{-- Native Checkboxen (zuverlässiges x-model) statt Flux-Komponente.
                     „closed" = Beitritt braucht Admin-Freigabe → Anfragen landen in der
                     Beitritts-Queue (Mitglieder-Tab → Meldungen/Beitritte). --}}
                <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" x-model="roomForm.isPrivate" class="accent-brand-500" />
                    {{ __('Privater Raum (nur Mitglieder)') }}
                </label>
                <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" x-model="roomForm.isClosed" class="accent-brand-500" />
                    {{ __('Beitritt nur mit Freigabe') }}
                </label>

                <div class="flex justify-end gap-2">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                    <flux:button variant="primary" x-on:click="saveRoom()" ::disabled="roomSaving || !roomForm.name.trim()">{{ __('Speichern') }}</flux:button>
                </div>
            </div>
        </flux:modal>

        {{-- Raum löschen (NIP-29 9008 → 39000-Tombstone). --}}
        <flux:modal name="delete-room" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Raum löschen?') }}</flux:heading>
                <flux:text>{{ __('Dieser Raum wird für alle entfernt. Das lässt sich nicht rückgängig machen.') }}</flux:text>
                <div class="surface-card rounded-tile p-2 text-sm font-medium" x-text="pendingRoomDelete?.name"></div>
                <div class="flex justify-end gap-2">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                    <flux:button variant="danger" x-on:click="confirmDeleteRoom()" ::disabled="roomSaving">{{ __('Löschen') }}</flux:button>
                </div>
            </div>
        </flux:modal>

        {{-- Raum-Mitglieder (P4b): 39002-Liste + Hinzufügen (npub → 9000)/Entfernen (9001).
             x-on:close räumt die Live-Subscription ab. --}}
        <flux:modal name="room-members" class="max-w-sm" x-on:close="closeRoomMembers()">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Mitglieder') }} <span class="text-muted" x-text="membersRoom ? '# ' + membersRoom.name : ''"></span></flux:heading>

                {{-- Hinzufügen per npub/hex. --}}
                <div class="flex items-end gap-2">
                    <flux:input class="flex-1" label="{{ __('npub hinzufügen') }}" x-model="memberNpub" placeholder="npub1…" />
                    <flux:button variant="primary" icon="user-plus" x-on:click="addRoomMemberByNpub()" ::disabled="memberBusy || !memberNpub.trim()" aria-label="{{ __('Hinzufügen') }}" />
                </div>

                <template x-if="roomMembers.length === 0">
                    <flux:text class="text-sm text-muted">{{ __('Noch keine Mitglieder in diesem Raum.') }}</flux:text>
                </template>
                <div class="space-y-2">
                    <template x-for="m in roomMembers" :key="m.pubkey">
                        <div class="surface-card flex items-center gap-3 p-2">
                            <button type="button" x-on:click="$dispatch('open-profile', m.pubkey)" class="pressable shrink-0" aria-label="{{ __('Profil anzeigen') }}">
                                <x-group::nostr-avatar picture="m.picture" name="m.name" />
                            </button>
                            <div class="min-w-0 flex-1">
                                <div class="truncate text-sm font-medium" x-text="m.name"></div>
                                <div class="truncate font-mono text-xs text-muted" x-text="m.short"></div>
                            </div>
                            <flux:button size="xs" variant="ghost" icon="user-minus" class="icon-btn-touch shrink-0" x-on:click="kickRoomMember(m.pubkey)" ::disabled="memberBusy" aria-label="{{ __('Entfernen') }}" />
                        </div>
                    </template>
                </div>
            </div>
        </flux:modal>

        <x-group::profile-card />
    </div>

</x-group::app-shell>
