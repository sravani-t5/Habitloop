import { LitElement, html, css, svg } from 'lit';

export interface Bar { label: string; done: number; missed: number }

/** <hl-chart>: stacked done/missed bars (30-day trend or per-hour history). */
export class HlChart extends LitElement {
  static properties = { data: { attribute: false }, height: { type: Number }, caption: { type: String } };
  declare data: Bar[]; declare height: number; declare caption: string;
  constructor() { super(); this.data = []; this.height = 110; this.caption = ''; }
  static styles = css`:host { display: block; } svg { width: 100%; height: auto; display: block; } text { font: 10px 'DM Sans', sans-serif; fill: #5b6478; } .legend { display: flex; gap: 14px; font: 12px 'DM Sans', sans-serif; color: #5b6478; margin-top: 6px; } i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; }`;
  render() {
    const W = 600, H = this.height, n = Math.max(this.data.length, 1), bw = W / n;
    const max = Math.max(1, ...this.data.map((d) => d.done + d.missed));
    const labelEvery = n > 12 ? Math.ceil(n / 6) : 1;
    return html`<svg viewBox="0 0 ${W} ${H + 16}" role="img" aria-label=${this.caption || 'chart'}>
        <line x1="0" x2=${W} y1=${H} y2=${H} stroke="#dde2ec" />
        ${this.data.map((d, i) => {
          const hd = (d.done / max) * (H - 6), hm = (d.missed / max) * (H - 6), x = i * bw + bw * 0.15, w = bw * 0.7;
          return svg`<rect x=${x} y=${H - hd} width=${w} height=${hd} rx="1.5" fill="var(--done, #12a67a)" />
            <rect x=${x} y=${H - hd - hm} width=${w} height=${hm} rx="1.5" fill="var(--missed, #e3a008)" />
            ${i % labelEvery === 0 ? svg`<text x=${x + w / 2} y=${H + 12} text-anchor="middle">${d.label}</text>` : ''}`;
        })}
      </svg>
      <div class="legend"><span><i style="background:var(--done,#12a67a)"></i>Done</span><span><i style="background:var(--missed,#e3a008)"></i>Missed</span></div>`;
  }
}

/** <hl-ring>: the streak "loop" ring. */
export class HlRing extends LitElement {
  static properties = { value: { type: Number }, max: { type: Number }, label: { type: String } };
  declare value: number; declare max: number; declare label: string;
  constructor() { super(); this.value = 0; this.max = 7; this.label = 'day streak'; }
  static styles = css`:host { display: inline-block; } .c { position: relative; width: 150px; height: 150px; } svg { transform: rotate(-90deg); } .t { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; } b { font: 700 2.4rem 'Bricolage Grotesque', sans-serif; line-height: 1; color: #151b2d; } span { font: 13px 'DM Sans', sans-serif; color: #5b6478; margin-top: 4px; }`;
  render() {
    const r = 62, c = 2 * Math.PI * r, pct = Math.min(1, this.value / Math.max(this.max, 1));
    return html`<div class="c"><svg width="150" height="150" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r=${r} fill="none" stroke="#e8e9fd" stroke-width="14" />
        <circle cx="75" cy="75" r=${r} fill="none" stroke="var(--accent, #3b3fe0)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${c * pct} ${c}" style="transition: stroke-dasharray .6s ease" />
      </svg><div class="t"><b>${this.value}</b><span>${this.label}</span></div></div>`;
  }
}
