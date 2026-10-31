/** Change to give back, or how much is still short, in paise. Nothing tendered means exact cash. */
export function cashChange(total, tendered) {
  if (!tendered) return { change: 0, short: 0 };
  return tendered >= total ? { change: tendered - total, short: 0 } : { change: 0, short: total - tendered };
}

/** Stock meter fill in percent: full at twice the reorder level, or at any stock when no level is set. */
export function stockMeter(available, reorderLevel) {
  if (available <= 0) return 0;
  return reorderLevel > 0 ? Math.min(100, Math.round((available / (reorderLevel * 2)) * 100)) : 100;
}
