{{--
    P1 (Entwurf C): Dark ist der DEFAULT der Darstellung — der Entwurf ist
    „dark only" (Spec-Meta `colorScheme`), und ein System-Light-Nutzer sähe
    default die (bis zum Light-Defektscan nach P6) un reparierten Light-Zweige.

    Mechanismus: @fluxAppearance (Vendor) wendet beim Boot
    `localStorage.getItem('flux.appearance') || 'system'` an. Dieses Partial
    läuft DANACH und ersetzt nur den FALLBACK: steht KEIN Schlüssel, wird
    `applyAppearance('dark')` gesetzt — persistiert also als gewähltes Dunkel.

    Was das bewusst NICHT tut:
      · Kein Force: eine gespeicherte `light`-Preference bleibt unangetastet —
        der Toggle in den Einstellungen bleibt voll funktionstüchtig.
      · Die Preference `system` („Auto") entfernt den Schlüssel (Vendor-
        Verhalten) und fällt damit beim nächsten Boot auf Dark zurück. Das ist
        die P1-Entscheidung: Auto wäre eine Light-Kurve, die gerade nicht
        repariert wird. Neu verankert wird das in P5.

    Ein Partial statt zweier Inline-Skripte: Web-Head und Package-Head binden
    dasselbe nach @fluxAppearance ein — eine Wahrheit über den Default.
--}}

<script>
    window.Flux.applyAppearance(window.localStorage.getItem('flux.appearance') || 'dark');
</script>
