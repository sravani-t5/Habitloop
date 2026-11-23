import { LitElement, html, css } from 'lit';

const base = css`:host { display: block; font-family: 'DM Sans', sans-serif; color: #151b2d; } .card { background: #fff; border: 1px solid #dde2ec; border-radius: 10px; padding: 16px; display: grid; gap: 10px; height: 100%; box-sizing: border-box; }
  h3 { margin: 0; font: 600 1.05rem 'Bricolage Grotesque', sans-serif; } .m { color: #5b6478; font-size: .85rem; } .r { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  button { font: 600 .82rem 'DM Sans', sans-serif; padding: 7px 12px; border-radius: 8px; border: 1px solid #dde2ec; background: #fff; cursor: pointer; color: #151b2d; }
  button:hover { background: #f2f4f9; } button:focus-visible { outline: 2px solid #3b3fe0; outline-offset: 2px; }
  button.p { background: #3b3fe0; border-color: #3b3fe0; color: #fff; } button.p:hover { filter: brightness(1.1); }
  .tag { font-size: .72rem; font-weight: 600; padding: 2px 9px; border-radius: 99px; background: #e8e9fd; color: #3b3fe0; } .tag.g { background: #dcf5ec; color: #0c7a59; }
  .bar { height: 8px; border-radius: 99px; background: #f2f4f9; overflow: hidden; } .bar i { display: block; height: 100%; background: #12a67a; }`;
const fire = (el: HTMLElement, name: string, detail: unknown) => el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));

/** <hl-activity-summary>: one habit with 7-day progress and quick-log buttons. Fires `hl-log`. */
export class HlActivitySummary extends LitElement {
  static properties = { habit: { attribute: false } };
  declare habit: any;
  static styles = base;
  render() {
    const h = this.habit; if (!h) return html``;
    const pct = Math.min(100, Math.round((h.done7d / Math.max(h.frequencyPerWeek, 1)) * 100));
    return html`<div class="card">
      <div class="r"><h3>${h.name}</h3><span class="tag">${h.scheduledTime}</span></div>
      <div class="m">${h.done7d} of ${h.frequencyPerWeek} sessions this week${h.missed7d ? html` · ${h.missed7d} missed` : ''}</div>
      <div class="bar" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <div class="r">
        <button class="p" @click=${() => fire(this, 'hl-log', { id: h.id, status: 'done' })}>Mark done</button>
        <button @click=${() => fire(this, 'hl-log', { id: h.id, status: 'completed' })}>Completed</button>
        <button @click=${() => fire(this, 'hl-log', { id: h.id, status: 'missed' })}>Missed</button>
      </div></div>`;
  }
}

/** <hl-challenge-card>: fires `hl-join` and `hl-open`. */
export class HlChallengeCard extends LitElement {
  static properties = { challenge: { attribute: false } };
  declare challenge: any;
  static styles = base;
  render() {
    const c = this.challenge; if (!c) return html``;
    return html`<div class="card">
      <div class="r"><h3>${c.title}</h3><span class="tag">${c.visibility}</span>${c.joined ? html`<span class="tag g">joined</span>` : ''}</div>
      <div class="m">${c.description || 'No description'}</div>
      <div class="m">${c.startDate} to ${c.endDate} · goal ${c.goalTarget} sessions · ${c.participants} people · by ${c.ownerName}</div>
      <div class="r">
        ${!c.joined && c.visibility === 'public' ? html`<button class="p" @click=${() => fire(this, 'hl-join', c.id)}>Join challenge</button>` : ''}
        ${c.joined ? html`<button @click=${() => fire(this, 'hl-open', c.id)}>View leaderboard</button>` : ''}
      </div></div>`;
  }
}

/** <hl-partner-tile>: a connected wearable / partner app. Fires `hl-disconnect`. */
export class HlPartnerTile extends LitElement {
  static properties = { integration: { attribute: false } };
  declare integration: any;
  static styles = base;
  render() {
    const i = this.integration; if (!i) return html``;
    return html`<div class="card">
      <div class="r"><h3>${i.provider}</h3><span class="tag g">${i.status}</span></div>
      <div class="m">${i.deviceLabel || 'Unnamed device'} · ${i.events} events received</div>
      <div class="r"><button @click=${() => fire(this, 'hl-disconnect', i.id)}>Disconnect</button></div></div>`;
  }
}
