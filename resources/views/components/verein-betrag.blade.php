{{-- Der Beitrag als Tatsache — eine Kachel, zwei Aufrufstellen (Statuten- und
     Zahlschritt).

     Vorher stand sie zweimal im Flow und beide Male anders: im Statutenschritt
     „Jahresbeitrag / 42 EUR / 2026", im Zahlschritt „42 EUR / Beitragsjahr 2026".
     Dieselbe Zahl, zwei Aufmachungen und einmal eine nackte Jahreszahl ohne
     Bezug — der Nutzer soll den Betrag über die Schritte hinweg WIEDERERKENNEN,
     nicht neu lesen müssen.

     `tabular-nums`: gleichbreite Ziffern. Die Zahl wechselt zwischen den
     Schritten nicht, aber sie steht neben `feeLabel()`-Platzhaltern, und ein
     springender Betrag sieht nach einem anderen Betrag aus. --}}
<div class="rounded-tile bg-brand-500/10 px-4 py-4 text-center">
    <flux:text class="text-xs font-medium uppercase tracking-wide text-muted">{{ __('Jahresbeitrag') }}</flux:text>
    <p class="mt-1 text-3xl font-bold tabular-nums tracking-tight"
       x-text="feeLabel() || @js(__('wird geladen…'))"></p>
    <flux:text class="mt-1 text-xs text-muted">
        {{ __('Beitragsjahr') }} <span x-text="year || '—'"></span>
    </flux:text>
</div>
