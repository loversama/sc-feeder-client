# Dual-Mode Detection Requirements for log-monitor-client

## 📋 Current State Analysis

### Existing Regex Patterns (OLD FORMAT ONLY)

The client currently **only supports pre-4.4 log formats**:

```typescript
// log-parser.ts (lines 64-246)
✅ loginRegex                  // Line 64  - <AccountLoginCharacterStatus_Character>
✅ legacyLoginRegex            // Line 65  - <Legacy login response>
✅ vehicleDestructionRegex     // Line 71  - <Vehicle Destruction> (OLD format)
✅ corpseLogRegex              // Line 243 - <[ActorState] Corpse> (OLD format)
✅ killPatternRegex            // Line 244 - <Actor Death> CActor::Kill (OLD format)
✅ incapRegex                  // Line 245 - Incapacitation logs
✅ environmentDeathRegex       // Line 246 - Environmental deaths (OLD format)
```

### What's MISSING (NEW FORMAT - SC 4.4+)

```typescript
❌ newActorStateDeadRegex      // <[ActorState] Dead> - Vehicle death (HAS name)
❌ corpseUtilsRegex            // CSCActorCorpseUtils - Death (NO name, needs lookup)
❌ attachmentReceivedRegex     // <AttachmentReceived> - Player respawn
❌ fatalCollisionRegex         // <FatalCollision> - Collision physics
❌ newVehicleDestroyedRegex    // [VEHICLE SPAWN] Vehicle Destroyed - New format
```

---

## 🎯 Requirements for Dual-Mode Detection

### 1. **Add NEW Format Regex Patterns**

Add after line 73 in `log-parser.ts`:

```typescript
// === NEW FORMAT PATTERNS (Star Citizen 4.4+) ===

// New ActorState Dead (player death in vehicle context - HAS player name)
const newActorStateDeadRegex =
  /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>\s+\[Notice\]\s+<\[ActorState\] Dead>\s+\[ACTOR STATE\]\[CSCActorControlStateDead::PrePhysicsUpdate\]\s+Actor '(?<actor>[^']+)'\s+\[(?<actor_id>\d+)\]\s+ejected from zone '(?<from_zone>[^']+)'\s+\[(?<from_zone_id>\d+)\]\s+to zone '(?<to_zone>[^']+)'\s+\[(?<to_zone_id>\d+)\]\s+due to (?<reason>.+)\./;

// CSCActorCorpseUtils (definitive player death - NO player name, needs username from state)
const corpseUtilsRegex =
  /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>\s+\[Notice\]\s+<Adding non kept item \[CSCActorCorpseUtils::PopulateItemPortForItemRecoveryEntitlement\]>\s+Item '(?<item_name>[^']+)\s+-\s+Class\((?<item_class>[^)]+)\).*?Port Name '(?<port_name>[^']+)',\s+Class GUID:\s+'(?<guid>[^']+)'(?:,\s+KeptId:\s+'(?<kept_id>\d+)')?/;

// AttachmentReceived (player respawn - HAS player name)
const attachmentReceivedRegex =
  /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>\s+\[Notice\]\s+<AttachmentReceived>\s+Player\[(?<player_name>[^\]]+)\]\s+Attachment\[(?<item_full_name>[^,]+),\s+(?<item_class>[^,]+),\s+(?<item_id>\d+)\]\s+Status\[(?<status>\w+)\]\s+Port\[(?<port>[^\]]+)\]\s+Elapsed\[(?<elapsed>[\d.]+)\]/;

// FatalCollision (detailed collision data)
const fatalCollisionRegex =
  /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>\s+\[Notice\]\s+<FatalCollision>\s+Fatal Collision occured for vehicle (?<vehicle>\S+)\s+\[Part: (?<part>[^,]+), Pos: x: (?<pos_x>[-\d.]+), y: (?<pos_y>[-\d.]+), z: (?<pos_z>[-\d.]+), Zone: (?<zone>[^,]+), PlayerPilot: (?<player_pilot>\d+)\].*?after hitting entity: (?<hit_entity>[^\[]+)\[Zone: (?<hit_zone>[^\s]+).*?\].*?Hit Pos: x: (?<hit_x>[-\d.]+), y: (?<hit_y>[-\d.]+), z: (?<hit_z>[-\d.]+), Distance: (?<distance>[-\d.]+), Relative Vel: x: (?<vel_x>[-\d.]+), y: (?<vel_y>[-\d.]+), z: (?<vel_z>[-\d.]+)/;

// New Vehicle Destroyed (context-sensitive "Killed by" field)
const newVehicleDestroyedRegex =
  /<(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)>\s+\[VEHICLE SPAWN\]\s+Vehicle Destroyed \((?<vehicle>[^)]+)\)\.\s+Killed by \((?<killer>[^)]+)\)\.\s+Reason: (?<reason>\w+)/;

// === END NEW FORMAT PATTERNS ===
```

### 2. **Add Dual-Mode Detection Configuration**

Add after Module State section (~line 52):

```typescript
// === DUAL-MODE DETECTION CONFIGURATION ===
const ENABLE_OLD_FORMAT = true;    // Keep old format detection
const ENABLE_NEW_FORMAT = true;    // Enable new format detection
const PREFERRED_FORMAT: 'old' | 'new' = 'old';  // Prioritize old when both present
const DEDUP_WINDOW_MS = 5000;      // 5-second deduplication window

// Detection priority (lower index = higher priority)
const DETECTION_PRIORITY = [
  'corpse_log_old',        // 1. OLD: <[ActorState] Corpse> (most reliable)
  'actor_state_dead_new',  // 2. NEW: <[ActorState] Dead> (has name)
  'corpse_utils_new',      // 3. NEW: CSCActorCorpseUtils (no name)
  'attachment_received',   // 4. NEW: AttachmentReceived (respawn)
];

// Deduplication cache
const recentDeaths = new Map<string, {method: string; timestamp: number}>();

// Detection metrics
let detectionStats = {
  old_corpse_log: 0,
  actor_state_dead_new: 0,
  corpse_utils_new: 0,
  attachment_received: 0,
  unknown_format: 0,
  duplicates_prevented: 0,
};
```

### 3. **Add Helper Functions**

Add before `parseLogContent` function (~line 290):

```typescript
/**
 * Checks if a death event should be processed or is a duplicate
 */
function shouldProcessDeath(
  playerName: string,
  timestamp: string,
  detectionMethod: string
): boolean {
  const timestampSeconds = Math.floor(new Date(timestamp).getTime() / 1000);
  const dedupKey = `${playerName.toLowerCase()}:${timestampSeconds}`;

  if (recentDeaths.has(dedupKey)) {
    const existing = recentDeaths.get(dedupKey)!;
    const currentPriority = DETECTION_PRIORITY.indexOf(detectionMethod);
    const existingPriority = DETECTION_PRIORITY.indexOf(existing.method);

    if (currentPriority < existingPriority) {
      logger.info(MODULE_NAME, `Upgrading death detection from ${existing.method} to ${detectionMethod} for ${playerName}`);
      recentDeaths.set(dedupKey, { method: detectionMethod, timestamp: Date.now() });
      return true;
    } else {
      logger.debug(MODULE_NAME, `Skipping duplicate death (${detectionMethod}) - already detected via ${existing.method}`);
      detectionStats.duplicates_prevented++;
      return false;
    }
  }

  recentDeaths.set(dedupKey, { method: detectionMethod, timestamp: Date.now() });

  // Clean up old entries
  const now = Date.now();
  for (const [key, value] of recentDeaths.entries()) {
    if (now - value.timestamp > DEDUP_WINDOW_MS) {
      recentDeaths.delete(key);
    }
  }

  return true;
}

/**
 * Log detection statistics
 */
function logDetectionStats() {
  logger.info(MODULE_NAME, '=== Death Detection Statistics ===');
  logger.info(MODULE_NAME, `Old Corpse Log: ${detectionStats.old_corpse_log}`);
  logger.info(MODULE_NAME, `New ActorState Dead: ${detectionStats.actor_state_dead_new}`);
  logger.info(MODULE_NAME, `New CorpseUtils: ${detectionStats.corpse_utils_new}`);
  logger.info(MODULE_NAME, `AttachmentReceived: ${detectionStats.attachment_received}`);
  logger.info(MODULE_NAME, `Duplicates Prevented: ${detectionStats.duplicates_prevented}`);

  if (detectionStats.old_corpse_log > detectionStats.corpse_utils_new * 2) {
    logger.warn(MODULE_NAME, 'Old format significantly higher than new - investigate!');
  }
}
```

### 4. **Update Corpse Log Processing (Dual-Mode)**

Replace corpse log processing section (lines 436-454) with:

```typescript
// === DUAL-MODE PLAYER DEATH DETECTION ===
let deathDetected = false;
let detectionMethod: string | null = null;
let victimName: string | null = null;
let deathTimestamp: string | null = null;

// 1. Try OLD FORMAT: Corpse Log (most reliable - has player name)
if (ENABLE_OLD_FORMAT) {
  const corpseMatch = line.match(corpseLogRegex);
  if (corpseMatch?.groups) {
    detectionMethod = 'corpse_log_old';
    victimName = corpseMatch.groups.playerName;
    deathTimestamp = corpseMatch.groups.timestamp;
    deathDetected = true;

    logger.info(MODULE_NAME, 'OLD FORMAT Corpse Log detected:', { victim: victimName });
    detectionStats.old_corpse_log++;
  }
}

// 2. Try NEW FORMAT: ActorState Dead (has player name, vehicle context)
if (!deathDetected && ENABLE_NEW_FORMAT) {
  const newActorDeadMatch = line.match(newActorStateDeadRegex);
  if (newActorDeadMatch?.groups) {
    detectionMethod = 'actor_state_dead_new';
    victimName = newActorDeadMatch.groups.actor;
    deathTimestamp = newActorDeadMatch.groups.timestamp;
    deathDetected = true;

    logger.info(MODULE_NAME, 'NEW FORMAT ActorState Dead detected:', {
      victim: victimName,
      fromZone: newActorDeadMatch.groups.from_zone,
      toZone: newActorDeadMatch.groups.to_zone
    });
    detectionStats.actor_state_dead_new++;
  }
}

// 3. Try NEW FORMAT: CSCActorCorpseUtils (NO player name - use currentUsername)
if (!deathDetected && ENABLE_NEW_FORMAT) {
  const corpseUtilsMatch = line.match(corpseUtilsRegex);
  if (corpseUtilsMatch?.groups) {
    // Only process first item (body) to avoid duplicates
    if (corpseUtilsMatch.groups.item_class.includes('body_01')) {
      detectionMethod = 'corpse_utils_new';
      victimName = currentUsername; // Use current logged-in username
      deathTimestamp = corpseUtilsMatch.groups.timestamp;
      deathDetected = true;

      logger.info(MODULE_NAME, 'NEW FORMAT CSCActorCorpseUtils detected, resolved to:', { victim: victimName });
      detectionStats.corpse_utils_new++;
    }
  }
}

// Process death event if detected
if (deathDetected && victimName && deathTimestamp && detectionMethod) {
  // Check for duplicates
  if (!shouldProcessDeath(victimName, deathTimestamp, detectionMethod)) {
    continue; // Skip duplicate
  }

  logger.info(MODULE_NAME, 'Player death detected:', { victim: victimName }, 'via', detectionMethod);
  const deathTimeMs = new Date(deathTimestamp).getTime();

  // Add to recent deaths for correlation
  recentPlayerDeaths.push({ timestamp: deathTimeMs, playerName: victimName, processed: false });

  // Clean up old entries
  const cutoffTime = Date.now() - 60000;
  while (recentPlayerDeaths.length > 0 && recentPlayerDeaths[0].timestamp < cutoffTime) {
    recentPlayerDeaths.shift();
  }

  // Attempt correlation
  await correlateDeathWithDestruction(deathTimestamp, victimName, silentMode);
  continue;
}
// === END DUAL-MODE PLAYER DEATH DETECTION ===
```

### 5. **Add New Format Vehicle Destruction Detection**

Add after old vehicle destruction processing (after line 434):

```typescript
// === NEW FORMAT: Vehicle Destroyed ===
if (ENABLE_NEW_FORMAT) {
  const newVehicleMatch = line.match(newVehicleDestroyedRegex);
  if (newVehicleMatch?.groups) {
    const { timestamp, vehicle, killer, reason } = newVehicleMatch.groups;

    logger.info(MODULE_NAME, 'NEW FORMAT Vehicle Destroyed:', {
      vehicle,
      killer,
      reason
    });

    // Context-sensitive "killer" field:
    // - reason === "Collision" → killer = VICTIM (pilot who died)
    // - reason === "Combat" → killer = ATTACKER (player who got kill)
    // - reason === "Explosion" → killer = ATTACKER (who caused explosion)

    let actualKiller: string;
    let actualVictim: string;

    if (reason === 'Collision') {
      actualVictim = killer; // Killer field is actually the victim
      actualKiller = 'Collision'; // Environmental/self-inflicted
    } else {
      actualKiller = killer; // Killer field is correct
      actualVictim = vehicle; // Vehicle is victim
    }

    // Check if player is involved
    const isPlayerInvolved = actualKiller === currentUsername || actualVictim === currentUsername;

    if (isPlayerInvolved) {
      // Process similar to old vehicle destruction
      const vehicleCleanupMatch = vehicle.match(cleanupPattern);
      const vehicleBaseName = vehicleCleanupMatch?.[1] || vehicle;

      const deathType = reason === 'Collision' ? 'Collision' :
                       reason === 'Combat' ? 'Combat' :
                       reason === 'Explosion' ? 'Explosion' : 'Unknown';

      const stableId = `v_kill_new_${vehicle}`.replace(/[^a-zA-Z0-9_]/g, '');

      // Process as kill event...
      // (Similar to old vehicle destruction processing)
    }
    continue;
  }
}
```

### 6. **Add FatalCollision Detection (Optional - Rich Physics Data)**

Add after new vehicle destroyed detection:

```typescript
// === NEW FORMAT: Fatal Collision (Detailed Physics) ===
if (ENABLE_NEW_FORMAT) {
  const fatalCollisionMatch = line.match(fatalCollisionRegex);
  if (fatalCollisionMatch?.groups) {
    const groups = fatalCollisionMatch.groups;

    logger.info(MODULE_NAME, 'NEW FORMAT Fatal Collision detected:', {
      vehicle: groups.vehicle,
      part: groups.part,
      zone: groups.zone,
      hitEntity: groups.hit_entity,
      playerPilot: groups.player_pilot === '1'
    });

    // Store collision data for enriching vehicle destruction events
    // This provides exact coordinates, velocity, collision entity details
    // Can be correlated with Vehicle Destroyed event within 1-2 seconds

    // TODO: Implement collision data caching and correlation
  }
}
```

### 7. **Add AttachmentReceived Detection (Optional - Respawn Tracking)**

Add in the parsing loop:

```typescript
// === NEW FORMAT: AttachmentReceived (Player Respawn) ===
if (ENABLE_NEW_FORMAT) {
  const attachmentMatch = line.match(attachmentReceivedRegex);
  if (attachmentMatch?.groups) {
    const { timestamp, player_name, item_class, elapsed } = attachmentMatch.groups;

    // Only log first attachment (body) to avoid spam
    if (item_class.includes('body_01')) {
      logger.info(MODULE_NAME, 'NEW FORMAT Player Respawn detected:', {
        player: player_name,
        elapsed: parseFloat(elapsed)
      });

      detectionStats.attachment_received++;

      // Calculate downtime if we have recent death
      const lastDeath = recentPlayerDeaths.find(d => d.playerName === player_name);
      if (lastDeath) {
        const downtime = new Date(timestamp).getTime() - lastDeath.timestamp;
        logger.info(MODULE_NAME, `Player ${player_name} respawned after ${(downtime/1000).toFixed(1)}s downtime`);
      }
    }
  }
}
```

### 8. **Add Periodic Stats Logging**

Add at end of `parseLogContent` function:

```typescript
// Log detection stats every ~100 parses (random sampling)
if (Math.random() < 0.01) {
  logDetectionStats();
}
```

### 9. **Update resetParserState()**

Add to reset function:

```typescript
// Reset dual-mode detection state
recentDeaths.clear();
detectionStats = {
  old_corpse_log: 0,
  actor_state_dead_new: 0,
  corpse_utils_new: 0,
  attachment_received: 0,
  unknown_format: 0,
  duplicates_prevented: 0,
};
```

---

## 📊 Key Differences: Client vs Server

### **Client-Side (Simpler)**

✅ **Has `currentUsername`** - Player name always available from login detection
✅ **Single client context** - Only processes current player's logs
✅ **No database** - Uses in-memory state only
✅ **No async lookup needed** - Username already in memory
✅ **Simpler correlation** - All events from same player

### **Server-Side (More Complex)**

⚠️ **No direct username** - Must resolve from clientId
⚠️ **Multi-client** - Handles logs from many players
⚠️ **Database required** - Lookups for lastKnownHandle, user.rsiHandle
⚠️ **Async lookups** - Database queries add latency
⚠️ **Complex correlation** - Events from different clients

---

## 🎯 Implementation Priority

### **Phase 1: Critical (Minimum Viable)**
1. ✅ Add NEW format regex patterns
2. ✅ Add dual-mode corpse log detection
3. ✅ Add deduplication logic
4. ✅ Update resetParserState()

### **Phase 2: Important (Enhanced)**
5. ⏳ Add NEW vehicle destroyed detection
6. ⏳ Add ActorState Dead handling
7. ⏳ Add detection metrics and logging

### **Phase 3: Optional (Advanced)**
8. ⏸️ Add FatalCollision detection
9. ⏸️ Add AttachmentReceived respawn tracking
10. ⏸️ Implement collision data caching/correlation

---

## ✅ Benefits

✅ **Zero data loss** - Catches both old and new formats
✅ **Smooth migration** - Works across SC versions
✅ **No duplicate events** - Smart deduplication
✅ **Player name always available** - Uses currentUsername
✅ **Monitoring ready** - Detection metrics included
✅ **Future-proof** - Easy to phase out old format

---

## ⚠️ Important Notes

1. **Client has currentUsername** - Makes new format detection much easier than server!
2. **CSCActorCorpseUtils resolution** - Just use `currentUsername` (no database lookup needed)
3. **Deduplication is critical** - Both formats may detect same death
4. **Context-sensitive killer field** - NEW vehicle destroyed format is tricky
5. **Only process if player involved** - Client already filters by currentUsername

---

## 🔗 References

- **Server Implementation**: `/log-monitor-server/src/log-processor/log-processor.service.ts`
- **Documentation**: `/log-monitor-server/event-regex-comparison.md`
- **Existing Client Parser**: `/log-monitor-client/electron/modules/log-parser.ts`
