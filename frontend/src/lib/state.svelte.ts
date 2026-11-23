import { api, ApiError, getToken, setToken, type Challenge, type Habit, type Integration, type IntegrationEvent, type Invite, type Recommendation, type Summary, type User } from './api';

/** Application state, built on Svelte 5 runes ($state) so every page reacts to changes automatically. */
class AppState {
  ready = $state(false);
  user = $state<User | null>(null);
  habits = $state<Habit[]>([]);
  summary = $state<Summary | null>(null);
  challenges = $state<Challenge[]>([]);
  invites = $state<Invite[]>([]);
  integrations = $state<Integration[]>([]);
  events = $state<IntegrationEvent[]>([]);
  recs = $state<Recommendation[]>([]);
  toast = $state('');
  pendingRecs = $derived(this.recs.filter((r) => r.status === 'pending'));

  notify(msg: string) { this.toast = msg; setTimeout(() => { if (this.toast === msg) this.toast = ''; }, 2800); }
  fail(e: unknown) { if (e instanceof ApiError && e.status === 401) this.logout(); this.notify(e instanceof Error ? e.message : 'Something went wrong'); }

  async init() {
    if (getToken()) {
      try { this.user = await api<User>('/api/users/me'); } catch { setToken(null); }
    }
    this.ready = true;
  }
  async authenticate(path: 'login' | 'signup', body: object) {
    const r = await api<{ token: string; user: User }>(`/api/users/auth/${path}`, { method: 'POST', body, auth: false });
    setToken(r.token);
    this.user = await api<User>('/api/users/me');
  }
  logout() {
    setToken(null); this.user = null; this.habits = []; this.summary = null; this.challenges = []; this.invites = [];
    this.integrations = []; this.events = []; this.recs = [];
  }

  // ---- loaders ----
  loadHabits = async () => { this.habits = await api<Habit[]>('/api/activities'); };
  loadSummary = async () => { this.summary = await api<Summary>('/api/analytics/summary'); };
  refreshDashboard = async () => { try { await Promise.all([this.loadHabits(), this.loadSummary()]); } catch (e) { this.fail(e); } };
  loadChallenges = async () => { try { [this.challenges, this.invites] = await Promise.all([api<Challenge[]>('/api/challenges'), api<Invite[]>('/api/challenges/invites')]); } catch (e) { this.fail(e); } };
  loadIntegrations = async () => {
    try { [this.integrations, this.events] = await Promise.all([api<Integration[]>('/api/integrations'), api<IntegrationEvent[]>('/api/integrations/events/recent')]); } catch (e) { this.fail(e); }
  };
  loadRecs = async () => { try { this.recs = await api<Recommendation[]>('/api/recommendations'); } catch (e) { this.fail(e); } };

  // ---- commands ----
  async createHabit(b: { name: string; scheduledTime: string; frequencyPerWeek: number }) {
    await api('/api/activities', { method: 'POST', body: b }); await this.refreshDashboard(); this.notify('Habit created');
  }
  async logHabit(id: string, status: 'done' | 'missed' | 'completed') {
    try { await api(`/api/activities/${id}/logs`, { method: 'POST', body: { status } }); this.notify(`Logged as ${status}`); await new Promise((r) => setTimeout(r, 400)); await this.refreshDashboard(); }
    catch (e) { this.fail(e); }
  }
  async acceptInvite(id: string) { await api(`/api/challenges/invites/${id}/accept`, { method: 'POST' }); await this.loadChallenges(); this.notify('You joined the challenge'); }
  async declineInvite(id: string) { await api(`/api/challenges/invites/${id}/decline`, { method: 'POST' }); await this.loadChallenges(); }
  async generateRecs() { this.recs = await api<Recommendation[]>('/api/recommendations/generate', { method: 'POST' }); await this.loadRecs(); }
  async acceptRec(id: string) { await api(`/api/recommendations/${id}/accept`, { method: 'POST' }); await this.loadRecs(); this.notify('Schedule updated'); }
  async dismissRec(id: string) { await api(`/api/recommendations/${id}/dismiss`, { method: 'POST' }); await this.loadRecs(); }
}

export const app = new AppState();
