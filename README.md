# <img src="assets/icon.svg" width="40" align="top" alt=""> Moonbeam

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
- **One menu.** The ▼ lists this device, Steam's streaming and Moonbeam for each PC, or Moonbeam instead of Steam's streaming.
- **Several PCs.** Every PC saved in Moonlight is used; a game offers Moonbeam from each PC that has it, and remembers which one you picked.
- **Only when the PC is online.** Seen by Steam, or answering Moonbeam's own check, so non-Steam games and PCs without Steam work too.
- **Collections** in the library with every game you can stream, from any PC and from each PC.
- **App lists without opening Moonlight.** Read from Moonlight's config, refreshed from the PC on demand, directly from the host if needed.
- **Network scan** for Sunshine/Apollo/Vibepollo PCs, showing which are paired.
- **Optional quit on exit:** close the game on the PC when the stream ends.

## Requirements

- A Steam Deck (or another SteamOS device) with [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader).
- Moonlight from Flatpak (`com.moonlight_stream.Moonlight`, the version in the Discover store).
- A PC running Sunshine, Apollo or Vibepollo, **paired with Moonlight on the Deck**.
- Each game you want to stream added as an app on the host, **named like the game in Steam** (see [Adding games](#adding-games)).
- The PC reachable from the Deck (same network). Steam on the PC is optional: when it runs, Steam's own streaming shows up next to Moonbeam.

## Installing

1. Download the plugin:
   - the **decky-moonbeam** artifact of the latest successful [Build](https://github.com/Sabissimo/decky-moonbeam/actions/workflows/build.yaml) run (the downloaded zip installs as is), or
   - `decky-moonbeam.zip` from the [nightly release](https://github.com/Sabissimo/decky-moonbeam/releases/tag/nightly) (built from `main`).
2. In Decky, turn on **Settings → General → Developer mode**.
3. Install it with **Settings → Developer → Install Plugin from ZIP File**.

## Quick start

1. Open Moonlight on the Deck, pair it with your PC and open the PC's app list once, so Moonlight saves it.
2. Open the Quick Access menu (**…**) → Decky → **Moonbeam**. The menu shows your PC(s) and how many apps they know.
3. Open a game that is also an app on the PC, press **▼** next to Play and choose **Moonbeam from: ‹PC›**.
4. The big button now says **Moonbeam**. Press it to stream.

## Streaming from the game page

Moonbeam shows up on a game's page when:

- the game's name matches an app on one of Moonlight's PCs, and
- that PC is online: Steam lists it for the game (its **▼** next to Play), or the PC itself answers Moonbeam's check (see [Several PCs](#several-pcs)).

When Steam shows no ▼ (a non-Steam shortcut, Steam not running on the PC, or the game not installed in the PC's Steam), Moonbeam adds its own ▼ next to Play, with **This Steam Deck** and **Moonbeam from: ‹PC›**. Without an online PC with the game, Moonbeam changes nothing on the page.

### The ▼ menu

**▼** opens one **Play from** menu, like Steam's own, with:

- **This Steam Deck**: play the game on the Deck;
- **Stream from: ‹PC›**: Steam's own streaming, for each PC Steam sees;
- **Moonbeam from: ‹PC›**: stream with Moonlight, for each of those PCs whose Moonlight app list has the game.

✓ marks the current choice. Choosing an item only selects it, remembered for the game; the big button then shows **Play**/**Install**, **Stream** or **Moonbeam** (**Moonbeam: ‹PC›** when Moonlight knows several PCs). Press it to start.

With **Replace Steam's stream** on in the plugin menu, a PC with the game shows only **Moonbeam from: ‹PC›**, without Steam's streaming next to it. A game Steam already streams from such a PC (when it would show **Stream**) then uses Moonbeam.

For example, with GAMING-PC and LAPTOP online and both having the game:

| Normal | Replace Steam's stream |
| --- | --- |
| This Steam Deck | This Steam Deck |
| Stream from: GAMING-PC | Moonbeam from: GAMING-PC |
| Moonbeam from: GAMING-PC | Moonbeam from: LAPTOP |
| Stream from: LAPTOP | |
| Moonbeam from: LAPTOP | |

### Several PCs

- Every PC saved in Moonlight is used. A game gets Moonbeam from each of them whose app list has it.
- Steam's PCs and Moonlight's PCs are matched **by name** (ignoring case and punctuation): `GAMING-PC` in Steam's ▼ menu matches `Gaming PC` in Moonlight. Name the host like the computer (the default in Sunshine/Apollo/Vibepollo) and they line up. With only one PC on each side, they are matched whatever their names.
- A PC is offered while Steam lists it for the game, or while it answers Moonbeam's online check (asked when a matching game page opens and every 30 seconds while it stays open; a sleeping PC doesn't answer). If the PC chosen for a game is offline, the big button goes back to Steam's action until it is online again.
- The big button names the PC (**Moonbeam: ‹PC›**) when Moonlight knows more than one.

## Plugin menu

| Option | What it does |
| --- | --- |
| **PC / Preferred PC** | Lists the PCs saved in Moonlight, with the number of apps each knows. With several PCs, the **PC address** below belongs to the preferred one. |
| **Refresh app list(s) from PC(s)** | Gets every PC's current app list (see [App lists](#app-lists)). A message tells, for each PC, where the list came from. Use it after adding games on a host. |
| **PC address (optional)** | IP or name of the (preferred) PC (`192.168.1.10`, `gaming-pc.lan`, `192.168.1.10:47989`). Only needed when the refresh can't reach it at the addresses Moonlight saved. |
| **Moonbeam collection** | Keeps a *Moonbeam* collection (**Library → Collections**) with every game you can stream, and with several PCs a *Moonbeam: ‹PC›* collection for each. Turning it off removes them. |
| **Close game on PC when stream ends** | Moonlight asks the host to quit the app when the stream ends (`--quit-after`). For games started with `steam://` links, see [Steam games: Big Picture mode and closing them](#steam-games-big-picture-mode-and-closing-them-when-the-stream-ends). |
| **Replace Steam's stream** | Shows **Moonbeam from: ‹PC›** instead of Steam's **Stream from: ‹PC›** for PCs that have the game (see [The ▼ menu](#the--menu)). |
| **Debug logging** | Writes detailed log lines and snapshots of game pages to `~/homebrew/logs/Moonbeam/`. Leave it off unless troubleshooting. |
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

### Steam games: Big Picture mode and closing them when the stream ends

Both are **Command Preparations** in the host's web UI: a **Do** command runs before the app starts, an **Undo** command runs when the app is quit. Undo commands run in **reverse order** (last row first), and the global ones run after the app's own.

1. Open the web UI (`https://<PC>:47990`) → **Configuration → General → Command Preparations**.
2. Add a row for Big Picture:
   - **Do:** `cmd /C start steam://open/bigpicture`
   - **Undo:** `cmd /C start steam://close/bigpicture`, or this one to also minimize Steam's window that opens after Big Picture closes:
     ```
     powershell -NoProfile -Command "Start-Process 'steam://close/bigpicture'; Start-Sleep 3; Add-Type -Name W -Namespace U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(System.IntPtr h, int c);'; Get-Process steam, steamwebhelper -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Steam' } | ForEach-Object { [U.W]::ShowWindow($_.MainWindowHandle, 6) | Out-Null }"
     ```
     It waits 3 seconds for Steam's window to appear, then minimizes it. If the window is still open afterwards, raise the `Start-Sleep 3`.
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
- If a game doesn't close, check where its process runs from (Task Manager → *Open file location*).

### Only for Steam games

Global commands run for **every** app, and the host doesn't tell them whether the app is a Steam game. So it's decided per app:

- **Keep them global** and, in each app that isn't a Steam game (**Desktop**, non-Steam games), tick **Exclude global prep commands** (**Applications → Edit**). Usually the fewer apps to touch.
- Or **remove the global rows** and add both to each Steam game's own **Command Preparations**, in the same order. Better when most apps aren't Steam games.

Forgetting the tick on a non-Steam app mostly costs Big Picture opening over the game; the Steam kill command finds nothing to close there.

### Non-Steam games

Big Picture isn't needed, and usually nothing has to be closed by hand:

- Put the game's `.exe` (or the emulator with the game) in the app's **Command**, not in **Detached Commands**. The host then starts and watches the game itself, and closes it (with whatever it started) when the app is quit, e.g. by **Close game on PC when stream ends**.
- Tick **Exclude global prep commands**, so the Steam commands don't run (see above).
- Games started through a launcher (Epic, GOG Galaxy, Ubisoft Connect, EA app, Battle.net) behave like Steam games: the launcher starts the game and exits, and the host can't close the game. Add an **Undo** command to that app that closes the game by its folder:
  ```
  powershell -NoProfile -Command "$p = Get-Process | Where-Object { $_.Path -like '*\Epic Games\*' }; $p | ForEach-Object { $_.CloseMainWindow() | Out-Null }; Start-Sleep 5; $p | Where-Object { -not $_.HasExited } | Stop-Process -Force"
  ```
  with the game's install folder instead of `*\Epic Games\*` (e.g. `*\GOG Games\*`). Not the launcher's own folder, or the launcher is closed too.

#### Example: an Epic Games link

1. Get the game's link: in the Epic launcher, the game's **⋯ → Manage → Create desktop shortcut**, then open the shortcut's **Properties** on the desktop. The **URL** looks like `com.epicgames.launcher://apps/<id>?action=launch&silent=true`.
2. In the host's web UI, add an app named like the game in Steam (or like your non-Steam shortcut on the Deck):
   - **Command:** `cmd /C start "" "com.epicgames.launcher://apps/<id>?action=launch&silent=true"` (the quotes keep `&` from being taken by `cmd`);
   - tick **Exclude global prep commands**;
   - **Command Preparations** of the app, one row, **Do** empty, **Undo**:
     ```
     powershell -NoProfile -Command "$p = Get-Process | Where-Object { $_.Path -like '*\Epic Games\*' -and $_.Path -notlike '*\Epic Games\Launcher\*' -and $_.Path -notlike '*\Epic Games\Epic Online Services\*' }; $p | ForEach-Object { $_.CloseMainWindow() | Out-Null }; Start-Sleep 5; $p | Where-Object { -not $_.HasExited } | Stop-Process -Force"
     ```
     It closes whatever runs from an `Epic Games` folder (where Epic installs games, `C:\Program Files\Epic Games\<Game>` by default) except Epic's launcher and its online services, which live under `Epic Games` too. Games installed elsewhere: use their folder instead. Tick **Elevated** for games running as administrator (anti-cheat).
3. On the Deck, turn on **Close game on PC when stream ends** in Moonbeam.

Epic's launcher keeps running on the PC, ready for the next game.

| App | Command | Exclude global prep commands | Undo of its own |
| --- | --- | --- | --- |
| Steam game | `steam://rungameid/…` | no | none, the global rows cover it |
| Non-Steam game or emulator | the game's `.exe` | yes | none, the host closes it |
| Game from a launcher | the launcher's link or command | yes | close by the game's folder |

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
- Whether Steam can stream the game comes from Steam's play bar itself (`bShowStreamingSelector`, the flag behind the ▼); which PCs, from Steam's per-game client data (`per_client_data`), matched to Moonlight's PCs by name.
- The backend also asks each of Moonlight's PCs for `/serverinfo` (the same public request Moonlight makes, 1.5 s timeout), at the addresses also used for the app list. A PC counts as online when it answers with the ID Moonlight paired with.
- Without Steam's ▼, Moonbeam renders its own ▼ (Steam's `DialogButton` with Steam's selector class) right after the Play button.
- The ▼ opens Moonbeam's own menu instead of Steam's. Choosing this device or a PC sets Steam's choice for the game (`SteamClient.Apps.SetStreamingClientForApp`, shown by `selected_clientid`), exactly like Steam's menu. Choosing Moonbeam also selects that PC in Steam, and remembers Moonbeam for the game in the plugin's settings.
- Steam's game page is made of MobX observer components whose render can't be patched after their first render, which is why Moonbeam patches the buttons' components instead of the page.

### Collection and network scan

- The **Moonbeam** collection contains every game and non-Steam shortcut in the library whose name matches an app on any PC; with several PCs, each *Moonbeam: ‹PC›* collection those matching that PC's apps. They are updated when the app lists change, and a PC's collection is removed when the PC is no longer in Moonlight.
- **Scan for PCs** sends an mDNS query for `_nvstream._tcp.local`, the service Moonlight looks for, and reads `/serverinfo` from each PC found to tell whether it is paired.

## Troubleshooting

| Problem | What to try |
| --- | --- |
| The menu shows **Backend error** | Moonbeam's backend didn't answer. Press **Retry**; if it keeps failing, check the log in `~/homebrew/logs/Moonbeam/`. |
| **No paired PC** | Pair the PC in Moonlight (Flatpak), open its app list once, then press **Reload**. |
| No ▼ next to Play | Neither Steam nor Moonbeam reaches a PC with the game: it's off or asleep, the game's name doesn't match an app, or the PC's addresses don't work (try **Scan for PCs** or set **PC address**). Moonbeam checks again every 30 seconds while the page is open. |
| ▼ shows only Steam's menu | The game's name doesn't match a host app, the PC's name in Steam doesn't match its name in Moonlight (with several PCs), or **Replace Steam's stream** is on. Compare names and press **Refresh app list from PC**. |
| "‹PC›: not reachable, using saved list" | The PC is off or none of its addresses work. Start it, try **Scan for PCs**, or set **PC address**. The message lists each attempt's error. |
| Host refuses the app list (401/403) | The host doesn't let this Moonlight client list apps. Check the client's permissions in the host's web UI (Apollo/Vibepollo have per-client permissions). |
| **Scan for PCs** finds nothing | The host must be running on the same network. Some routers and guest Wi-Fi block mDNS; set **PC address** instead. |
| "Failed to create the Moonlight shortcut" | Restart Steam and try again. |
| The game keeps running on the PC | See [Closing games](#steam-games-big-picture-mode-and-closing-them-when-the-stream-ends). |
| Something else on the game page | Turn on **Debug logging**, open the game page (and the ▼ menu), then send `~/homebrew/logs/Moonbeam/` (the log plus `gamepage-<appid>.txt`) with your report. The snapshots contain the page's text, including friends' names. |

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
| `src/playbar.tsx` | Moonbeam in Steam's play bar and the ▼ menu |
| `src/steam.ts` | Hidden Moonlight shortcut and launching |
| `src/collection.ts` | Moonbeam library collections |
| `src/match.ts` | Game name ↔ host app matching |
| `src/store.ts` | Frontend state and backend calls |
| `src/debugdump.ts` | Game page snapshots for debug logging |
| `src/icon.tsx` | Plugin icon (also `assets/icon.svg`) |
| `tests/test_main.py` | Backend tests, including a fake host and mDNS responder |

The backend runs on Decky's bundled Python, which only includes some standard modules; `tests/test_main.py` checks that `main.py` doesn't import anything else.

## License

GPL-3.0. The game page route patch is based on [MoonDeck](https://github.com/FrogTheFrog/moondeck).
