/**
 * The renderer must be WebGL: the dynamic meshes (./dynMesh) ship a GLSL-only shader, so a silent PixiJS fallback to
 * WebGPU or Canvas would start "fine" and draw nothing. `requireWebGL` turns that into an error the app can show
 * (main.ts: the load-error screen with the localized `webglRequired` message).
 */
import { RendererType } from 'pixi.js';

export class WebGLRequiredError extends Error {
  constructor(got: string) {
    super(`AI WAR needs WebGL; the browser gave PixiJS a ${got} renderer instead`);
    this.name = 'WebGLRequiredError';
  }
}

export function requireWebGL(renderer: { type: number; name: string }): void {
  if (renderer.type !== RendererType.WEBGL) throw new WebGLRequiredError(renderer.name || String(renderer.type));
}
