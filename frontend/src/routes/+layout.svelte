<script lang="ts">
  import '../app.css';
  import '$lib/components';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { app } from '$lib/state.svelte';
  let { children } = $props();

  onMount(() => { app.init(); });
  const path = $derived(page.url.pathname);
  $effect(() => {
    if (!app.ready) return;
    const onboarding = path.startsWith('/onboarding');
    if (!app.user && !onboarding) goto('/onboarding');
    else if (app.user && (onboarding || path === '/')) goto('/dashboard');
  });
  const links = [['/dashboard', 'Dashboard'], ['/challenges', 'Challenges'], ['/integrations', 'Integrations'], ['/recommendations', 'Recommendations']];
  function signOut() { app.logout(); goto('/onboarding'); }
</script>

{#if app.user}
  <header class="topbar">
    <div class="shell">
      <a class="brand" href="/dashboard">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="#3b3fe0" stroke-width="5" stroke-dasharray="60 10" /></svg>HabitLoop
      </a>
      <nav class="nav" aria-label="Main">
        {#each links as [href, label]}<a {href} aria-current={path.startsWith(href) ? 'page' : undefined}>{label}</a>{/each}
      </nav>
      <div class="who"><span>{app.user.name} · {app.user.tenantName}</span><button class="btn quiet" onclick={signOut}>Sign out</button></div>
    </div>
  </header>
{/if}

<main class="shell">{@render children()}</main>
{#if app.toast}<div class="toast" role="status">{app.toast}</div>{/if}
