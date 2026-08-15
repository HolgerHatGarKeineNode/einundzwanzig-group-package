{{-- Relay-Gate (P11): für ein ANGEMELDETES Relay-Nicht-Mitglied. Der Relay hat
     AUTH angenommen und danach JEDE Lese-Anfrage mit
     `CLOSED restricted: you are not a member of this relay` abgewiesen (gemessen,
     p11-02/p11-05) — der Raumzustand ist für diesen Client UNBEKANNT, nicht leer.
     Sichtbarkeit steuert die Rauminsel (`nostrRoomChat.gatedOut`, reaktiv vom
     restricted-CLOSED der Live-Sub abgeleitet, siehe bridge.ts); diese Komponente
     trägt bewusst KEIN eigenes `x-data` — der Gast-Pfad des verein-gate startet
     eine eigene Directory-Sub, und genau die käme hier nie durch.

     DIE SPRACHE (Nutzerentscheid P4, gilt unverändert): aus `restricted:` folgt
     nur Relay-Mitgliedschaft ≠ Vereinsmitgliedschaft — über die PERSON wissen wir
     nichts. Also nur Aussagen über den BEREICH, wortgleich mit dem Gast-Zweig des
     verein-gate (dieselben __()-Schlüssel, bewusst wiederverwendet statt
     dupliziert): „Nur für Mitglieder" / „Dieser Bereich ist Mitgliedern
     vorbehalten." Kein Knopf — es gibt keine Handlung, die von hier aus gelingen
     könnte (Anmeldung ist schon vorhanden, `join()` scheitert nachweislich). --}}
<div data-testid="room-gate-restricted"
     class="surface-card relative overflow-hidden !border-brand-500/30 p-6 text-center">
    <div aria-hidden="true" class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500 to-transparent"></div>

    <flux:icon.lock-closed class="mx-auto size-8 text-zinc-400" />

    <flux:heading size="lg" class="mt-2 text-balance">{{ __('Nur für Mitglieder') }}</flux:heading>

    <flux:text class="mx-auto mt-2 max-w-xs text-balance text-sm text-muted">
        {{ __('Dieser Bereich ist Mitgliedern vorbehalten.') }}
    </flux:text>
</div>
