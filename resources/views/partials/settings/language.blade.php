{{-- ── Sprache (P2): direkt unter „Darstellung" — beides beantwortet „wie sieht/
     klingt es aus", nicht „wem gehört das Konto".

     Bewusst KEIN `variant="segmented"` wie beim Theme: acht Endonyme in einer
     Leiste brechen unter 400px um oder scrollen horizontal. `flux:select` rendert
     ein natives <select>; im WebView öffnet damit der System-Picker.

     Keine Flaggen. Eine Flagge bezeichnet einen Staat, keine Sprache (Español ≠
     Spanien, Português ≠ Portugal), und Regional-Indicator-Emoji fallen auf
     Android als Tofu-Kästchen aus.

     Übernehmen liegt auf einem eigenen Knopf statt auf `change`: ein Wechsel lädt
     die Seite neu, das ist ein Kontextwechsel im Sinne von WCAG 3.2.2 (On Input).
     Firefox feuert `change` schon beim Durchpfeilen mit den Pfeiltasten — ein
     Auto-Submit machte die Tastaturauswahl unbenutzbar. --}}
<section aria-labelledby="settings-language">
    <flux:heading id="settings-language" level="2" size="sm" class="mb-2 text-muted">{{ __('Sprache') }}</flux:heading>

    <form method="POST" action="{{ route('group.locale') }}" class="surface-card p-3">
        @csrf

        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <flux:select
                name="locale"
                size="sm"
                class="sm:max-w-64"
                aria-label="{{ __('Sprache') }}"
            >
                @foreach (config('group.locales', []) as $code => $endonym)
                    <flux:select.option
                        value="{{ $code }}"
                        lang="{{ $code }}"
                        :selected="app()->getLocale() === $code"
                    >{{ $endonym }}</flux:select.option>
                @endforeach
            </flux:select>

            {{-- `outline`, nicht `primary`: die Marken-Orange ist auf diesem Screen
                 dem situativen CTA („Beitreten") vorbehalten. Ein zweiter oranger
                 Knopf in Sektion 5 von 6 zöge den Blick zuerst auf die Sprache und
                 verkehrte die Hierarchie. Gerechnet (2026-08-14 mit `p2-kontrast.mjs`
                 nachgezogen): Knopftext 15,13:1 hell (zinc-800 auf `bg-white`) und
                 10,37:1 dunkel (weiß auf `dark:bg-zinc-700`) — die Identifikation
                 trägt der Text, nicht die Kante (die liegt bei 1,26:1 hell und
                 1,33:1 dunkel, das ist Flux-Bestand und gilt für jeden Knopf dieser
                 App). Vorher standen hier 14,89 / 10,44 / 1,27 / 1,70; die erste
                 Zahl stammte aus Tailwinds zinc-Rampe (#27272a), die dieses Projekt
                 gar nicht führt — unser `--color-zinc-800` ist #262626. --}}
            <flux:button type="submit" variant="outline" size="sm" class="shrink-0">
                {{ __('Sprache wechseln') }}
            </flux:button>
        </div>

        <flux:text class="mt-3 text-xs text-muted">
            {{ __('Die Seite lädt neu, sobald du die Sprache wechselst.') }}
        </flux:text>
    </form>
</section>
