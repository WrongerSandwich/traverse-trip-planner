import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { realpathSync } from 'node:fs';

// In a git-worktree dev setup (scripts/new-worktree.sh), node_modules is a
// symlink into the main checkout. Its realpath therefore lives OUTSIDE the
// worktree root, so Vite's dev-server fs allow-list (default: the workspace
// root) 403s the client runtime served from there — the page SSR-loads but
// never hydrates. Allow that realpath too, but ONLY when node_modules is
// actually symlinked, so normal checkouts are unaffected. Dev-server only;
// no effect on the production build.
function symlinkedModulesRealpath() {
  try {
    const real = realpathSync('node_modules');
    return real.startsWith(realpathSync('.')) ? null : real;
  } catch {
    return null; // no node_modules yet
  }
}
const extraFsAllow = symlinkedModulesRealpath();

export default defineConfig({
  plugins: [sveltekit()],
  ...(extraFsAllow
    ? { server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), extraFsAllow] } } }
    : {}),
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
