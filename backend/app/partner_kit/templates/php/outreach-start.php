<?php
// Hands your page a short-lived Outreach pass. Put this file in the folder your website serves, next to outreach-test.html.
// Your page asks for /outreach-start.php. The secret key is read from the .env file in this folder.
header('Content-Type: application/json');
header('Cache-Control: no-store');

function fail($message, $status = 502) {
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

// Read OUTREACH_SECRET from .env (keep .env OUTSIDE the public folder if you can, or block it in your web server settings).
$secret = getenv('OUTREACH_SECRET') ?: '';
$env = __DIR__ . '/.env';
if ($secret === '' && is_readable($env)) {
    foreach (file($env, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (preg_match('/^\s*OUTREACH_SECRET\s*=\s*(.*?)\s*$/', $line, $m)) {
            $secret = trim($m[1], "\"'");
        }
    }
}
if (strpos($secret, 'psk_') !== 0) {
    fail('The secret key is missing. Copy .env.example to .env and paste your secret key after OUTREACH_SECRET=', 500);
}

function call($secret, $path, $body) {
    $ch = curl_init('{{HOST}}/api/embed' . $path);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $secret, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($body),
    ]);
    $text = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode((string) $text, true) ?: [];
    if ($status < 200 || $status >= 300) {
        fail($data['detail'] ?? ('Outreach answered ' . $status));
    }
    return $data;
}

// TESTING ONLY: one fixed test person. Before real users, use the id of whoever is signed in, and refuse (401) when nobody is.
$user = 'test-user-1';
$component = preg_replace('/[^a-z]/', '', $_GET['component'] ?? 'leads') ?: 'leads';

$info = call($secret, '/connect-sessions', ['external_id' => $user, 'component' => $component]);
if (empty($info['linked'])) {
    echo json_encode(['connect_token' => $info['connect_token'] ?? null]);
} else {
    $pass = call($secret, '/sessions', ['external_id' => $user, 'component' => $component]);
    echo json_encode(['token' => $pass['token']]);
}
