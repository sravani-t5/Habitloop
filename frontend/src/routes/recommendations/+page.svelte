<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/state.svelte';
  let busy = $state(false);

  async function analyse() {
    busy = true;
    try { await app.generateRecs(); app.notify(app.pendingRecs.length ? 'New suggestions ready' : 'No changes suggested yet'); } catch (e) { app.fail(e); }
    busy = false;
  }
  onMount(async () => { await app.loadRecs(); if (!app.pendingRecs.length) analyse(); });
  const past = $derived(app.recs.filter((r) => r.status !== 'pending'));
</script>

<div class="page-head">
  <div><h1>Recommendations</h1><p>Suggestions based on when you actually complete each habit.</p></div>
  <button class="btn" onclick={analyse} disabled={busy}>{busy ? 'Analysing…' : 'Analyse my habits'}</button>
</div>

<div class="grid cols-2">
  {#each app.pendingRecs as r (r.id)}
    <div class="panel stack">
      <div class="row"><h3>{r.activityName}</h3><span class="badge">{r.type === 'timing' ? 'Better time' : 'Weekly frequency'}</span></div>
      <div class="row" style="font:600 1.4rem var(--display)"><span class="muted">{r.currentValue}</span><span aria-label="change to">&rarr;</span><span style="color:var(--accent)">{r.suggestedValue}</span></div>
      <p>{r.rationale}</p>
      <p class="muted small">Confidence {Math.round(r.confidence * 100)}%</p>
      <div class="row">
        <button class="btn" onclick={() => app.acceptRec(r.id).catch(app.fail)}>{r.type === 'timing' ? 'Move to ' + r.suggestedValue : 'Switch to ' + r.suggestedValue}</button>
        <button class="btn quiet" onclick={() => app.dismissRec(r.id).catch(app.fail)}>Not now</button>
      </div>
    </div>
  {:else}
    <p class="empty" style="grid-column:1/-1">{busy ? 'Looking at your history…' : 'No suggestions yet. Log at least five sessions on a habit, ideally at different times of day, then analyse again.'}</p>
  {/each}
</div>

{#if past.length}
  <div class="panel" style="margin-top:20px"><h2>History</h2>
    <table><tbody>{#each past as r (r.id)}<tr><td>{r.activityName}</td><td>{r.currentValue} &rarr; {r.suggestedValue}</td><td><span class="badge {r.status === 'accepted' ? 'done' : ''}">{r.status}</span></td></tr>{/each}</tbody></table>
  </div>
{/if}
