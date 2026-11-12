import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { mergeHabitHistories } from '../../services/dataMerge/merge';

type HabitSchedule = { startDate: string; name?: string };

const habitScheduleArb = fc.record({
  startDate: fc.date().map(d => d.toISOString().slice(0, 10)),
  name: fc.string({ maxLength: 20 }),
});

describe('mergeHabitHistories property tests', () => {
  it('returns sorted unique startDates covering union of inputs (property test skeleton)', () => {
    fc.assert(
      fc.property(fc.array(habitScheduleArb), fc.array(habitScheduleArb), (a, b) => {
        const aNorm = a.map(s => ({ ...s }));
        const bNorm = b.map(s => ({ ...s }));
        const res = mergeHabitHistories(aNorm as any, bNorm as any);

        // 1) Sorted ascending by startDate
        for (let i = 1; i < res.length; i++) {
          if (res[i - 1].startDate > res[i].startDate) return false;
        }

        // 2) Unique startDates
        const dates = res.map(r => r.startDate);
        const unique = new Set(dates);
        if (unique.size !== dates.length) return false;

        // 3) Contains union of input startDates
        const union = new Set([...aNorm.map(x => x.startDate), ...bNorm.map(x => x.startDate)]);
        for (const d of union) if (!unique.has(d)) return false;

        return true;
      }),
      { numRuns: 200 }
    );
  });
});
