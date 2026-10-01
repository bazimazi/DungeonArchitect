/** Expand the authenticated recommendation audience only after observed engagement. */
export function audienceLimit(card: {
  players: number;
  clearers: number;
  reactions: number;
}): number {
  if (card.players >= 10 && card.clearers >= 2) return Infinity;
  if (card.players >= 3 && (card.clearers > 0 || card.reactions >= 2))
    return 100;
  return 20;
}
