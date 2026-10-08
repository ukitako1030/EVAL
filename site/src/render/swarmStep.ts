/**
 * One simulation step of the swarm battle (mockup C `stepParticles`): keep the swarms at their target sizes,
 * rebuild the spatial hash, then move every particle — cohesion to its squad plus a swirl around it, raids on
 * enemy swarms, a noise field, boids alignment / separation with friends, strength-weighted push and pull with
 * enemies (the stronger side leans into the weaker one) and clashes at close range — and finally smooth the
 * swarm centroids. Typed arrays only: no allocation in the loop.
 */
import { ALIVE, DEAD, FADING, FREE, HIT_RATE, MAX_SQUADS, MAX_UNITS, RHO_MAX, RHO_MIN } from './swarmMath';
import { clash, enforceCounts, placeSquads, release, spawn, type SwarmCore } from './swarmCore';

export function stepSwarm(c: SwarmCore, dt: number, time: number, reduced: boolean): void {
  c.clashes.n = 0;
  if (!(dt > 0)) return;
  const { N, x, y, vx, vy, alpha, life, charge, seed, squad, state, owner, tgt, units, nSq, sig, sqX, sqY, raid, count, sumX, sumY, ccInit, t1, t2, coef, hash, hasSector } = c;
  const M = MAX_UNITS;
  const rnd = c.rnd;
  placeSquads(c, time);
  enforceCounts(c);
  for (let s = 0; s < M; s++) {
    sumX[s] = 0;
    sumY[s] = 0;
    units.alive[s] = 0;
    count[s] = 0;
    if (units.warpT[s] > 0) units.warpT[s] = Math.max(0, units.warpT[s] - dt);
  }
  // neighbour radius ≈ 1.5 × the mean particle spacing; the grid cell equals it
  let live = 0;
  for (let i = 0; i < N; i++) if (state[i] === ALIVE) live++;
  const G = Math.max(6, Math.floor(2 / (1.5 * Math.sqrt(Math.PI / Math.max(60, live)))));
  hash.setGrid(G);
  const rn = 2 / G;
  hash.build(x, y, state, ALIVE, N);
  const { start, items, cellOf } = hash;
  const speedK = reduced ? 0.25 : 1;
  const steer = 1 - Math.exp(-3.4 * dt);
  const fadeDrag = Math.exp(-2 * dt);
  const pHit = 1 - Math.exp(-HIT_RATE * (reduced ? 0.15 : 1) * dt);
  const rn2 = rn * rn;
  const rs = rn * 0.42;
  const rs2 = rs * rs;
  const rh = rn * 0.36;
  const rh2 = rh * rh;
  const irn = 1 / rn;
  const rMin2 = RHO_MIN * RHO_MIN;
  const rMax2 = RHO_MAX * RHO_MAX;
  let visible = 0;

  for (let i = 0; i < N; i++) {
    const st = state[i];
    if (st === FREE) continue;
    const f = owner[i];
    if (st === DEAD) {
      count[f]++;
      life[i] -= dt;
      if (life[i] <= 0) {
        if (units.present[f] && hasSector[f]) spawn(c, i, f);
        else {
          release(c, i);
          count[f]--;
        }
      }
      continue;
    }
    if (st === FADING) {
      const al = alpha[i] - dt * 1.7;
      if (al <= 0) {
        release(c, i);
        continue;
      }
      alpha[i] = al;
      vx[i] *= fadeDrag;
      vy[i] *= fadeDrag;
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      visible++;
      continue;
    }

    // ---- alive ----
    count[f]++;
    units.alive[f]++;
    visible++;
    let px = x[i];
    let py = y[i];
    sumX[f] += px;
    sumY[f] += py;
    if (alpha[i] < 1) alpha[i] = Math.min(1, alpha[i] + dt * 1.5);
    const vmax = units.vmax[f] * speedK;
    let dvx = 0;
    let dvy = 0;
    let lim = 1.15;

    // the particle's squad in the home sector (follows the animated territory edges)
    const q = squad[i] % nSq[f];
    let hx = sqX[f * MAX_SQUADS + q] - px;
    let hy = sqY[f * MAX_SQUADS + q] - py;
    const hd = Math.sqrt(hx * hx + hy * hy) + 1e-6;
    hx /= hd;
    hy /= hd;
    const rel = hd / sig[f];

    let chg = charge[i];
    if (chg > 0) {
      chg -= dt;
      const e = tgt[i];
      if (chg <= 0 || !units.present[e]) charge[i] = 0;
      else {
        const tx = units.cx[e] - px;
        const ty = units.cy[e] - py;
        const td = Math.sqrt(tx * tx + ty * ty) + 1e-6;
        if (td < 0.05) charge[i] = 0;
        else {
          charge[i] = chg;
          dvx += (tx / td) * vmax * 1.7;
          dvy += (ty / td) * vmax * 1.7;
          lim = 1.8;
        }
      }
    }
    if (charge[i] <= 0) {
      // cohesion to the squad + a swirl around it (neighbouring squads turn opposite ways)
      const pull = rel < 1 ? 0.14 * rel : 0.14 + (rel - 1) * 1.6;
      const pm = (pull > 2.4 ? 2.4 : pull) * vmax;
      dvx += hx * pm;
      dvy += hy * pm;
      const sw = vmax * 0.8 * (rel < 1 ? rel : 1 / rel) * ((q + f) & 1 ? 1 : -1);
      dvx -= hy * sw;
      dvy += hx * sw;
      // raids: aggression ∝ strength
      if (!reduced && raid[f] > 0 && t1[f] >= 0 && alpha[i] > 0.9 && rnd() < raid[f] * dt) {
        charge[i] = 0.9 + rnd() * 1.5;
        tgt[i] = rnd() < 0.7 ? t1[f] : t2[f];
      }
    }
    // noise field (organic wobble)
    const sd = seed[i];
    const na = Math.sin(px * 4.7 + time * 0.31 + sd * 9) * 2.6 + Math.cos(py * 4.1 - time * 0.27 + sd * 5) * 2.6;
    const nz = vmax * 0.38;
    dvx += Math.cos(na) * nz;
    dvy += Math.sin(na) * nz;

    // neighbours: alignment + separation with friends, push / pull and clashes with enemies
    const cl = cellOf[i];
    const gx = cl % G;
    const gy = (cl / G) | 0;
    const myAl = alpha[i];
    const cb = f * M;
    let sepx = 0;
    let sepy = 0;
    let alx = 0;
    let aly = 0;
    let aln = 0;
    let enx = 0;
    let eny = 0;
    let killed = false;
    const yA = gy > 0 ? gy - 1 : 0;
    const yB = gy < G - 1 ? gy + 1 : G - 1;
    const xA = gx > 0 ? gx - 1 : 0;
    const xB = gx < G - 1 ? gx + 1 : G - 1;
    for (let yy = yA; yy <= yB && !killed; yy++) {
      for (let xx = xA; xx <= xB; xx++) {
        const cell = yy * G + xx;
        for (let k = start[cell], e = start[cell + 1]; k < e; k++) {
          const j = items[k];
          if (j === i || state[j] !== ALIVE) continue;
          const ddx = px - x[j];
          const ddy = py - y[j];
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 > rn2 || d2 < 1e-12) continue;
          if (owner[j] === f) {
            alx += vx[j];
            aly += vy[j];
            aln++;
            if (d2 < rs2) {
              const d = Math.sqrt(d2);
              const w = (rs - d) / (rs * d);
              sepx += ddx * w;
              sepy += ddy * w;
            }
          } else {
            const net = coef[cb + owner[j]] * (1 / Math.sqrt(d2) - irn);
            enx += ddx * net;
            eny += ddy * net;
            if (d2 < rh2 && myAl > 0.6 && alpha[j] > 0.6 && rnd() < pHit && clash(c, i, j) === i) {
              killed = true;
              break;
            }
          }
        }
        if (killed) break;
      }
    }
    if (killed) {
      units.alive[f]--;
      sumX[f] -= px;
      sumY[f] -= py;
      visible--;
      continue;
    }
    if (aln > 0) {
      dvx += (alx / aln) * 0.35;
      dvy += (aly / aln) * 0.35;
    }
    dvx += sepx * vmax * 0.9 + enx * vmax * 0.7;
    dvy += sepy * vmax * 0.9 + eny * vmax * 0.7;

    // soft walls: the rim and the planet core
    const r2 = px * px + py * py;
    if (r2 > rMax2 * 0.94) {
      const r = Math.sqrt(r2);
      const k = (r - RHO_MAX * 0.97) * 25 * vmax;
      dvx -= (px / r) * k;
      dvy -= (py / r) * k;
    } else if (r2 < rMin2 * 1.3) {
      const r = Math.sqrt(r2) + 1e-6;
      const k = (RHO_MIN * 1.14 - r) * 25 * vmax;
      dvx += (px / r) * k;
      dvy += (py / r) * k;
    }

    const dm = Math.sqrt(dvx * dvx + dvy * dvy);
    const mx = vmax * lim;
    if (dm > mx) {
      dvx *= mx / dm;
      dvy *= mx / dm;
    }
    let nvx = vx[i] + (dvx - vx[i]) * steer;
    let nvy = vy[i] + (dvy - vy[i]) * steer;
    px += nvx * dt;
    py += nvy * dt;
    const rr = px * px + py * py;
    if (rr > rMax2 || rr < rMin2) {
      // hard walls: back inside, bounce the radial velocity
      const r = Math.sqrt(rr) + 1e-9;
      const nx = px / r;
      const ny = py / r;
      const wall = rr > rMax2 ? RHO_MAX : RHO_MIN;
      px = nx * wall;
      py = ny * wall;
      const vr = nvx * nx + nvy * ny;
      if ((rr > rMax2 && vr > 0) || (rr < rMin2 && vr < 0)) {
        nvx -= vr * nx * 1.6;
        nvy -= vr * ny * 1.6;
      }
    }
    if (px !== px || py !== py || nvx !== nvx || nvy !== nvy) {
      spawn(c, i, f); // never let a NaN (bad input data) poison the centroids: start over at home
      continue;
    }
    x[i] = px;
    y[i] = py;
    vx[i] = nvx;
    vy[i] = nvy;
  }
  c.visible = visible;

  // smoothed centroids
  const kS = 1 - Math.exp(-dt * 5);
  for (let s = 0; s < M; s++) {
    const n = units.alive[s];
    if (n > 0) {
      const tx = sumX[s] / n;
      const ty = sumY[s] / n;
      if (!ccInit[s]) {
        units.cx[s] = tx;
        units.cy[s] = ty;
        ccInit[s] = 1;
      } else {
        units.cx[s] += (tx - units.cx[s]) * kS;
        units.cy[s] += (ty - units.cy[s]) * kS;
      }
    } else if (!units.present[s]) ccInit[s] = 0;
  }
}
