import { minConfidence, type Confidence } from '../core/types';

export function strengthConfidence(c: { measured: number; reconstructed: number; estimated: boolean }): Confidence {
  if (c.estimated) return 'estimated';
  if (c.measured >= 2) return 'high';
  if (c.measured === 1) return 'medium';
  if (c.reconstructed > 0) return 'reconstructed';
  return 'estimated';
}

export function scaleConfidence(components: number): Confidence {
  if (components >= 2) return 'high';
  if (components === 1) return 'medium';
  return 'estimated';
}

export function unitConfidence(s: { measured: number; reconstructed: number; estimated: boolean }, scaleComponents: number): Confidence {
  return minConfidence(strengthConfidence(s), scaleConfidence(scaleComponents));
}
