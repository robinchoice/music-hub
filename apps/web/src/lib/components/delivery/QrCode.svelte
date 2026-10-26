<script lang="ts">
  import { encode } from 'uqr';

  // Rendered in the browser, the payload never leaves the page
  let { value, label, size = 200 }: { value: string; label: string; size?: number } = $props();

  const qr = $derived(encode(value, { ecc: 'M', border: 2 }));
  const path = $derived(
    qr.data
      .flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : '')))
      .join(''),
  );
</script>

<svg class="qr" role="img" aria-label={label} width={size} height={size} viewBox="0 0 {qr.size} {qr.size}" shape-rendering="crispEdges">
  <rect width={qr.size} height={qr.size} fill="#fff" />
  <path d={path} fill="#111" />
</svg>

<style>
  .qr {
    display: block;
    margin: 0 auto;
    border-radius: var(--radius-md);
    max-width: 100%;
    height: auto;
  }
</style>
