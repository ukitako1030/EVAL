import { createRenderer } from './render/app';
import type { QualityLevel } from './fx/quality';

// Render shell only for now — data loading, HUD and the full frame loop are wired in Task 15.
const mount = document.getElementById('app');
if (mount) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  createRenderer(mount, { reducedMotion: motion.matches })
    .then((renderer) => {
      motion.addEventListener('change', (e) => renderer.setReducedMotion(e.matches));
      // debug: ?quality=0..3 pins the quality level (used by the screenshot / fps harness)
      const q = new URLSearchParams(location.search).get('quality');
      if (q === '0' || q === '1' || q === '2' || q === '3') renderer.setQuality(Number(q) as QualityLevel);
      // dev only: a handle for poking the renderer from the console / harness (--eval)
      if (import.meta.env.DEV) Object.assign(window, { __renderer: renderer });
    })
    .catch((err: unknown) => console.error('renderer failed to start', err));
}
