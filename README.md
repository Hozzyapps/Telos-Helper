# Telos Special Attack Alerts (Alt1 app)

Reads your RuneScape 3 chatbox while you fight **Telos, the Warden** and fires an
**on-screen overlay** plus a **spoken voice** and **beep** the instant a special
attack is announced in chat. All triggers are editable — no code changes needed.

Alt1 can only read pixels on your screen (it never touches the game client), so
this works by watching the chat messages Telos prints, exactly like every other
Telos attack tracker.

## Install

Alt1 loads apps over HTTP, so the folder has to be served — you can't just
double-click `index.html`. Pick either option.

### Option A — host it locally (quickest)

1. Open a terminal in this folder and start any static server:
   ```
   python -m http.server 8090
   ```
   (or `npx http-server -p 8090`)
2. With **Alt1 Toolkit** running, paste this into a normal browser:
   ```
   alt1://addapp/http://localhost:8090/appconfig.json
   ```
   …or open `http://localhost:8090` inside **Alt1's own browser** and click the
   "add app" banner at the top.

Keep the server running while you use the app.

### Option B — host it online (permanent)

Upload this folder to any static host (GitHub Pages, Netlify, your own site),
then install with:
```
alt1://addapp/https://YOUR-URL/appconfig.json
```
Opening `index.html` in a normal browser also shows a one-click "add the app" link.

## In-game settings (do these once for reliable reading)

- **Turn on chat timestamps:** Settings → Gameplay → Chat & Social → Chat
  Customisation → *Local timestamps in chat box*.
- **Interface transparency 0%** and **interface scaling 100%** (defaults).
- Make sure Telos' messages land in the chatbox Alt1 reads (the main game/chat tab).

## Using it

- The big banner shows the **current special** the moment it's called, with a
  short reaction tip; the anima core and overlay flash in that special's colour.
- **Test alert** fires a sample so you can check your volume/voice.
- **Voice on/off** mutes speech quickly; the gear opens full settings.

## Triggers (fully editable)

Defaults cover the verified reaction-critical calls:

| Special | Chat message it matches | Spoken |
|---|---|---|
| Charge / dash | `Gielinor, give me strength!` | "Charge" |
| Anima bomb | `SO. MUCH. POWER!` | "Anima bomb" |
| Tendrils (grip) | `Your anima will return to the source!` | "Tendrils" |
| Absorbed → font | `…absorbs the anima. Stand near a font…` | "Font now" |

Open **Settings → Triggers** to add or change any of them. Each trigger is:

```json
{
  "id": "myalert",
  "label": "SHOWN ON SCREEN",
  "say": "spoken words",
  "color": "#ff4d4f",
  "tip": "what to do about it",
  "match": ["a phrase to look for", "an alternate phrase"]
}
```

`match` is a list of phrases — if any one appears in a chat line, the alert fires.
Matching ignores case, punctuation and timestamps, so you can paste the message
roughly as you see it. To add a new special, just copy any chat line Telos prints
into a new `match` entry. Set `"enabled": false` to keep a trigger without firing it.

## Notes

- If the banner says "Looking for your chatbox", click into RuneScape so the chat
  is visible, or move the chat tab; it re-syncs automatically.
- Settings and triggers are saved in the app between sessions.
- This does not read game state (Alt1 can't) — it reacts to chat text only, so
  specials that don't print a chat line can't be detected. Add any that do as you
  spot them.
