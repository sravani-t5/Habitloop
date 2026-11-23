<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type LeaderRow } from '$lib/api';
  import { app } from '$lib/state.svelte';
  import { listen } from '$lib/actions';

  let openId = $state<string | null>(null);
  let board = $state<LeaderRow[]>([]); let goal = $state(0);
  let error = $state('');
  const today = new Date().toLocaleDateString('en-CA');
  const inThirty = new Date(Date.now() + 30 * 864e5).toLocaleDateString('en-CA');
  const opened = $derived(app.challenges.find((c) => c.id === openId));

  onMount(() => { app.loadChallenges(); });

  async function openBoard(id: string) {
    openId = id;
    try { const r = await api<{ goalTarget: number; leaderboard: LeaderRow[] }>(`/api/challenges/${id}/leaderboard`); board = r.leaderboard; goal = r.goalTarget; }
    catch (e) { app.fail(e); }
  }
  async function join(id: string) {
    try { await api(`/api/challenges/${id}/join`, { method: 'POST' }); await app.loadChallenges(); app.notify('You joined the challenge'); } catch (e) { app.fail(e); }
  }
  async function create(e: SubmitEvent) {
    e.preventDefault(); error = '';
    const form = e.currentTarget as HTMLFormElement; const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    try {
      await api('/api/challenges', { method: 'POST', body: { title: f.title, description: f.description, visibility: f.visibility, goalTarget: Number(f.goal), startDate: f.start, endDate: f.end } });
      form.reset(); await app.loadChallenges(); app.notify('Challenge created');
    } catch (err) { error = err instanceof Error ? err.message : 'Could not create challenge'; }
  }
  async function invite(e: SubmitEvent) {
    e.preventDefault(); const form = e.currentTarget as HTMLFormElement; const email = String(new FormData(form).get('email'));
    try { await api(`/api/challenges/${openId}/invites`, { method: 'POST', body: { email } }); form.reset(); app.notify(`Invite sent to ${email}`); } catch (err) { app.fail(err); }
  }
</script>

<div class="page-head"><div><h1>Challenges</h1><p>Compete or cheer each other on. Private challenges are invite-only.</p></div></div>

{#if app.invites.length}
  <div class="panel" style="margin-bottom:16px">
    <h2>Invitations</h2>
    {#each app.invites as inv (inv.id)}
      <div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)">
        <span><b>{inv.title}</b> <span class="muted small">from {inv.invitedBy}, {inv.startDate} to {inv.endDate}</span></span>
        <span class="row"><button class="btn" onclick={() => app.acceptInvite(inv.id).catch(app.fail)}>Accept</button><button class="btn quiet" onclick={() => app.declineInvite(inv.id).catch(app.fail)}>Decline</button></span>
      </div>
    {/each}
  </div>
{/if}

<div class="grid cols-2">
  <section class="stack">
    <h2>Challenge feed</h2>
    {#each app.challenges as challenge (challenge.id)}
      <hl-challenge-card {challenge} use:listen={{ 'hl-join': (e) => join(e.detail), 'hl-open': (e) => openBoard(e.detail) }}></hl-challenge-card>
    {:else}<p class="empty">Nothing here yet. Start the first challenge for your organization.</p>{/each}
  </section>
  <section class="stack">
    {#if opened}
      <div class="panel">
        <h2>{opened.title}: leaderboard</h2>
        {#each board as row, i (row.userId)}
          <div style="padding:8px 0"><div class="row" style="justify-content:space-between"><span>{i + 1}. {row.name}</span><span class="muted small">{row.done} of {goal} sessions</span></div>
            <div class="bar"><i style="width:{row.progressPct}%"></i></div></div>
        {/each}
        {#if opened.ownerId === app.user?.id}
          <form class="row" style="margin-top:14px" onsubmit={invite}>
            <label style="flex:1">Invite by email<input name="email" type="email" required /></label><button class="btn" style="align-self:end">Send invite</button>
          </form>
        {/if}
      </div>
    {/if}
    <form class="panel form" onsubmit={create}>
      <h2>Start a challenge</h2>
      <label>Title<input name="title" required maxlength="120" placeholder="November fitness sprint" /></label>
      <label>Description<input name="description" maxlength="500" /></label>
      <div class="row">
        <label>Who can join<select name="visibility"><option value="public">Everyone in my organization</option><option value="private">Invite only</option></select></label>
        <label>Goal (sessions)<input name="goal" type="number" min="1" value="20" required /></label>
      </div>
      <div class="row"><label>Starts<input name="start" type="date" value={today} required /></label><label>Ends<input name="end" type="date" value={inThirty} required /></label></div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="btn">Create challenge</button>
    </form>
  </section>
</div>
