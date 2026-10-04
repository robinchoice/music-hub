<script lang="ts">
  import { DEMO_FRAME } from '$lib/demo/mode.js';

  // Embeds a page of the real app; inside the frame it runs in demo mode (see $lib/demo).
  let {
    src,
    title,
    width = 0,
    height = 0,
    fit = false,
    interactive = true,
    lazy = false,
    onready,
  }: {
    src: string;
    title: string;
    /** Fixed layout size of the embedded page; without it the frame fills its parent. */
    width?: number;
    height?: number;
    /** Scale the fixed size down to the available width. */
    fit?: boolean;
    interactive?: boolean;
    lazy?: boolean;
    onready?: (win: Window & typeof globalThis) => void;
  } = $props();

  let frame = $state<HTMLIFrameElement>();
  let boxWidth = $state(0);
  let loaded = $state(false);
  const fixed = $derived(width > 0 && height > 0);
  const scale = $derived(fit && fixed && boxWidth ? Math.min(1, boxWidth / width) : 1);

  // Passing over the frame, the wheel scrolls the landing page. After a click into the frame it
  // scrolls the page inside until that reaches its end; the pointer leaving the frame resets this.
  let engaged = false;

  function scrollsInside(e: WheelEvent, win: Window & typeof globalThis) {
    if (!engaged) return false;
    for (const node of e.composedPath()) {
      if (!(node instanceof win.Element)) continue;
      const max = node.scrollHeight - node.clientHeight;
      const scrollable =
        node === win.document.scrollingElement || /(auto|scroll)/.test(win.getComputedStyle(node).overflowY);
      if (scrollable && max > 1 && (e.deltaY < 0 ? node.scrollTop > 0 : node.scrollTop < max - 1)) return true;
    }
    return false;
  }

  function handleLoad() {
    const win = frame?.contentWindow as (Window & typeof globalThis) | null;
    if (!win) return;
    win.addEventListener('pointerdown', () => (engaged = true));
    win.addEventListener(
      'wheel',
      (e) => {
        if (scrollsInside(e, win)) return;
        e.preventDefault();
        window.scrollBy({ top: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY });
      },
      { passive: false },
    );
    loaded = true;
    onready?.(win);
  }
</script>

<div
  class="demo-frame"
  class:fixed
  bind:clientWidth={boxWidth}
  style:height={fixed ? `${height * scale}px` : undefined}
  onpointerleave={() => (engaged = false)}
  role="presentation"
>
  <iframe
    bind:this={frame}
    name={DEMO_FRAME}
    {src}
    {title}
    loading={lazy ? 'lazy' : 'eager'}
    inert={!interactive}
    class:loaded
    style:width={fixed ? `${width}px` : undefined}
    style:height={fixed ? `${height}px` : undefined}
    style:transform={scale < 1 ? `scale(${scale})` : undefined}
    onload={handleLoad}
  ></iframe>
</div>

<style>
  .demo-frame {
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 100%;
    background: var(--color-bg-base);
  }
  iframe {
    display: block;
    border: 0;
    width: 100%;
    height: 100%;
    background: var(--color-bg-base);
    opacity: 0;
    transition: opacity 0.4s var(--ease-out);
  }
  .fixed iframe {
    transform-origin: 0 0;
  }
  iframe.loaded {
    opacity: 1;
  }
</style>
