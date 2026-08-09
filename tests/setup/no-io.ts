import net from 'node:net';

/**
 * The anti-I/O guard for the unit project (CLAUDE.md §5).
 *
 * "Aucune I/O dans le projet unitaire, imposé par le code : un garde en setup
 * lève une exception si fetch ou le client Postgres est appelé. C'est ce qui
 * empêche la dérive sur deux ans — pas la bonne volonté."
 *
 * Two chokepoints cover everything a unit test could reach for:
 *
 *  - `fetch`, used by every call to PSI, geo.api or DILA;
 *  - `net.Socket.prototype.connect`, the single funnel through which TCP
 *    Postgres, `node:http`, `node:https` and `node:tls` all establish their
 *    connection. Patching it here catches transports that do not go through
 *    `fetch`, including ones no dependency uses yet.
 *
 * Filesystem access is deliberately *not* blocked: Vitest, the V8 coverage
 * provider and the module loader all need it, so blocking it would only teach
 * everyone to disable the guard.
 */
export class NetworkAccessInUnitTestError extends Error {
  override readonly name = 'NetworkAccessInUnitTestError';

  constructor(attempt: string) {
    super(
      `Network access is forbidden in the unit test project: ${attempt}.\n` +
        'Unit tests cover src/lib/ — pure logic, zero I/O (CLAUDE.md §5).\n' +
        'Inject the transport and assert on a fake, or move this test to the ' +
        'integration project (tests/integration/).',
    );
  }
}

function describeFetchTarget(input: unknown): string {
  if (typeof input === 'string') return `fetch("${input}")`;
  if (input instanceof URL) return `fetch("${input.href}")`;
  if (input instanceof Request) return `fetch("${input.url}")`;
  return 'fetch(...)';
}

function describeSocketTarget(args: readonly unknown[]): string {
  const [first, second] = args;

  if (typeof first === 'number') {
    const host = typeof second === 'string' ? second : 'localhost';
    return `a TCP connection to ${host}:${String(first)}`;
  }
  if (typeof first === 'string') {
    return `a socket connection to ${first}`;
  }
  if (typeof first === 'object' && first !== null) {
    const options = first as { host?: unknown; port?: unknown; path?: unknown };
    if (typeof options.path === 'string') {
      return `a socket connection to ${options.path}`;
    }
    const host = typeof options.host === 'string' ? options.host : 'localhost';
    const port = typeof options.port === 'number' ? String(options.port) : '?';
    return `a TCP connection to ${host}:${port}`;
  }
  return 'a socket connection';
}

export function installNoIoGuard(): void {
  globalThis.fetch = (input: unknown) => {
    throw new NetworkAccessInUnitTestError(describeFetchTarget(input));
  };

  const forbidConnect = function connect(this: net.Socket, ...args: unknown[]): net.Socket {
    throw new NetworkAccessInUnitTestError(describeSocketTarget(args));
  };

  net.Socket.prototype.connect = forbidConnect;
}

installNoIoGuard();
