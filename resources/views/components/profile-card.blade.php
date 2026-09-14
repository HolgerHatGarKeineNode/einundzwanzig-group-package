{{-- Autor-Profil-Karte (PLAN4 B3) als Identitätskarte: Banner-Header, überlappender
     Ring-Avatar (Brand-Glow), kopierbare Mono-Chips für npub/Lightning. Eigene
     Alpine-Insel, geöffnet per `open-profile`-Window-Event ($dispatch aus Chat/
     Directory mit der pubkey). Daten reaktiv aus welshman (deriveProfile +
     verifizierter NIP-05-Handle, lazy). Einmal pro Seite einbinden. --}}
<div x-data="nostrProfileCard" x-on:open-profile.window="open($event.detail)">
    <flux:modal name="profile-card" class="max-w-sm overflow-hidden">
        {{-- Flux-Modal-Padding (p-6) aufheben, damit der Banner randlos blutet. --}}
        <div class="-m-6">
            {{-- Banner-Header. Ohne Banner: Brand-Verlauf statt leerer Fläche.

                 Derselbe dritte Weg wie beim Avatar: liegt der Banner auf dem
                 Workspace-Relay, ist er nur mit signiertem Blossom-Header lesbar.
                 `$blossomBind` legt dafür eine `blob:`-URL in `authSrc`; solange die
                 fehlt, entsteht KEIN `<img>`. Der eigene `x-data`-Rahmen ist nötig,
                 weil der Zustand pro BILD geführt wird — der Avatar darunter hat
                 seinen eigenen. Ohne diesen Rahmen ging die private URL an
                 `$img(...)`, also an den serverseitigen Bild-Proxy: genau der Weg,
                 der hier ausdrücklich nicht gegangen werden soll. --}}
            <div class="relative h-28 bg-gradient-to-br from-brand-500/30 via-brand-500/10 to-transparent"
                 x-data="{ imgOrig: false, imgBroken: false, needsAuth: false, authSrc: '' }"
                 x-effect="$blossomBind($data, banner)">
                <template x-if="banner && !imgBroken && (!needsAuth || authSrc)">
                    <img :src="needsAuth ? authSrc : (imgOrig ? banner : $img(banner, 'full'))" alt=""
                         x-on:error="needsAuth ? (imgBroken = true) : (imgOrig ? (imgBroken = true) : ($imgFallback(banner) ? (imgOrig = true) : (imgBroken = true)))"
                         class="absolute inset-0 size-full object-cover" />
                </template>
                {{-- Scrim Banner → Kartengrund, damit der Avatar sauber aufsitzt. --}}
                <div class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent dark:from-zinc-900"></div>
            </div>

            <div class="px-6 pb-6">
                {{-- Avatar überlappt den Banner-Rand; der Ring stanzt ihn frei (Brand-Glow). --}}
                <div class="-mt-12 mb-3">
                    <div class="inline-block rounded-full ring-4 ring-white dark:ring-zinc-900" style="box-shadow: var(--shadow-glow)">
                        <x-group::nostr-avatar picture="picture" name="name" size="5rem" emoji="status.emoji" />
                    </div>
                </div>

                <div class="flex items-center gap-1.5">
                    <flux:heading size="xl" class="min-w-0 break-words" x-text="name"></flux:heading>
                    <x-group::nostr-nip05 nip05="nip05" />
                </div>

                {{-- Verifizierter NIP-05-Handle (nur bei bestätigtem Match, PLAN4 B4). --}}
                <div x-show="nip05" x-cloak class="mt-0.5 truncate text-sm text-muted" x-text="nip05"></div>

                {{-- NIP-38-Status (P2). Die Karte ist die EINZIGE Fläche, die ihn vollständig
                     als Text zeigt: die Chat-Zeile kürzt per CSS, die Avatar-Plakette trägt nur
                     das Emoji und ist `aria-hidden`. Also ist dies auch die einzige Stelle, an
                     der ein Screenreader den Status hört — deshalb steht das Emoji hier als
                     echter Text neben dem Satz und nicht als Dekor.
                     Kein Skeleton: die Karte öffnet auf Tastendruck, lange nachdem die
                     Relay-Weiche gefallen ist; ein Platzhalter wäre hier reine Unruhe. --}}
                <div x-show="status.text || status.emoji" x-cloak data-user-status
                     class="mt-1.5 flex items-start gap-1.5 text-sm">
                    <span x-show="status.emoji" x-text="status.emoji"></span>
                    <span class="min-w-0 break-words text-muted" x-text="status.text"></span>
                </div>

                {{-- npub — kopierbarer Mono-Chip (npub ist ein Wert zum Kopieren). --}}
                <button type="button" x-on:click="copy(npub, @js(__('npub kopiert.')))" aria-label="{{ __('npub kopieren') }}"
                        class="pressable group mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-tile bg-brand-500/10 px-2.5 py-1 font-mono text-xs text-brand-800 dark:text-brand-400">
                    <span class="min-w-0 truncate" x-text="npub"></span>
                    <flux:icon.clipboard-document class="size-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                </button>

                {{-- Bio --}}
                <flux:text x-show="about" x-cloak class="mt-3 whitespace-pre-wrap break-words text-sm" x-text="about"></flux:text>

                {{-- Website — eigene volle Zeile, lange URLs truncaten statt auszulaufen. --}}
                <a x-show="website" x-cloak :href="website" target="_blank" rel="noopener noreferrer"
                   class="pressable mt-3 flex min-w-0 items-center gap-2 rounded-tile border border-zinc-200 px-3 py-2 text-sm text-brand-800 hover:bg-brand-500/5 dark:border-zinc-800 dark:text-brand-400">
                    <flux:icon.globe-alt class="size-4 shrink-0" />
                    <span class="min-w-0 truncate" x-text="website"></span>
                    <flux:icon.arrow-up-right class="ml-auto size-3.5 shrink-0 opacity-50" />
                </a>

                {{-- ── Der Ausgang: dasselbe Profil auf media. ────────────────────────
                     Bis hierher hatte diese Karte KEINEN Ausgang „Profil anderswo
                     ansehen" — npub und Lightning kopieren, die Website öffnen, mehr
                     nicht. Der Verweis schließt den Loop im eigenen Haus, statt Leute
                     auf njump oder einen fremden Client zu schicken.

                     BAUFORM = die der Website-Zeile darüber, Zeichen für Zeichen: gleiche
                     Kante, gleiches Polster, gleicher Pfeil rechts. Zwei Zeilen derselben
                     Klasse (ein externes Ziel öffnen) sollen gleich aussehen; eine eigene
                     Betonung nähme dem ⚡-Chip darunter seinen Akzent, und der ist der
                     einzige der Karte.

                     `x-show="medienUrl()"` und `:href="medienUrl() || null"`: ohne Ziel
                     gibt es kein `href`, und ein `<a>` ohne `href` ist kein Tabstopp
                     (gleiche Bauform wie `autorHref()`). Das `@if` darum ist die
                     SERVER-seitige Entscheidung — ist nichts konfiguriert, entsteht die
                     Zeile gar nicht erst.

                     `$extern(...)` neben `target="_blank"`: in der nativen WebView
                     verpufft ein `_blank`-Anker wirkungslos (im Haus dreimal beschrieben,
                     zuletzt bei `openChatLink`). Im Web bleibt es ein gewöhnlicher Anker
                     — Mittelklick, „Link kopieren", Tastatur inklusive. --}}
                @if (config('group.media_public_url'))
                    @php($medienHost = (string) Str::of((string) config('group.media_public_url'))->after('://')->before('/'))
                    <a x-show="medienUrl()" x-cloak :href="medienUrl() || null"
                       x-on:click="$extern(medienUrl(), $event)"
                       target="_blank" rel="noopener noreferrer" data-medien-profil="karte"
                       class="pressable mt-2 flex min-w-0 items-center gap-2 rounded-tile border border-zinc-200 px-3 py-2 text-sm text-brand-800 hover:bg-brand-500/5 dark:border-zinc-800 dark:text-brand-400">
                        <flux:icon.user-circle class="size-4 shrink-0" />
                        <span class="min-w-0 truncate">{{ __('Profil auf :host ansehen', ['host' => $medienHost]) }}</span>
                        <flux:icon.arrow-up-right class="ml-auto size-3.5 shrink-0 opacity-50" />
                    </a>
                @endif

                {{-- ── Reach this person (P8) ─────────────────────────────────────────
                     Two actions, side by side, above the hide block: write to them, and
                     follow them. Both were missing until P8 — the card showed who somebody
                     is and offered exactly one thing to DO with that, namely hide them.

                     `x-show` and not `x-if`, like the block below and for the same reason:
                     the card is ONE node for every person, `open()` only swaps the data.

                     **Neither button appears on your own card.** Writing to yourself is a
                     legal NIP-17 shape but reads like a defect (`writeTo` refuses it), and
                     a contact list containing its own author says nothing (`planFollowWrite`
                     refuses it). Both stores refuse a second time; this is the surface half
                     of a decision that is settled in the pure rules.

                     `text-btn-touch`: the house utility for LABELLED targets — 44 px on a
                     coarse pointer, 32 px on a mouse (`theme.css`, WCAG 2.5.5 / Apple HIG).
                     Same class as the hide button below, so the three targets in this card
                     grow together. --}}
                <div x-show="pubkey && pubkey !== $store.follows?.me" x-cloak
                     class="mt-4 flex gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                    {{-- The store is mounted app-wide in `app-frame.blade.php`; the card
                         only reads it. `writeTo` opens (or seeds) the conversation and
                         navigates — the picker on `/messages` is not involved, because the
                         person is already chosen. --}}
                    {{-- ── The label is „Schreiben", and that is a MEASUREMENT ─────────
                         With „Nachricht schreiben" the two buttons came out 170.05 px and
                         141.55 px at 1280 px. Not because `flex-1` failed — both carry
                         `flex-basis: 0px`, `flex-grow: 1`, `flex-shrink: 1`, read off the
                         rendered element — but because a Flux button is
                         `whitespace-nowrap`: its content sets a `min-width` the flex
                         algorithm cannot go below, so the longer label took its minimum and
                         the other one got the remainder. `basis-0` changes nothing about
                         that and stays only because it is the correct basis to state.

                         Shortening the visible label is the fix that keeps both buttons
                         under their share. The full sentence lives in `aria-label`, so
                         screen readers keep it; the padlock carries „encrypted" visually,
                         which is also why this button and no other has that icon. --}}
                    <flux:button variant="primary" size="sm" icon="lock-closed" class="flex-1 basis-0 text-btn-touch"
                                 data-person-dm
                                 aria-label="{{ __('Verschlüsselte Nachricht schreiben') }}"
                                 x-show="$store.privateMessages?.canSend" x-cloak
                                 x-on:click="$store.privateMessages?.writeTo(pubkey)">
                        {{ __('Schreiben') }}
                    </flux:button>

                    {{-- Kind 3 is the most consequential replaceable list this client
                         writes: one per person, global, and the object every other client
                         reads to build a feed. The button is offered on `canFollow`, but the
                         write itself is gated a second time on whether the relay ANSWERED
                         the read (`planFollowWrite`) — a follow written on an unseen list
                         would delete every contact made elsewhere. `js/follows.ts` carries
                         the measurement. --}}
                    {{-- ONE button with a swapping label, and a FIXED `variant` — the
                         same shape as the hide button below. `x-bind:variant` would be a
                         dead binding: Flux resolves `variant` at compile time into a class
                         set, so the bound attribute would land in the HTML and change
                         nothing (measured in this repo for `flux:icon ::variant`, and the
                         same mechanism applies here). Two buttons swapped by `x-show`
                         would work but double the target the keyboard walks over. --}}
                    {{-- ── The THIRD state: we do not know yet (P1) ───────────────────
                         `canFollow` only answers whether this RELAY takes a kind 3. It
                         says nothing about whether we have seen the reader's own list, and
                         until P1 the button had no way to say so: "does not follow" and
                         "we have not looked" were one and the same word, namely „Folgen".
                         That word is the lie this state exists to stop — so the label here
                         is neutral and makes no claim about the direction.

                         `listSeen` is the strict verdict: a relay closed a read of our own
                         list with an `EOSE` (`js/follows.ts`). `$store.follows?.listSeen`
                         is `undefined` before the store is wired, and `!undefined` is
                         true — the unknown state is what an absent store falls into, which
                         is the right way round.

                         `aria-disabled` and NOT `disabled`: the button keeps its place in
                         the tab order and keeps announcing itself, which is what lets a
                         screen reader hear the reason at all. It is only an announcement
                         though — the lock that makes a click harmless sits in
                         `toggle()`, not here.

                         The visible label is SHORT on purpose. Both buttons in this row
                         are `flex-1 basis-0` and a Flux button is `whitespace-nowrap`, so
                         its content sets a `min-width` the flex algorithm cannot go below
                         — the measurement two comments up is exactly that failure. The
                         whole sentence therefore lives in `aria-label`, which is bound to
                         `null` in the ordinary state so it never overrides the real
                         label. --}}
                    <flux:button variant="filled" size="sm" class="flex-1 basis-0 text-btn-touch" data-person-follow
                                 x-show="$store.follows?.canFollow" x-cloak
                                 x-bind:aria-busy="$store.follows?.busy ? 'true' : 'false'"
                                 x-bind:aria-disabled="$store.follows?.listSeen ? null : 'true'"
                                 x-bind:aria-label="$store.follows?.listSeen ? null : @js(__('Kontaktliste wird geladen — Folgen ist noch nicht möglich'))"
                                 x-on:click="$store.follows?.toggle(pubkey)">
                        <span x-text="!$store.follows?.listSeen ? @js(__('Lädt…')) : ($store.follows?.isFollowing(pubkey) ? @js(__('Entfolgen')) : @js(__('Folgen')))"></span>
                    </flux:button>
                </div>
                <flux:text x-show="$store.follows?.error" x-cloak data-person-follow-fehler
                           class="mt-1 text-xs text-red-600 dark:text-red-400" x-text="$store.follows?.error"></flux:text>

                {{-- ── The reach of this list, said once and plainly (P2, corrected N1) ──
                     A reader with no NIP-65 relay list has not said where their data
                     belongs, so this client writes their contact list to the general
                     public relays (`FOLLOW_FALLBACK_RELAYS` in `js/follows.ts`). That
                     works — those relays serve kind 3 and other clients read them — but
                     it is not what the reader chose, and the next client they use may
                     look somewhere else entirely.

                     **The earlier wording said the list „is not findable outside this
                     Space". That was true while the space was the only target and is
                     false since N1** — the space is no longer written to at all. A
                     sentence that describes a previous version is worse than none: the
                     reader acts on it.

                     The write still happens. A gate here would be a dead end: this
                     client has no write path for kind 10002 (`RelayLists.update`,
                     `setWriteUrls`, `addWriteUrl` appear nowhere in `js/`), so the
                     reader could not satisfy it. A sentence they can act on elsewhere is
                     the honest answer; a blocked button would not be.

                     Gated on `listSeen` as well, and that is the whole point: before a
                     read has come back, „no relay list" and „nobody has looked" are the
                     same `false`, and only one of them is a statement about this reader.
                     `js/follows.ts` sets both fields from the same answer. --}}
                <flux:text x-show="$store.follows?.canFollow && $store.follows?.listSeen && $store.follows?.noRelayList"
                           x-cloak data-person-follow-lokal
                           class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {{ __('Du hast keine Relay-Liste (NIP-65) hinterlegt. Deine Kontaktliste wird deshalb auf allgemeine Relais geschrieben.') }}
                </flux:text>

                {{-- ── Hide a person (P6, NIP-51 kind 10000) ──────────────────────────
                     The COUNTERPART of "Raum stummschalten": different kind, different
                     list, different word, different icon (`eye-slash` instead of
                     `bell-slash`). That naming decision was taken in P4 and is held as a
                     comment in both room menus — this is the surface it was taken for.

                     And it is explicitly NOT a ban: the association does not ban or
                     remove its members (decision 2026-09-03). This action only affects
                     this reader's own view, and the sentence below says so rather than
                     leaving it to a comment.

                     `x-show` and not `x-if`: the card is ONE node for every person,
                     `open()` only swaps the data. An `x-if` would rebuild the button on
                     every open, and the condition hangs on `canMute`, which is settled
                     after the first open anyway.

                     Your own person does not get the button: hiding yourself would take
                     away your own messages together with the way back (`planMuteWrite`
                     refuses it a second time). --}}
                <div x-show="$store.mutes?.canMute && pubkey !== $store.mutes?.me" x-cloak class="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                    {{-- `text-btn-touch`: the house utility for LABELLED targets — it lifts
                         the height to 44 px on a coarse pointer only and leaves the mouse
                         compact (`theme.css`, WCAG 2.5.5 / Apple HIG). Measured on
                         2026-09-05, settled geometry: 44.00 px on a coarse pointer with the
                         class, 32.00 px without it — which clears WCAG 2.5.8's 24 px and
                         misses the thumb. On a mouse it is 32.00 px either way. No
                         `icon-btn-touch` here: that one also sets `min-width`, and this
                         button already spans the card. --}}
                    <flux:button variant="ghost" size="sm" icon="eye-slash" class="w-full justify-start text-btn-touch"
                                 data-person-mute
                                 x-bind:aria-busy="$store.mutes.busy ? 'true' : 'false'"
                                 x-on:click="$store.mutes.toggle(pubkey)">
                        <span x-text="$store.mutes.isMuted(pubkey) ? @js(__('Person wieder einblenden')) : @js(__('Person ausblenden'))"></span>
                    </flux:button>
                    <flux:text class="mt-1 text-xs text-muted">{{ __('Wirkt nur in deiner Anzeige. Die Beiträge werden weiterhin vom Relay geladen — das ist keine Sperre und keine Vertraulichkeit.') }}</flux:text>
                    <flux:text x-show="$store.mutes.error" x-cloak class="mt-1 text-xs text-red-600 dark:text-red-400" x-text="$store.mutes.error"></flux:text>
                </div>

                {{-- Lightning — kopierbarer ⚡-Chip. Reine Anzeige, KEINE Zaps (PLAN §1). --}}
                <button type="button" x-show="lud16" x-cloak x-on:click="copy(lud16, @js(__('Lightning-Adresse kopiert.')))"
                        aria-label="{{ __('Lightning-Adresse kopieren') }}"
                        class="pressable mt-2 flex w-full min-w-0 items-center gap-2 rounded-tile border border-brand-500/30 bg-brand-500/5 px-3 py-2">
                    <flux:icon.bolt variant="solid" class="size-4 shrink-0 text-brand-500" />
                    <span class="min-w-0 truncate font-mono text-xs" x-text="lud16"></span>
                    <flux:icon.clipboard-document class="ml-auto size-3.5 shrink-0 opacity-50" />
                </button>
            </div>
        </div>
    </flux:modal>
</div>
