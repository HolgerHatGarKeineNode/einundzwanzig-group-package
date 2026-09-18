{{-- Befehlspalette (P4) — ein Feld für Räume, Mitglieder, Spaces und Aktionen.

     ── Warum sie im Layout hängt ────────────────────────────────────────────
     EINMAL neben `login-sheet` gemountet, außerhalb des `$slot`: nur so überlebt
     sie `wire:navigate` und steht auf JEDER Seite, auch auf den chrome-losen.
     Vorher hing ⌘K an der Rail, und die existiert erst ab `xl` (`x-if` am
     Viewport-Store) — unterhalb gab es die Taste gar nicht. Der Listener ist in
     `js/palette.ts` UMGEZOGEN, nicht kopiert; in `rail.ts` steht kein ⌘K mehr.

     ── Die Grammatik ist die der Rail ───────────────────────────────────────
     `r:` `m:` `p:` `w:` und ein Ländercode (`de:`) grenzen auf eine Raumgruppe
     ein — dieselbe `parseScope()`, die die Rail benutzt. Dazu genau zwei Sigel:
     `@` für Mitglieder, `>` für Aktionen. Das erkannte Präfix wandert in den Chip
     vor dem Feld (Muster: `desktop-rail`). Kein zweites `g r`/`g s`-Schema.

     ── Was Flux liefert ─────────────────────────────────────────────────────
     `flux:command` ist ein `<ui-select filter>`: Textfilterung, ↑/↓/↵ und der
     Leerzustand kommen aus `flux-pro/dist/flux.js` und werden NICHT nachgebaut.
     Was Flux nicht kennt, sind Sektionen — es gibt keine Gruppen-Komponente. Die
     Überschriften stehen deshalb als eigene Zeilen zwischen den Optionen, und
     ihre Sichtbarkeit leitet die Insel aus Flux' eigenem `[data-hidden]` ab.

     ── Farbe ────────────────────────────────────────────────────────────────
     Die Flux-Stubs sind auf `bg-white dark:bg-zinc-700` verdrahtet; `zinc-700`
     ist HELLER als der Kartengrund `dark:bg-zinc-900` und ließe Feld und Liste
     als hellen Block über der Karte schweben. Feld, Liste und Karte tragen
     deshalb denselben Wert — gemessen über die Computed-Styles, nicht nach
     Augenschein. --}}

@php($paletteActions = [
    ['id' => 'start', 'label' => __('Start'), 'href' => route(config('group.start_route', 'group.start'))],
    ['id' => 'spaces', 'label' => __('Alle Räume & Entdecken'), 'href' => route('group.bereich.chat')],
    ['id' => 'directory', 'label' => __('Mitgliederverzeichnis'), 'href' => route('group.bereich.leute')],
    ['id' => 'articles', 'label' => __('Artikel'), 'href' => route('group.bereich.artikel')],
    // P6 — die Forge gibt es nur mit konfiguriertem Workspace. `array_filter` unten
    // wirft den Eintrag sonst raus: ein Palettenbefehl, der in einen Leerzustand
    // führt, ist schlechter als kein Befehl.
    config('group.workspace_url') ? ['id' => 'forge', 'label' => __('Forge'), 'href' => route('group.bereich.forge')] : null,
    ['id' => 'updates', 'label' => __('Postfach'), 'href' => route('group.postfach')],
    // P2 — Lesezeichen. Ohne Bedingung: die Liste gehört dem Nutzer, nicht dem Space,
    // und ist auf jedem Relay lesbar (NIP-51 10003). Ein leerer Screen ist hier eine
    // Aussage („noch nichts gemerkt") und kein Sackgassen-Zustand wie bei der Forge.
    ['id' => 'bookmarks', 'label' => __('Lesezeichen'), 'href' => route('group.ich.lesezeichen')],
    // P7 — encrypted conversations (NIP-17). Unconditional, for the same reason as the
    // bookmarks entry: the screen itself says what the space can do. A Buzz space refuses
    // the delivery list (10050) but carries messages between its members regardless, so
    // the empty state is a statement rather than a dead end.
    ['id' => 'messages', 'label' => __('Verschlüsselt'), 'href' => route('group.postfach', ['ansicht' => 'direkt'])],
    ['id' => 'wallet', 'label' => __('Wallet'), 'href' => route('group.bereich.wallet')],
    /*
     * P4/D8 — the two wallet ACTIONS. Not a second way to the wallet page but the two
     * things people go there for, addressable by name: "Zahlen" and "Rechnung erstellen".
     *
     * The intent travels in the ADDRESS (`?aktion=`) and not as a browser event, and that
     * is not a style choice: in the app the wallet island boots only on a full document
     * load, so an event dispatched before the navigation would be gone by the time the
     * island exists. `js/bridge.ts` (`nostrWallet.init`) reads the parameter once, opens
     * the sheet and removes it from the address again.
     */
    ['id' => 'wallet-empfangen', 'label' => __('Rechnung erstellen'), 'href' => route('group.bereich.wallet', ['aktion' => 'empfangen'])],
    ['id' => 'wallet-senden', 'label' => __('Zahlen'), 'href' => route('group.bereich.wallet', ['aktion' => 'senden'])],
    /*
     * P5/D12 — „Zusagen". The one action WITHOUT an `href`, and that is the point: it is not a
     * destination but a question („which date?"). It lifts the `z:` chip and leaves the palette
     * open with the dates of the reader's own meetups; Enter on one of them publishes the kind
     * 31925 through the same store and the same relay set as the meetup page
     * (`js/rsvpTermine.ts`). A page for this does not exist and should not: the list belongs
     * where the question was asked.
     *
     * Unconditional, like the two wallet actions above: without pinned or joined meetups the
     * section is empty, and an empty list under an explicit question is an ANSWER („you have
     * not marked a meetup yet"), not a dead end.
     */
    ['id' => 'zusagen', 'label' => __('Zusagen'), 'scope' => 'zusagen'],
    // ── Der Einstellungen-Eintrag zeigt auf die Route, die der HOST dafür nennt ──
    // Der Mobile-Host hat seine Einstellungen in P6 mit den Portal-Prefs auf EINEM
    // Screen verschmolzen (`pages/profile`, dort inline dieselben
    // `group::partials.settings.*`) — NOT ANY MORE since P2: its app-only sections are
    // injected into THIS hub (`view:` entries of the `settings` registry). The config
    // line stays all the same, because it answers a question a foreign host may answer
    // differently (Nielsen #4: not two places for one thing).
    // `settings_route` ist die Config-Zeile je Host; Default ist die
    // package-eigene Route, der Web-Client bleibt damit zeichengleich.
    ['id' => 'settings', 'label' => __('Einstellungen'), 'href' => route(config('group.settings_route', 'group.ich.einstellungen'))],
    ['id' => 'ich', 'label' => __('Ich'), 'href' => route(config('group.me_route', 'group.ich'))],
])
@php($paletteActions = array_values(array_filter($paletteActions)))
{{-- Ein Stil für alle Tastenkappen: derselbe wie am Rail-Prompt. --}}
@php($kbd = 'shrink-0 rounded-pill border border-zinc-300 px-2 py-0.5 text-[11px] leading-none text-muted dark:border-border-strong')

<div x-data="nostrPalette(@js(['actions' => $paletteActions]))"
     x-on:open-command-palette.window="open()"
     data-palette>

    {{-- `variant="bare"` nimmt dem Dialog Padding, Ring und Hintergrund — die
         Karte darunter bringt beides selbst mit, sonst lägen zwei Flächen
         übereinander. Unterhalb `sm` ein Vollbild-Sheet (`inset-0` via `m-0` +
         `h-dvh`, `pt-safe`/`pb-safe`), darüber ein oben verankerter Dialog: eine
         mittig zentrierte Palette zieht das Auge unter das Feld, in dem gerade
         getippt wird. --}}
    <flux:modal name="command-palette"
                variant="bare"
                x-on:close="onClose()"
                class="m-0 h-dvh max-h-none w-full max-w-none sm:mx-auto sm:mt-[10dvh] sm:mb-auto sm:h-auto sm:w-[92vw] sm:max-w-xl">

        {{-- P3 (Entwurf C §2 `.cmdk`): die Palette ist das Overlay — Grund #141415
              (`--color-overlay`), Radius 16 (`--radius-overlay`), Kante #3a3a3e
              (`border-strong`), Schatten 0 30px 80px (`--shadow-overlay`). Keine
              zweite Fläche darunter: Feld, Chips und Liste stehen ALLE auf dem
              Overlay, getrennt nur durch Haarlinien (border-card/-border). --}}
            <div data-palette-card class="flex h-full flex-col overflow-hidden border border-zinc-200 bg-white pt-safe pb-safe shadow-pop dark:border-border-strong dark:bg-overlay dark:shadow-overlay sm:h-auto sm:rounded-overlay sm:pt-0 sm:pb-0">

            {{-- `!` an genau vier Stellen, und zwar bewusst: der Stub setzt
                 `block`, `rounded-xl`, `border` und `shadow-xs` fest. Gegen eine
                 gleich spezifische Utility entscheidet die Reihenfolge im
                 GEBAUTEN Stylesheet, nicht die im Markup — ohne `!` wäre das
                 Ergebnis Zufall. Die Kante und die Rundung trägt hier die Karte,
                 nicht das Feld-Bündel. --}}
            <flux:command class="flex! rounded-none! border-0! shadow-none! min-h-0 flex-1 flex-col">

                {{-- Prompt-Zeile: Sigel · Chip · Feld · Schließen.
                     Das Sigel ist die Signatur des Clients (der `#`-Prompt der
                     Rail) und hier zugleich die Anzeige des Bereichs: `#` Räume,
                     `@` Mitglieder, `>` Aktionen. Ein Zeichen sagt, was gerade
                     adressiert wird — dieselbe Marke steht vor jeder Zeile ihrer
                     Sektion. --}}
                <div class="flex shrink-0 items-center gap-2.5 border-b border-zinc-200 bg-white px-4 dark:border-border-card dark:bg-overlay">
                    {{-- P3: die Lupe ersetzt das Sigel — das Artboard zeigt hier das
                         orange Such-Icon; WELCHER Bereich adressiert wird, sagt der
                         Chip daneben (Text + x, aussagekräftiger als ein Zeichen). --}}
                    <flux:icon.magnifying-glass variant="micro" aria-hidden="true"
                                                 class="sw-18 size-5 shrink-0 text-accent" />

                    {{-- P3: die fünf Labels hier waren ein Präfix-Schlüssel plus angehängter
                         Name („Raum: " + room.name). Der Übersetzer sah den Doppelpunkt ohne
                         das, was danach kommt, und konnte die Stellung nicht wählen. Jetzt EIN Satz
                         mit Platzhalter, gefüllt im Browser (der Name ist reaktiv).
                         `.split(…).join(…)` statt `.replace(…)`, weil die Werte aus fremden
                         kind-0/39000-Ereignissen stammen: in `String.replace` sind `$&`,
                         `$'` und `$$` im ERSATZ Sonderzeichen, in `join` nicht. Dieselbe
                         Regel wie `fill()` in `js/i18n.ts`. Wo der Wert eine Zahl ist,
                         steht weiterhin `.replace()`. --}}
                    <template x-if="hasScope">
                        <button type="button" x-on:click.stop.prevent="clearScope()"
                                x-bind:aria-label="@js(__('Suchbereich aufheben: :label')).split(':label').join(scopeLabel)"
                                data-palette-chip
                                class="pressable inline-flex min-h-8 shrink-0 items-center gap-1 rounded-pill border border-accent bg-accent px-3 text-sm font-extrabold text-on-accent">
                            <span x-text="scopeLabel"></span>
                            <flux:icon.x-mark variant="micro" aria-hidden="true" class="size-3" />
                        </button>
                    </template>

                    {{-- Eigener Wrapper, weil `flux:command.input` sein `class` an
                         den <input> reicht, nicht an dessen Hülle — ohne ihn wäre
                         das Feld in dieser Flex-Zeile inhaltsbreit statt voll.
                         `icon=""` leert den Icon-Slot des Stubs: die Marke steht
                         schon links, ein zweites Symbol wäre Dekor. --}}
                    <div class="min-w-0 flex-1">
                        <flux:command.input
                            icon=""
                            autofocus
                            data-palette-input
                            x-model="query"
                            x-on:input="lift()"
                            x-on:keydown.escape.stop.prevent="onEscape()"
                            {{-- P5 — Enter löst die Relay-Suche aus, aber NUR im
                                 Workspace-Scope (`onEnter()` prüft das selbst).
                                 Kein `.stop`: Flux' eigener Enter-Handler hängt am
                                 SELBEN Element, und `stopPropagation` hielte ihn
                                 ohnehin nicht auf. Er läuft ins Leere, weil im
                                 Workspace-Scope keine Option existiert, die er
                                 aktivieren könnte (siehe `visibleSections`). --}}
                            x-on:keydown.enter="onEnter()"
                            autocomplete="off"
                            autocorrect="off"
                            spellcheck="false"
                            x-bind:placeholder="hasScope ? @js(__('Filtern…')) : @js(__('Springen, suchen, ausführen…'))"
                            aria-label="{{ __('Suchen und springen') }}"
                            class="ps-0! border-b-0! bg-white dark:bg-zinc-900" />
                    </div>

                    <flux:modal.close>
                        <flux:button variant="subtle" size="sm" icon="x-mark" class="icon-btn-touch shrink-0"
                                     aria-label="{{ __('Schließen') }}" />
                    </flux:modal.close>
                </div>

                {{-- Die scrollende Fläche. `dvh` statt `vh`: die Adressleiste auf
                     Android ändert `vh` nicht mit, die Liste ragte dann unter den
                     Bildschirmrand. Im Vollbild-Sheet gibt es keine Deckelung —
                     dort IST die Palette der Bildschirm. --}}
                {{-- P3 (Entwurf C `screen-desktop`): Filter-Chips — die klickbare Form
                     der Bereichs-Grammatik, dieselbe wie die Token im Feld (`r:`, `@`,
                     `>`). „Alles" brennt im Leerzustand; ein Chip und ein getipptes
                     Token desselben Bereichs lassen denselben Chip angehen, weil beide
                     `this.scope` lesen — eine Quelle, kein zweiter Filterbegriff.
                     Aktiv = orange gefüllt, Text #0b0b0c, 800 (Spec §2 `.chip.on`);
                     inaktiv = Ghost mit Chip-Kante #2f2f33 und fg-2. `aria-pressed`
                     trägt den Zustand zusätzlich zur Farbe (WCAG 1.4.1). --}}
                <div class="flex shrink-0 flex-wrap gap-1.5 border-b border-zinc-200 px-4 py-2.5 dark:border-border">
                    @php($paletteChips = [
                        ['label' => __('Alles'), 'section' => null],
                        ['label' => __('Räume'), 'section' => 'rooms'],
                        ['label' => __('Mitglieder'), 'section' => 'members'],
                        ['label' => __('Meetups im Portal'), 'section' => 'meetups'],
                        ['label' => __('Kurse'), 'section' => 'courses'],
                        ['label' => __('Aktionen'), 'section' => 'actions'],
                    ])
                    @foreach ($paletteChips as $chip)
                        <button type="button"
                                x-on:click.stop.prevent="setChipScope(@js($chip['section']))"
                                x-bind:aria-pressed="chipActive(@js($chip['section'])) ? 'true' : 'false'"
                                class="pressable inline-flex h-8 items-center whitespace-nowrap rounded-pill border px-3 text-sm transition-colors"
                                x-bind:class="chipActive(@js($chip['section']))
                                    ? 'border-accent bg-accent font-extrabold text-on-accent'
                                    : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-border-chip dark:bg-transparent dark:text-zinc-300 dark:hover:bg-white/5'">
                            {{ $chip['label'] }}
                        </button>
                    @endforeach
                </div>

                <flux:command.items
                    data-palette-items
                    class="min-h-0 max-h-none flex-1 overflow-y-auto bg-white px-2 py-2 dark:bg-overlay sm:max-h-[60dvh] sm:flex-none">

                    {{-- Eigener Leerzustand statt `flux:command.empty`. Zwei
                         gemessene Gründe, beide in `palette.ts` bei `_syncHeadings`
                         ausgeschrieben: Flux rechnet ihn nur bei geändertem
                         SUCHTEXT nach (unsere Zeilen kommen aber aus Alpine, bei
                         gleichem Text) — und von außen nachhelfen lässt es nicht
                         zu, weil es `data-hidden` mit einem eigenen Beobachter
                         gegen fremde Schreibzugriffe verteidigt. Sein eigener,
                         englischer Knoten wird in `theme.css` ausgeblendet.
                         `role="status"` meldet den Zustand auch dem Screenreader. --}}
                    <div data-palette-empty hidden role="status"
                         class="flex h-10 items-center justify-center text-sm font-medium text-muted">{{ __('Nichts gefunden.') }}</div>

                    {{-- ── Räume ──────────────────────────────────────────────
                         Ohne Eingabe die zuletzt benutzten fünf; sobald gesucht
                         oder eingegrenzt wird, der volle Bestand. --}}
                    <div data-palette-heading="rooms" role="presentation" aria-hidden="true" hidden
                         class="px-2 pb-1.5 pt-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{{ __('Räume') }}</div>
                    <template x-for="room in roomItems" :key="'room:' + (room.workspace ? 'w' : 's') + ':' + room.h">
                        <flux:command.item
                            data-palette-section="rooms"
                            x-bind:data-palette-h="room.h"
                            {{-- Reine Beobachtungsstelle, kein Verhalten: `recentRooms()`
                                 füllt den Ruhezustand bewusst mit ENTDECKBAREN Räumen auf,
                                 solange keine fünf beigetretenen bekannt sind (und während
                                 die 39002 noch laufen, sind das null). Ein solcher Raum
                                 öffnet sich richtig — nur steht dort das Beitritts-Gate
                                 statt des Composers (`⚡room.blade.php`:
                                 `x-show="membershipReady && joined && !isForum"`). Ohne
                                 diesen Wert ist von außen nicht unterscheidbar, ob die
                                 Liste schon die beigetretenen zeigt; die E2E-Vorbedingung
                                 in `command-palette.spec.ts` liest genau ihn.
                                 Ausgeschriebenes 'true'/'false' statt der rohen Bindung:
                                 Alpine entfernt ein `x-bind`-Attribut bei falsy Wert, und
                                 „Attribut fehlt" hieße dann zweierlei — nicht beigetreten
                                 ODER noch nicht gebunden. --}}
                            x-bind:data-palette-joined="room.joined === true ? 'true' : 'false'"
                            x-bind:aria-label="@js(__('Raum: :name')).split(':name').join(room.name)"
                            x-on:click="openRoom(room)"
                            class="dark:data-active:bg-accent-wash! min-h-11 items-center gap-3 rounded-btn! px-2.5! py-1.5">
                            <span aria-hidden="true" class="flex size-11 shrink-0 items-center justify-center rounded-tile border border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-border-chip dark:bg-surface-2 dark:text-accent">
                                <flux:icon.chat-bubble-left variant="micro" class="sw-18 size-5" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-[15px] font-extrabold" x-text="room.name"></span>
                                <span class="block truncate text-[13px] text-muted" x-show="room.hint" x-text="room.hint"></span>
                            </span>
                            <span class="shrink-0 rounded-pill border border-zinc-300 px-2 py-0.5 text-[11px] leading-none text-muted dark:border-border-strong">&#8629; {{ __('öffnen') }}</span>
                        </flux:command.item>
                    </template>

                    {{-- ── Mitglieder (`@`) ───────────────────────────────────── --}}
                    <div data-palette-heading="members" role="presentation" aria-hidden="true" hidden
                         class="px-2 pb-1.5 pt-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{{ __('Mitglieder') }}</div>
                    <template x-for="member in memberItems" :key="'member:' + member.pubkey">
                        <flux:command.item
                            data-palette-section="members"
                            x-bind:data-palette-pubkey="member.pubkey"
                            x-bind:aria-label="@js(__('Mitglied: :name')).split(':name').join(member.name)"
                            x-on:click="openMember(member)"
                            class="dark:data-active:bg-accent-wash! min-h-11 items-center gap-3 rounded-btn! px-2.5! py-1.5">
                            <span aria-hidden="true" class="flex size-11 shrink-0 items-center justify-center rounded-tile border border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-border-chip dark:bg-surface-2 dark:text-accent">
                                <flux:icon.user variant="micro" class="sw-18 size-5" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-[15px] font-extrabold" x-text="member.name"></span>
                                <span class="block truncate text-[13px] text-muted" x-show="member.nip05" x-text="member.nip05"></span>
                            </span>
                            <span class="shrink-0 rounded-pill border border-zinc-300 px-2 py-0.5 text-[11px] leading-none text-muted dark:border-border-strong">&#8629; {{ __('öffnen') }}</span>
                        </flux:command.item>
                    </template>

                    {{-- ── Spaces ─────────────────────────────────────────────── --}}
                    <div data-palette-heading="spaces" role="presentation" aria-hidden="true" hidden
                         class="px-2 pb-1.5 pt-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{{ __('Spaces') }}</div>
                    <template x-for="space in spaceItems" :key="'space:' + space.url">
                        <flux:command.item
                            data-palette-section="spaces"
                            x-bind:data-palette-url="space.url"
                            x-bind:aria-label="@js(__('Space: :label')).split(':label').join(space.label)"
                            x-on:click="openSpace(space)"
                            class="dark:data-active:bg-accent-wash! min-h-11 items-center gap-3 rounded-btn! px-2.5! py-1.5">
                            <span aria-hidden="true" class="flex size-11 shrink-0 items-center justify-center rounded-tile border border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-border-chip dark:bg-surface-2 dark:text-accent">
                                <flux:icon.globe-alt variant="micro" class="sw-18 size-5" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-[15px] font-extrabold" x-text="space.label"></span>
                                <span class="block truncate text-[13px] text-muted" x-show="space.hint" x-text="space.hint"></span>
                            </span>
                            <span class="shrink-0 rounded-pill border border-zinc-300 px-2 py-0.5 text-[11px] leading-none text-muted dark:border-border-strong">&#8629; {{ __('öffnen') }}</span>
                        </flux:command.item>
                    </template>

                    {{-- ── The four Portal sections (D6) ──────────────────────
                         Meetups, dates, courses and lecturers of the association portal.
                         They come from ONE index the island loads ONCE per session
                         (`/suche/portal-index`) and filters in the browser afterwards — the
                         typed query never leaves the device, and the Portal's throughput
                         (60/min per IP for the whole instance) is not spent per keystroke.

                         Four blocks and not one with an `x-if`: Flux' filter works on the
                         RENDERED options, and the section headings hang on
                         `data-palette-section` — a shared block could not show and hide its
                         heading per section.

                         Every row carries its prefix as its mark (`o` `t` `k` `l`) — the
                         same character one can type into the field to see that section
                         only. --}}
                    <div data-palette-heading="meetups" role="presentation" aria-hidden="true" hidden
                         class="px-2 pb-1.5 pt-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{{ __('Meetups im Portal') }}</div>
                    <template x-for="row in meetupItems" :key="'meetup:' + row.r">
                        <flux:command.item
                            data-palette-section="meetups"
                            x-bind:data-palette-portal="row.t + ':' + row.r"
                            x-bind:aria-label="@js(__('Meetup: :name')).split(':name').join(row.n)"
                            x-on:click="openPortal(row)"
                            class="dark:data-active:bg-accent-wash! min-h-11 items-center gap-3 rounded-btn! px-2.5! py-1.5">
                            <span aria-hidden="true" class="flex size-11 shrink-0 items-center justify-center rounded-tile border border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-border-chip dark:bg-surface-2 dark:text-accent">
                                <flux:icon.map-pin variant="micro" class="sw-18 size-5" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-[15px] font-extrabold" x-text="row.n"></span>
                                <span class="block truncate text-[13px] text-muted" x-show="row.s" x-text="row.s"></span>
                            </span>
                            <span class="shrink-0 rounded-pill border border-zinc-300 px-2 py-0.5 text-[11px] leading-none text-muted dark:border-border-strong">{{ __('Portal') }}</span>
                        </flux:command.item>
                    </template>

                    <div data-palette-heading="events" role="presentation" aria-hidden="true" hidden
                         class="px-2 pb-1.5 pt-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{{ __('Termine') }}</div>
                    <template x-for="row in eventItems" :key="'event:' + row.r + ':' + row.d">
                        <flux:command.item
                            data-palette-section="events"
                            x-bind:data-palette-portal="row.t + ':' + row.r"
                            x-bind:aria-label="@js(__('Termin: :name')).split(':name').join(row.n + ' · ' + row.d)"
                            x-on:click="openPortal(row)"
                            class="dark:data-active:bg-accent-wash! min-h-11 items-center gap-3 rounded-btn! px-2.5! py-1.5">
                            <span aria-hidden="true" class="flex size-11 shrink-0 items-center justify-center rounded-tile border border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-border-chip dark:bg-surface-2 dark:text-accent">
                                <flux:icon.calendar variant="micro" class="sw-18 size-5" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-[15px] font-extrabold" x-text="row.n"></span>
                                <span class="block truncate text-[13px] text-muted" x-show="portalHint(row)" x-text="portalHint(row)"></span>
                            </span>
                            <span class="shrink-0 rounded-pill border border-zinc-300 px-2 py-0.5 text-[11px] leading-none text-muted dark:border-border-strong">{{ __('Portal') }}</span>
                        </flux:command.item>
                    </template>

                    <div data-palette-heading="courses" role="presentation" aria-hidden="true" hidden
                         class="px-2 pb-1.5 pt-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{{ __('Kurse') }}</div>
                    <template x-for="row in courseItems" :key="'course:' + row.r">
                        <flux:command.item
                            data-palette-section="courses"
                            x-bind:data-palette-portal="row.t + ':' + row.r"
                            x-bind:aria-label="@js(__('Kurs: :name')).split(':name').join(row.n)"
                            x-on:click="openPortal(row)"
                            class="dark:data-active:bg-accent-wash! min-h-11 items-center gap-3 rounded-btn! px-2.5! py-1.5">
                            <span aria-hidden="true" class="flex size-11 shrink-0 items-center justify-center rounded-tile border border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-border-chip dark:bg-surface-2 dark:text-accent">
                                <flux:icon.academic-cap variant="micro" class="sw-18 size-5" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-[15px] font-extrabold" x-text="row.n"></span>
                                <span class="block truncate text-[13px] text-muted" x-show="portalHint(row)" x-text="portalHint(row)"></span>
                            </span>
                            <span class="shrink-0 rounded-pill border border-zinc-300 px-2 py-0.5 text-[11px] leading-none text-muted dark:border-border-strong">{{ __('Portal') }}</span>
                        </flux:command.item>
                    </template>

                    <div data-palette-heading="lecturers" role="presentation" aria-hidden="true" hidden
                         class="px-2 pb-1.5 pt-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{{ __('Referenten') }}</div>
                    <template x-for="row in lecturerItems" :key="'lecturer:' + row.r">
                        <flux:command.item
                            data-palette-section="lecturers"
                            x-bind:data-palette-portal="row.t + ':' + row.r"
                            x-bind:aria-label="@js(__('Referent: :name')).split(':name').join(row.n)"
                            x-on:click="openPortal(row)"
                            class="dark:data-active:bg-accent-wash! min-h-11 items-center gap-3 rounded-btn! px-2.5! py-1.5">
                            <span aria-hidden="true" class="flex size-11 shrink-0 items-center justify-center rounded-tile border border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-border-chip dark:bg-surface-2 dark:text-accent">
                                <flux:icon.user variant="micro" class="sw-18 size-5" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-[15px] font-extrabold" x-text="row.n"></span>
                                <span class="block truncate text-[13px] text-muted" x-show="row.s" x-text="row.s"></span>
                            </span>
                            <span class="shrink-0 rounded-pill border border-zinc-300 px-2 py-0.5 text-[11px] leading-none text-muted dark:border-border-strong">{{ __('Portal') }}</span>
                        </flux:command.item>
                    </template>

                    {{-- ── „Zusagen" (`z:`, P5/D12) ────────────────────────────
                         The one section whose rows do not NAVIGATE but PUBLISH: a press writes
                         a signed kind 31925 to the calendar relays and the reader's own write
                         relays. That is why it appears only when it is asked for — through the
                         action „Zusagen" below or by typing `z:` — and never while somebody is
                         merely searching (`visibleSections`, with its own test).

                         The rows are the dates of the reader's OWN meetups: the ones he pinned
                         (D7) and the ones whose room he joined. A list of strangers' dates
                         would be an invitation to answer something he has no relation to.

                         Where the disclosure is still owed, the press does NOT publish — it
                         leads to the meetup page, where the sentence and the button stand next
                         to each other (`palette.zusagen`). --}}
                    <div data-palette-heading="zusagen" role="presentation" aria-hidden="true" hidden
                         class="px-2 pb-1.5 pt-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{{ __('Zusagen zu deinen Meetups') }}</div>
                    <template x-for="row in zusagenItems" :key="'zusage:' + row.a">
                        <flux:command.item
                            data-palette-section="zusagen"
                            x-bind:data-palette-zusage="row.a"
                            x-bind:aria-label="@js(__('Zusagen: :name')).split(':name').join(row.n + ' · ' + row.d)"
                            x-on:click="zusagen(row)"
                            class="dark:data-active:bg-accent-wash! min-h-11 items-center gap-3 rounded-btn! px-2.5! py-1.5">
                            <span aria-hidden="true" class="flex size-11 shrink-0 items-center justify-center rounded-tile border border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-border-chip dark:bg-surface-2 dark:text-accent">
                                <flux:icon.calendar-days variant="micro" class="sw-18 size-5" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-[15px] font-extrabold" x-text="row.n"></span>
                                <span class="block truncate text-[13px] text-muted" x-show="portalHint(row)" x-text="portalHint(row)"></span>
                            </span>
                            <span x-show="zusageStatus(row) === 'accepted'" x-cloak
                                  class="shrink-0 text-xs font-semibold text-brand-300">{{ __('zugesagt') }}</span>
                        </flux:command.item>
                    </template>

                    {{-- ── Aktionen (`>`) ─────────────────────────────────────── --}}
                    <div data-palette-heading="actions" role="presentation" aria-hidden="true" hidden
                         class="px-2 pb-1.5 pt-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{{ __('Aktionen') }}</div>
                    <template x-for="action in actionItems" :key="'action:' + action.id">
                        <flux:command.item
                            data-palette-section="actions"
                            x-bind:data-palette-action="action.id"
                            x-bind:aria-label="@js(__('Aktion: :label')).split(':label').join(action.label)"
                            x-on:click="runAction(action)"
                            class="dark:data-active:bg-accent-wash! min-h-11 items-center gap-3 rounded-btn! px-2.5! py-1.5">
                            <span aria-hidden="true" class="flex size-11 shrink-0 items-center justify-center rounded-tile border border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-border-chip dark:bg-surface-2 dark:text-accent">
                                <flux:icon.bolt variant="micro" class="sw-18 size-5" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-[15px] font-extrabold" x-text="action.label"></span>
                            </span>
                            <span class="shrink-0 rounded-pill border border-zinc-300 px-2 py-0.5 text-[11px] leading-none text-muted dark:border-border-strong">&gt; {{ __('Aktion') }}</span>
                        </flux:command.item>
                    </template>

                    {{-- Die Kürzel-Übersicht als Zeile — sonst findet sie nur, wer
                         `?` schon kennt. Nur ab `xl`: darunter gibt es weder `?`
                         noch die Tasten, die sie erklärt. Eigenes `x-if` statt
                         eines Eintrags in `actionItems`, weil nur diese Zeile eine
                         Tastenkappe trägt.

                         Die Kappe steht NICHT über das `kbd`-Prop des Stubs: das
                         rendert `text-xs text-zinc-500` fest ein, und der Hausstil
                         für Sekundärtext ist seit P7 `text-muted`. Die AA-Schwelle
                         hängt bei zinc-500 am Untergrund, deshalb hier beide Werte
                         statt einer pauschalen Aussage (gerechnet mit
                         `p2-kontrast.mjs`, 2026-08-14): auf der Flux-`kbd`-Fläche
                         (`bg-zinc-800/5` über Weiß) sind es 4,32:1 und damit UNTER
                         den 4,5:1 aus 1.4.3 — auf blankem Weiß dagegen 4,74:1, also
                         darüber. Genau diese Abhängigkeit ist der Grund für den
                         Token: `text-muted` (zinc-600) hält auf Weiß 7,81:1. Hier
                         steht dieselbe Kappe wie in der Fußzeile und im Register —
                         ein Stil für dieselbe Sache. --}}
                    <template x-if="shows('actions') && $store.viewport?.desktop">
                        <flux:command.item
                            data-palette-section="actions"
                            data-palette-action="shortcuts"
                            aria-label="{{ __('Aktion: Tastenkürzel') }}"
                            x-on:click="openShortcuts()"
                            class="dark:data-active:bg-accent-wash! min-h-11 items-center gap-3 rounded-btn! px-2.5! py-1.5">
                            <span aria-hidden="true" class="flex size-11 shrink-0 items-center justify-center rounded-tile border border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-border-chip dark:bg-surface-2 dark:text-accent">
                                <flux:icon.bolt variant="micro" class="sw-18 size-5" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-[15px] font-extrabold">{{ __('Tastenkürzel') }}</span>
                            </span>
                            <kbd class="{{ $kbd }}">?</kbd>
                        </flux:command.item>
                    </template>
                </flux:command.items>
            </flux:command>

            {{-- P5 — die Workspace-Suche (`w:`). Bewusst AUSSERHALB von
                 `<flux:command>`: Flux' Filter blendet jede Option aus, deren
                 Text den Suchbegriff nicht als Teilzeichenkette enthält, und
                 genau das würde relay-seitige Stammform-Treffer wieder
                 wegwerfen. Ausführlich im Kopf der Komponente. --}}
            <x-group::space-search-results />

            {{-- Kürzel-Zeile. Blendet unter `xl` aus, statt tote Tasten zu
                 bewerben: dort gibt es kein ⌘K, kein Alt+↑/↓ und kein `?`. --}}
            <div class="hidden shrink-0 items-center gap-3 border-t border-zinc-200 bg-white px-4 py-2.5 text-xs text-muted dark:border-border-card dark:bg-overlay xl:flex">
                <span class="inline-flex items-center gap-1"><kbd class="{{ $kbd }}">↑</kbd><kbd class="{{ $kbd }}">↓</kbd>{{ __('Navigieren') }}</span>
                <span class="inline-flex items-center gap-1"><kbd class="{{ $kbd }}">↵</kbd>{{ __('Öffnen') }}</span>
                <span class="inline-flex items-center gap-1"><kbd class="{{ $kbd }}">Esc</kbd>{{ __('Schließen') }}</span>
                <span class="ms-auto inline-flex items-center gap-1"><kbd class="{{ $kbd }}">?</kbd>{{ __('Alle Kürzel') }}</span>
            </div>
        </div>
    </flux:modal>

    {{-- ── Kürzel-Register ────────────────────────────────────────────────────
         Öffnet über `?` (nur wenn kein Textfeld den Fokus hat — sonst könnte
         niemand mehr ein Fragezeichen tippen) und über die Zeile in der Palette.
         Zweispaltig ab `sm`; die Tastenkappen tragen denselben Stil wie am
         Rail-Prompt. --}}
    <flux:modal name="shortcuts" class="max-w-lg" data-shortcuts>
        <flux:heading size="lg">{{ __('Tastenkürzel') }}</flux:heading>
        <flux:text class="mt-1">{{ __('Gilt am Rechner mit Tastatur.') }}</flux:text>

        <dl class="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
            @php($shortcuts = [
                ['keys' => ['⌘', 'K'], 'text' => __('Befehlspalette öffnen')],
                ['keys' => ['Strg', 'K'], 'text' => __('Befehlspalette öffnen (Windows/Linux)')],
                ['keys' => ['Alt', '↑'], 'text' => __('Einen Raum nach oben')],
                ['keys' => ['Alt', '↓'], 'text' => __('Einen Raum nach unten')],
                ['keys' => ['↑', '↓'], 'text' => __('In der Palette navigieren')],
                ['keys' => ['↵'], 'text' => __('Auswahl öffnen')],
                ['keys' => ['⌘', '↵'], 'text' => __('Nachricht senden')],
                ['keys' => ['Esc'], 'text' => __('Schließen, Suche leeren')],
                ['keys' => ['?'], 'text' => __('Diese Übersicht')],
            ])
            @foreach ($shortcuts as $row)
                <div class="flex items-center justify-between gap-4 border-b border-zinc-200 py-1.5 last:border-0 dark:border-zinc-800">
                    <dt class="min-w-0 text-sm text-zinc-900 dark:text-zinc-100">{{ $row['text'] }}</dt>
                    <dd class="flex shrink-0 items-center gap-1">
                        @foreach ($row['keys'] as $key)
                            <kbd class="{{ $kbd }}">{{ $key }}</kbd>
                        @endforeach
                    </dd>
                </div>
            @endforeach
        </dl>

        <p class="mt-4 text-sm text-muted">{{ __('In der Palette grenzen r: m: p: und ein Ländercode wie de: auf einen Bereich ein. @ sucht Mitglieder, > listet Aktionen. o: t: k: l: zeigen Meetups, Termine, Kurse und Referenten aus dem Portal, z: die Termine deiner eigenen Meetups zum Zusagen. w: durchsucht den Workspace — dort ↵ drücken, der Relay findet ganze Wörter.') }}</p>
    </flux:modal>
</div>
