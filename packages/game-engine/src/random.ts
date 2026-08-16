/**
 * Randomness is injected so the engine stays deterministic under test while
 * production shuffles come from a CSPRNG (§58).
 */
export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

/** Cryptographically strong RNG, rejection-sampled to stay uniform. */
export function cryptoRng(
  getRandomValues: (array: Uint32Array) => Uint32Array,
): Rng {
  return {
    nextInt(maxExclusive: number): number {
      if (maxExclusive <= 0) throw new Error('maxExclusive must be > 0');
      if (maxExclusive === 1) return 0;
      const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
      const buf = new Uint32Array(1);
      let value: number;
      do {
        getRandomValues(buf);
        value = buf[0]!;
      } while (value >= limit);
      return value % maxExclusive;
    },
  };
}

/** Deterministic mulberry32 RNG — tests only, never for real deals. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    nextInt(maxExclusive: number): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const float = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(float * maxExclusive);
    },
  };
}

/** Fisher-Yates. Returns a new array; the input is untouched. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return result;
}
