<script lang="ts">
  import { APP_BAND, GLOW, bandColor } from '@music-hub/shared';

  let { size = 28 }: { size?: number } = $props();

  const id = $props.id();
  const stops = [APP_BAND.from, (APP_BAND.from + APP_BAND.to) / 2, APP_BAND.to].map((p) => bandColor(p, GLOW));
</script>

<!-- The app tile: the sign (a wave, a placeholder until the sign is designed) glows in the product gradient -->
<svg class="tile" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <linearGradient id="{id}-sign" gradientUnits="userSpaceOnUse" x1="22" y1="78" x2="78" y2="22">
      {#each stops as color, i (i)}<stop offset={i / 2} stop-color={color} />{/each}
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="24" fill="#121117" />
  <path
    d="M26.5 50C36.47 26 40.03 26 50 50S63.53 74 73.5 50"
    fill="none"
    stroke="url(#{id}-sign)"
    stroke-width="9"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>

<style>
  .tile {
    display: block;
    flex-shrink: 0;
    border-radius: 24%;
    /* Without the line the dark tile disappears on the dark ground */
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.13);
  }
</style>
