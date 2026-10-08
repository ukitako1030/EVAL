import type { World } from '../compute/world';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Org colours are interpolated into style/stroke attributes, so only #rrggbb passes; anything else falls back to grey. */
function safeColor(c: unknown): string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#888';
}

function spark(values: (number | null)[], color: string, w = 260, h = 40): string {
  const pts: string[] = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - (v / 100) * h;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts.join(' ')}"/></svg>`;
}

export function renderReport(w: World): string {
  const last = w.months.length - 1;
  const sections = w.fronts
    .map((f) => {
      const units = Object.entries(w.units[f.id] ?? {});
      const rows = units
        .map(([id, u]) => {
          const series = w.series[f.id]?.[id] ?? []; // a unit can lack a series entry
          return { id, u, cell: series[last] ?? null, series };
        })
        .sort((a, b) => (b.cell?.s ?? -1) - (a.cell?.s ?? -1))
        .map(({ u, cell, series }) => {
          const color = safeColor(w.orgs[u.org]?.color);
          return `<tr><td><span class="chip" style="background:${color}"></span>${esc(u.name)}</td><td>${esc(w.orgs[u.org]?.name ?? u.org)}</td>
<td class="num">${cell ? cell.s.toFixed(1) : '—'}</td><td class="num">${cell ? cell.c.toFixed(1) : '—'}</td><td>${cell?.q ?? '—'}</td>
<td>${spark(series.map((c) => c?.s ?? null), color)}</td><td>${spark(series.map((c) => c?.c ?? null), color)}</td></tr>`;
        })
        .join('\n');
      const events = w.events
        .filter((e) => e.front === f.id)
        .map((e) => `<li><b>${e.month}</b> [${e.type}] ${esc(e.text.ja)}</li>`)
        .join('\n');
      return `<section><h2>${esc(f.name.ja)} <small>${esc(f.name.en)}</small></h2>
<table><thead><tr><th>部隊</th><th>軍</th><th>強さ</th><th>規模%</th><th>確度</th><th>強さ推移 (${w.months[0]}→${w.months[last]})</th><th>規模推移</th></tr></thead>
<tbody>${rows}</tbody></table>
<details><summary>戦況速報 (${w.events.filter((e) => e.front === f.id).length})</summary><ul>${events}</ul></details></section>`;
    })
    .join('\n');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI WAR データ確認レポート</title>
<style>
body{font-family:system-ui,'Noto Sans JP',sans-serif;background:#0b1020;color:#dfe6ff;margin:0;padding:24px}
h1{margin:0 0 4px}h2{margin:32px 0 8px}small{color:#7f8db3;font-weight:normal}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:6px 8px;border-bottom:1px solid #1c2747;text-align:left}
.num{text-align:right;font-variant-numeric:tabular-nums}.chip{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
details{margin-top:8px;color:#aab6da}
</style></head><body>
<h1>AI WAR データ確認レポート</h1>
<div>生成: ${esc(w.generatedAt)} ／ 期間: ${w.months[0]} 〜 ${w.months[last]}（${w.partialMonth} は速報値）</div>
${sections}
</body></html>
`;
}
