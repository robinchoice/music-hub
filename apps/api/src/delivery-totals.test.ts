import { expect, test } from 'bun:test';
import { DELIVERY_TRACK_STATES } from '@music-hub/shared';
import fc from 'fast-check';
import { isCovered, isPayable, totalsOf } from './lib/deliveries.js';

const cents = fc.integer({ min: 0, max: 10_000_000 });
const song = fc.record({
  priceCents: cents,
  extraRounds: fc.integer({ min: 0, max: 20 }),
  extraCents: cents,
  state: fc.constantFrom(...DELIVERY_TRACK_STATES),
});

test('totals add up for any songs and payments, and a delivery is either payable, covered or neither', () => {
  fc.assert(
    fc.property(fc.array(song, { maxLength: 30 }), cents, cents, (list, extraRoundCents, paidCents) => {
      const totals = totalsOf(list, extraRoundCents, paidCents);
      const sum = (key: 'priceCents' | 'extraCents' | 'extraRounds') => list.reduce((total, t) => total + t[key], 0);
      expect(totals.songsCents).toBe(sum('priceCents'));
      expect(totals.extraCents).toBe(sum('extraCents'));
      expect(totals.extraRounds).toBe(sum('extraRounds'));
      expect(totals.totalCents).toBe(totals.songsCents + totals.extraCents);
      // Overpaying never turns into credit, underpaying leaves exactly the rest due
      expect(totals.dueCents).toBe(Math.max(0, totals.totalCents - paidCents));
      expect(totals.approvedCount).toBeLessThanOrEqual(totals.trackCount);
      for (const status of ['open', 'paid', 'cancelled']) {
        const payable = isPayable({ status }, totals);
        const covered = isCovered({ status }, totals);
        expect(payable && covered).toBe(false);
        const allApproved = status === 'open' && list.length > 0 && list.every((t) => t.state === 'approved');
        expect(payable || covered).toBe(allApproved);
      }
    }),
  );
});
