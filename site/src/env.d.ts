/** Build-time constants injected by vite.config.ts `define`. */

/** Paths (relative to the site base) of optional background art in public/art/, or null when absent. */
declare const __BG_ART__: { desktop: string | null; mobile: string | null };

interface ImportMetaEnv {
  /** '1' at build time (`VITE_DEBUG_HOOKS=1 npm run build`): a production build that honours the debug switches */
  readonly VITE_DEBUG_HOOKS?: string;
}
