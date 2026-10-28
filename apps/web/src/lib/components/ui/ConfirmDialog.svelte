<script lang="ts">
  import { question } from '$lib/stores/confirm.js';
  import { t } from '$lib/i18n/index.js';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';

  function answer(yes: boolean) {
    $question?.answer(yes);
    question.set(null);
  }
</script>

<!-- Closing the modal (Escape, backdrop, ×) means no -->
<Modal bind:open={() => $question !== null, (open) => !open && answer(false)} title={t().common.confirmTitle}>
  <p class="message">{$question?.message}</p>
  {#snippet actions()}
    <Button variant="secondary" onclick={() => answer(false)}>{t().common.cancel}</Button>
    <Button variant="danger" onclick={() => answer(true)}>{$question?.confirmLabel ?? t().common.confirm}</Button>
  {/snippet}
</Modal>

<style>
  .message {
    margin: 0;
    line-height: 1.5;
  }
</style>
