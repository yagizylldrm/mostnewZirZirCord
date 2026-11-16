/** Geometry for the profile-picture cropper: an image shown "cover" inside a frame, zoomed and panned. */

export interface CropView {
  /** Frame size on screen (px). */
  frameW: number;
  frameH: number;
  /** Image natural size (px). */
  imgW: number;
  imgH: number;
  /** 1 = the image just covers the frame. */
  zoom: number;
  /** Image top-left relative to the frame (px). Zero or negative. */
  offsetX: number;
  offsetY: number;
}

/** Display scale at zoom 1: the smallest that still covers the whole frame. */
export const coverScale = (v: Pick<CropView, 'frameW' | 'frameH' | 'imgW' | 'imgH'>) => Math.max(v.frameW / v.imgW, v.frameH / v.imgH);

/** Keeps the image covering the frame (no empty edges) after a pan or zoom. */
export function clampOffset(v: CropView): { offsetX: number; offsetY: number } {
  const s = coverScale(v) * v.zoom;
  const minX = Math.min(0, v.frameW - v.imgW * s);
  const minY = Math.min(0, v.frameH - v.imgH * s);
  return { offsetX: Math.max(minX, Math.min(0, v.offsetX)), offsetY: Math.max(minY, Math.min(0, v.offsetY)) };
}

/** The part of the original image inside the frame, in image pixels. */
export function sourceRect(v: CropView): { sx: number; sy: number; sw: number; sh: number } {
  const s = coverScale(v) * v.zoom;
  const { offsetX, offsetY } = clampOffset(v);
  return { sx: -offsetX / s, sy: -offsetY / s, sw: v.frameW / s, sh: v.frameH / s };
}

/** Zooming around the frame's centre: the offset that keeps the same point in the middle. */
export function zoomAroundCenter(v: CropView, nextZoom: number): CropView {
  const k = coverScale(v);
  const cx = (v.frameW / 2 - v.offsetX) / (k * v.zoom);
  const cy = (v.frameH / 2 - v.offsetY) / (k * v.zoom);
  const next = { ...v, zoom: nextZoom, offsetX: v.frameW / 2 - cx * k * nextZoom, offsetY: v.frameH / 2 - cy * k * nextZoom };
  return { ...next, ...clampOffset(next) };
}
