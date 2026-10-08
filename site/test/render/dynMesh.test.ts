// @vitest-environment jsdom
// (PixiJS probes a canvas for the shader precision when the mesh's GlProgram is built; jsdom has no WebGL, which is fine)
import { describe, it, expect } from 'vitest';
import type { Buffer } from 'pixi.js';
import { createDynMesh } from '../../src/render/dynMesh';
import { fillRect, rgba, strokeSegment } from '../../src/render/meshBuild';
import { fillStep } from '../../src/render/planetDraw';

const buffer = (d: ReturnType<typeof createDynMesh>, name: string) => d.mesh.geometry.getBuffer(name) as Buffer;

describe('dynamic mesh', () => {
  it('draws nothing until filled, then exactly the triangles written', () => {
    const d = createDynMesh({ verts: 4, indices: 6 });
    expect(d.mesh.geometry.indexCount).toBe(3); // one degenerate triangle of the zeroed index buffer
    d.begin();
    fillRect(d.buf, 0, 0, 2, 2, rgba(0xff0000, 1));
    strokeSegment(d.buf, 0, 0, 5, 5, 1, rgba(0x00ff00, 0.5));
    d.end();
    expect(d.mesh.geometry.indexCount).toBe(12);
    expect(d.buf.nv).toBe(8);
    // a frame with nothing in it falls back to the degenerate triangle (indexCount 0 would draw the whole buffer)
    d.begin();
    d.end();
    expect(d.mesh.geometry.indexCount).toBe(3);
    expect(Array.from(d.buf.idx.subarray(0, 3))).toEqual([0, 0, 0]);
  });

  it('hands grown arrays to the GPU buffers', () => {
    const d = createDynMesh({ verts: 4, indices: 6 });
    d.begin();
    for (let i = 0; i < 40; i++) fillRect(d.buf, i, 0, 1, 1, rgba(0xffffff, 1));
    d.end();
    expect(d.buf.grew).toBe(false);
    expect(buffer(d, 'aPosition').data).toBe(d.buf.pos);
    expect(buffer(d, 'aColor').data).toBe(d.buf.col);
    expect(d.mesh.geometry.indexBuffer.data).toBe(d.buf.idx);
    expect(d.mesh.geometry.indexCount).toBe(240);
  });

  it('rescales vertex alphas of a range from the kept colours', () => {
    const d = createDynMesh();
    d.begin();
    fillRect(d.buf, 0, 0, 1, 1, rgba(0x123456, 0.8));
    fillRect(d.buf, 2, 0, 1, 1, rgba(0x654321, 1));
    d.end();
    d.keepColors();
    d.setAlpha(0, 4, 0.5);
    d.flushColors();
    expect(d.buf.col[0] >>> 24).toBe(Math.round(204 * 0.5));
    expect(d.buf.col[0] & 0xffffff).toBe(rgba(0x123456, 0.8) & 0xffffff);
    expect(d.buf.col[4]).toBe(rgba(0x654321, 1)); // other ranges untouched
    // repeated fades start from the kept colours, not from the last fade
    d.setAlpha(0, 4, 1);
    expect(d.buf.col[0]).toBe(rgba(0x123456, 0.8));
    d.destroy();
  });
});

describe('territory fill step', () => {
  it('is the original 0.08 rad on big planets and coarser on small ones, within 0.25 px of the rim circle', () => {
    expect(fillStep(400)).toBe(0.08);
    expect(fillStep(60)).toBeGreaterThan(0.08);
    for (const sr of [20, 60, 95, 140, 250, 600]) {
      const d = fillStep(sr);
      expect(sr * (1 - Math.cos(d / 2))).toBeLessThanOrEqual(Math.max(0.25, sr * (1 - Math.cos(0.04))) + 1e-9);
    }
    expect(Number.isFinite(fillStep(0))).toBe(true);
  });
});
