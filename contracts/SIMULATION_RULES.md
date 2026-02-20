# Simulation Rules

## Tick model

- Hybrid system:
  - Player actions (move/turn/interact/use egg) are event-driven, validated instantly, and rate-limited.
  - World simulation advances on ticks for monsters/NPCs, timers, and scheduled spawn checks.

Default tick rate:
- TICK_RATE_HZ = 4

## Soft pause and catch-up

When there are no connected/active players in the dungeon world:
- Simulation is paused (no ticking).
- On resume:
  - compute elapsed real time delta
  - apply "timer catch-up" rules without iterating every tick

Catch-up applies to:
- monster despawn timers (if should have expired, expire)
- dynamic key-lock links (if key-monster despawned, unlock)
- loot chest expirations (opened chests that should expire, expire)
- chunk scheduled spawn check times:
  - run missed scheduled checks once per interval boundary while chunk becomes active again
  - do not "over-spawn" due to large offline time; enforce quotas strictly

## Active regions

Definitions:
- ACTIVE_RADIUS_TILES = 24
- DESPAWN_RADIUS_TILES = 18

Active region for simulation:
- union of all player circles (level-local) with radius ACTIVE_RADIUS_TILES
- only entities within active regions are tick-simulated

Cross-level proximity:
- only counts through connectors:
  - ladder endpoints
  - chute endpoints
- Used for:
  - despawn "near player" checks
  - key-lock persistence
  - not used for general activation (activation is level-local)

## Monsters and NPCs

### Population controller
Per level:
- target_population = base + per_player * active_players
- max_population = ceil(target_population * 1.5)
- maintain density caps in local radius windows

Spawn conditions:
- within active regions
- only if below max_population
- local density under cap
- obey rarity tables by depth

### Roaming
- Non-aggro and passive monsters roam within a home radius.
- Monsters may traverse ladders and chutes.
- Constraint: abs(current_level - spawn_level) <= 2
  - if traversal would violate constraint, monster will not traverse and will leash.

### Despawn
- If no players within DESPAWN_RADIUS_TILES:
  - start despawn timer
  - normal: DESPAWN_TIME_SEC = 180
  - key monsters: DESPAWN_TIME_KEY_SEC = 300
- If a player re-enters radius before timer expires, cancel despawn.

## Dynamic key-locks (doors and chests)

- Some doors (edges) and some loot chests are dynamically locked while a specific key-monster exists.
- Players cannot traverse locked door edges and cannot open locked chests.
- The key-monster may traverse locked door edges (players cannot).

Unlock conditions (applies to both doors and chests):
- key-monster is killed OR despawns
- on unlock, the object returns to unlocked state (or configured default)

Lockpicking (alternative resolution):
- If a player has sufficient lockpicking skill, they may pick:
  - locked doors (edge interaction), and/or
  - locked chests (open interaction)
- Successful lockpicking immediately unlocks the target and allows traversal/opening.
- Lockpicking does not require the key-monster to be killed.

## Egg of Sanctuary

### Death-trigger
On death by monster/trap:
- if character has Egg of Sanctuary:
  - consume egg
  - teleport to nearest hub on current level (straight-line nearest; hub is fixed at (0,0))
  - restore full HP
  - clear most status effects
  - do not create corpse chest
  - create bones drop

### Manual use
- Restrictions:
  - cannot be used in combat
  - cannot be used within 10 seconds of being attacked
  - cannot be used while stunned or immobilized
- Channeling:
  - channel 3-5 seconds
  - if any damage during channel, cancel (egg not consumed)
- Success:
  - consume egg
  - teleport to nearest hub on current level
  - restore full HP
  - clear most status effects

## Corpse and loot rules

On death without egg:
- equipped gear never drops
- carried loot drops into corpse chest
- bones drop always

Corpse visibility:
- 0-5 min: owner only
- 5-10 min: party only (if in party)
- after: public (or after 5 min if solo)

Paid temple resurrection:
- returns character with all items
- removes corpse chest (prevents duplication)

## Loot chests

Per chunk:
- chest_quota limits number of active chests
- scheduled spawn checks occur every CHEST_SPAWN_CHECK_INTERVAL_SEC while chunk is active

Spawn check:
- if active_chest_count < chest_quota:
  - spawn one or more chests (tunable), selecting valid locations
  - assign trapped status and loot based on depth

Opening:
- opening sets state=opened and expires_at = now + 30 min
- after expires_at, chest disappears regardless of remaining loot

Anti-farming:
- no immediate respawn on chest expiration; spawns only via scheduled checks and quotas.

## Traps

- Rare dynamic hazards can spawn in active regions (rarer than chests).
- Detection state is per player/party.
- Once detected, trap does not trigger for that player/party.
- Traps despawn when no players are nearby (not persistent).

## Turning and movement cooldowns

- move cooldown: 500ms
- turn cooldown: 150ms
- server enforces cooldowns, seq monotonicity, and rate limits.
