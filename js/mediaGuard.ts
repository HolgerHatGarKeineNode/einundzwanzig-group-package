/**
 * **Die Wache vor dem serverseitigen Bild-Proxy.**
 *
 * Medien, die der Workspace-Relay selbst ausliefert, sind auth-pflichtig (Blossom,
 * kind 24242 — siehe [[blossomAuth]]). Für sie gibt es genau EINEN richtigen Weg: der
 * Browser holt sie mit dem Schlüssel des angemeldeten Nutzers und zeigt eine
 * `blob:`-URL. Zwei Wege sind ausdrücklich falsch:
 *
 * 1. **Der serverseitige Bild-Proxy** (`/img/{preset}?src=…`). Er würde die private
 *    Medien-URL an unseren Server reichen; ein Proxy, der solche Blobs ausliefern
 *    KÖNNTE, wäre ein Orakel für relay-private Medien. Dieser Weg ist bewusst
 *    verworfen worden — nicht nur „nicht gebaut".
 * 2. **Die rohe URL im `<img src>`.** Sie kann den `Authorization`-Header nicht
 *    mitschicken und endet mit 401 — eine Anfrage pro Gesicht, für nichts.
 *
 * Diese Wache steht deshalb nicht an den Flächen, sondern an der Engstelle: JEDE
 * Bild-URL der Insel läuft durch `proxifyImage` (`core.ts`) — Chat-Anhänge
 * (`feeds.ts:66`), Artikelbilder (`longformFeed.ts:165`), Custom-Emoji
 * (`emoji.ts:129`), Avatare und Banner. Eine Fläche, die den Blossom-Weg vergisst,
 * zeigt damit **nichts** statt zu lecken.
 *
 * **Warum das eine eigene Datei ist:** genau dieser Fall ist einmal durchgerutscht.
 * Der Merge nahm `banner` in die Anzeige auf, der Blossom-Weg existierte aber nur für
 * `picture` — und `profile-card.blade.php` schickte die private URL an `$img`. Eine
 * Regel, die an 21 Aufrufstellen einzeln eingehalten werden muss, wird irgendwo nicht
 * eingehalten; diese hier gilt an einer Stelle für alle.
 */
import { isSpaceHostedMedia } from './profileMerge.ts'

/**
 * Darf diese URL an den Bild-Proxy (und im Fehlerfall roh ins `<img>`)?
 *
 * `false` genau dann, wenn sie vom Workspace-Relay stammt. Ohne konfigurierten
 * Workspace gibt es nichts zu schützen — dann ist alles erlaubt wie bisher.
 */
export const mayProxifyMedia = (url: unknown, workspaceUrl: string): boolean =>
    !(typeof url === 'string' && workspaceUrl !== '' && isSpaceHostedMedia(url, workspaceUrl))
