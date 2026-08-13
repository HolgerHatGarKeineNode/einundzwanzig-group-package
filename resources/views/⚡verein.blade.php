<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/**
 * P5 — Vereins-Onboarding (`/verein/beitritt`) als Livewire-SFC.
 *
 * Dünne Hülle, wie im ganzen Repo: der Zustand lebt in der Alpine-Insel
 * (`nostrVerein`, `js/verein.ts`), der Schritt-Entscheid in `js/vereinFlow.ts`.
 * Kein `wire:model`, keine Server-Runde — jeder Aufruf an den Verein trägt eine
 * NIP-98-Signatur, und die entsteht im Browser.
 *
 * `?schritt=warten` ist der Rücksprung aus dem Checkout (`group.verein.return`):
 * er setzt die Insel direkt im Wartezustand ab, ohne auf `/me` zu warten. Sonst
 * sähe der Nutzer nach der Zahlung für einen Moment wieder den Zahlschritt —
 * mit einem Knopf, der eine zweite Rechnung aus einem Kontingent von drei pro
 * Tag zöge.
 */
new #[Layout('group::einundzwanzig')] #[Title('Vereinsbeitritt')] class extends Component {}; ?>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 pt-safe">
    {{-- Interstitial ohne app-shell → Signer-/Reconnect-Strip selbst tragen: jeder
         Schritt hier signiert (NIP-98), der Banner darf nicht fehlen. --}}
    <x-group::status-strip />

    <div x-data="nostrVerein(@js(request()->query('schritt') === 'warten'))"
         data-testid="verein-flow"
         class="page-enter space-y-4">

        {{-- Kopf: gilt für jeden Schritt --}}
        <div class="text-center">
            <div class="mx-auto mb-3 flex size-12 items-center justify-center">
                <x-group::app-brand-mark class="size-12 shadow-pop" />
            </div>
            <flux:heading size="xl">{{ __('Vereinsmitglied werden') }}</flux:heading>
        </div>

        {{-- ── Flow nicht eingerichtet ────────────────────────────────────────
             Ohne Vereins-Basis-URL könnte die Insel den `u`-Tag nicht auf den
             Verein setzen; jede Signatur wäre wertlos. Statt eines Knopfes, der
             immer 503 liefert, steht hier der ehrliche Weg nach außen. --}}
        <template x-if="!hasFlow()">
            <div class="surface-card p-6 text-center" data-testid="verein-kein-flow">
                <flux:text>{{ __('Der Beitritt ist in dieser App gerade nicht eingerichtet.') }}</flux:text>
                <flux:button variant="primary" class="mt-4 w-full" icon:trailing="arrow-up-right"
                             href="{{ config('group.verein_public_url') }}" target="_blank" rel="noopener"
                             x-on:click="openExternal(@js(config('group.verein_public_url')), $event)">
                    {{ __('Beitritt im Browser öffnen') }}
                </flux:button>
                {{-- Wohin der Knopf führt, steht darunter — derselbe Handgriff wie
                     im Gate. Ein Weg aus der App heraus sagt sein Ziel an. --}}
                <flux:text class="mt-3 text-xs text-muted">
                    {{ Str::of(config('group.verein_public_url'))->after('://')->rtrim('/') }}
                </flux:text>
            </div>
        </template>

        <template x-if="hasFlow()">
            <div class="space-y-4">

                {{-- ── Fortschritt ────────────────────────────────────────────
                     Vier Marken, die den ganzen Weg zeigen — auch die noch nicht
                     erreichten. Wer weiß, wie viel noch kommt, bricht seltener ab.

                     Der Zustand einer Marke liegt auf DREI Kanälen, und das ist
                     kein Zierrat:
                       · Höhe    (6px erledigt-und-hier · 4px erledigt · 1px offen)
                       · Farbe   (Akzent gegen Grau)
                       · Schrift (die aktive Marke ist die einzige halbfette)
                     Vorher trugen `done` und `active` DIESELBE Farbe und sonst
                     kein Unterscheidungsmerkmal — im Wartezustand sah der Balken
                     deshalb vollständig erledigt aus, und „wo bin ich" war am
                     Bildschirm nicht zu beantworten. Zwei Regeln fielen dabei
                     zugleich: 1.4.1 (Farbe als einziger Träger) und 1.4.11
                     (brand-500 auf der hellen Seite gemessen 2,30:1 < 3:1).

                     `accent-content` statt `brand-500`: das Haus-Token ist
                     brand-700 im Hellen (4,24:1 auf zinc-50) und brand-400 im
                     Dunklen (10,0:1) — dieselbe Marke, aber tragfähig auf beiden
                     Untergründen. Für TEXT reicht brand-700 nicht (4,24 < 4,5),
                     deshalb ist die aktive Beschriftung neutral-dunkel und
                     halbfett statt farbig; die Marke lebt im Balken. --}}
                <ol class="flex items-end justify-between gap-1.5 text-xs" data-testid="verein-fortschritt"
                    aria-label="{{ __('Fortschritt') }}">
                    @foreach ([
                        'statuten' => __('Statuten'),
                        'antrag' => __('Antrag'),
                        'zahlung' => __('Beitrag'),
                        'warten' => __('Zugang'),
                    ] as $key => $label)
                        {{-- `x-bind:` ausgeschrieben: `::attr` funktioniert nur auf
                             Blade-KOMPONENTEN. Auf normalem HTML entstünde ein totes
                             Attribut namens `::data-state`, lautlos. --}}
                        <li class="flex flex-1 flex-col items-center gap-1.5"
                            data-step="{{ $key }}"
                            x-bind:data-state="stepState(@js($key))"
                            x-bind:aria-current="stepState(@js($key)) === 'active' ? 'step' : null">
                            <span class="flex h-1.5 w-full items-end">
                                <span class="block w-full rounded-full transition-all"
                                      style="transition-duration: var(--duration-nav)"
                                      x-bind:class="{
                                          'h-1.5 bg-accent-content': stepState(@js($key)) === 'active',
                                          'h-1 bg-accent-content': stepState(@js($key)) === 'done',
                                          'h-px bg-zinc-300 dark:bg-zinc-700': stepState(@js($key)) === 'todo',
                                      }"></span>
                            </span>
                            <span x-bind:class="stepState(@js($key)) === 'active'
                                      ? 'font-semibold text-zinc-900 dark:text-zinc-100'
                                      : 'text-muted'">{{ $label }}</span>
                        </li>
                    @endforeach
                </ol>

                {{-- ── Fehler ─────────────────────────────────────────────────
                     Kein Fehlerzustand ohne sichtbaren Ausweg: der Knopf trägt
                     immer eine Beschriftung (`escapeLabel` ist über den
                     geschlossenen Typ vollständig) und führt immer in eine
                     Handlung.

                     ÜBER dem Schritt und nicht mehr darunter. Der häufigste Fehler
                     hier ist der 422 aus dem Antrag, und der Antrag ist die längste
                     Fläche der Strecke: am Fuß angehängt stand die Meldung auf einem
                     390er Schirm unterhalb des Falzes — der Nutzer drückte „Antrag
                     senden", und sichtbar änderte sich nichts. Oben steht sie da, wo
                     der Blick nach dem Drücken ohnehin hinfällt, und behält den
                     Bezug zu den Feldern darunter.

                     `role="alert"`: der Zweig entsteht erst mit dem Fehler, die
                     Ansage kommt also genau dann, wenn es etwas anzusagen gibt. --}}
                <template x-if="error">
                    <flux:callout variant="danger" icon="exclamation-triangle" role="alert" data-testid="verein-fehler">
                        <flux:callout.text>
                            <span x-text="error.message"></span>
                        </flux:callout.text>

                        {{-- Ein Satz, ein Schlüssel: der Wert steckt IM Satz
                             (`Bitte noch :seconds Sekunden warten.`) und nicht
                             zwischen zwei Bruchstücken. Vorher standen hier zwei
                             Übersetzungsaufrufe mit einem reaktiven `<span x-text>`
                             dazwischen — für Deutsch richtig, für jede Sprache mit
                             anderer Wortstellung oder anderem Kasus unlösbar.
                             Gefüllt wird in JS (`retryLine()`), nicht in Blade:
                             `__()` ersetzte serverseitig und fröre den reaktiven
                             Wert ein. --}}
                        <template x-if="error.retryAfter">
                            <flux:callout.text class="text-xs">
                                <span x-text="retryLine()"></span>
                            </flux:callout.text>
                        </template>

                        {{-- 422: die Felder, die der Verein beanstandet hat. Die
                             MELDUNG bleibt unverfälscht; der Feldname bekommt die
                             Beschriftung, die im Formular darübersteht. Vorher stand
                             hier der rohe Schlüssel des Vereins — `nip05_handle` ist
                             kein Feld, das der Nutzer je gesehen hat, und ein
                             Fehler, dessen Bezugspunkt man raten muss, ist keiner
                             mit Ausweg (`fieldLabel`, js/verein.ts). --}}
                        <template x-for="(messages, field) in errorFields()" :key="field">
                            <flux:callout.text class="text-xs">
                                <span class="font-medium" x-text="fieldLabel(field)"></span>:
                                <span x-text="Array.isArray(messages) ? messages.join(' ') : messages"></span>
                            </flux:callout.text>
                        </template>

                        <flux:button variant="primary" size="sm" class="mt-3 w-full"
                                     data-testid="verein-fehler-ausweg"
                                     x-on:click="resolveError()">
                            <span x-text="errorAction()"></span>
                        </flux:button>
                    </flux:callout>
                </template>

                {{-- ── Schritt 1: Laden ───────────────────────────────────────
                     Solange `/config` und `/me` unterwegs sind, ist über den
                     Nutzer NICHTS bekannt — und es wird auch nichts behauptet. --}}
                <template x-if="phase === 'laden'">
                    {{-- Die Ansage steht EINMAL da und ist zugleich die Live-Region.
                         Vorher stand derselbe Satz zusätzlich als `sr-only` darüber:
                         am Bildschirm unsichtbar, im Screenreader doppelt. --}}
                    <div class="surface-card p-6 text-center" aria-busy="true" data-testid="verein-laden">
                        <div class="mx-auto h-4 w-40 skeleton"></div>
                        <div class="mx-auto mt-3 h-4 w-28 skeleton"></div>
                        <flux:text class="mt-4 text-sm text-muted" aria-live="polite">{{ __('Vereinsdaten werden geladen…') }}</flux:text>
                    </div>
                </template>

                {{-- ── Schritt 2: Statuten ────────────────────────────────────
                     Der Betrag steht da, BEVOR irgendetwas passiert. --}}
                <template x-if="phase === 'statuten'">
                    <div class="surface-card space-y-6 p-6" data-testid="verein-statuten">
                        <x-group::verein-betrag />

                        <div class="space-y-2">
                            <flux:heading size="lg">{{ __('Statuten') }}</flux:heading>
                            {{-- Ein Satz statt vier Stücken (`Fassung :version,
                                 beschlossen am :date`). Der Preis ist sichtbar
                                 und bewusst bezahlt: die beiden Werte tragen
                                 kein `font-medium`/`whitespace-nowrap` mehr —
                                 eine Auszeichnung INNERHALB eines Satzes gäbe es
                                 nur über `x-html`, und dafür ist eine Hervorhebung
                                 kein Grund. Der Gedankenstrich für fehlende Werte
                                 sitzt jetzt in `formatStatutes` (vereinFlow.ts),
                                 wo er geprüft ist. --}}
                            <flux:text class="text-sm text-muted">
                                <span x-text="statutesLine()"></span>
                            </flux:text>
                            {{-- Plain <a> statt flux:button: `href` entscheidet bei
                                 Flux SERVERSEITIG, ob ein <a> oder ein <button>
                                 entsteht. Die Adresse kommt aber erst aus
                                 `GET /config` — ein gebundenes `href` ergäbe einen
                                 <button> mit einem Attribut, das niemand liest.

                                 Genau deshalb bringt dieses eine Element auch
                                 nichts von dem mit, was Flux sonst mitliefert, und
                                 die drei fehlenden Stücke sind hier nachgetragen:

                                 · KANTE über das Haus-Token `border-control-edge`.
                                   Gemessen war die Kante vorher 1,26:1 im Hellen
                                   (zinc-200 auf Weiß) und 1,73:1 im Dunklen
                                   (zinc-700 auf zinc-900) — beide unter den 3:1,
                                   die WCAG 1.4.11 für die Grenze eines
                                   Bedienelements verlangt. Der TEXT war nie das
                                   Problem (17,9:1 / 16,4:1); der Umriss war es.
                                 · FOKUSRING + Press-Feedback über `.pressable`.
                                   Vorher trug es nur den Chromium-Standardring,
                                   also einen anderen als jeder Nachbar.
                                 · HÖHE `h-10` — dieselbe wie ein Flux-Knopf. Mit
                                   `py-2` waren es 38px neben 40px, und ein
                                   Zwei-Pixel-Versatz in einem Stapel gleich
                                   breiter Flächen liest sich als Unfall. --}}
                            <a x-bind:href="statutesUrl" target="_blank" rel="noopener"
                               data-testid="verein-statuten-link"
                               x-show="statutesUrl" x-cloak
                               x-on:click="openExternal(statutesUrl, $event)"
                               class="pressable flex h-10 w-full items-center justify-center gap-1.5 rounded-tile border border-control-edge px-3 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800">
                                {{ __('Statuten lesen') }}
                                <flux:icon.arrow-up-right class="size-4" />
                            </a>
                        </div>

                        {{-- Zustimmung und Weiter gehören zusammen: engerer Abstand
                             als zu den Blöcken darüber (`space-y-6` außen, 12px hier). --}}
                        <div class="space-y-3">
                            <flux:checkbox x-model="statutesConfirmed"
                                           data-testid="verein-statuten-zustimmung"
                                           label="{{ __('Ich habe die Statuten gelesen und stimme ihnen zu') }}" />

                            <flux:button variant="primary" class="w-full" icon="arrow-right"
                                         data-testid="verein-statuten-weiter"
                                         ::disabled="!statutesConfirmed"
                                         x-on:click="acceptStatutes()">
                                {{ __('Weiter zum Antrag') }}
                            </flux:button>
                        </div>
                    </div>
                </template>

                {{-- ── Schritt 3: Antrag ──────────────────────────────────────
                     Optionale Felder sehen auch optional aus: sie stehen unter
                     einer eigenen Überschrift, tragen „optional" im Label und
                     der Knopf ist von Anfang an aktiv. --}}
                <template x-if="phase === 'antrag'">
                    <div class="surface-card space-y-6 p-6" data-testid="verein-antrag">
                        <div class="space-y-2">
                            <flux:heading size="lg">{{ __('Beitrittsantrag') }}</flux:heading>
                            <flux:text class="text-sm text-muted">
                                {{ __('Deine Zustimmung zu den Statuten reicht. Die Angaben unten sind freiwillig.') }}
                            </flux:text>
                        </div>

                        <div class="space-y-4 rounded-tile bg-zinc-50 p-4 dark:bg-zinc-800/50">
                            <flux:text class="text-xs font-medium uppercase tracking-wide text-muted">
                                {{ __('Freiwillige Angaben') }}
                            </flux:text>

                            <flux:field>
                                <flux:label>{{ __('E-Mail (optional)') }}</flux:label>
                                <flux:input type="email" x-model="email" data-testid="verein-antrag-email"
                                            ::disabled="noEmail" placeholder="{{ __('name@example.org') }}" />
                            </flux:field>

                            <flux:checkbox x-model="noEmail" data-testid="verein-antrag-keine-email"
                                           label="{{ __('Ich möchte keine E-Mail-Adresse angeben') }}" />

                            <flux:field>
                                <flux:label>{{ __('Nostr-Adresse / NIP-05 (optional)') }}</flux:label>
                                <flux:input x-model="nip05" data-testid="verein-antrag-nip05" placeholder="name@einundzwanzig.space" />
                            </flux:field>

                            <flux:field>
                                <flux:label>{{ __('Nachricht an den Vorstand (optional)') }}</flux:label>
                                <flux:textarea x-model="applicationText" rows="3" data-testid="verein-antrag-text"
                                               ::maxlength="applicationTextMax" />
                                {{-- Rechtsbündig am Feldende und mit Einheit: „0 / 2000"
                                     allein sagt nicht, wovon 2000. Zähler UND Einheit
                                     sind ein Schlüssel (`:used / :max Zeichen`) — als
                                     bloßes „Zeichen" hinter zwei Zahlen konnte keine
                                     Sprache die Einheit vor den Zähler stellen, und
                                     genau das brauchen Polnisch und Lettisch, um dem
                                     Numerus nach der Zahl zu entgehen. --}}
                                <flux:text class="text-right text-xs text-muted">
                                    <span x-text="charCountLine()"></span>
                                </flux:text>
                            </flux:field>
                        </div>

                        {{-- Weiter und Zurück als ein Block: der Rückweg gehört zur
                             Handlung, nicht zum Formular darüber. --}}
                        <div class="space-y-2">
                            <flux:button variant="primary" class="w-full" icon="arrow-right"
                                         data-testid="verein-antrag-senden"
                                         ::disabled="busy !== ''"
                                         x-on:click="submitApplication()">
                                <span x-text="busy || @js(__('Antrag senden'))"></span>
                            </flux:button>

                            <flux:button variant="ghost" size="sm" class="w-full"
                                         data-testid="verein-antrag-zurueck"
                                         x-on:click="backToStatutes()">
                                {{ __('Zurück zu den Statuten') }}
                            </flux:button>
                        </div>
                    </div>
                </template>

                {{-- ── Schritt 4: Zahlung ─────────────────────────────────────
                     Zwei Zweige. In der App zahlen NUR mit Wallet UND BOLT11 —
                     fehlt eines von beidem (Feld fehlt, `null`, keine Wallet),
                     führt derselbe Weg in den Checkout. --}}
                <template x-if="phase === 'zahlung'">
                    {{-- Drei Ränge, drei Abstände: der Betrag ist die Tatsache, die
                         Knöpfe sind die Handlung, der Notausgang steht hinter einer
                         Trennlinie. Vorher lagen alle sieben Kinder in einem
                         gleichmäßigen `space-y-4` — der Ausweg „Rechnung abgelaufen"
                         wog damit optisch genauso viel wie ein Zahlweg. --}}
                    <div class="surface-card space-y-6 p-6" data-testid="verein-zahlung">
                        <div class="space-y-3">
                            <flux:heading size="lg">{{ __('Beitrag zahlen') }}</flux:heading>
                            <x-group::verein-betrag />
                        </div>

                        <div class="space-y-2">
                            {{-- Noch keine Rechnung: sie wird erst auf Wunsch erzeugt.
                                 Der Verein deckelt bei drei pro Tag und Pubkey. --}}
                            <template x-if="!bolt11 && !checkoutUrl">
                                <flux:button variant="primary" class="w-full" icon="bolt"
                                             data-testid="verein-rechnung-erzeugen"
                                             ::disabled="busy !== ''"
                                             x-on:click="startPayment()">
                                    <span x-text="busy || @js(__('Zahlung starten'))"></span>
                                </flux:button>
                            </template>

                            {{-- In der App zahlen --}}
                            <template x-if="payInApp()">
                                <flux:button variant="primary" class="w-full" icon="bolt"
                                             data-testid="verein-wallet-zahlen"
                                             ::disabled="busy !== ''"
                                             x-on:click="payWithWallet()">
                                    <span x-text="busy || @js(__('Mit verbundener Wallet zahlen'))"></span>
                                </flux:button>
                            </template>

                            {{-- Checkout — auch als Zweitweg neben der Wallet sichtbar,
                                 damit ein gescheiterter Wallet-Versuch keinen
                                 Neuaufbau der Fläche braucht.

                                 Zwei Zweige statt eines gebundenen `variant`: Flux löst
                                 `variant` serverseitig zu Klassen auf, ein `x-bind:variant`
                                 wäre ein Attribut ohne Wirkung. Nur einer der beiden
                                 Knöpfe ist je sichtbar. --}}
                            <template x-if="checkoutUrl && payInApp()">
                                <flux:button variant="ghost" class="w-full" icon:trailing="arrow-up-right"
                                             data-testid="verein-checkout"
                                             x-on:click="openCheckout($event)">
                                    {{ __('Im Browser bezahlen') }}
                                </flux:button>
                            </template>

                            <template x-if="checkoutUrl && !payInApp()">
                                <flux:button variant="primary" class="w-full" icon:trailing="arrow-up-right"
                                             data-testid="verein-checkout"
                                             x-on:click="openCheckout($event)">
                                    {{ __('Im Browser bezahlen') }}
                                </flux:button>
                            </template>

                            {{-- Fußnote zum Knopf darüber und zu keinem anderen —
                                 deshalb steht sie direkt darunter und im engen Raster. --}}
                            <template x-if="checkoutUrl">
                                <flux:text class="text-center text-xs text-muted">
                                    {{ __('Du kommst danach automatisch hierher zurück.') }}
                                </flux:text>
                            </template>

                            {{-- Rechnung da, aber keine Wallet verbunden: der Hinweis
                                 darauf, dass es auch in der App ginge — ohne den
                                 Checkout-Weg zu verstellen. --}}
                            <template x-if="bolt11 && !payInApp()">
                                <flux:text class="text-center text-xs text-muted">
                                    {{ __('Mit einer verbundenen Wallet zahlst du direkt in der App.') }}
                                    <a class="underline" href="{{ route('group.wallet') }}" wire:navigate>{{ __('Wallet verbinden') }}</a>
                                </flux:text>
                            </template>
                        </div>

                        {{-- Notausgang. Er wird gebraucht (Lightning-Rechnungen laufen
                             ab), aber er ist kein Zahlweg — Trennlinie davor, Frage
                             als Text, Handlung im selben Wortlaut wie der Ausweg im
                             Fehlerfall (`escapeLabel('neue-rechnung')`). --}}
                        <template x-if="bolt11 || checkoutUrl">
                            <div class="space-y-2 border-t border-zinc-200 pt-4 text-center dark:border-zinc-800">
                                <flux:text class="text-xs text-muted">{{ __('Rechnung abgelaufen?') }}</flux:text>
                                <flux:button variant="ghost" size="sm" class="w-full" icon="arrow-path"
                                             data-testid="verein-neue-rechnung"
                                             ::disabled="busy !== ''"
                                             x-on:click="newInvoice()">
                                    {{ __('Neue Rechnung erzeugen') }}
                                </flux:button>
                            </div>
                        </template>
                    </div>
                </template>

                {{-- ── Schritt 5: Warten ──────────────────────────────────────
                     Der Schritt, an dem dieser Plan hängt. Jede Stufe sagt, WAS
                     gerade passiert, WIE LANGE es dauert und dass der Zugang
                     auch ohne offene App kommt.

                     Die Trennung, die hier nicht eingeebnet werden darf: nur die
                     Stufe `freischaltung` trifft eine Aussage über die
                     Mitgliedschaft, und sie wird nur erreicht, wenn die
                     relay-signierte Liste FERTIG gelesen ist (`vereinFlow.ts`,
                     STAGE_REQUIRES_DIRECTORY). Ein Lesefehler ist `lesefehler`,
                     ein noch laufender Lesevorgang `zugang-pruefen` — beide
                     behaupten nichts. --}}
                <template x-if="phase === 'warten'">
                    <div class="surface-card space-y-6 p-6 text-center" data-testid="verein-warten"
                         x-bind:data-stage="stage">

                        {{-- ── Das Statussymbol ───────────────────────────────
                             Vorher trugen ALLE fünf Stufen dieselbe orange Uhr.
                             Damit sah der größte Übergang der ganzen Strecke —
                             „Zahlung bestätigt" — genauso aus wie das Warten davor,
                             und der Störfall (`lesefehler`) genauso wie der
                             Normalfall. Das Symbol trägt jetzt die Stufe mit:

                               Blitz    Lightning ist unterwegs
                               Person   ein Mensch aus dem Vorstand schaut drauf
                               Haken    Zahlung bestätigt, es geht um den Zugang
                               Funk aus der Space antwortet nicht (neutral, NICHT
                                        brand — ein Störfall ist keine Markenfarbe)

                             Der Ring darum pulsiert GENAU DANN, wenn wirklich
                             gerade nachgefragt wird (`checking`). Kein Dauerlauf:
                             eine Bewegung ohne Vorgang beruhigt, ohne etwas zu
                             sagen — das ist die Kehrseite von „kein Spinner ohne
                             Aussage". --}}
                        <div class="relative mx-auto flex size-14 items-center justify-center">
                            <span x-show="checking" x-cloak aria-hidden="true"
                                  class="status-pulse absolute inset-0 rounded-full"
                                  x-bind:class="stage === 'lesefehler' ? 'bg-zinc-500' : 'bg-brand-500'"></span>
                            <span class="relative flex size-14 items-center justify-center rounded-full"
                                  x-bind:class="stage === 'lesefehler' ? 'bg-zinc-500/15' : 'bg-brand-500/15'">
                                <flux:icon.bolt x-show="stage === 'zahlung-offen'" x-cloak class="size-6 text-brand-500" />
                                <flux:icon.user x-show="stage === 'zahlung-geprueft'" x-cloak class="size-6 text-brand-500" />
                                <flux:icon.check-circle x-show="stage === 'zugang-pruefen' || stage === 'freischaltung'" x-cloak class="size-6 text-brand-500" />
                                <flux:icon.signal-slash x-show="stage === 'lesefehler'" x-cloak class="size-6 text-zinc-600 dark:text-zinc-300" />
                            </span>
                        </div>

                        {{-- Live-Region über den Stufen: der Wechsel wird angesagt,
                             ohne dass ein Screenreader-Nutzer die Seite neu abtasten
                             muss. Sie steht AUSSERHALB der Zweige, weil eine
                             Live-Region schon dastehen muss, bevor sich ihr Inhalt
                             ändert — eine, die mit ihrem Inhalt zusammen entsteht,
                             sagt nichts an. --}}
                        <div class="space-y-2" aria-live="polite">
                            {{-- Zahlung raus, noch nicht bestätigt --}}
                            <template x-if="stage === 'zahlung-offen'">
                                <div class="space-y-2" data-testid="verein-warten-zahlung">
                                    <flux:heading size="lg">{{ __('Zahlung wird bestätigt') }}</flux:heading>
                                    <flux:text class="text-sm text-muted">
                                        {{ __('Wir warten auf die Bestätigung. Über Lightning dauert das meist wenige Sekunden.') }}
                                    </flux:text>
                                </div>
                            </template>

                            {{-- Nachfass-Plan durch, immer noch nicht bestätigt --}}
                            <template x-if="stage === 'zahlung-geprueft'">
                                <div class="space-y-2" data-testid="verein-warten-pruefung">
                                    <flux:heading size="lg">{{ __('Deine Zahlung wird geprüft') }}</flux:heading>
                                    <flux:text class="text-sm text-muted">
                                        {{ __('Meist weichen Betrag oder Währung ab. Jemand aus dem Vorstand sieht sich das an — du musst nichts weiter tun.') }}
                                    </flux:text>
                                </div>
                            </template>

                            {{-- Zahlung bestätigt, Mitgliederliste noch nicht gelesen.
                                 KEINE Aussage über die Mitgliedschaft. --}}
                            <template x-if="stage === 'zugang-pruefen'">
                                <div class="space-y-2" data-testid="verein-warten-pruefen">
                                    <flux:heading size="lg">{{ __('Zahlung bestätigt') }}</flux:heading>
                                    <flux:text class="text-sm text-muted">
                                        {{ __('Dein Zugang wird gerade geprüft.') }}
                                    </flux:text>
                                </div>
                            </template>

                            {{-- Mitgliederliste NICHT lesbar. Auch keine Aussage —
                                 sondern ein Ausweg. --}}
                            <template x-if="stage === 'lesefehler'">
                                <div class="space-y-2" data-testid="verein-warten-lesefehler">
                                    <flux:heading size="lg">{{ __('Zugang konnte nicht geprüft werden') }}</flux:heading>
                                    <flux:text class="text-sm text-muted">
                                        {{ __('Der Space antwortet gerade nicht. Das sagt nichts über deine Mitgliedschaft — wir können sie nur nicht nachsehen.') }}
                                    </flux:text>
                                </div>
                            </template>

                            {{-- Zahlung bestätigt, Liste gelesen, Pubkey noch nicht drin. --}}
                            <template x-if="stage === 'freischaltung'">
                                <div class="space-y-2" data-testid="verein-warten-freischaltung">
                                    <flux:heading size="lg">{{ __('Zahlung bestätigt') }}</flux:heading>
                                    <flux:text class="text-sm text-muted">
                                        {{ __('Du bist noch nicht freigeschaltet. Der Abgleich läuft automatisch.') }}
                                    </flux:text>
                                </div>
                            </template>
                        </div>

                        {{-- Die Dauer — aus dem EINEN konfigurierten Wert, an
                             jeder Stufe dieselbe Quelle. Ist keine Dauer
                             konfiguriert, steht hier „in Kürze" statt einer
                             Zahl, die nicht stimmt. --}}
                        <div class="rounded-tile bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-800/60" data-testid="verein-wartezeit">
                            {{-- `Das dauert :duration.` als ein Schlüssel. Der
                                 Einschub kommt aus `formatWait` und trägt im
                                 Ungarischen die `-ig`-Endung („legfeljebb egy
                                 óráig") — die geht nur auf, wenn der Rahmensatz
                                 als Ganzes übersetzbar ist. Die Halbfettung des
                                 Einschubs entfällt damit, wie oben bei der
                                 Fassung. --}}
                            <template x-if="waitText">
                                <p x-text="waitLine()"></p>
                            </template>
                            <template x-if="!waitText">
                                <p>{{ __('Das dauert in der Regel nur kurz.') }}</p>
                            </template>
                            <p class="mt-1 text-muted">{{ __('Du kannst die App schließen — der Zugang kommt auch dann.') }}</p>
                        </div>

                        {{-- Die Handlung ist hier bewusst KEINE Hauptsache: Nichtstun
                             ist der richtige Weg. Rückmeldung braucht sie trotzdem —
                             vorher änderte sich beim Drücken nichts, weil der
                             Nachfass-Weg `busy` nie setzt. --}}
                        <div class="space-y-2">
                            <flux:button variant="ghost" size="sm" class="w-full" icon="arrow-path"
                                         data-testid="verein-jetzt-pruefen"
                                         ::disabled="busy !== '' || checking"
                                         x-on:click="checkNow()">
                                <span x-text="checking ? @js(__('Wird geprüft…')) : (busy || @js(__('Jetzt prüfen')))"></span>
                            </flux:button>

                            {{-- Solange der Plan läuft: sagen, DASS er läuft. Sonst
                                 sieht ein Bildschirm, der sich zwei Minuten nicht
                                 rührt, aus wie einer, der hängt. --}}
                            <template x-if="!exhausted">
                                <flux:text class="text-xs text-muted" data-testid="verein-warten-automatik">
                                    {{ __('Wir fragen automatisch weiter nach.') }}
                                </flux:text>
                            </template>

                            {{-- Der Ausweg aus dem Wartezustand.

                                 „Checkout geöffnet" ist nicht „bezahlt": abgebrochen,
                                 falsche Wallet, Tab zugemacht, Popup geblockt. Ohne
                                 diesen Weg wäre der Wartezustand eine Sackgasse, die
                                 auf eine Zahlung wartet, die es nicht gibt — und die
                                 nach Ablauf des Plans behauptet, jemand aus dem
                                 Vorstand sehe sie sich an.

                                 Nur solange die Zahlung NICHT bestätigt ist: danach
                                 gibt es nichts mehr zurückzunehmen, der Zugang folgt. --}}
                            <template x-if="stage === 'zahlung-offen' || stage === 'zahlung-geprueft'">
                                <flux:button variant="ghost" size="sm" class="w-full"
                                             data-testid="verein-warten-abbrechen"
                                             x-on:click="abortPayment()">
                                    {{ __('Doch nicht bezahlt? Zurück zur Zahlung') }}
                                </flux:button>
                            </template>

                            {{-- Nachfass-Plan abgearbeitet: wir hören auf zu fragen und
                                 sagen das auch, statt still einen Spinner stehenzulassen. --}}
                            <template x-if="exhausted">
                                <flux:text class="text-xs text-muted" data-testid="verein-warten-ende">
                                    {{ __('Wir fragen nicht mehr automatisch nach. Sobald der Zugang da ist, siehst du ihn beim nächsten Öffnen der App.') }}
                                </flux:text>
                            </template>
                        </div>
                    </div>
                </template>

                {{-- ── Schritt 6: Zugang ──────────────────────────────────────
                     Nur wenn der eigene Pubkey wirklich in der relay-signierten
                     Liste steht. --}}
                <template x-if="phase === 'freigeschaltet'">
                    {{-- Der einzige Schritt, an dem etwas gelungen ist — er darf
                         auch so aussehen. `empty-state` ist der Haus-Auftritt dafür
                         (gestaffeltes Einblenden Icon → Titel → Text → Knopf, in
                         `prefers-reduced-motion` still). Kein eigenes Feuerwerk:
                         die eine Bewegung dieses Flows gehört dem Wartezustand. --}}
                    <div class="surface-card empty-state space-y-4 p-6 text-center" data-testid="verein-fertig">
                        <div class="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-500/15">
                            <flux:icon.check-badge variant="solid" class="size-8 text-brand-500" />
                        </div>
                        <flux:heading size="lg">{{ __('Willkommen im Verein') }}</flux:heading>
                        <flux:text class="text-sm text-muted">{{ __('Dein Zugang ist freigeschaltet.') }}</flux:text>
                        <flux:button variant="primary" class="w-full" icon="arrow-right"
                                     data-testid="verein-zum-space"
                                     href="{{ route('group.spaces') }}" wire:navigate>
                            {{ __('Zu den Räumen') }}
                        </flux:button>
                    </div>
                </template>

            </div>
        </template>

        {{-- Der Abbruch heißt nicht überall dasselbe.

             Ab dem Wartezustand ist die Zahlung raus und der Vorgang läuft
             weiter, auch wenn niemand zusieht — „Abbrechen" verspricht dort das
             Gegenteil von dem, was der Knopf tut (er navigiert zu den Räumen).
             Vor der Zahlung ist „Abbrechen" richtig und bleibt.

             `x-text` statt zweier Zweige: beide Beschriftungen laufen durch
             `__()`, der Katalog bleibt die einzige Textquelle. --}}
        <flux:button variant="ghost" size="sm" class="w-full" href="{{ route('group.spaces') }}" wire:navigate>
            <span x-text="['warten', 'freigeschaltet'].includes(phase)
                      ? @js(__('Zurück zu den Räumen'))
                      : @js(__('Abbrechen'))"></span>
        </flux:button>
    </div>
</main>
