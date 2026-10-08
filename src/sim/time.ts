/** Simulation steps per second. */
export const TICK_RATE = 60;

export const seconds = (s: number): number => Math.round(s * TICK_RATE);
