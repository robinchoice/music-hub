<script lang="ts">
  let {
    src = null,
    name,
    size = 'md',
  }: {
    src?: string | null;
    name: string;
    size?: 'xs' | 'sm' | 'md' | 'lg';
  } = $props();

  const initials = $derived(
    name
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  );
</script>

<!-- Neutral, so colour stays with what can be done -->
<div class="avatar {size}" class:photo={src}>
  {#if src}
    <img {src} alt={name} />
  {:else}
    <span>{initials}</span>
  {/if}
</div>

<style>
  .avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    font-weight: 600;
    color: var(--color-text-primary);
    background: var(--color-bg-subtle);
    box-shadow: inset 0 0 0 1px var(--color-border-hover);
    flex-shrink: 0;
    overflow: hidden;
  }
  .photo {
    background: none;
    box-shadow: none;
  }

  .xs { width: 20px; height: 20px; font-size: 0.55rem; }
  .sm { width: 24px; height: 24px; font-size: 0.6rem; }
  .md { width: 32px; height: 32px; font-size: 0.7rem; }
  .lg { width: 40px; height: 40px; font-size: 0.85rem; }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
