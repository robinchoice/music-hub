import { expect, test } from 'bun:test';

const modulePath = (file: string) => JSON.stringify(`${import.meta.dir}/${file}.ts`);

// OS signals and module mocks stay in their own processes.
function start(entry: 'index' | 'worker', setup: string) {
  const child = Bun.spawn([process.execPath, '--eval', `
    import { mock } from 'bun:test';
    const storage = await import(${modulePath('storage/s3')});
    mock.module(${modulePath('storage/s3')}, () => ({ ...storage, allowBrowserAccess: async () => {} }));
    ${setup}
    await import(${modulePath(entry)});
  `], {
    env: { ...process.env, PORT: '0', SMTP_HOST: '', SENTRY_DSN: '', NODE_ENV: 'test' },
    stdout: 'pipe', stderr: 'pipe',
  });
  const lines = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let output = '';
  async function until(marker: string) {
    while (!output.includes(marker)) {
      const { value, done } = await lines.read();
      if (done) throw new Error(`Child exited before ${marker}: ${output}\n${await new Response(child.stderr).text()}`);
      output += value;
    }
    return output;
  }
  async function close() {
    child.kill('SIGKILL');
    await child.exited;
  }
  return { child, until, close };
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  test(`API drains a streaming request and closes SSE on ${signal}`, async () => {
    const run = start('index', `
      const { Hono } = await import('hono');
      const { runInBackground } = await import(${modulePath('lib/background')});
      const { subscribe } = await import(${modulePath('services/sse')});
      const auth = await import(${modulePath('routes/auth')});
      mock.module(${modulePath('routes/auth')}, () => ({ ...auth,
        authRoutes: new Hono()
          .post('/drain', async (c) => {
            console.log('request-started');
            const body = await c.req.text();
            await c.get('db').execute('select pg_sleep(0.1)');
            return c.text(body);
          })
          .get('/background', (c) => {
            runInBackground((async () => {
              await Bun.sleep(700);
              await c.get('db').execute('select 1');
              console.log('background-finished');
            })());
            return c.text('queued');
          })
          .get('/stream', () => new Response(new ReadableStream({ start(controller) {
            controller.enqueue(new TextEncoder().encode(': connected\\n\\n'));
            subscribe('shutdown', () => {}, () => controller.close());
          } }), { headers: { 'content-type': 'text/event-stream' } })),
      }));
    `);
    try {
      const output = await run.until('Music Hub API running on port ');
      const port = output.match(/running on port (\d+)/)![1]!;
      const stream = await fetch(`http://localhost:${port}/api/v1/auth/stream`);
      const streamBody = stream.text();
      expect(await (await fetch(`http://localhost:${port}/api/v1/auth/background`)).text()).toBe('queued');
      let finish!: () => void;
      const body = new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('upload-'));
        finish = () => { controller.enqueue(new TextEncoder().encode('complete')); controller.close(); };
      } });
      const init: RequestInit & { duplex: 'half' } = { method: 'POST', body, duplex: 'half' };
      const response = fetch(`http://localhost:${port}/api/v1/auth/drain`, init).then((res) => res.text());
      await run.until('request-started');
      run.child.kill(signal);
      finish();
      expect(await response).toBe('upload-complete');
      expect(await streamBody).toContain(': connected');
      await run.until('background-finished');
      expect(await run.child.exited).toBe(0);
    } finally { await run.close(); }
  }, 30_000);

  test(`API completes startup before closing on ${signal}`, async () => {
    const run = start('index', `
      const updates = await import(${modulePath('lib/updates')});
      mock.module(${modulePath('lib/updates')}, () => ({ ...updates, importDrafts: async (db) => {
        console.log('import-started');
        await db.execute('select pg_sleep(0.2)');
        console.log('import-finished');
      } }));
    `);
    try {
      await run.until('import-started');
      run.child.kill(signal);
      await run.until('import-finished');
      expect(await run.child.exited).toBe(0);
    } finally { await run.close(); }
  }, 30_000);

  test(`worker waits for cancellation before releasing its job on ${signal}`, async () => {
    const run = start('worker', `
      mock.module(${modulePath('services/audio-jobs')}, () => ({
        giveUpAudioJobs: async () => {}, claimAudioJob: async () => 'test-version', hasWaitingAudioJob: async () => false,
        releaseAudioJob: async () => console.log('job-released'),
        renewAudioJob: async () => {}, finishAudioJob: async () => { throw new Error('Must not finish'); }, LEASE_MS: 300000,
      }));
      mock.module(${modulePath('services/audio-processor')}, () => ({ analyzeNextVersion: async () => false, processVersion: async (db, id, signal) => {
        console.log('processing-started');
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        await db.execute('select pg_sleep(0.1)');
        console.log('processing-stopped');
        signal.throwIfAborted();
      } }));
    `);
    try {
      await run.until('processing-started');
      run.child.kill(signal);
      const output = await run.until('job-released');
      expect(output.indexOf('processing-stopped')).toBeLessThan(output.indexOf('job-released'));
      expect(await run.child.exited).toBe(0);
    } finally { await run.close(); }
  }, 30_000);

  test(`worker interrupts its idle pause on ${signal}`, async () => {
    const run = start('worker', `
      const jobs = await import(${modulePath('services/audio-jobs')});
      mock.module(${modulePath('services/audio-jobs')}, () => ({ ...jobs, giveUpAudioJobs: async () => {}, claimAudioJob: async () => {
        console.log('idle'); return null;
      } }));
    `);
    try {
      await run.until('idle');
      const before = performance.now();
      run.child.kill(signal);
      expect(await run.child.exited).toBe(0);
      expect(performance.now() - before).toBeLessThan(1000);
    } finally { await run.close(); }
  }, 30_000);
}

test('worker kills the audio subprocess before releasing a cancelled job', async () => {
  const run = start('worker', `
    const { createDb, migrateDb, users, projects, tracks, versions } = await import('@music-hub/db');
    const db = createDb(process.env.DATABASE_URL);
    await migrateDb(process.env.DATABASE_URL);
    const [user] = await db.insert(users).values({ email: crypto.randomUUID() + '@example.com', name: 'Test' }).returning();
    const [project] = await db.insert(projects).values({ name: 'Test', createdById: user.id }).returning();
    const [track] = await db.insert(tracks).values({ name: 'Test', projectId: project.id, createdById: user.id }).returning();
    const [version] = await db.insert(versions).values({ trackId: track.id, createdById: user.id, versionNumber: 1,
      originalFileKey: 'shutdown-test', originalFileName: 'test.wav', mimeType: 'audio/wav', fileSize: 1 }).returning();
    mock.module(${modulePath('storage/s3')}, () => ({ ...storage, createDownloadUrl: async () => 'unused' }));
    const spawn = Bun.spawn;
    let audio;
    Bun.spawn = (command, options) => {
      audio = spawn([process.execPath, '--eval', 'setInterval(() => {}, 1000)'], options);
      console.log('audio-started');
      return audio;
    };
    mock.module(${modulePath('services/audio-jobs')}, () => ({
      giveUpAudioJobs: async () => {}, claimAudioJob: async () => version.id, hasWaitingAudioJob: async () => false,
      releaseAudioJob: async () => {
        if (audio.exitCode === null && audio.signalCode === null) throw new Error('Audio process is still running');
        const { eq } = await import('drizzle-orm');
        const [row] = await db.select().from(versions).where(eq(versions.id, version.id));
        if (row.status !== 'processing') throw new Error('Cancelled audio must not become ready');
        console.log('audio-stopped-before-release');
        await db.delete(projects).where(eq(projects.id, project.id));
        await db.delete(users).where(eq(users.id, user.id));
        await db.$client.end();
      },
      renewAudioJob: async () => {}, finishAudioJob: async () => { throw new Error('Must not finish'); }, LEASE_MS: 300000,
    }));
  `);
  try {
    await run.until('audio-started');
    run.child.kill('SIGTERM');
    await run.until('audio-stopped-before-release');
    expect(await run.child.exited).toBe(0);
  } finally { await run.close(); }
}, 30_000);
