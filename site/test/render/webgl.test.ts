import { describe, it, expect } from 'vitest';
import { RendererType } from 'pixi.js';
import { WebGLRequiredError, requireWebGL } from '../../src/render/webgl';

describe('requireWebGL', () => {
  it('accepts the WebGL renderer', () => {
    expect(() => requireWebGL({ type: RendererType.WEBGL, name: 'webgl' })).not.toThrow();
  });
  it('refuses a silent fallback to WebGPU or Canvas with a WebGLRequiredError', () => {
    for (const r of [
      { type: RendererType.WEBGPU, name: 'webgpu' },
      { type: RendererType.CANVAS, name: 'canvas' },
    ]) {
      let err: unknown = null;
      try {
        requireWebGL(r);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WebGLRequiredError);
      expect((err as Error).message).toContain(r.name);
    }
  });
});
