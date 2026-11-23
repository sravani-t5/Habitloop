import { HlChart, HlRing } from './charts';
import { HlActivitySummary, HlChallengeCard, HlPartnerTile } from './cards';

const defs: [string, CustomElementConstructor][] = [
  ['hl-chart', HlChart], ['hl-ring', HlRing], ['hl-activity-summary', HlActivitySummary],
  ['hl-challenge-card', HlChallengeCard], ['hl-partner-tile', HlPartnerTile]
];
for (const [name, ctor] of defs) if (!customElements.get(name)) customElements.define(name, ctor);
