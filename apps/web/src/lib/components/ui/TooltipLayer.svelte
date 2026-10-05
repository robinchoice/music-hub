<script lang="ts">
  import { onMount, untrack } from 'svelte';

  // One tooltip for every element with data-tt: it follows the mouse, sits below elements
  // focused by keyboard and shows on tap on touch screens.
  let text = $state('');
  let left = $state(0);
  let top = $state(0);
  let flipX = $state(false);
  let flipY = $state(false);

  function show(el: Element | null, x: number, y: number) {
    const tt = el?.getAttribute('data-tt');
    if (!tt) {
      text = '';
      return;
    }
    text = tt;
    flipX = x > window.innerWidth - 300;
    flipY = y > window.innerHeight - 140;
    left = x + (flipX ? -14 : 14);
    top = y + (flipY ? -12 : 16);
  }

  const target = (e: Event) => (e.target instanceof Element ? e.target.closest('[data-tt]') : null);

  onMount(() => {
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') show(target(e), e.clientX, e.clientY);
    };
    const tap = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') show(target(e), e.clientX, e.clientY);
    };
    const focus = (e: FocusEvent) => {
      const el = target(e);
      if (!el || !(e.target as Element).matches(':focus-visible')) return;
      const r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.bottom);
    };
    // Removing a focused element fires focusout while Svelte is still updating the DOM
    const hide = () => untrack(() => (text = ''));
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerdown', tap);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerdown', tap);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      window.removeEventListener('scroll', hide, true);
    };
  });
</script>

{#if text}
  <div class="tip" class:flip-x={flipX} class:flip-y={flipY} role="tooltip" style="left: {left}px; top: {top}px">{text}</div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 400;
    pointer-events: none;
    background: var(--color-bg-overlay);
    border: 1px solid var(--color-border-hover);
    color: var(--color-text-primary);
    font-size: 12px;
    line-height: 1.45;
    padding: 7px 10px;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    white-space: pre-line;
    max-width: 280px;
  }
  .flip-x {
    transform: translateX(-100%);
  }
  .flip-y {
    transform: translateY(-100%);
  }
  .flip-x.flip-y {
    transform: translate(-100%, -100%);
  }
</style>
