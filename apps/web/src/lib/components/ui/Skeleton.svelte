<script lang="ts">
  let {
    width = '100%',
    height = '1rem',
    variant = 'text',
  }: {
    width?: string;
    height?: string;
    variant?: 'text' | 'circle' | 'rect';
  } = $props();
</script>

<div
  class="skeleton {variant}"
  style:width
  style:height
  style:border-radius={variant === 'circle' ? '50%' : variant === 'rect' ? 'var(--radius-md)' : 'var(--radius-sm)'}
></div>

<style>
  .skeleton {
    background: linear-gradient(
      90deg,
      var(--color-bg-subtle) 25%,
      var(--color-border) 50%,
      var(--color-bg-subtle) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
