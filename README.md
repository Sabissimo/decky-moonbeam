# Moonbeam

Moonbeam is a [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin that puts a **Moonbeam** button right into the Steam Deck's game pages: stream a game from your PC with [Moonlight](https://moonlight-stream.org/), straight into the matching app of your [Sunshine](https://github.com/LizardByte/Sunshine), [Apollo](https://github.com/ClassicOldSong/Apollo) or Vibepollo host, from the same Play button and ▼ menu you use for Steam's own streaming.

Nothing extra runs on the PC. Moonbeam only talks to the streaming host and reuses the pairing your Moonlight already has.

- [Features](#features)
- [Requirements](#requirements)
- [Installing](#installing)
- [Quick start](#quick-start)
- [Streaming from the game page](#streaming-from-the-game-page)
- [Plugin menu](#plugin-menu)
- [Setting up the host](#setting-up-the-host)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Features

- **Moonbeam in Steam's play bar.** Pick it from the ▼ next to Play, and the main button remembers it per game, like Steam's own Stream.
- **Two styles.** A small Moonbeam menu behind the ▼, or Steam's own "Stream from ‹PC›" taken over and renamed.
- **Several PCs.** Every PC saved in Moonlight is used; a game offers Moonbeam from each PC that has it, and remembers which one you picked.
- **Only when the PC is online.** No ▼ from Steam means no PC to stream from, so Moonbeam stays out of the way.
- **Moonbeam collection** in the library with every game you can stream.
- **App lists without opening Moonlight.** Read from Moonlight's config, refreshed from the PC on demand, directly from the host if needed.
- **Network scan** for Sunshine/Apollo/Vibepollo PCs, showing which are paired.
- **Optional quit on exit:** close the game on the PC when the stream ends.

## Requirements

- A Steam Deck (or another SteamOS device) with [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader).
- Moonlight from Flatpak (`com.moonlight_stream.Moonlight`, the version in the Discover store).
- A PC running Sunshine, Apollo or Vibepollo, **paired with Moonlight on the Deck**.
- Each game you want to stream added as an app on the host, **named like the game in Steam** (see [Adding games](#adding-games)).
- Steam on the Deck able to see the PC for streaming (Steam's ▼ next to Play appears for games installed there). That's normally the case when Steam runs on the PC on the same network.

## Installing

1. Download the plugin:
   - the **Moonbeam** artifact of the latest successful [Build](https://github.com/Sabissimo/decky-moonbeam/actions/workflows/build.yaml) run (the downloaded zip installs as is), or
   - `moonbeam.zip` from the [nightly release](https://github.com/Sabissimo/decky-moonbeam/releases/tag/nightly) (built from `main`).
2. In Decky, turn on **Settings → General → Developer mode**.
3. Install it with **Settings → Developer → Install Plugin from ZIP File**.

## Quick start

1. Open Moonlight on the Deck, pair it with your PC and open the PC's app list once, so Moonlight saves it.
2. Open the Quick Access menu (**…**) → Decky → **Moonbeam**. The menu shows your PC(s) and how many apps they know.
3. Open a game that is also an app on the PC, press **▼** next to Play and choose **Moonbeam from ‹PC›**.
4. The big button now says **Moonbeam**. Press it to stream.

## Streaming from the game page

Moonbeam shows up on a game's page when:

- the game's name matches an app on one of Moonlight's PCs, and
- Steam shows its **▼** next to Play, meaning a PC is online and has the game. Without the ▼, Moonbeam changes nothing on the page, and
- that PC is one Steam lists for the game right now (see [Several PCs](#several-pcs)).

### Moonbeam menu (default)

- **▼** opens a small menu:
  - **Moonbeam from ‹PC›**, once for each online PC that has the game, makes Moonbeam from that PC the game's main action. The big button changes to **Moonbeam**. The choice (with its PC) is remembered for the game.
  - **Steam options…** switches back to Steam's own action and opens Steam's original menu (play on this device, Steam streaming, …).
  - ✓ marks the current choice.
- Choosing an item only selects it; press the big button to start.

### Replace Steam's stream

With **Replace Steam's stream** on in the plugin menu, there's no extra menu:

- **▼** opens Steam's own menu, where **Stream from ‹PC›** is renamed **Moonbeam from ‹PC›** for each PC whose Moonlight app list has the game. Choosing it streams from that PC with Moonlight right away. Other PCs keep Steam's own streaming.
- Steam remembers the choice like its own. Whenever Steam's choice for a game is such a PC (when it would show **Stream**), the big button shows **Moonbeam** and streams from that PC with Moonlight.
- Choosing **Play on this device** in Steam's menu goes back to playing locally.

### Several PCs

- Every PC saved in Moonlight is used. A game gets Moonbeam from each of them whose app list has it.
- Steam's PCs and Moonlight's PCs are matched **by name** (ignoring case and punctuation): `GAMING-PC` in Steam's ▼ menu matches `Gaming PC` in Moonlight. Name the host like the computer (the default in Sunshine/Apollo/Vibepollo) and they line up. With only one PC on each side, they are matched whatever their names.
- A PC is only offered while Steam lists it for the game (online, with the game installed). If the PC remembered for a game is offline, the big button goes back to Steam's action until it is online again.

## Plugin menu

| Option | What it does |
| --- | --- |
| **PC / Preferred PC** | Lists the PCs saved in Moonlight, with the number of apps each knows. With several PCs, the preferred one is listed first in the Moonbeam menu and uses the **PC address** below. |
| **Refresh app list(s) from PC(s)** | Gets every PC's current app list (see [App lists](#app-lists)). A message tells, for each PC, where the list came from. Use it after adding games on a host. |
| **PC address (optional)** | IP or name of the (preferred) PC (`192.168.1.10`, `gaming-pc.lan`, `192.168.1.10:47989`). Only needed when the refresh can't reach it at the addresses Moonlight saved. |
| **Moonbeam collection** | Keeps a *Moonbeam* collection (**Library → Collections**) with every game you can stream. Turning it off removes the collection. |
| **Close game on PC when stream ends** | Moonlight asks the host to quit the app when the stream ends (`--quit-after`). For games started with `steam://` links, see [Starting games in Big Picture mode and closing them](#starting-games-in-big-picture-mode-and-closing-them-when-the-stream-ends). |
| **Replace Steam's stream** | Takes over Steam's own "Stream from ‹PC›" instead of adding the Moonbeam menu (see [Replace Steam's stream](#replace-steams-stream)). |
| **Debug logging** | Writes detailed log lines and snapshots of game pages and Steam's launch menu to `~/homebrew/logs/Moonbeam/`. Leave it off unless troubleshooting. |
| **Scan for PCs** | Looks for Sunshine/Apollo/Vibepollo PCs on the network (about 3 seconds) and shows whether each is paired with Moonlight. Unpaired PCs must be paired in Moonlight first. |

## Setting up the host

Everything here happens in the host's web UI (usually `https://<PC>:47990`). Labels may differ a bit between Sunshine, Apollo and Vibepollo.

### Adding games

Each game needs an app on the host with **the same name as in Steam**. A Steam game is usually started with:

```
steam://rungameid/<Steam app id>
```

Names are compared ignoring upper/lower case, ™/®/©, accents, apostrophes and punctuation: `ELDEN RING™` in Steam matches `ELDEN RING` on the host, `Tom Clancy's Rainbow Six® Siege` matches `Tom Clancys Rainbow Six Siege`. Different words don't match: `Portal` doesn't match `Portal 2`.

Non-Steam shortcuts in your Deck library work too when their names match.

### Starting games in Big Picture mode and closing them when the stream ends

Both are **Command Preparations** in the host's web UI: a **Do** command runs before the app starts, an **Undo** command runs when the app is quit. Undo commands run in **reverse order** (last row first), and the global ones run after the app's own.

1. Open the web UI (`https://<PC>:47990`) → **Configuration → General → Command Preparations**.
2. Add a row for Big Picture:
   - **Do:** `cmd /C start steam://open/bigpicture`
   - **Undo:** `cmd /C start steam://close/bigpicture`
3. Add a second row, **below** the first, to close the game:
   - **Do:** empty
   - **Undo:**
     ```
     powershell -NoProfile -Command "$p = Get-Process | Where-Object { $_.Path -like '*\steamapps\common\*' }; $p | ForEach-Object { $_.CloseMainWindow() | Out-Null }; Start-Sleep 5; $p | Where-Object { -not $_.HasExited } | Stop-Process -Force"
     ```
   - Tick **Run as administrator** / **Elevated** if you play games that run as administrator (some with anti-cheat).
4. **Save** and **Apply** (the host restarts).
5. In Moonbeam's menu on the Deck, turn on **Close game on PC when stream ends**. Without it, ending the stream leaves the app running on the host, so the undo commands never run.

When the stream ends: the game is closed first (row 2), then Big Picture (row 1). Steam itself keeps running.

About the close command:

- A `steam://rungameid/...` command only asks Steam to start the game and finishes right away, so the host can't close the game by itself; this command does it instead. It finds every running program installed in a Steam library (`...\steamapps\common\...`), asks each to close like clicking the window's X, and force-closes whatever still runs after 5 seconds.
- **Save first.** A force-close loses progress since the last save; many games ignore the polite close.
- **It also closes non-game Steam apps**, such as Wallpaper Engine. To keep one running, add `-and $_.Name -ne 'wallpaper64'` inside `Where-Object { ... }`, with that program's process name from Task Manager.
- **A dropped connection doesn't close the game**: undo commands only run when the app is actually quit, so you can reconnect after a Wi-Fi drop.
- Apps that shouldn't get these commands (such as **Desktop**) can opt out with **Exclude global prep commands** in the app's settings. Or add both rows to each game's app instead of globally.
- If a game doesn't close, check where its process runs from (Task Manager → *Open file location*).

## How it works

### App lists

- Moonbeam reads the paired PCs and their app lists from Moonlight's config (`~/.var/app/com.moonlight_stream.Moonlight/config/Moonlight Game Streaming Project/Moonlight.conf`), so they're there instantly, even offline.
- **Refresh app list from PC** tries, in order:
  1. `moonlight list <PC>` through the Flatpak;
  2. asking the PC directly, like Moonlight does: `http://<PC>:47989/serverinfo` for the HTTPS port, then `/applist` over HTTPS with Moonlight's own client certificate, checking that the PC's certificate is the one Moonlight paired with. The **PC address** is tried first, then addresses found by **Scan for PCs**, then those saved by Moonlight;
  3. the last saved list.

  A refreshed list is saved and used from then on.

### Launching

Moonbeam starts one hidden non-Steam shortcut (`/usr/bin/flatpak`) with the launch options `run com.moonlight_stream.Moonlight stream "<PC>" "<App>"` (plus `--quit-after` when enabled), so Moonlight runs in Game Mode like any game, and Steam shows the game's name while streaming. When the stream ends, Steam would leave you on that shortcut's bare page; Moonbeam goes back to the game's own page instead.

### Game page

- Pages of games without a matching host app are left completely alone: no lookup, no patch, no re-render.
- When a matching game's page opens, Moonbeam finds Steam's Play button and ▼ on it by Steam's own class names (`appActionButtonClasses`), and patches the component that renders them, once. The patch only changes those buttons on the open game page for matching games; Steam's own code still renders them, with a different click action and label.
- Whether the PC is online comes from Steam's play bar itself (`bShowStreamingSelector`, the flag behind the ▼).
- Which PCs are online for the game comes from Steam's per-game client data (`per_client_data`), matched to Moonlight's PCs by name.
- **Replace Steam's stream** also uses `selected_clientid`: the main button is Moonbeam while Steam's choice is a PC with the game, and the menu item selects the PC with `SteamClient.Apps.SetStreamingClientForApp` and streams. Steam's menu items are found by their class (`StreamingContextMenuItem`) when the menu opens.
- Steam's game page is made of MobX observer components whose render can't be patched after their first render, which is why Moonbeam patches the buttons' components instead of the page.

### Collection and network scan

- The **Moonbeam collection** contains every game and non-Steam shortcut in the library whose name matches an app on any PC. It is updated when the app lists change.
- **Scan for PCs** sends an mDNS query for `_nvstream._tcp.local`, the service Moonlight looks for, and reads `/serverinfo` from each PC found to tell whether it is paired.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| The menu shows **Backend error** | Moonbeam's backend didn't answer. Press **Retry**; if it keeps failing, check the log in `~/homebrew/logs/Moonbeam/`. |
| **No paired PC** | Pair the PC in Moonlight (Flatpak), open its app list once, then press **Reload**. |
| No ▼ next to Play | Steam doesn't see the PC for streaming: it's off, Steam isn't running on it, or the game isn't installed there. Moonbeam only appears together with Steam's ▼. |
| ▼ shows only Steam's menu | The game's name doesn't match a host app, the PC's name in Steam doesn't match its name in Moonlight (with several PCs), or **Replace Steam's stream** is on. Compare names and press **Refresh app list from PC**. |
| "‹PC›: not reachable, using saved list" | The PC is off or none of its addresses work. Start it, try **Scan for PCs**, or set **PC address**. The message lists each attempt's error. |
| Host refuses the app list (401/403) | The host doesn't let this Moonlight client list apps. Check the client's permissions in the host's web UI (Apollo/Vibepollo have per-client permissions). |
| **Scan for PCs** finds nothing | The host must be running on the same network. Some routers and guest Wi-Fi block mDNS; set **PC address** instead. |
| "Failed to create the Moonlight shortcut" | Restart Steam and try again. |
| The game keeps running on the PC | See [Closing games](#starting-games-in-big-picture-mode-and-closing-them-when-the-stream-ends). |
| Something else on the game page | Turn on **Debug logging**, open the game page (and the ▼ menu), then send `~/homebrew/logs/Moonbeam/` (the log plus `gamepage-<appid>.txt` and `menu-<appid>.txt`) with your report. The snapshots contain the page's text, including friends' names. |

## Development

Requirements: Node.js with [pnpm](https://pnpm.io/), and Python 3 for the backend tests.

```sh
pnpm install
pnpm run typecheck  # TypeScript checks
pnpm run build      # frontend -> dist/
pnpm run test       # backend tests
```

The plugin consists of `dist/`, `main.py`, `plugin.json`, `package.json`, `LICENSE` and `README.md`. The [Build](.github/workflows/build.yaml) workflow runs the checks, uploads that folder as the **Moonbeam** artifact, and publishes `moonbeam.zip` as the nightly release for pushes to `main`.

| File | Purpose |
| --- | --- |
| `main.py` | Backend: Moonlight config, app list refresh, direct host requests, network scan, settings, debug files |
| `src/index.tsx` | Plugin entry point, Quick Access menu, collection sync |
| `src/gamepage.tsx` | Attaches Moonbeam to the library game page |
| `src/playbar.tsx` | Moonbeam in Steam's play bar and launch menu |
| `src/steam.ts` | Hidden Moonlight shortcut and launching |
| `src/collection.ts` | Moonbeam library collection |
| `src/match.ts` | Game name ↔ host app matching |
| `src/store.ts` | Frontend state and backend calls |
| `src/debugdump.ts` | Game page and launch menu snapshots for debug logging |
| `tests/test_main.py` | Backend tests, including a fake host and mDNS responder |

The backend runs on Decky's bundled Python, which only includes some standard modules; `tests/test_main.py` checks that `main.py` doesn't import anything else.

## License

GPL-3.0. The game page route patch is based on [MoonDeck](https://github.com/FrogTheFrog/moondeck).
