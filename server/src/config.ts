export const CONFIG = {
  port: Number(process.env.PORT ?? 3000),
  wsPath: process.env.WS_PATH ?? '/ws',
  dbPath: process.env.DB_PATH ?? './data/dev.sqlite3',

  /**
   * Dev Origin allowlist for WebSocket connections.
   *
   * - HTTP_ORIGIN: single origin (legacy)
   * - HTTP_ORIGINS: comma-separated list of origins
   * - Set either to "*" to disable origin checking in dev
   *
   * Examples:
   *   HTTP_ORIGIN="http://localhost:5173"
   *   HTTP_ORIGINS="http://localhost:5173,http://192.168.1.72:5173"
   *   HTTP_ORIGINS="*"
   */
  httpOrigins: (() => {
    const rawList = (process.env.HTTP_ORIGINS ?? '').trim();
    const rawSingle = (process.env.HTTP_ORIGIN ?? '').trim();

    const combined = [
      ...(rawList ? rawList.split(',').map((s) => s.trim()).filter(Boolean) : []),
      ...(rawSingle ? [rawSingle] : [])
    ];

    if (combined.includes('*')) return ['*'];

    if (combined.length === 0) return ['http://localhost:5173'];

    return Array.from(new Set(combined));
  })(),

  // 4 cells/sec => 250ms per move
  moveCooldownMs: Number(process.env.MOVE_COOLDOWN_MS ?? 250),

  // Instant turn
  turnCooldownMs: Number(process.env.TURN_COOLDOWN_MS ?? 0)
} as const;
