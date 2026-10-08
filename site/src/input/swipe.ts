export interface Pt { x: number; y: number; t: number }

export function detectSwipe(start: Pt, end: Pt): 'left' | 'right' | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (end.t - start.t > 600 || Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'left' : 'right';
}
