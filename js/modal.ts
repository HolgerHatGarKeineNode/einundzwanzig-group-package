/**
 * Flux-Modals aus der Insel öffnen und schließen.
 *
 * Flux lauscht auf zwei Dokument-Events (`modal-show`/`modal-close` mit
 * `detail.name`) — dieselbe Schnittstelle, die `Flux.modal(name).show()` intern
 * benutzt. Bewusst der rohe Event statt des globalen `Flux`-Objekts: der Event
 * ist da, sobald das Modal im DOM steht, `window.Flux` erst nach `@fluxScripts`.
 *
 * **Warum das ein eigenes Modul ist.** Die Funktion stand als Modul-Konstante in
 * `bridge.ts` und wird seit der Befehlspalette aus einer zweiten Insel gebraucht
 * (`palette.ts`). Ein zweiter Abzug derselben zehn Zeilen wäre eine zweite
 * Wahrheit über die Fokus-Rückgabe — und genau die ist der nicht offensichtliche
 * Teil hier.
 *
 * **Fokus-Rückgabe.** Beim Öffnen den auslösenden Fokus merken und beim Schließen
 * zurückgeben — nur `flux:modal.trigger` macht das von selbst; JS-geöffnete Modals
 * (role-form, member-roles, delete-message, Befehlspalette) ließen den Fokus sonst
 * ins Leere fallen (WCAG 2.4.3). Hängt einmalig am nativen `close`-Event des
 * `<dialog>` (feuert auch bei Escape/Backdrop) → deckt jeden Schließweg ab, ohne
 * pro Modal Markup zu berühren.
 */
export const dispatchModal = (name: string, show = true): void => {
    if (show) {
        const trigger = document.activeElement
        const dialog = document.querySelector(`dialog[data-modal="${name}"]`)
        if (dialog && trigger instanceof HTMLElement) {
            dialog.addEventListener('close', () => trigger.focus(), { once: true })
        }
    }
    document.dispatchEvent(new CustomEvent(show ? 'modal-show' : 'modal-close', { detail: { name } }))
}
