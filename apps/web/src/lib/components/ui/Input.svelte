<script lang="ts">
  let {
    type = 'text',
    value = $bindable(''),
    placeholder = '',
    label,
    error,
    disabled = false,
    autofocus = false,
  }: {
    type?: 'text' | 'email' | 'password';
    value?: string;
    placeholder?: string;
    label?: string;
    error?: string;
    disabled?: boolean;
    autofocus?: boolean;
  } = $props();
</script>

<div class="input-group">
  {#if label}
    <label class="input-label">{label}</label>
  {/if}
  <input
    {type}
    bind:value
    {placeholder}
    {disabled}
    {autofocus}
    class:has-error={!!error}
  />
  {#if error}
    <span class="input-error">{error}</span>
  {/if}
</div>

<style>
  .input-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .input-label {
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  input {
    padding: 0.7rem 0.9rem;
    height: 42px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-raised);
    color: var(--color-text-primary);
    font-size: var(--text-sm);
    font-family: inherit;
    transition:
      border-color var(--transition-fast),
      background var(--transition-fast),
      box-shadow var(--transition-fast);
    width: 100%;
  }

  input::placeholder {
    color: var(--color-text-tertiary);
  }

  input:hover:not(:disabled) {
    border-color: var(--color-border-hover);
  }

  input:focus {
    outline: none;
    border-color: var(--color-accent);
    background: var(--color-bg-overlay);
    box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.12);
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  input.has-error {
    border-color: var(--color-error);
  }

  .input-error {
    color: var(--color-error);
    font-size: var(--text-xs);
  }
</style>
