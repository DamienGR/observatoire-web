#!/usr/bin/env node
/**
 * Runs a command under a hard wall-clock budget.
 *
 * CLAUDE.md §5 makes the per-layer time budgets contractual *and measured*:
 * "Un budget qu'on ne mesure pas dérive sans que personne ne le remarque".
 * This wrapper is that measurement. It fails the run when the budget is blown,
 * so a slow test layer breaks CI instead of quietly stretching it.
 *
 * Usage: node scripts/budget.mjs <seconds> <command> [args...]
 */
import { spawn } from 'node:child_process';

const [, , rawSeconds, command, ...args] = process.argv;

const seconds = Number(rawSeconds);
if (!Number.isFinite(seconds) || seconds <= 0 || !command) {
  process.stderr.write('usage: node scripts/budget.mjs <seconds> <command> [args...]\n');
  process.exit(2);
}

const startedAt = process.hrtime.bigint();
const elapsedSeconds = () => Number(process.hrtime.bigint() - startedAt) / 1e9;

const child = spawn(command, args, { stdio: 'inherit' });

let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  child.kill('SIGTERM');
  // SIGTERM is a request; make sure the process actually goes away.
  setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
}, seconds * 1_000);

child.on('error', (error) => {
  clearTimeout(timer);
  process.stderr.write(`budget: failed to start "${command}": ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  const elapsed = elapsedSeconds().toFixed(1);

  if (timedOut) {
    process.stderr.write(
      `\nbudget: "${command}" exceeded its ${seconds}s budget (killed after ${elapsed}s).\n` +
        'See CLAUDE.md §5 — a layer over budget is a problem to fix, not a threshold to raise.\n',
    );
    process.exit(1);
  }

  process.stderr.write(`budget: "${command}" finished in ${elapsed}s (budget ${seconds}s).\n`);

  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
