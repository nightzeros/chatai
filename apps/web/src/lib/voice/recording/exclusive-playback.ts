/** Keeps one Voice recording audible at a time within a page (pure; safe for client components). */

export type PlaybackScope = {
  /** Adds a player; `pause` must keep its playback position. Returns an unregister function. */
  register: (playerId: string, pause: () => void) => () => void;
  /** A player is starting playback: every other player in the scope is paused. */
  claim: (playerId: string) => void;
};

export function createPlaybackScope(): PlaybackScope {
  const players = new Map<string, () => void>();
  return {
    register(playerId, pause) {
      players.set(playerId, pause);
      return () => {
        if (players.get(playerId) === pause) players.delete(playerId);
      };
    },
    claim(playerId) {
      for (const [id, pause] of players) {
        if (id !== playerId) pause();
      }
    },
  };
}
