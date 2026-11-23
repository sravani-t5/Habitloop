<script lang="ts">
  import { app } from '$lib/state.svelte';
  let mode = $state<'signup' | 'login'>('signup');
  let org = $state<'create' | 'join'>('create');
  let error = $state(''); let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault(); error = ''; busy = true;
    const f = Object.fromEntries(new FormData(e.currentTarget as HTMLFormElement)) as Record<string, string>;
    try {
      if (mode === 'login') await app.authenticate('login', { email: f.email, password: f.password });
      else await app.authenticate('signup', { email: f.email, password: f.password, name: f.name, ...(org === 'create' ? { tenantName: f.organization } : { tenantId: f.organization.trim() }) });
    } catch (err) { error = err instanceof Error ? err.message : 'Could not continue'; }
    busy = false;
  }
</script>

<div style="max-width:440px;margin:72px auto 0">
  <h1>Build habits you keep, together</h1>
  <p class="muted" style="margin:10px 0 24px">Track habits, join challenges with your team, and let your devices log sessions for you.</p>
  <div class="panel">
    <div class="row" style="margin-bottom:16px">
      <button class="btn {mode === 'signup' ? '' : 'quiet'}" onclick={() => (mode = 'signup')}>Create account</button>
      <button class="btn {mode === 'login' ? '' : 'quiet'}" onclick={() => (mode = 'login')}>Sign in</button>
    </div>
    <form class="form" onsubmit={submit}>
      {#if mode === 'signup'}
        <label>Your name<input name="name" required autocomplete="name" /></label>
      {/if}
      <label>Email<input name="email" type="email" required autocomplete="email" /></label>
      <label>Password<input name="password" type="password" required minlength="8" autocomplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
      {#if mode === 'signup'}
        <div class="row">
          <button type="button" class="btn {org === 'create' ? 'ghost' : 'quiet'}" onclick={() => (org = 'create')}>New organization</button>
          <button type="button" class="btn {org === 'join' ? 'ghost' : 'quiet'}" onclick={() => (org = 'join')}>Join existing</button>
        </div>
        <label>{org === 'create' ? 'Organization name' : 'Organization ID (ask your admin)'}<input name="organization" required /></label>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="btn" disabled={busy}>{mode === 'signup' ? 'Create account' : 'Sign in'}</button>
    </form>
  </div>
</div>
