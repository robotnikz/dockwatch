import { describe, expect, it } from 'vitest';
import { getScheduleWindowId, hasReachedScheduleTime } from '../src/services/cleanupScheduler.js';

describe('cleanup scheduler timing helpers', () => {
  it('considers current minute as reached when now is after scheduled time', () => {
    const now = new Date('2026-03-12T03:02:00Z');
    expect(hasReachedScheduleTime('03:00', now)).toBe(true);
    expect(hasReachedScheduleTime('03:02', now)).toBe(true);
    expect(hasReachedScheduleTime('03:03', now)).toBe(false);
  });

  it('builds stable daily/weekly/monthly schedule window identifiers', () => {
    const date = new Date('2026-03-12T10:30:00Z'); // Thursday
    expect(getScheduleWindowId('daily', date)).toBe('2026-03-12');
    expect(getScheduleWindowId('weekly', date)).toBe('2026-03-08'); // Sunday of same week
    expect(getScheduleWindowId('monthly', date)).toBe('2026-03');
  });
});
