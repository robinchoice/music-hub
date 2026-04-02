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
    font-size: var(--text-sm);
  }

  input {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-hover);
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-size: var(--text-base);
    font-family: inherit;
    transition: border-color var(--transition-fast);
    width: 100%;
  }

  input:focus {
    outline: none;
    border-color: var(--color-border-focus);
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
