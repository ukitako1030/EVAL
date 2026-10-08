import type { Lang, World } from '../data/types';
import { orgDeployment, orgDeploymentFrom, type FrameSource, type OrgDeployment } from '../data/timeline';
import { FRONT_SHORT, tr } from '../i18n/strings';
import type { AppState, Store } from '../state/store';
import { frontName, h, setAccent, setAttr, setText, srOnly, uid } from './dom';

export interface Deployment {
  el: HTMLElement;
  update(state: AppState): void;
  destroy(): void;
}

/** Changes only when an org's order or its set of fronts changes, so the table is rebuilt at most once per month boundary. */
const signature = (ds: OrgDeployment[]): string => ds.map((d) => `${d.org}:${d.fronts.join(',')}`).join('|');

/**
 * Deployment matrix: one row per org (from `orgDeployment(world, t)`), one column per front, a filled cell where the org
 * has a unit. Hovering a row → `hoverOrg` (keyboard users get the same highlight from the ranking rows).
 * `opts.frames` shares the app's per-frame `frontFrame`s (main.ts); without it the matrix computes its own.
 */
export function createDeployment(root: HTMLElement, world: World, store: Store<AppState>, opts: { frames?: FrameSource } = {}): Deployment {
  const deploymentAt = (s: AppState): OrgDeployment[] => (opts.frames ? orgDeploymentFrom(world, opts.frames(s.t, s.sortBy)) : orgDeployment(world, s.t));
  const titleId = uid('deploy-title');
  const titleEl = h('h2', { id: titleId, class: 'hud-h' });
  const headOrg = h('th', { class: 'deploy-org', attrs: { scope: 'col' } });
  const headFronts = world.fronts.map((f) => ({ id: f.id, abbr: h('abbr'), th: h('th', { attrs: { scope: 'col' } }) }));
  for (const hf of headFronts) hf.th.appendChild(hf.abbr);
  const headCount = h('th', { class: 'deploy-count', attrs: { scope: 'col' } });
  const tbody = h('tbody');
  const table = h('table', { class: 'deploy-table', attrs: { 'aria-labelledby': titleId } }, [
    h('thead', {}, [h('tr', {}, [headOrg, ...headFronts.map((x) => x.th), headCount])]),
    tbody,
  ]);
  const el = h('section', { class: 'deployment', attrs: { 'aria-labelledby': titleId } }, [titleEl, table]);
  root.appendChild(el);

  let lang: Lang | null = null;
  let sig = '';
  let rows = new Map<string, HTMLTableRowElement>();

  function build(ds: OrgDeployment[], l: Lang): void {
    rows = new Map();
    tbody.replaceChildren(
      ...ds.map((d) => {
        const tr_ = h('tr', { class: 'deploy-row', attrs: { 'data-org': d.org } }, [
          h('th', { class: 'deploy-org', attrs: { scope: 'row' } }, [h('i', { class: 'deploy-dot', attrs: { 'aria-hidden': 'true' } }), d.name]),
          ...world.fronts.map((f) => {
            const on = d.fronts.includes(f.id);
            return h('td', { class: on ? 'deploy-cell on' : 'deploy-cell', attrs: { 'data-front': f.id } }, [on ? srOnly(tr('deployed', l)) : null]);
          }),
          h('td', { class: 'deploy-count' }, [String(d.fronts.length)]),
        ]);
        setAccent(tr_, d.color);
        const on = () => store.set({ hoverOrg: d.org });
        const off = () => {
          if (store.get().hoverOrg === d.org) store.set({ hoverOrg: null });
        };
        tr_.addEventListener('pointerenter', on);
        tr_.addEventListener('pointerleave', off);
        rows.set(d.org, tr_);
        return tr_;
      }),
    );
  }

  function relabel(l: Lang): void {
    setText(titleEl, tr('deployment', l));
    setText(headOrg, tr('faction', l));
    setText(headCount, tr('frontsCount', l));
    for (const hf of headFronts) {
      setText(hf.abbr, FRONT_SHORT[hf.id][l]);
      setAttr(hf.abbr, 'title', frontName(world, hf.id, l));
    }
  }

  function update(state: AppState): void {
    const ds = deploymentAt(state);
    const s = signature(ds);
    if (state.lang !== lang || s !== sig) {
      if (state.lang !== lang) relabel(state.lang);
      lang = state.lang;
      sig = s;
      build(ds, state.lang);
    }
    for (const [org, row] of rows) row.classList.toggle('dim', state.hoverOrg !== null && state.hoverOrg !== org);
  }

  const unsubscribe = store.subscribe((s) => update(s));
  update(store.get());

  return {
    el,
    update,
    destroy() {
      unsubscribe();
      el.remove();
    },
  };
}
