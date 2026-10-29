# Copy-paste code

Everything a developer needs to show Outreach inside a product, as code to copy. The starter kit you download in Partner programme
holds these same files with your keys already filled in. Here they show `pk_YOUR_PUBLISHABLE_KEY` and `YOUR-OUTREACH-HOST`: replace
those with your own values from Partner programme.

> **New here?** Download the starter kit in Partner programme and follow `START-HERE.txt`. It is four steps. Come back to this page
> to see the code, or to choose how Outreach should look in your product.

## How it fits together

There are three pieces, and each has one job.

```
 your page              your server                   Outreach
 ─────────              ───────────                   ────────
 embed.js  ──asks──▶  /outreach-start  ──secret key──▶  gives a pass
           ◀──pass──                   ◀──pass───────
 shows the screen, using the pass
```

1. **Your page** has one script line. Our `embed.js` does all the work of showing the screen.
2. **Your server** has one small file that asks Outreach for a pass. The pass lasts 15 minutes.
3. **The secret key** lives in a file called `.env` on your server. It never goes in a web page.

> **Careful:** the secret key lets anyone who has it act as your company on Outreach. That is why a web page cannot hold it, and why
> your server is needed for the one small file below.

## File names at a glance

Each kit has one server file, named after the tool it plugs into. Use the one in your kit, and only that one.

| You build with | Server file | The two lines you add |
|---|---|---|
| Vite or React | `outreach-vite.mjs` | `import outreach from "./outreach-vite.mjs";` in `vite.config.ts`, and `outreach()` inside `plugins: [ ... ]` |
| Node / Express | `outreach-express.mjs` | `import outreach from "./outreach-express.mjs";` and `app.use(outreach());` |
| Next.js | `app/outreach-start/route.js` | none: it is already in the right folder |
| Python / Flask | `outreach_flask.py` | `from outreach_flask import outreach` and `app.register_blueprint(outreach)` |
| PHP | `outreach-start.php` | none: put it in your website folder |

The three that need lines all use the same word, `outreach`. The JavaScript ones are `import outreach from "…"` with no curly braces.

## 1. Your secret key

In Outreach, open Admin, APIs & Webhooks, then Partner programme, and make a secret key. It is shown once. Copy `.env.example` to
`.env` (`.env.local` for Next.js) and paste the key after the `=`. No quotes, no spaces.

```
OUTREACH_SECRET=psk_test_paste_your_secret_key_here
```

While you test, the key starts with `psk_test_`. After you go live it starts with `psk_live_`.

## 2. The page: choose how it should look

Add the script line to your page once. Then put a tag wherever a screen should show. The screen can be `leads`, `campaigns`,
`mail`, `voice` or `social`.

### A panel inside your page

The screen sits in your page, in the space you give it.

{{snippet:panel.html}}

### A popup

A button or link opens the screen over your page. Escape or the cross closes it.

{{snippet:popup.html}}

### A side panel

The screen slides in from the side.

{{snippet:drawer.html}}

### A full page

The screen replaces your page, or opens in a new tab.

{{snippet:full-page.html}}

### React and Next.js

Put the script line in your `index.html` (or the Next.js layout), then use this component anywhere.

{{snippet:OutreachScreen.jsx}}

### Options

| Where | Option | What it does |
|---|---|---|
| Script tag | `data-key` | Your publishable key. Required. |
| Script tag | `data-pass` | The address on your server that hands out a pass. Default `/outreach-start`. |
| Script tag | `data-appearance="auto"` | The screens take the colours, corners and font of your page. |
| Any tag | `data-outreach` | Which screen: `leads`, `campaigns`, `mail`, `voice` or `social`. |
| Any tag | `data-mode` | `popup`, `drawer` or `page`. Leave it out for a panel inside the page. |
| Panel tag | `data-height` | How tall the panel is, for example `700px`. |
| Drawer tag | `data-side` | `left` or `right`. Default `right`. |
| Page tag | `data-new-tab` | Open the full page in a new tab. |

Need more control, such as events or your own colours? See the [Embedding reference](embed.md).

## 3. The server: choose your language

One file. It reads the secret key from `.env`, asks Outreach for a pass, and gives it to your page. Pick yours.

### Vite or React with no server of its own

Save as `outreach-vite.mjs` next to `package.json` (with `outreach-vite.d.mts`, which stops TypeScript complaining). In
`vite.config.ts` add `import outreach from "./outreach-vite.mjs";` at the top, with the other imports, and `outreach()` inside
`plugins: [ ... ]`. No curly braces. Restart `npm run dev`.

{{server:vite}}

### Node and Express

Save as `outreach-express.mjs`. In your server file add `import outreach from "./outreach-express.mjs";` and `app.use(outreach());`
before any catch-all route such as `app.get("*", ...)`. No curly braces.

{{server:node}}

### Next.js

Save as `app/outreach-start/route.js`. Put the key in `.env.local` and restart `npm run dev`.

{{server:next}}

### Python and Flask

Save as `outreach_flask.py` next to your app file. Add `from outreach_flask import outreach` and `app.register_blueprint(outreach)`.

{{server:python}}

### PHP

Save as `outreach-start.php` in your website folder, and set `data-pass="/outreach-start.php"` on the script line.

{{server:php}}

### Any other language

Your server needs one address, `/outreach-start`, that does this and returns JSON:

1. Call `POST {{HOST}}/api/embed/connect-sessions` with the header `Authorization: Bearer <your secret key>` and the body
   `{"external_id": "<your user's id>", "component": "<the screen asked for>"}`.
2. If the answer has `"linked": false`, return `{"connect_token": <the connect_token from the answer>}` and stop.
3. Otherwise call `POST {{HOST}}/api/embed/sessions` with the same header and body. Return `{"token": <the token from the answer>}`.

`external_id` is your own id for the person who is signed in. Use it so each of your users gets their own Outreach account.

## 4. Check that it works

With the starter kit, run `node check.mjs` in your project folder. It tests each part and says what to fix. Without the kit, open
`/outreach-start` in your browser: you should see `{"token":"..."}` or `{"connect_token":"..."}`. Then open a page that has the
snippet from step 2. The first time, a window asks you to sign in to Outreach.

## 5. When it does not work

If a screen cannot open, the page shows a red message that says why. The usual ones:

| What you see | What it means | What to do |
|---|---|---|
| `your app answered with its own web page` | Your app has no `/outreach-start` route yet | Add the server file from step 3, then restart |
| `No matching export … for import "outreach"`, or `outreach is not defined` | The import does not match your kit's file, or is missing | Use the exact lines from "File names at a glance". Check you have the kit for your tool |
| `Cannot find module … check.mjs` | The kit's files are in a sub-folder, not in the project folder | Move them up into the folder with `package.json` |
| `The secret key is missing` | `.env` is missing or the key is not in it | Copy `.env.example` to `.env` and paste the key after `OUTREACH_SECRET=` |
| `Invalid secret key` | The key is wrong or was replaced | Make a new key in Partner programme and paste it in `.env` |
| `Add data-key="pk_..."` | The script line has no publishable key | Copy the script line again from step 2 |
| The box stays empty and the browser console says `Refused to frame` | This page's address is not in your list | Add it in Partner programme, step 2, exactly as the browser bar shows it |
| `did not open` after 12 seconds | Same as above, or the key is not yours | Check the address list and the publishable key |
