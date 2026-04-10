<script lang="ts">
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

  const initials = $derived(
    name
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );

  // Deterministic gradient angle based on name → variation per project
  const angle = $derived(
    name
      ? (Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0) * 17) % 360
      : 135
  );
</script>

<div class="cover {size} round-{rounded}">
  {#if src}
    <img {src} alt="" loading="lazy" />
  {:else}
    <div
      class="fallback"
      style="background: linear-gradient({angle}deg, #f43f5e 0%, #fb923c 100%)"
    >
      <span>{initials}</span>
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
    color: #fff;
    font-weight: 700;
    letter-spacing: -0.02em;
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
