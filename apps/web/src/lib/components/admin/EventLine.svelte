<script lang="ts">
  import { ROLE_LABELS } from '@music-hub/shared';
  import { formatTime } from '$lib/utils/format.js';
  import { VIA_LABEL, type AdminEvent, type Person } from '$lib/utils/admin.js';

  // One event as a sentence with a line of details below. `own` leaves out who did it,
  // for lists of a single person; with `onperson` names become buttons.
  let {
    event: e,
    people,
    own = false,
    onperson,
  }: {
    event: AdminEvent;
    people: Map<string, Pick<Person, 'name' | 'email'>>;
    own?: boolean;
    onperson?: (id: string) => void;
  } = $props();

  type Part = { text: string } | { who: string } | { em: string } | { strong: string } | { version: number };

  const nameOf = (id: string) => people.get(id)?.name ?? 'Unbekannt';
  const day = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });

  const parts = $derived.by((): Part[] => {
    const actor: Part[] = own || !e.userId ? [] : [{ who: e.userId }, { text: ' hat ' }];
    const guest: Part[] = e.guestName ? [{ text: 'Gast ' }, { strong: e.guestName }] : [{ text: 'Ein Gast' }];
    const version: Part[] = [{ em: e.trackName ?? '' }, { text: ' ' }, { version: e.versionNumber ?? 0 }];
    switch (e.type) {
      case 'login':
        return own ? [{ text: 'Angemeldet' }] : [{ who: e.userId! }, { text: ' hat sich angemeldet' }];
      case 'version':
        return [...actor, ...version, { text: ' hochgeladen' }];
      case 'stems':
        return [...actor, { text: e.count === 1 ? 'einen Stem zu ' : `${e.count} Stems zu ` }, { em: e.trackName ?? '' }, { text: ' hochgeladen' }];
      case 'comment':
        return e.userId
          ? [...actor, ...version, { text: ' kommentiert' }]
          : [...guest, { text: ' hat ' }, ...version, { text: ' kommentiert' }];
      case 'decision':
        return [...actor, ...version, { text: e.status === 'rejected' ? ' abgelehnt' : ' freigegeben' }];
      case 'share':
        return [...actor, { text: 'einen Share-Link für ' }, ...version, { text: ' erstellt' }];
      case 'listen':
        return e.played
          ? [...guest, { text: ' hat ' }, ...version, { text: ' gehört' }]
          : [...guest, { text: ' hat den Link zu ' }, ...version, { text: ' geöffnet, aber nicht abgespielt' }];
      case 'invite':
        return own
          ? [{ text: 'Eingeladen zu ' }, { em: e.projectName ?? '' }]
          : [{ strong: people.get(e.userId!)?.email ?? 'Unbekannt' }, { text: ' wurde zu ' }, { em: e.projectName ?? '' }, { text: ' eingeladen' }];
      case 'push':
        return [...actor, { text: 'Push-Mitteilungen eingeschaltet' }];
    }
  });

  // Sentences without the actor start with a capital letter
  const shown = $derived(
    own && parts[0] && 'text' in parts[0] ? [{ text: parts[0].text[0]!.toUpperCase() + parts[0].text.slice(1) }, ...parts.slice(1)] : parts,
  );

  const meta = $derived.by(() => {
    const linkBy = e.linkCreatorId ? `Link von ${nameOf(e.linkCreatorId)}` : '';
    switch (e.type) {
      case 'login':
        return VIA_LABEL[e.via ?? ''] ?? '';
      case 'share':
        return [e.projectName, e.until ? `gültig bis ${day(e.until)}` : 'unbegrenzt gültig', e.password ? 'mit Passwort' : '']
          .filter(Boolean)
          .join(' · ');
      case 'listen': {
        const heard = e.played
          ? `${formatTime(e.seconds ?? 0)}${e.duration ? ` von ${formatTime(e.duration)}` : ''}${e.completed ? ' · komplett' : ''}`
          : '';
        return [heard, e.device, linkBy].filter(Boolean).join(' · ');
      }
      case 'comment':
        return [e.projectName, e.userId ? '' : linkBy].filter(Boolean).join(' · ');
      case 'invite':
        return e.role ? `als ${ROLE_LABELS[e.role]}` : '';
      case 'push':
        return e.device ?? '';
      default:
        return e.projectName ?? '';
    }
  });
</script>

<!-- Spaces come only from the text parts; whitespace at the edges of blocks is dropped -->
{#snippet piece(part: Part)}
  {#if 'who' in part}
    {#if onperson}
      <button type="button" class="who" onclick={() => onperson(part.who)}>{nameOf(part.who)}</button>
    {:else}
      <b>{nameOf(part.who)}</b>
    {/if}
  {:else if 'em' in part}
    <i>{part.em}</i>
  {:else if 'strong' in part}
    <b>{part.strong}</b>
  {:else if 'version' in part}
    <span class="vchip">v{part.version}</span>
  {:else}
    {part.text}
  {/if}
{/snippet}

<span class="line">{#each shown as part, i (i)}{@render piece(part)}{/each}</span>
{#if meta}<span class="meta">{meta}</span>{/if}

<style>
  .line {
    color: var(--color-text-secondary);
  }
  .line b,
  .who {
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .who {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
    border-radius: 3px;
  }
  .who:hover {
    color: var(--color-accent);
  }
  .meta {
    display: block;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    margin-top: 1px;
  }
</style>
