# Game Spec

## World overview

- Level 0: Town (authored, fixed layout). Contains shops and temple.
- Levels 1+: Dungeon levels, infinite sideways expansion, fully packed 1-cell-wide corridor maze.
- Each dungeon level has a hub at (level, 0, 0). Players can navigate and teleport to hubs.

## Dungeon topology

### Cells and edges
- Every cell is walkable floor-space.
- Traversal is controlled by edges between adjacent cells (N/E/S/W):
  - EDGE = wall | open | door_locked | door_unlocked | lever_secret (hidden until detected)
- "Rooms" are corridor segments separated by door edges; there are no open rectangular rooms.

### Fully packed maze
- There are no empty void areas; the entire explored grid area is corridor network.
- The generator builds a maze by defining edge connectivity, not by carving corridors out of rock.

### Secret pockets (lever rooms)
- Occasionally, the generator creates a deliberately sealed pocket region:
  - All its boundary edges are walls except exactly one edge marked as a secret lever edge.
- The lever is functionally a doorway but is hidden until detected.
- Lever is two-way: detectable/usable from both sides.
- Lever locations are permanent fixtures (deterministic placement).

## Discovery and visibility

### Global discovery (initial implementation)
- Only the cell the player steps onto becomes globally discovered.
- Undiscovered cells appear blank on minimap and not part of global map.

### Per-player line-of-sight (later)
- LoS reveal is per-player (shared with party) and permanent once revealed.
- LoS reveals along straight corridors until blocked by a wall/locked edge.
- LoS reveal does not count as global discovery until cells are physically traversed.

### Detection (traps/trapdoors/levers)
- A detection skill may reveal hazards or secrets in adjacent/nearby cells.
- Detection state is per-player and party-shared.
- Once a trap is detected by a player/party, it will not trigger for that player/party.

## Movement and facing

- Players occupy one cell and have a facing direction N/E/S/W.
- Movement: N/E/S/W to adjacent cell if the edge is traversable (open/unlocked/lever-open).
- Turn: change facing direction without moving (small cooldown).
- Main view renders up to 3 cells forward based on facing; objects are visible up to 2 cells forward.

## Doors, locks, and keys

- Doors have only locked/unlocked state. No open/close.
- Locked doors block players; unlocked doors are traversable.

### Lockpicking (universal rule)
- All locked doors and locked chests may be picked if the player has sufficient lockpicking skill.
- Lockpicking is a context action.
- Lock difficulty scales by depth (deeper = harder).

### Lock tied to key-monster (doors only auto-reset)

Some door edges may be dynamically locked while a specific key-monster exists.

- While the key-monster is alive:
  - Door remains locked.
  - Monster may traverse the door; players cannot.
- When the key-monster is killed OR despawns:
  - Door unlocks automatically (resets to unlocked state).

Resolution options for locked doors:
- Defeat key-monster
- OR pick the lock


## Ladders and trapdoors (chutes)

### Ladders
- Bidirectional connectors between levels.
- Traversed via context action on the ladder cell (not automatic on step).

### Trapdoors / Chutes
- One-way downward connectors; can drop 1+ levels.
- If undetected:
  - stepping onto chute cell triggers an accidental fall.
- If detected:
  - stepping onto chute cell is safe.
  - player may intentionally jump via context action.

Damage rules:
- Accidental fall: damage scales with number of levels dropped.
- Intentional jump:
  - no damage if drop <= 2
  - damage if drop >= 3
- If chute drop >= 3, damage occurs regardless of detection if the player jumps intentionally.

Traversal:
- All non-player dungeon creatures can traverse ladders and chutes.
- Chutes are one-way for all entities.

## Creatures (non-player dungeon creatures)

- Temperament: passive | neutral | aggressive.
  - Passive does not attack unless attacked; can roam.
  - Neutral may attack when provoked or under conditions.
  - Aggressive attacks within range.
- Roaming:
  - Non-aggro creatures can roam.
  - Creatures may traverse levels casually.
  - Constraint: creatures may not end up more than 2 levels away from their spawn_level.

## Monsters: spawn, persistence, despawn

- Spawn is controlled by a per-level population controller within active regions.
- Spawn locations are chosen within active regions, respecting local density limits.
- Rare/difficult monsters and better loot scale with depth (level_id).

Despawn:
- Despawn timer begins when no players are within DESPAWN_RADIUS.
- Key-monsters use a longer despawn timer.
- Cross-level proximity:
  - proximity across levels counts only through connector adjacency (ladder/chute endpoints).

## Traps (dynamic hazards)

- Traps can spawn rarely near active players (rarer than chests).
- If detected by a player/party, trap will not trigger for them.
- Traps despawn when no players are near (do not persist indefinitely).

## Chests (loot containers)

- Chests are relatively uncommon but discoverable.
- Spawn model:
  - Chests are managed per chunk/region with a quota (max number of active chests).
  - While a chunk is active, the server performs scheduled spawn checks (interval-based).
  - If below quota, new chests may spawn at new locations within the chunk.
- Persistence:
  - Once spawned, a chest persists until opened.
  - When opened, it remains for 30 minutes, then disappears regardless of whether all loot was taken.
- Trapped chests
  - A chest may be trapped (explosion/poison/etc.) or not.
  - Trap status is persistent while the chest exists.
- Locked chests
  - A loot chest may be locked or unlocked.
  - Locked chests block opening until one of the following occurs:
    - the lock is picked by a player with sufficient lockpicking skill, OR
    - the chest's key-monster is defeated (key-monster lock).
  - Key-monster rule for chests:
    - Some chests are associated with a specific key-monster instance.
    - While the key-monster exists, the chest remains locked.
    - When the key-monster is killed, the chest unlocks.
    - If the key-monster despawns, the chest lock resets (unlocks).

- Depth scaling:
  - Chest loot quality scales with dungeon depth.

## Bones

- On death (with or without Egg of Sanctuary), bones drop and remain until picked up.
- Anyone can pick up and bury bones immediately; no cooldown.

## Parties (initial)

- Party shares detection states (traps/trapdoors/levers) and corpse visibility window benefits.
- Party mechanics beyond that can be added later.

## Death and resurrection

### Egg of Sanctuary
- Carry limit: 1.
- Can be consumed by death (automatic) or manually activated.
- Death-trigger:
  - triggers on any death by monsters or traps
  - teleports player to nearest hub on that level
  - full HP restore; clears most status effects
  - no corpse chest created
- Manual activation:
  - teleports to nearest hub on current level
  - full HP restore; clears most status effects
  - restrictions:
    - cannot be used in combat
    - cannot be used within 10 seconds of being attacked
    - cannot be used while stunned/immobilized
    - requires 3-5 seconds channel; interrupted by damage (egg not consumed on interruption)

### Death without Egg of Sanctuary
- Equipped gear never drops.
- Carried inventory drops into a corpse chest at the death location.
- Corpse chest visibility:
  - 0-5 minutes: only the dead player
  - if in party: 5-10 minutes: party-only
  - after that: public
  - if solo: public after first 5 minutes
- Corpse chest persists until emptied; once emptied it disappears.

### Temple resurrection
- Free resurrection:
  - resurrect in town
  - items remain in corpse chest
- Paid resurrection:
  - resurrect to town or last hub
  - returns with all items
  - removes corpse chest (prevents duplication)

## PvP (initial)

- Voluntary duels only (town outside shops and dungeon).
- No item loss from duels.
- Both gain experience; winner gains extra.
- Open PvP in dungeon may be considered later.

## Admin editing (future)

- Admin can edit the authored town visually.
- Admin can edit dungeon cell/edge attributes (walls, locks, trapdoors, ladders, etc.) via overrides.
