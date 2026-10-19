export const TILE = 32;
export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export const enum PassClass {
  Infantry = 0,
  Vehicle = 1,
  /** Hover units: like vehicles, but water is passable. */
  Hover = 2,
}
