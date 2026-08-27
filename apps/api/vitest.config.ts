import { defineConfig } from 'vitest/config';

// The sweep and the outbox drain act on GLOBAL database state (any past-due booking, any
// PENDING notification) under one advisory lock per job. jobs.test.ts and gate.jobs.test.ts
// both exercise them against the shared test database, so test FILES must not run
// concurrently: a stub drain in one worker would claim (and fake-send) rows the gate suite
// expects to reach the real Mailpit, and vice versa. Tests inside a file already run
// sequentially; this only serializes the files.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
