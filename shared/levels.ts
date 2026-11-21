/** XP needed to go from `level` to `level+1`. */
export const xpToNext = (level: number, mult = 1) => Math.round((5 * level * level + 50 * level + 100) * mult);
/** Total XP required to reach `level`. */
export function xpForLevel(level: number, mult = 1): number {
  let t = 0;
  for (let l = 0; l < level; l++) t += xpToNext(l, mult);
  return t;
}
export function levelFromXp(xp: number, mult = 1): number {
  let level = 0;
  let rem = xp;
  while (rem >= xpToNext(level, mult)) { rem -= xpToNext(level, mult); level++; }
  return level;
}
