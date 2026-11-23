<script lang="ts">
  import { onMount } from 'svelte';
  import { api, BASE } from '$lib/api';
  import { app } from '$lib/state.svelte';
  import { listen } from '$lib/actions';

  let newToken = $state<{ provider: string; token: string } | null>(null);
  let simId = $state(''); let simType = $state('steps'); let simValue = $state(8000);
  let error = $state('');
  const tokenKey = (id: string) => `habitloop.device.${id}`;

  onMount(() => {
    app.loadIntegrations();
    const t = setInterval(app.loadIntegrations, 4000); // event status changes RECEIVED -> PROCESSED asynchronously
    return () => clearInterval(t);
  });
  $effect(() => { if (!simId && app.integrations.length) simId = app.integrations[0].id; });

  async function connect(e: SubmitEvent) {
    e.preventDefault(); error = '';
    const form = e.currentTarget as HTMLFormElement; const f = new FormData(form);
    try {
      const r = await api<{ id: string; provider: string; deviceToken: string }>('/api/integrations', { method: 'POST', body: { provider: String(f.get('provider')), deviceLabel: String(f.get('label')) } });
      localStorage.setItem(tokenKey(r.id), r.deviceToken); // demo only: lets the simulator below act as the device
      newToken = { provider: r.provider, token: r.deviceToken }; form.reset(); await app.loadIntegrations();
    } catch (err) { error = err instanceof Error ? err.message : 'Could not connect'; }
  }
  async function disconnect(id: string) {
    try { await api(`/api/integrations/${id}`, { method: 'DELETE' }); localStorage.removeItem(tokenKey(id)); await app.loadIntegrations(); app.notify('Disconnected'); } catch (e) { app.fail(e); }
  }
  // Acts as the wearable: calls the public ingestion endpoint with the device token (no user login).
  async function simulate() {
    const token = localStorage.getItem(tokenKey(simId));
    if (!token) return app.notify('This browser does not hold that device token. Reconnect the device.');
    try {
      const body = { eventId: crypto.randomUUID(), type: simType, value: Number(simValue), timestamp: new Date().toISOString() };
      await api('/api/integrations/events', { method: 'POST', body, headers: { 'x-device-token': token }, auth: false });
      app.notify('Event sent. Watch its status below.'); await app.loadIntegrations();
    } catch (e) { app.fail(e); }
  }
  const badge = (s: string) => (s === 'PROCESSED' ? 'done' : s === 'REJECTED' ? 'bad' : '');
</script>

<div class="page-head"><div><h1>Integrations</h1><p>Connect a wearable or partner app and sessions log themselves.</p></div></div>

<div class="grid cols-2">
  <section class="stack">
    <h2>Connected devices</h2>
    {#each app.integrations as integration (integration.id)}
      <hl-partner-tile {integration} use:listen={{ 'hl-disconnect': (e) => disconnect(e.detail) }}></hl-partner-tile>
    {:else}<p class="empty">No devices connected yet.</p>{/each}
  </section>
  <section class="stack">
    <form class="panel form" onsubmit={connect}>
      <h2>Connect a device</h2>
      <div class="row">
        <label>Provider<select name="provider"><option>FitBand</option><option>StepTracker</option><option>ZenWatch</option></select></label>
        <label>Label<input name="label" placeholder="My wrist band" /></label>
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="btn">Connect</button>
    </form>
    {#if newToken}
      <div class="panel stack">
        <h3>{newToken.provider} connected. Copy this device token now.</h3>
        <p class="muted small">It is shown once. Your device sends it in the <code>x-device-token</code> header to <code>{BASE || location.origin}/api/integrations/events</code>.</p>
        <div class="token">{newToken.token}</div>
      </div>
    {/if}
    <div class="panel form">
      <h2>Send a test event</h2>
      <p class="muted small">Acts like your device. A matching habit (for example one named "Steps" or "Workout") gets logged automatically.</p>
      <div class="row">
        <label>Device<select bind:value={simId}>{#each app.integrations as i}<option value={i.id}>{i.provider} {i.deviceLabel}</option>{/each}</select></label>
        <label>Type<select bind:value={simType}><option>steps</option><option>workout</option><option>sleep</option><option>meditation</option></select></label>
        <label>Value<input type="number" min="0" bind:value={simValue} /></label>
      </div>
      <button class="btn" onclick={simulate} disabled={!app.integrations.length}>Send event</button>
    </div>
  </section>
</div>

<div class="panel" style="margin-top:16px">
  <h2>Recent events</h2>
  {#if app.events.length}
    <table><thead><tr><th>Received</th><th>Type</th><th>Value</th><th>Status</th><th>Note</th></tr></thead><tbody>
      {#each app.events as ev (ev.id)}
        <tr><td>{new Date(ev.receivedAt).toLocaleTimeString()}</td><td>{ev.payload.type}</td><td>{ev.payload.value}</td><td><span class="badge {badge(ev.status)}">{ev.status}</span></td><td class="muted small">{ev.error ?? ''}</td></tr>
      {/each}</tbody></table>
  {:else}<p class="muted">Events from your devices will appear here.</p>{/if}
</div>
