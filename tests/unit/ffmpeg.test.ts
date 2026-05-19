import { describe, expect, it } from 'vitest';

import { secondsToHms } from '../../src/lib/ffmpeg.js';

describe('secondsToHms', () => {
  it.each([
    [0, '00:00:00'],
    [9, '00:00:09'],
    [60, '00:01:00'],
    [3661, '01:01:01'],
    [86399, '23:59:59'],
  ])('converts %d -> %s', (sec, expected) => {
    expect(secondsToHms(sec)).toBe(expected);
  });

  it('clamps negative to zero', () => {
    expect(secondsToHms(-5)).toBe('00:00:00');
  });
});
