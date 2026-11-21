# Star Citizen game telemetry, in-game overlay, Game.log diff

## Game telemetry (SC 5.0+)

Star Citizen 5.0 (PTU first) ships a local gRPC server, `sc.game.telemetry.v1.GameTelemetryService`
on `127.0.0.1:2942` (plaintext, no auth, localhost only). It is **off by default**; enable it in the
channel's `user.cfg` (same folder as `Game.log`):

```ini
server.game.telemetry.enabled=1
```

Settings → *Telemetry & Overlay* → **Enable in user.cfg** does this (append-only, `.bak` kept).
Game.log then shows:

```
[User CFG ] server.game.telemetry.enabled=true
<Register Service> Service 'sc.game.telemetry.v1.GameTelemetryService' registered
<GameTelemetry> Local services server is running on 127.0.0.1:2942
Initializing game telemetry component of local player      ← stream starts after spawn
```

`TelemetryStream` sends ~17 frames/s. Each frame holds only some sections:

| section | content |
|---|---|
| `actor` | vitals (health/oxygen/hunger/thirst gauges, body temp, heart rate, gravity, pressure, intoxication), state (on foot / EVA / seated, crew role, seat, aUEC balance), environment (outside temp, radiation, breathable) |
| `vehicle` | name/class/manufacturer/type, lights, doors, annunciators, flight (landed, gear, VTOL, IFCS settings, speed, fuel, boost, altitude, heading…), power, shields, hull health, master mode |
| `weapons` | settings, preset, each weapon's power/ready state, countermeasures |
| `events` | GameEvent types (spawn, dead, enter/leave seat, respawn, downed). On 5.0.202 PTU ACTOR_DOWNED, ACTOR_DEAD and ENTER/LEAVE_SEAT are emitted (LEAVE_SEAT repeats up to 9x, collapsed by the client); ACTOR_SPAWN and ACTOR_RESPAWN never fired in our recordings |
| `force_feedback`, `turret` | stick feedback / turret light amplification |

Absent section = "no update" (kept until 3 s stale); absent field inside a present section = 0/false
(proto3). There is no gRPC reflection; the schema is embedded in
`electron/modules/telemetry/schema-desc.ts` (from `sc_extrait.desc`, 5.0.202.205 PTU build 13238477).
After a patch that changes the API, regenerate it from a new `.desc`:

```bash
{ head -4 electron/modules/telemetry/schema-desc.ts; echo "export const SCHEMA_GAME_BUILD = '<version (build)>';"; \
  printf "export const SCHEMA_DESC_BASE64 =\n  '%s';\n" "$(base64 -w0 sc_extrait.desc)"; } > /tmp/s.ts && mv /tmp/s.ts electron/modules/telemetry/schema-desc.ts
```

### Code

| file | role |
|---|---|
| `telemetry/telemetry-client.ts` | gRPC client (stream + ListTriggerableActions) |
| `telemetry/telemetry-state.ts` | pure: merges partial frames, staleness, **derived events** (vehicle entered/left, landing gear, landed/took off, master mode, shields down/up, hull damage, power, warning lights, countermeasures, low health/oxygen, atmosphere, seat/crew role, aUEC delta [local only]) |
| `telemetry/telemetry-service.ts` | connection loop (quiet retries while the game is closed, reopens a silent stream), throttled upload |
| `telemetry/telemetry-manager.ts` | Electron glue, user.cfg, overlay state |
| `telemetry/debug-bus.ts` | ring buffer of every event passing through the client + upload counters |

### Sharing with VOIDLOG.GG

When *Share telemetry* is on and the client is signed in, the socket emits `submit_telemetry`:

- `{ kind: 'snapshot', snapshot, capturedAt, fps }` — at most 1/s, only when changed (10 s heartbeat);
  `force_feedback` and raw `events` are never sent; `actor.state.uec_balance` is removed unless
  *Include aUEC balance* is on.
- `{ kind: 'events', events: [...] }` — derived events, batched every 250 ms.

Server: `TelemetryLiveService` keeps the latest snapshot (60 s TTL) and the last 100 events (6 h)
in Redis — no database writes. Web: Settings → **Live Telemetry** (`/settings/telemetry`), via the
`/frontend` socket (`subscribe_telemetry`) with `GET /api/telemetry/me` as fallback.

## In-game debug overlay

A transparent, click-through, always-on-top window in the bottom-right corner of the primary display.
Nothing is injected into `StarCitizen.exe`. It is shown while the overlay is enabled and
`StarCitizen.exe` is running (or *Show even when the game isn't running*). Toggle: **Ctrl+Alt+O**
(configurable). Shows telemetry status/fps, every streamed field (changed values flash),
what was shared (snapshots/events/log chunks, dropped), the last events from all sources
(`TLM` telemetry, `LOG` Game.log parser, `SRV` server, `SYS`), with `↑` = sent to VOIDLOG.GG and
`·` = local only, and the Game.log diff summary.

Only works with the game in **Borderless** or **Windowed** mode.

## Game.log diff

Every Game.log line is reduced to a *signature* (timestamps, ids, numbers, quoted names, coordinates,
trailing team tags and your handle stripped). The tracker compares the current Game.log with the
previous one parsed (saved in `%APPDATA%/<app>/log-diff/baseline.json`; on first run the newest
`logbackups/*.log`), and counts hits of every log-parser regex (`PARSER_PATTERNS` in `log-parser.ts`):

- **added** — kinds of lines the previous log never had
- **not seen** — kinds of lines the previous log had that this one hasn't (yet)
- **patterns lost** — parser regexes that matched before and match nothing now → likely broken by a patch

Settings → *Telemetry & Overlay* → *Export full report* / *Compare a log with current…* / *Compare two logs…*
write Markdown + JSON reports. Offline:

```bash
npm run log-diff -- path/to/old/Game.log path/to/new/Game.log --redact YourHandle --out diff.md
```

Example, 4.1 (build 9659838) → 4.2 (build 9898472): 154 new kinds of lines, 60 not seen,
parser patterns lost: `corpseLog`, `systemQuit`; now matching: `actorStateDead`, `newVehicleDestroyed`.

## Channels (LIVE / PTU / EPTU / TECH-PREVIEW / HOTFIX)

Settings → General → *Star Citizen Folder* holds the game root (`gameRoot`, the folder with `LIVE`, `PTU`, ...).
It is derived once from the old `logFilePath` (parent of the channel folder); non-standard layouts stay in
single-file mode. Channels = sub-folders with `Game.log`, `Bin64` or `StarCitizen_Launcher`, re-scanned every 30 s.
The *active* channel is the one whose Game.log was written most recently (stat-polled every 2 s; a switch needs a
>1 s newer write and at most one per 30 s). Only its lines are parsed/uploaded; a switch behaves like a new Game.log
(parser reset, new session, log read from the start). `submit_log_chunk` / `submit_telemetry` carry `channel`.
user.cfg is handled per channel (Settings → Telemetry), the Game.log diff keeps a baseline per channel
(`log-diff/<CHANNEL>/`; the pre-channel baseline is copied to the old channel's folder).

## Local recordings

`<userData>/telemetry-recordings/<time>_<channel>_<version>.log`, JSON Lines, one file per game session
(setting `telemetryRecord`, default on; never uploaded). Kinds: `session_start`, `status`, `changes` (flatten() path
diffs `{path: [old, new]}`, null = absent, ≤4 lines/s), `event`, `game_event`, `session_end` (frames, fpsAvg,
fieldsSeen, `neverNonDefault` = schema fields that never carried data: the accuracy signal). force_feedback is not
recorded; files are capped at 50 MB, the newest 30 are kept.

## Tests

`npm run test:telemetry` — fake game gRPC server built from the embedded schema, state/event
derivation, sharing filters, signatures, tracker baseline rotation.
