<script lang="ts">
  let {
    src = null,
    name,
    size = 'md',
  }: {
    src?: string | null;
    name: string;
    size?: 'sm' | 'md' | 'lg';
  } = $props();

  const initials = $derived(
    name
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  );

  const colors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
    '#f97316', '#eab308', '#22c55e', '#06b6d4',
  ];

  const color = $derived(colors[name.charCodeAt(0) % colors.length]);
</script>

<div class="avatar {size}" style:background={src ? 'none' : color}>
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
    color: #fff;
    flex-shrink: 0;
    overflow: hidden;
  }

  .sm { width: 24px; height: 24px; font-size: 0.6rem; }
  .md { width: 32px; height: 32px; font-size: 0.7rem; }
  .lg { width: 40px; height: 40px; font-size: 0.85rem; }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
