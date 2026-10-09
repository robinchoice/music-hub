<script lang="ts">
  import { initials } from '$lib/utils/format.js';

  let {
    src = null,
    name = '',
    size = 'md',
    rounded = 'md',
  }: {
    src?: string | null;
    name?: string;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'fill';
    rounded?: 'sm' | 'md' | 'lg';
  } = $props();
</script>

<div class="cover {size} round-{rounded}">
  {#if src}
    <img {src} alt="" loading="lazy" />
  {:else}
    <div class="fallback">
      <span>{initials(name) || '?'}</span>
    </div>
  {/if}
</div>

<style>
  .cover {
    overflow: hidden;
    flex-shrink: 0;
    background: var(--color-bg-subtle);
    aspect-ratio: 1 / 1;
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 0 0 1px var(--color-border);
    color: var(--color-text-tertiary);
    font-family: var(--font-display);
    font-weight: 780;
    font-stretch: 80%;
    letter-spacing: -0.01em;
  }

  .xs { width: 20px; height: 20px; }
  .sm { width: 32px; height: 32px; }
  .md { width: 48px; height: 48px; }
  .lg { width: 80px; height: 80px; }
  .xl { width: 120px; height: 120px; }
  .fill { width: 100%; height: 100%; aspect-ratio: 1 / 1; }

  .xs .fallback span { font-size: 8px; }
  .sm .fallback span { font-size: 11px; }
  .md .fallback span { font-size: 16px; }
  .lg .fallback span { font-size: 24px; }
  .xl .fallback span { font-size: 36px; }
  .fill .fallback span { font-size: clamp(20px, 8cqw, 56px); }

  .round-sm { border-radius: var(--radius-sm); }
  .round-md { border-radius: var(--radius-md); }
  .round-lg { border-radius: var(--radius-lg); }
</style>
