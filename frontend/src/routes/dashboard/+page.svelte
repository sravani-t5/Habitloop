<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/state.svelte';
  import { listen } from '$lib/actions';

  // Dynamic dashboard: refresh on load and every 5s, so wearable events show up without a reload.
  onMount(() => {
    app.refreshDashboard();
    const t = setInterval(app.refreshDashboard, 5000);
    return () => clearInterval(t);
  });

  const trend = $derived((app.summary?.trend ?? []).map((d) => ({ label: d.day.slice(5), done: d.done, missed: d.missed })));
  const hours = $derived((app.summary?.byHour ?? []).map((h) => ({ label: `${h.hour}h`, done: h.done, missed: h.missed })));
  let error = $state('');

  async function createHabit(e: SubmitEvent) {
    e.preventDefault(); error = '';
    const form = e.currentTarget as HTMLFormElement; const f = new FormData(form);
    try {
      await app.createHabit({ name: String(f.get('name')), scheduledTime: String(f.get('time')), frequencyPerWeek: Number(f.get('perWeek')) });
      form.reset();
    } catch (err) { error = err instanceof Error ? err.message : 'Could not create habit'; }
  }
</script>

<div class="page-head">
  <div><h1>Hi {app.user?.name.split(' ')[0]}</h1><p>Organization ID for teammates: <code>{app.user?.tenantId}</code></p></div>
</div>

<div class="panel hero" style="margin-bottom:16px">
  <hl-ring value={app.summary?.currentStreak ?? 0} max={Math.max(7, app.summary?.longestStreak ?? 7)} label="day streak"></hl-ring>
  <div class="stack" style="flex:1;min-width:260px">
    <div class="stats">
      <div class="stat"><b>{app.summary?.completionRate ?? 0}%</b><span>completion rate</span></div>
      <div class="stat"><b>{app.summary?.totalDone ?? 0}</b><span>sessions done</span></div>
      <div class="stat"><b>{app.summary?.totalMissed ?? 0}</b><span>missed</span></div>
      <div class="stat"><b>{app.summary?.longestStreak ?? 0}</b><span>longest streak</span></div>
    </div>
    <hl-chart data={trend} caption="Last 30 days"></hl-chart>
  </div>
</div>

<div class="grid cols-2">
  <section class="stack">
    <h2>Your habits</h2>
    {#each app.habits as habit (habit.id)}
      <hl-activity-summary {habit} use:listen={{ 'hl-log': (e) => app.logHabit(e.detail.id, e.detail.status) }}></hl-activity-summary>
    {:else}
      <p class="empty">No habits yet. Add your first one and log it when you're done.</p>
    {/each}
  </section>
  <section class="stack">
    <form class="panel form" onsubmit={createHabit}>
      <h2>Add a habit</h2>
      <label>Name<input name="name" placeholder="Morning run" required maxlength="100" /></label>
      <div class="row">
        <label>Planned time<input name="time" type="time" value="07:00" required /></label>
        <label>Times per week<input name="perWeek" type="number" min="1" max="7" value="5" required /></label>
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="btn">Add habit</button>
    </form>
    <div class="panel">
      <h2>When you get things done</h2>
      {#if hours.length}<hl-chart data={hours} caption="Completions by hour"></hl-chart>
      {:else}<p class="muted">Log a few sessions and your best times of day will show up here.</p>{/if}
    </div>
  </section>
</div>
