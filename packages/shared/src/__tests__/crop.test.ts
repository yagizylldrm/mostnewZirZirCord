import { describe, expect, it } from 'vitest';
import { type CropView, clampOffset, coverScale, sourceRect, zoomAroundCenter } from '..';

const base: CropView = { frameW: 300, frameH: 300, imgW: 600, imgH: 400, zoom: 1, offsetX: 0, offsetY: 0 };

describe('crop geometry', () => {
  it('covers the frame at zoom 1 and shows the largest centred-able square', () => {
    expect(coverScale(base)).toBeCloseTo(0.75); // height 400 -> 300
    const r = sourceRect({ ...base, offsetX: -75 }); // pan to the middle of the 450px-wide scaled image
    expect(r.sh).toBeCloseTo(400);
    expect(r.sw).toBeCloseTo(400);
    expect(r.sx).toBeCloseTo(100);
    expect(r.sy).toBeCloseTo(0);
  });

  it('clamps so no empty edge shows', () => {
    expect(clampOffset({ ...base, offsetX: 50, offsetY: 50 })).toEqual({ offsetX: 0, offsetY: 0 });
    expect(clampOffset({ ...base, offsetX: -999 }).offsetX).toBeCloseTo(300 - 450);
  });

  it('keeps the centre point when zooming', () => {
    const v = { ...base, offsetX: -75 };
    const before = sourceRect(v);
    const after = sourceRect(zoomAroundCenter(v, 2));
    expect(after.sx + after.sw / 2).toBeCloseTo(before.sx + before.sw / 2);
    expect(after.sw).toBeCloseTo(before.sw / 2);
  });

  it('works for a wide banner frame', () => {
    const v: CropView = { frameW: 360, frameH: 120, imgW: 1200, imgH: 1200, zoom: 1, offsetX: 0, offsetY: -100 };
    const r = sourceRect(v);
    expect(r.sw / r.sh).toBeCloseTo(3);
    expect(r.sw).toBeCloseTo(1200);
  });
});
