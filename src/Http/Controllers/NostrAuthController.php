<?php

namespace App\Chat\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use swentel\nostr\Event\Event;

/**
 * NIP-98-Handoff: der pubkey wird beweisbar in die Laravel-Session gesetzt.
 *
 * Der Server sieht den privaten Key nie — der Client signiert nur ein
 * NIP-98-Auth-Event (kind 27235) über die Login-URL + eine Server-Nonce; hier
 * wird ausschließlich die Schnorr-Signatur server-seitig verifiziert. Erst
 * danach gilt der pubkey für das Gate als beglaubigt.
 */
class NostrAuthController
{
    /** Maximales Alter des signierten Events (Uhren-Drift-Toleranz). */
    private const EVENT_MAX_AGE = 120;

    /** Lebensdauer der ausgegebenen Challenge. */
    private const CHALLENGE_TTL = 300;

    private const HTTP_AUTH_KIND = 27235;

    /**
     * Gibt eine Einmal-Nonce + die kanonische Login-URL aus. Der Client signiert
     * genau diese URL, damit der u-Tag server-seitig exakt matcht.
     */
    public function challenge(Request $request): JsonResponse
    {
        $challenge = Str::random(64);

        $request->session()->put('nostr_challenge', $challenge);
        $request->session()->put('nostr_challenge_at', now()->timestamp);

        return response()->json([
            'challenge' => $challenge,
            'url' => route('chat.nostr.login'),
        ]);
    }

    /**
     * Verifiziert das signierte NIP-98-Event und setzt den pubkey in die Session.
     */
    public function login(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'event' => ['required', 'array'],
            'event.id' => ['required', 'string'],
            'event.pubkey' => ['required', 'string', 'regex:/^[0-9a-f]{64}$/'],
            'event.sig' => ['required', 'string'],
            'event.kind' => ['required', 'integer'],
            'event.created_at' => ['required', 'integer'],
            'event.tags' => ['required', 'array'],
            'event.content' => ['present', 'nullable', 'string'],
        ]);

        $event = $validated['event'];

        // NIP-98-Auth-Events haben content ''; Laravels ConvertEmptyStringsToNull
        // macht daraus null — für die ID-/Signaturprüfung zurück auf '' normalisieren.
        $event['content'] ??= '';

        // 1. Schnorr-Signatur + Event-ID server-seitig prüfen (die Krypto-Grenze).
        $json = json_encode($event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false || ! (new Event)->verify($json)) {
            return $this->reject('Ungültige Signatur.');
        }

        // 2. NIP-98-Semantik.
        if ($event['kind'] !== self::HTTP_AUTH_KIND) {
            return $this->reject('Falscher Event-Typ.');
        }

        if (abs(now()->timestamp - $event['created_at']) > self::EVENT_MAX_AGE) {
            return $this->reject('Event abgelaufen.');
        }

        $tags = collect($event['tags']);
        $url = $tags->firstWhere(0, 'u')[1] ?? null;
        $method = $tags->firstWhere(0, 'method')[1] ?? null;
        $challenge = $tags->firstWhere(0, 'challenge')[1] ?? null;

        if ($url !== route('chat.nostr.login') || strtoupper((string) $method) !== 'POST') {
            return $this->reject('URL oder Methode stimmt nicht.');
        }

        // 3. Einmal-Nonce prüfen (Replay-Schutz) und sofort verbrauchen.
        $expected = $request->session()->pull('nostr_challenge');
        $issuedAt = $request->session()->pull('nostr_challenge_at', 0);

        if (! $expected || ! is_string($challenge) || ! hash_equals($expected, $challenge)) {
            return $this->reject('Challenge ungültig.');
        }

        if (now()->timestamp - $issuedAt > self::CHALLENGE_TTL) {
            return $this->reject('Challenge abgelaufen.');
        }

        // Beglaubigt: pubkey in eine frische Session schreiben.
        $request->session()->regenerate();
        $request->session()->put('nostr_pubkey', $event['pubkey']);

        return response()->json([
            'ok' => true,
            'pubkey' => $event['pubkey'],
            'redirect' => session()->pull('url.intended', route('chat.spaces')),
        ]);
    }

    /** Beendet die Laravel-Session (welshman-Session cleart der Client separat). */
    public function logout(Request $request): JsonResponse
    {
        $request->session()->forget(['nostr_pubkey', 'nostr_challenge', 'nostr_challenge_at']);

        return response()->json(['ok' => true]);
    }

    private function reject(string $message): JsonResponse
    {
        return response()->json(['ok' => false, 'error' => $message], 422);
    }
}
