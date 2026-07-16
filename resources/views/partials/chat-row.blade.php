{{-- Chat-Message-Row (P3 4.2): EINE Zeilen-Darstellung für Raum UND Thread. `m` ist die
     ChatMessage im umgebenden x-for-Scope; `$context` ('room'|'thread') gatet die
     kontextspezifischen Aktionen. Alle Alpine-Methoden/State leben im gemeinsamen
     nostrRoomChat-Component, also funktionieren react/zap/reply hier wie im Raum.
     Divider/unreadDivider inline; unreadDivider ist im Thread immer false (nie gerendert). --}}
                    <template x-if="m.divider">
                        <div class="my-3 flex items-center gap-3">
                            <flux:separator class="flex-1" />
                            <span class="font-mono text-[0.7rem] tracking-wide text-muted" x-text="m.divider"></span>
                            <flux:separator class="flex-1" />
                        </div>
                    </template>

                    {{-- Last-Read-Grenze: erste ungelesene Fremd-Nachricht seit dem letzten Besuch. --}}
                    <template x-if="m.unreadDivider">
                        <div class="my-3 flex items-center gap-3">
                            <flux:separator class="flex-1" />
                            <span class="shrink-0 font-mono text-[0.7rem] font-semibold tracking-wide text-brand-500">{{ __('Neue Nachrichten') }}</span>
                            <flux:separator class="flex-1" />
                        </div>
                    </template>

                    {{-- Zeile: Tap blendet die Aktionen ein/aus (Touch); :title = volles Datum. --}}
                    <div :id="'msg-'+m.id" :title="m.fullTime"
                         x-on:click="activeId = (activeId===m.id ? null : m.id)"
                         class="group relative flex gap-2 rounded-card px-1 transition-shadow"
                         :class="flashId===m.id ? 'ring-2 ring-brand-500/70' : ''">
                        <div class="w-8 shrink-0">
                            <template x-if="m.showAuthor">
                                <button type="button" x-on:click.stop="$dispatch('open-profile', m.pubkey)"
                                        class="pressable" aria-label="{{ __('Profil anzeigen') }}">
                                    {{-- Unaufgelöst (kind-0 noch nicht da) → ruhiges „?" statt der irreführenden
                                         npub-Initiale „n". Profile sind dank Prewarm (Schritt 4) meist warm. --}}
                                    <x-group::nostr-avatar picture="m.picture" name="m.profileReady ? m.name : ''" />
                                </button>
                            </template>
                            {{-- Folgezeile ohne Autor-Kopf: HH:MM erscheint links bei Hover. --}}
                            <template x-if="!m.showAuthor">
                                <div class="pt-0.5 text-right font-mono text-[0.65rem] leading-4 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                                     x-text="m.time"></div>
                            </template>
                        </div>
                        <div class="min-w-0 flex-1">
                            {{-- items-center (nicht -baseline): das später einblendende NIP-05-Badge-Icon
                                 (16px) darf die Zeilenhöhe (text-sm ≈ 20px) NICHT vergrössern → kein
                                 vertikaler Ruck der Liste, wenn die Verifizierung spät nachlädt (Schritt 3). --}}
                            <template x-if="m.showAuthor">
                                <div class="flex items-center gap-2">
                                    <button type="button" x-on:click.stop="$dispatch('open-profile', m.pubkey)"
                                            class="pressable truncate text-left text-sm font-semibold hover:underline" x-text="m.name"></button>
                                    {{-- Fester 16px-Slot fürs Badge: reserviert den Platz IMMER, damit das
                                         spät nachladende NIP-05-Häkchen die Uhrzeit nicht nach rechts schiebt
                                         (Schritt 3). Kosten: kleine Lücke bei Autoren ohne verifiziertes NIP-05. --}}
                                    <span class="inline-flex size-4 shrink-0 items-center justify-center">
                                        <x-group::nostr-nip05 nip05="m.nip05" />
                                    </span>
                                    <span class="shrink-0 font-mono text-[0.7rem] text-muted" x-text="m.time"></span>
                                </div>
                            </template>
                            {{-- Zitat-Vorschau: Klick springt zur zitierten Original-Nachricht.
                                 Zwei-Zeilen-Komposit → rohes <button> (kein Flux-Icon-Pendant), §6. --}}
                            <template x-if="m.reply">
                                <button type="button" x-on:click.stop="scrollToMessage(m.reply.id)"
                                        class="pressable mt-0.5 mb-1 block w-full border-l-2 border-brand-500/60 pl-2 text-left hover:border-brand-500">
                                    <div class="truncate text-xs font-semibold text-brand-500" x-text="m.reply.name"></div>
                                    <div class="truncate text-xs text-muted" x-text="m.reply.text"></div>
                                </button>
                            </template>
                            {{-- Thread-Kommentar (P3): Eltern-Bezug „Antwort auf <Autor>" (NIP-22 kleines `e`,
                                 via replyToName). Im Raum-Feed undefined → nie gerendert; ersetzt die
                                 frühere depth-Einrückung (flach/Slack-Stil). --}}
                            <template x-if="m.replyToName">
                                <div class="mb-0.5 text-xs text-muted">
                                    {{ __('Antwort auf') }} <span class="text-brand-500" x-text="m.replyToName"></span>
                                </div>
                            </template>
                            {{-- Inline-Bild anklicken → Lightbox (Klick delegiert, da x-html-Inhalt). --}}
                            <div class="chat-content text-sm break-words whitespace-pre-wrap" x-html="m.html"
                                 x-on:click="if ($event.target.matches('img.chat-image')) { $event.stopPropagation(); lightboxSrc = $event.target.dataset.full }"></div>
                            {{-- Poll (C5, NIP-88 kind 1068): Optionen mit Live-Balken + Vote-Buttons.
                                 Titel steht bereits in m.html (Poll-content = Frage). Option-Button
                                 ist ein Komposit (Balken + Marker + Label + Zähler) → rohes <button>
                                 wie die Zitat-Vorschau (§6), Flux hat kein Pendant. --}}
                            <template x-if="m.poll">
                                {{-- Einfachwahl = radiogroup (exklusiv), Mehrfachwahl = group aus Checkboxen.
                                     Rolle/aria-checked tragen den Zustand → SR sagt „ausgewählt" an, nicht
                                     die dekorative Glyphe (aria-hidden). --}}
                                <div class="mt-1.5">
                                    {{-- Optionen in einer GEDECKELTEN, innen scrollbaren Box (max-h-52): jede
                                         Options-Zeile hat feste Höhe (truncate, kein Umbruch), viele Optionen
                                         scrollen INNEN statt die Nachrichtenzeile wachsen zu lassen. So ist die
                                         äußere Höhe deterministisch (Optionsanzahl × feste Zeilenhöhe, gedeckelt)
                                         und async-stabil (Tally füllt nur die Balken) → der Virtualizer-Estimate
                                         trifft exakt → kein Jitter beim Scrollen in Polls. --}}
                                    <div class="max-h-52 space-y-1.5 overflow-y-auto" :role="m.poll.multi ? 'group' : 'radiogroup'" aria-label="{{ __('Umfrageoptionen') }}">
                                        <template x-for="opt in m.poll.options" :key="opt.id">
                                            <button type="button" x-on:click.stop="votePoll(m, opt.id)" :disabled="m.poll.closed"
                                                    :role="m.poll.multi ? 'checkbox' : 'radio'" :aria-checked="opt.mine"
                                                    class="pressable relative block w-full overflow-hidden rounded-tile border text-left disabled:opacity-70"
                                                    :class="opt.mine ? 'border-brand-500' : 'border-white/10 hover:border-brand-500/50'">
                                                <div class="absolute inset-y-0 left-0 bg-brand-500/15 transition-[width] duration-300 motion-reduce:transition-none" :style="`width:${opt.pct}%`"></div>
                                                <div class="relative flex items-center justify-between gap-2 px-2 py-1.5">
                                                    <span class="flex min-w-0 items-center gap-2">
                                                        {{-- Marker signalisiert die Wahlart: Radio (●/○) bei Einfach-, Checkbox (☑/☐) bei Mehrfachwahl. --}}
                                                        <span aria-hidden="true" class="shrink-0 text-sm" :class="opt.mine ? 'text-brand-500' : 'text-muted'"
                                                              x-text="opt.mine ? (m.poll.multi ? '☑' : '●') : (m.poll.multi ? '☐' : '○')"></span>
                                                        <span class="truncate text-sm" x-text="opt.label"></span>
                                                    </span>
                                                    <span class="shrink-0 font-mono text-xs text-muted" x-text="opt.votes"></span>
                                                </div>
                                            </button>
                                        </template>
                                    </div>
                                    {{-- Footer außerhalb der Scrollbox → bleibt fix sichtbar. --}}
                                    <div class="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
                                        <span x-text="m.poll.typeLabel + (m.poll.endsLabel ? ' · ' + m.poll.endsLabel : '')"></span>
                                        <span x-text="m.poll.voters + (m.poll.voters === 1 ? @js(__(' Stimme')) : @js(__(' Stimmen')))"></span>
                                    </div>
                                </div>
                            </template>
                            {{-- Zap-Goal (Z5, NIP-75 kind 9041): Titel steht in m.html (Goal-content),
                                 hier Details + Fortschrittsbalken (aus validiertem 9735-Tally) +
                                 „Beitragen"-Zap. Eigenes Ziel (!zappable) zeigt nur den Fortschritt. --}}
                            <template x-if="m.goal">
                                <div class="surface-card mt-1.5 space-y-2 rounded-tile border border-brand-500/20 p-3">
                                    {{-- Summary auf eine Zeile abgeschnitten (+ Hover-Tooltip für die
                                         Vollansicht): hält die Goal-Höhe fix, egal wie lang die Beschreibung
                                         ist → async-stabil, Estimate trifft → kein Jitter (Nutzer-Vorgabe). --}}
                                    <template x-if="m.goal.summary">
                                        <p class="truncate text-sm text-muted" :title="m.goal.summary" x-text="m.goal.summary"></p>
                                    </template>
                                    <div>
                                        <div class="flex items-center justify-between gap-2 font-mono text-xs tabular-nums">
                                            <span class="font-semibold text-brand-500" x-text="m.goal.raisedSats.toLocaleString('de-DE') + ' Sats'"></span>
                                            <span class="text-muted" x-text="@js(__('Ziel ')) + m.goal.targetSats.toLocaleString('de-DE')"></span>
                                        </div>
                                        {{-- Balken: role=progressbar trägt den Wert für SR; die Breite
                                             animiert nur bei motion-safe (Reduced-Motion springt). --}}
                                        <div class="mt-1 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar"
                                             :aria-valuenow="m.goal.pct" aria-valuemin="0" aria-valuemax="100"
                                             aria-label="{{ __('Ziel-Fortschritt') }}"
                                             :aria-valuetext="m.goal.pct + @js(__(' Prozent — ')) + m.goal.raisedSats.toLocaleString('de-DE') + @js(__(' von ')) + m.goal.targetSats.toLocaleString('de-DE') + ' Sats'">
                                            <div class="h-full rounded-full bg-brand-500 transition-[width] duration-500 motion-reduce:transition-none"
                                                 :style="`width:${m.goal.pct}%`"></div>
                                        </div>
                                    </div>
                                    <div class="flex items-center justify-between gap-2">
                                        <span class="text-xs text-muted"
                                              x-text="m.goal.contributors + (m.goal.contributors === 1 ? @js(__(' Beitragende:r')) : @js(__(' Beitragende'))) + (m.goal.reached ? @js(__(' · Ziel erreicht 🎉')) : '')"></span>
                                        <flux:button size="xs" variant="primary" icon="bolt" class="shrink-0 icon-btn-touch"
                                                     x-show="zapsEnabled && m.zappable" x-cloak
                                                     x-on:click.stop="openZap(m)">{{ __('Beitragen') }}</flux:button>
                                    </div>
                                </div>
                            </template>
                            {{-- Grow-only Chip-Bereich (Schritt 1, plans/chat-message-cache-no-flicker.md):
                                 EIN Container um Reaction- + Zap-Zeile mit stabiler :id. bridge.ts misst
                                 im $nextTick die Höhe und hält sie als min-height — nachladende oder
                                 zurückgenommene Chips vergrössern das Item, kollabieren es aber nie
                                 (keine Motion in der Liste). Leer = Höhe 0 (kein reservierter Leerstreifen).
                                 `flow-root` = eigener BFC, damit das mt-1 der inneren Zeile INNERHALB
                                 der border-box liegt und offsetHeight es miterfasst (sonst 4px-Ruck). --}}
                            {{-- Chip-Lane mit RESERVIERTER Höhe (min-h-7 = eine Chip-Reihe): Zap-/
                                 Reaction-Chips laden async nach (throttled stores) → ohne Reservierung
                                 wüchse die Zeile beim Eintreffen von 0 auf 28px → scrollHeight ändert
                                 sich → Scrollbalken-Thumb zuckt. Der reservierte Platz fängt das ab
                                 (Chips füllen ihn, die Zeilenhöhe bleibt konstant). Reactions UND Zap in
                                 EINER umbrechenden Reihe → bei sehr vielen Chips kann eine zweite Reihe
                                 entstehen; das ist mit dem Spacer-Sync-Fix (chatVirtualizer.ts scrollToFn)
                                 aber KEINE Oszillation mehr, sondern eine einmalige, saubere Höhenkorrektur
                                 (Leseposition bleibt erhalten). Darum bewusst flex-wrap statt einer
                                 erzwungenen Ein-Reihen-Lane mit horizontalem Scrollbalken: der Balken
                                 brächte die Höhenvariabilität (Balkenhöhe) zurück und schöbe den Zap-Chip
                                 aus dem Bild. `mt-1` als Padding (flow-root/border-box → offsetHeight
                                 erfasst es). --}}
                            <div :id="'chips-'+m.id" class="mt-1 flex min-h-7 flex-wrap items-center gap-1">
                                {{-- Antworten-Indikator (C6b, Slack-Stil): erscheint an JEDER Nachricht mit
                                     ≥1 Antwort (kind 1111). Überlappende Teilnehmer-Gesichter + Zähler +
                                     „vor …" der letzten Antwort → öffnet den Thread. Passt in die reservierte
                                     Chip-Lane (h-7 = min-h-7), also kein Layout-Sprung beim Nachladen.
                                     REIHENFOLGE: Thread → Reaktionen → Zap. Der klickbare Thread-Pill steht
                                     bewusst ZUERST (wichtigste Navigations-Aktion); Reaktionen und Zaps hängen
                                     rechts an. --}}
                                <template x-if="m.thread">
                                    {{-- P2: Pille = teilbarer Deep-Link auf die Thread-Route (wire:navigate,
                                         Vollansicht) statt In-Place-Modal. Real-`<a>` → back/mittelklick/teilbar.
                                         KEIN `.stop`: wire:navigate lauscht global, stopPropagation bräche es. --}}
                                    <a wire:navigate :href="threadHref(m)"
                                            :aria-label="m.thread.count + (m.thread.count === 1 ? @js(__(' Antwort, letzte ')) : @js(__(' Antworten, letzte '))) + m.thread.lastLabel + @js(__(' — Thread öffnen'))"
                                            class="chip-in pressable group/th inline-flex h-7 items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/10 pl-1 pr-2.5 text-brand-500 transition-colors motion-reduce:transition-none hover:border-brand-500 hover:bg-brand-500/15">
                                        <span class="flex -space-x-1.5">
                                            <template x-for="f in m.thread.faces" :key="f.pubkey">
                                                <span class="inline-flex rounded-full ring-2 ring-white dark:ring-zinc-900">
                                                    <x-group::nostr-avatar picture="f.picture" name="f.name" size="1.15rem" />
                                                </span>
                                            </template>
                                        </span>
                                        <span class="text-xs font-semibold" x-text="m.thread.count + (m.thread.count === 1 ? @js(__(' Antwort')) : @js(__(' Antworten')))"></span>
                                        <span class="text-xs text-muted" x-text="'· ' + m.thread.lastLabel"></span>
                                        <flux:icon.chevron-right class="size-3.5 shrink-0 opacity-60 transition-transform motion-reduce:transition-none group-hover/th:translate-x-0.5" />
                                    </a>
                                </template>
                                {{-- Reaction-Chips (C1): pro Emoji Zähler + eigener Toggle-Zustand. --}}
                                <template x-for="r in m.reactions" :key="r.key">
                                    {{-- Pills homogen: feste Höhe + Mindestbreite, Emoji/Bild auf
                                         identische Größe normiert (das Inline-`chat-emoji` wäre sonst
                                         1.4em → höhere Pill als ein Unicode-Emoji). --}}
                                    <button type="button" x-on:click.stop="toggleReaction(m, r)" :aria-pressed="r.mine"
                                            :title="r.names"
                                            class="chip-in pressable inline-flex h-6 min-w-7 items-center justify-center gap-1 rounded-full border px-2 text-sm leading-none"
                                            :class="r.mine ? 'border-brand-500 bg-brand-500/15 text-brand-500' : 'border-white/10 bg-white/5 text-muted hover:border-brand-500/50'">
                                        <template x-if="r.emojiUrl"><img class="chat-emoji !size-4 shrink-0 object-contain" :src="r.emojiUrl" :alt="r.content" loading="lazy" /></template>
                                        <template x-if="!r.emojiUrl"><span x-text="r.label"></span></template>
                                        <span x-show="r.count > 1" x-text="r.count" class="font-mono text-xs"></span>
                                    </button>
                                </template>
                                {{-- ⚡-Zap-Chip (Z3): validierte 9735-Summe in Sats, Brand-Ramp,
                                     hervorgehoben wenn man selbst (mit)gezappt hat. Tap re-zappt
                                     (nur fremde Nachrichten → openZap gatet über m.zappable).
                                     Bei Goals (Z5) unterdrückt — der Fortschrittsbalken zeigt die Summe.
                                     ZULETZT in der Lane (s. Reihenfolge-Hinweis oben): Thread-Pill zuerst,
                                     Reaktionen, dann Zap ganz rechts. --}}
                                <template x-if="m.zaps.count && !m.goal">
                                    <button type="button"
                                            x-on:click.stop="zapsEnabled && m.zappable && openZap(m)"
                                            :title="m.zaps.names"
                                            :aria-label="(m.zaps.mine ? @js(__('Du hast gezappt. ')) : '') + m.zaps.sats + @js(__(' Sats gezappt von ')) + m.zaps.names + (zapsEnabled && m.zappable ? @js(__(' – tippen zum erneuten Zappen')) : '')"
                                            class="chip-in pressable inline-flex h-6 min-w-7 items-center justify-center gap-1 rounded-full border px-2 text-sm leading-none transition-colors motion-reduce:transition-none"
                                            :class="m.zaps.mine ? 'border-brand-500 bg-brand-500/15 text-brand-500' : 'border-white/10 bg-white/5 text-muted hover:border-brand-500/50'">
                                        <flux:icon.bolt variant="solid" class="size-3.5 shrink-0 text-brand-500" />
                                        <span x-text="m.zaps.sats" class="font-mono text-xs tabular-nums"></span>
                                    </button>
                                </template>
                            </div>
                        </div>
                        {{-- Aktionen: schwebende Toolbar oben rechts (bei Hover/aktivem Tap).
                             `absolute` → nimmt KEINEN Layout-Platz, der Text behält die volle
                             Breite (früher drückte die Leiste ihn auf Mobile schmal). Opaker
                             surface-Hintergrund, damit sie über langem Text lesbar bleibt. --}}
                        <div class="surface-card pointer-events-none absolute right-1 top-0.5 z-10 flex items-center gap-0.5 rounded-full px-0.5 shadow-md opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:opacity-100"
                             :class="activeId===m.id && '!pointer-events-auto !opacity-100'">
                            {{-- Zap (Z3, NIP-57): WICHTIGSTE Aktion → ganz vorne, Brand-Gelb.
                                 `!text-brand-500` überschreibt Flux' ghost-Textfarbe
                                 (text-zinc-800/white, gleiche Spezifität → sonst Reihenfolge).
                                 Nur fremde Nachrichten mit lud16; Feature-Flag-gated. --}}
                            <flux:button size="xs" variant="ghost" icon="bolt" class="icon-btn-touch !text-brand-500"
                                         x-show="zapsEnabled && m.zappable" x-cloak x-on:click.stop="openZap(m)"
                                         aria-label="Zap" />
                            {{-- Antworten: im Raum q-Reply (Raum-Composer), im Thread verschachtelte
                                 Kommentar-Antwort (Thread-Composer). --}}
                            <flux:button size="xs" variant="ghost" icon="arrow-uturn-left" class="icon-btn-touch"
                                         x-on:click.stop="{{ $context === 'thread' ? 'setThreadReply(m)' : 'setReply(m)' }}" aria-label="{{ __('Antworten') }}" />
                            @if ($context === 'room')
                            {{-- Im Thread antworten (C6b): öffnet den Thread dieser Nachricht (jede Nachricht
                                 ist thread-fähig). Nur im Raum — ein Kommentar wurzelt keinen Sub-Thread. --}}
                            <flux:button size="xs" variant="ghost" icon="chat-bubble-oval-left" class="icon-btn-touch"
                                         x-on:click.stop="openThread(m)" aria-label="{{ __('Im Thread antworten') }}" />
                            {{-- Löschen: Raum-Nachricht (kind 9, deleteRoomMessage). Kommentar-Delete (kind
                                 1111) ist nicht implementiert → im Thread aus. --}}
                            <flux:button size="xs" variant="ghost" icon="trash" class="icon-btn-touch"
                                         x-show="m.mine" x-cloak x-on:click.stop="askDelete(m)" ::disabled="deleting"
                                         aria-label="{{ __('Nachricht löschen') }}" />
                            @endif
                            {{-- Reaktions-Picker (C1, Web): volles Emoji-Panel. Teleportiert ans
                                 <body> (sonst würde der Chat-Scroll-Container es abschneiden) und
                                 `fixed` mit Flip positioniert (reactionPopover) → nie aus dem Viewport.
                                 `x-if="open"` mountet den Picker erst beim Öffnen. App: „…"-Modal. --}}
                            <template x-if="!isMobile">
                                <div x-data="reactionPopover()" x-on:click.stop>
                                    <flux:button x-ref="trigger" size="xs" variant="ghost" icon="face-smile"
                                                 class="icon-btn-touch" x-on:click="toggle()" aria-label="{{ __('Reagieren') }}" />
                                    {{-- x-if (lazy-mount) + x-teleport getrennt verschachteln — beides
                                         auf EINEM template teleportiert bei jedem Tick neu (Leak). --}}
                                    <template x-if="open">
                                        <div>
                                            <template x-teleport="body">
                                                {{-- x-on:click.stop: das Panel ist nach <body> teleportiert, der
                                                     .stop-Wrapper (reactionPopover) ist kein Vorfahre mehr →
                                                     ohne .stop bubbelt ein Klick im Picker zum document und
                                                     triggert click.outside des Thread-Overlays (closeThread). --}}
                                                <div x-ref="panel" x-transition.opacity :style="panelStyle"
                                                     x-on:click.stop
                                                     x-on:click.outside="closeUnless($event)"
                                                     x-on:keydown.escape.window="open = false"
                                                     class="surface-card fixed z-50 rounded-card p-2 shadow-xl">
                                                    <x-group::emoji-picker message="m" onpick="open = false" />
                                                </div>
                                            </template>
                                        </div>
                                    </template>
                                </div>
                            </template>
                            {{-- „…"-Menü = gemeinsamer Andockpunkt für alle weiteren Aktionen (C1–C4).
                                 Web: Zeilen-Popover (flux:dropdown). Native App: Vollbild-Modal (openMessageMenu). --}}
                            <template x-if="!isMobile">
                                <div x-on:click.stop>
                                    <flux:dropdown position="top" align="end">
                                        <flux:button size="xs" variant="ghost" icon="ellipsis-horizontal"
                                                     class="icon-btn-touch" aria-label="{{ __('Weitere Aktionen') }}" />
                                        <flux:menu>
                                            {{-- Zap (Z3, NIP-57): WICHTIGSTE Aktion → ganz vorne. Nur fremde Nachricht mit lud16. --}}
                                            <template x-if="zapsEnabled && m.zappable">
                                                <flux:menu.item icon="bolt" x-on:click="openZap(m)">Zap</flux:menu.item>
                                            </template>
                                            <flux:menu.item icon="arrow-uturn-left" x-on:click="{{ $context === 'thread' ? 'setThreadReply(m)' : 'setReply(m)' }}">{{ __('Antworten') }}</flux:menu.item>
                                            @if ($context === 'room')
                                            {{-- Im Thread antworten (C6b): öffnet den Thread dieser Nachricht. Nur im Raum. --}}
                                            <flux:menu.item icon="chat-bubble-oval-left" x-on:click="openThread(m)">{{ __('Im Thread antworten') }}</flux:menu.item>
                                            {{-- Zitieren (C3): Nachricht ohne Kommentar teilen (Quote-Only) — Raum-Composer. --}}
                                            <flux:menu.item icon="chat-bubble-left-right" x-on:click="share(m)">{{ __('Zitieren') }}</flux:menu.item>
                                            {{-- Bearbeiten (C3): nur eigene Nachrichten, ≤5 min alt (kind-9-spezifisch → nur Raum). --}}
                                            <template x-if="canEdit(m)">
                                                <flux:menu.item icon="pencil-square" x-on:click="startEdit(m)">{{ __('Bearbeiten') }}</flux:menu.item>
                                            </template>
                                            @endif
                                            {{-- Fork off!: fremde Nachrichten anprangern (NIP-56 kind 1984) — generisch, auch im Thread. --}}
                                            <template x-if="!m.mine">
                                                <flux:menu.item icon="flag" x-on:click="askReport(m)">Fork off!</flux:menu.item>
                                            </template>
                                            @if ($context === 'room')
                                            {{-- Löschen: nur eigene Nachrichten (NIP-09 kind 5, kind-9-spezifisch → nur Raum). --}}
                                            <template x-if="m.mine">
                                                <flux:menu.item icon="trash" variant="danger" x-on:click="askDelete(m)">{{ __('Löschen') }}</flux:menu.item>
                                            </template>
                                            @endif
                                            {{-- Moderation (P1, NIP-86): nur Admins, nur fremde Nachrichten. $context-agnostisch
                                                 (banevent/banpubkey wirken auf jedes kind, auch Thread-Kommentare). Drei separate
                                                 template x-if, je EIN flux-Kind — ein Wrapper-Div verschluckte flux:menu. --}}
                                            <template x-if="isAdmin && !m.mine">
                                                <flux:menu.separator />
                                            </template>
                                            <template x-if="isAdmin && !m.mine">
                                                <flux:menu.item icon="trash" variant="danger" x-on:click="askAdminDelete(m)">{{ __('Nachricht entfernen') }}</flux:menu.item>
                                            </template>
                                            {{-- „Autor bannen" (banpubkey) vorerst NICHT angeboten (bewusst deaktiviert). Zum
                                                 Reaktivieren dieses template x-if wieder einkommentieren (JS confirmBanAuthor bleibt).
                                            <template x-if="isAdmin && !m.mine">
                                                <flux:menu.item icon="no-symbol" variant="danger" x-on:click="askBanAuthor(m)">{{ __('Autor bannen') }}</flux:menu.item>
                                            </template>
                                            --}}
                                            {{-- C4: Kopieren/Info (nur lesen, kein Publish). --}}
                                            <flux:menu.separator />
                                            <flux:menu.item icon="link" x-on:click="copyNevent(m)">{{ __('Event-Link kopieren') }}</flux:menu.item>
                                            <flux:menu.item icon="user-circle" x-on:click="copyNpub(m)">{{ __('npub kopieren') }}</flux:menu.item>
                                            <flux:menu.item icon="code-bracket" x-on:click="copyJson(m)">{{ __('JSON kopieren') }}</flux:menu.item>
                                            <flux:menu.item icon="information-circle" x-on:click="openInfo(m)">{{ __('Info') }}</flux:menu.item>
                                        </flux:menu>
                                    </flux:dropdown>
                                </div>
                            </template>
                            <template x-if="isMobile">
                                <flux:button size="xs" variant="ghost" icon="ellipsis-horizontal"
                                             class="icon-btn-touch" x-on:click.stop="openMessageMenu(m, {{ $context === 'thread' ? 'true' : 'false' }})"
                                             aria-label="{{ __('Weitere Aktionen') }}" />
                            </template>
                        </div>
                    </div>
