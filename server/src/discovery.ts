import type { DB } from './db.js';

export class DbDiscoveryProvider {
  constructor(private db: DB, private worldId: string) {}

  markDiscovered(levelId: number, x: number, y: number, atMs: number): void {
    // Idempotent: one row per (world_id, level_id, x, y)
    this.db
      .prepare(
        `
        INSERT INTO discovered_cells_global (world_id, level_id, x, y, discovered_at_ms)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(world_id, level_id, x, y) DO UPDATE SET discovered_at_ms = excluded.discovered_at_ms
      `
      )
      .run(this.worldId, levelId, x, y, atMs);
  }

  /**
   * Returns all discovered cells within an axis-aligned square radius around (cx, cy).
   * This is what the minimap uses (full set, not a "delta patch").
   */
  getDiscoveredInRadius(levelId: number, cx: number, cy: number, radius: number): Array<{ x: number; y: number }> {
    const minX = cx - radius;
    const maxX = cx + radius;
    const minY = cy - radius;
    const maxY = cy + radius;

    const rows = this.db
      .prepare(
        `
        SELECT x, y
        FROM discovered_cells_global
        WHERE world_id = ?
          AND level_id = ?
          AND x BETWEEN ? AND ?
          AND y BETWEEN ? AND ?
        ORDER BY y ASC, x ASC
      `
      )
      .all(this.worldId, levelId, minX, maxX, minY, maxY) as any[];

    return rows.map((r) => ({ x: Number(r.x), y: Number(r.y) }));
  }
}
