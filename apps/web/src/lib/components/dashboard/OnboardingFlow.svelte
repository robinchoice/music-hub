<script lang="ts">
  import { goto } from '$app/navigation';
  import { fly } from 'svelte/transition';
  import { api } from '$lib/api/client.js';
  import { toastError, toastSuccess } from '$lib/stores/toast.js';
  import Button from '$lib/components/ui/Button.svelte';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let step = $state(0);
  let dir = $state(1);
  let selectedRole = $state('');
  let projectName = $state('');
  let inviteEmail = $state('');
  let loading = $state(false);
  let createdProjectId = $state('');

  const roles = [
    { id: 'producer', label: 'Produzent', icon: '🎛️', desc: 'Beats, Tracks, Stems' },
    { id: 'label', label: 'Label / A&R', icon: '🏢', desc: 'Releases & Feedback' },
    { id: 'artist', label: 'Artist', icon: '🎤', desc: 'Aufnahmen & Kollaboration' },
    { id: 'manager', label: 'Manager', icon: '📋', desc: 'Team & Koordination' },
    { id: 'engineer', label: 'Mix Engineer', icon: '🎚️', desc: 'Mixen & Mastern' },
    { id: 'other', label: 'Anderes', icon: '✨', desc: 'Ich entdecke die Platform' },
  ];

  function pickRole(id: string) {
    selectedRole = id;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('onboarding-role', id);
    }
    advance();
  }

  function advance() {
    dir = 1;
    step++;
  }

  function back() {
    dir = -1;
    step--;
  }

  async function loadDemo() {
    loading = true;
    try {
      const res = await api.post<{ projectId: string }>('/onboarding/seed-demo');
      createdProjectId = res.projectId;
      advance();
    } catch {
      toastError('Demo konnte nicht geladen werden');
    } finally {
      loading = false;
    }
  }

  async function createProject() {
    const name = projectName.trim();
    if (!name) return;
    loading = true;
    try {
      const res = await api.post<{ project: { id: string } }>('/projects', { name });
      createdProjectId = res.project.id;
      advance();
    } catch {
      toastError('Projekt konnte nicht erstellt werden');
    } finally {
      loading = false;
    }
  }

  async function sendInvite() {
    const email = inviteEmail.trim();
    if (!email || !createdProjectId) return;
    loading = true;
    try {
      await api.post(`/projects/${createdProjectId}/members`, {
        email,
        role: 'collaborator',
        canUpload: true,
        canComment: true,
        canApprove: false,
      });
      toastSuccess(`Einladung an ${email} gesendet`);
      finish();
    } catch {
      toastError('Einladung konnte nicht gesendet werden');
    } finally {
      loading = false;
    }
  }

  function finish() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('onboarding-done', '1');
    }
    open = false;
    if (createdProjectId) {
      goto(`/projects/${createdProjectId}`);
    }
  }
</script>

{#if open}
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Onboarding">
    <div class="panel">
      <div class="panel-inner">
        <!-- Header -->
        <div class="panel-head">
          <div class="dots">
            {#each [0, 1, 2] as i}
              <div class="dot" class:active={step === i} class:done={step > i}></div>
            {/each}
          </div>
          {#if step < 2}
            <button class="skip-btn" onclick={finish}>Überspringen</button>
          {/if}
        </div>

        <!-- Step content -->
        <div class="steps-viewport">
          {#key step}
            <div
              class="step"
              in:fly={{ x: dir * 56, opacity: 0, duration: 300, delay: 60 }}
              out:fly={{ x: dir * -56, opacity: 0, duration: 220 }}
            >
              {#if step === 0}
                <div class="step-header">
                  <div class="wordmark">Music Hub</div>
                  <h1>Willkommen!</h1>
                  <p class="lead">Wie würdest du dich beschreiben?</p>
                </div>
                <div class="roles">
                  {#each roles as role}
                    <button
                      class="role-tile"
                      class:selected={selectedRole === role.id}
                      onclick={() => pickRole(role.id)}
                    >
                      <span class="role-icon">{role.icon}</span>
                      <span class="role-label">{role.label}</span>
                      <span class="role-desc">{role.desc}</span>
                    </button>
                  {/each}
                </div>

              {:else if step === 1}
                <div class="step-header">
                  <h1>Wie möchtest du starten?</h1>
                  <p class="lead">Du kannst das Demo jederzeit löschen</p>
                </div>
                <div class="choices">
                  <button class="choice-card" onclick={loadDemo} disabled={loading}>
                    <span class="choice-emoji">🎵</span>
                    <div class="choice-text">
                      <strong>Demo-Projekt laden</strong>
                      <span>Sofort loslegen mit echten Beispiel-Tracks, Versionen und Kommentaren</span>
                    </div>
                    <span class="choice-arrow">→</span>
                  </button>
                  <div class="or-divider"><span>oder</span></div>
                  <div class="new-row">
                    <input
                      class="name-input"
                      type="text"
                      placeholder="Projekttitel eingeben …"
                      bind:value={projectName}
                      onkeydown={(e) => e.key === 'Enter' && createProject()}
                      autofocus
                    />
                    <Button
                      onclick={createProject}
                      {loading}
                      disabled={loading || !projectName.trim()}
                    >Erstellen →</Button>
                  </div>
                </div>
                <button class="back-btn" onclick={back}>← Zurück</button>

              {:else if step === 2}
                <div class="step-header">
                  <div class="check-icon">✓</div>
                  <h1>Fast fertig!</h1>
                  <p class="lead">Lade jemanden ein — oder starte direkt alleine.</p>
                </div>
                <div class="invite-block">
                  <input
                    class="name-input"
                    type="email"
                    placeholder="E-Mail-Adresse eingeben …"
                    bind:value={inviteEmail}
                    onkeydown={(e) => e.key === 'Enter' && sendInvite()}
                    autofocus
                  />
                  <Button
                    onclick={sendInvite}
                    {loading}
                    disabled={loading || !inviteEmail.trim()}
                  >Einladen</Button>
                </div>
                <div class="finish-row">
                  <button class="skip-link" onclick={finish}>Überspringen → Zum Projekt</button>
                </div>
              {/if}
            </div>
          {/key}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }

  .panel {
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl, 20px);
    width: 100%;
    max-width: 620px;
    max-height: 90vh;
    overflow: hidden;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  }

  .panel-inner {
    padding: var(--space-6) var(--space-7);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .dots {
    display: flex;
    gap: 6px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-border);
    transition: background 0.25s, transform 0.25s;
  }

  .dot.active {
    background: var(--color-accent);
    transform: scale(1.25);
  }

  .dot.done {
    background: var(--color-accent);
    opacity: 0.4;
  }

  .skip-btn {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0;
    transition: color var(--transition-fast);
  }

  .skip-btn:hover {
    color: var(--color-text-secondary);
  }

  .steps-viewport {
    position: relative;
    min-height: 320px;
    overflow: hidden;
  }

  .step {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    overflow-y: auto;
  }

  /* Step headers */
  .step-header {
    text-align: center;
  }

  .wordmark {
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-accent);
    margin-bottom: var(--space-3);
  }

  .step-header h1 {
    font-size: var(--text-2xl);
    font-weight: 700;
    margin: 0 0 var(--space-2);
    color: var(--color-text-primary);
    letter-spacing: -0.02em;
  }

  .lead {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    margin: 0;
  }

  .check-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
    color: var(--color-accent);
    font-size: 1.4rem;
    font-weight: 700;
    margin: 0 auto var(--space-3);
  }

  /* Role tiles */
  .roles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }

  .role-tile {
    background: var(--color-bg);
    border: 1.5px solid var(--color-border);
    border-radius: var(--radius-lg, 12px);
    padding: var(--space-4) var(--space-3);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    cursor: pointer;
    transition: all var(--transition-fast);
    text-align: center;
  }

  .role-tile:hover {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg));
    transform: translateY(-2px);
  }

  .role-tile.selected {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg));
  }

  .role-icon {
    font-size: 1.75rem;
    line-height: 1;
  }

  .role-label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .role-desc {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    line-height: 1.3;
  }

  /* Choice cards (step 1) */
  .choices {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .choice-card {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    background: var(--color-bg);
    border: 1.5px solid var(--color-border);
    border-radius: var(--radius-lg, 12px);
    padding: var(--space-4) var(--space-5);
    cursor: pointer;
    text-align: left;
    transition: all var(--transition-fast);
  }

  .choice-card:hover:not(:disabled) {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg));
    transform: translateY(-1px);
  }

  .choice-card:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .choice-emoji {
    font-size: 2rem;
    flex-shrink: 0;
  }

  .choice-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .choice-text strong {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .choice-text span {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    line-height: 1.4;
  }

  .choice-arrow {
    color: var(--color-text-tertiary);
    font-size: 1.1rem;
    flex-shrink: 0;
  }

  .or-divider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--color-text-tertiary);
    font-size: var(--text-xs);
  }

  .or-divider::before,
  .or-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-border);
  }

  .new-row {
    display: flex;
    gap: var(--space-3);
  }

  .name-input {
    flex: 1;
    background: var(--color-bg);
    border: 1.5px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: 0 var(--space-3);
    height: 2.5rem;
    font-size: var(--text-sm);
    color: var(--color-text-primary);
    outline: none;
    transition: border-color var(--transition-fast);
    font-family: inherit;
  }

  .name-input:focus {
    border-color: var(--color-accent);
  }

  .name-input::placeholder {
    color: var(--color-text-tertiary);
  }

  .back-btn {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0;
    align-self: flex-start;
    transition: color var(--transition-fast);
  }

  .back-btn:hover {
    color: var(--color-text-secondary);
  }

  /* Invite step */
  .invite-block {
    display: flex;
    gap: var(--space-3);
  }

  .finish-row {
    display: flex;
    justify-content: center;
  }

  .skip-link {
    background: none;
    border: none;
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0;
    transition: color var(--transition-fast);
  }

  .skip-link:hover {
    color: var(--color-text-secondary);
  }

  /* Mobile */
  @media (max-width: 640px) {
    .panel-inner {
      padding: var(--space-5) var(--space-4);
    }

    .roles {
      grid-template-columns: repeat(2, 1fr);
    }

    .step-header h1 {
      font-size: var(--text-xl);
    }

    .choice-card {
      padding: var(--space-3) var(--space-4);
    }

    .new-row {
      flex-direction: column;
    }

    .invite-block {
      flex-direction: column;
    }
  }
</style>
