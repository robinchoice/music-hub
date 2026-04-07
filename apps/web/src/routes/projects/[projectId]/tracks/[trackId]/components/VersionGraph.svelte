<script lang="ts">
  type Node = {
    id: string;
    parentVersionId: string | null;
    branchLabel: string | null;
    versionNumber: number;
    label: string | null;
    status: string;
    createdAt: string;
  };

  let {
    nodes,
    selectedId,
    onSelect,
    onBranch,
  }: {
    nodes: Node[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onBranch?: (id: string) => void;
  } = $props();

  // Assign each node a column based on branchLabel.
  // Mainline (branchLabel === null) → col 0; each distinct branchLabel → next col.
  const layout = $derived.by(() => {
    const cols = new Map<string, number>();
    cols.set('__main__', 0);
    let next = 1;
    for (const n of nodes) {
      const key = n.branchLabel ?? '__main__';
      if (!cols.has(key)) cols.set(key, next++);
    }
    const sorted = [...nodes].sort(
      (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
    );
    const rowOf = new Map<string, number>();
    sorted.forEach((n, i) => rowOf.set(n.id, i));
    const positions = sorted.map((n) => ({
      node: n,
      col: cols.get(n.branchLabel ?? '__main__')!,
      row: rowOf.get(n.id)!,
    }));
    const colCount = cols.size;
    return { positions, colCount, rowCount: sorted.length };
  });

  const COL_W = 60;
  const ROW_H = 50;
  const PAD = 20;
  const R = 12;

  const width = $derived(PAD * 2 + (layout.colCount - 1) * COL_W + 200);
  const height = $derived(PAD * 2 + Math.max(1, layout.rowCount - 1) * ROW_H);

  function pos(col: number, row: number) {
    return { x: PAD + col * COL_W, y: PAD + row * ROW_H };
  }

  const colorOf = (s: string) =>
    ({
      approved: '#22c55e',
      rejected: '#ef4444',
      processing: '#fbbf24',
      ready: '#6366f1',
      uploaded: '#666',
    }[s] || '#888');
</script>

<div class="graph">
  <h2>Version Graph</h2>
  {#if nodes.length === 0}
    <p class="empty">Noch keine Versionen.</p>
  {:else}
    <svg {width} {height} role="img" aria-label="Version graph">
      <!-- edges -->
      {#each layout.positions as p}
        {#if p.node.parentVersionId}
          {@const parent = layout.positions.find((q) => q.node.id === p.node.parentVersionId)}
          {#if parent}
            {@const a = pos(parent.col, parent.row)}
            {@const b = pos(p.col, p.row)}
            <path
              d={`M ${a.x} ${a.y} C ${a.x} ${(a.y + b.y) / 2}, ${b.x} ${(a.y + b.y) / 2}, ${b.x} ${b.y}`}
              stroke="#444"
              stroke-width="2"
              fill="none"
            />
          {/if}
        {/if}
      {/each}

      <!-- nodes -->
      {#each layout.positions as p}
        {@const c = pos(p.col, p.row)}
        <g
          class="node"
          class:selected={selectedId === p.node.id}
          onclick={() => onSelect(p.node.id)}
          role="button"
          tabindex="0"
        >
          <circle
            cx={c.x}
            cy={c.y}
            r={R}
            fill={colorOf(p.node.status)}
            stroke={selectedId === p.node.id ? '#fff' : '#222'}
            stroke-width="2"
          />
          <text x={c.x} y={c.y + 4} text-anchor="middle" font-size="11" fill="#fff">
            {p.node.versionNumber}
          </text>
          <text
            x={PAD + (layout.colCount - 1) * COL_W + 30}
            y={c.y + 4}
            font-size="12"
            fill="#ccc"
          >
            {p.node.label || p.node.branchLabel || (p.col === 0 ? 'main' : 'branch')}
          </text>
        </g>
      {/each}
    </svg>
    {#if onBranch && selectedId}
      <button class="branch-btn" onclick={() => onBranch?.(selectedId!)}>
        ⑂ Neue Variante von dieser Version
      </button>
    {/if}
  {/if}
</div>

<style>
  .graph {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-5);
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-lg);
  }
  .empty {
    color: var(--color-text-tertiary);
    font-size: var(--text-sm);
  }
  svg {
    display: block;
    max-width: 100%;
  }
  .node {
    cursor: pointer;
  }
  .node:hover circle {
    stroke: #fff;
  }
  .branch-btn {
    margin-top: var(--space-3);
    background: var(--color-bg-raised);
    border: 1px solid var(--color-border-hover);
    color: var(--color-text-primary);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--text-sm);
  }
  .branch-btn:hover {
    border-color: var(--color-accent);
  }
</style>
