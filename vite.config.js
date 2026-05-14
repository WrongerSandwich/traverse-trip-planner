import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    // Exclude git worktrees under .claude/worktrees/ — they have their own
    // test suites that vitest would otherwise pick up when run from the root.
    exclude: ['.claude/**', 'node_modules/**'],
  },
});
