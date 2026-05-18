import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    // Exclude git worktrees under .claude/worktrees/ — they have their own
    // test suites that vitest would otherwise pick up when run from the root.
    exclude: ['.claude/**', 'node_modules/**'],
    setupFiles: ['./tests/setup.js'],
    // workflow-stats.test.js uses process.chdir() which is global state.
    // Run it in the forks pool so each file gets its own subprocess and
    // chdir calls cannot bleed into concurrently-running thread workers.
    poolMatchGlobs: [['tests/workflow-stats.test.js', 'forks']],
  },
});
