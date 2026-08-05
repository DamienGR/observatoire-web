import { describe, expect, it } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { NetworkAccessInUnitTestError } from '../setup/no-io.js';

/**
 * The guard is the load-bearing rule of the unit layer (CLAUDE.md §5), so it
 * gets tested like production code. If these tests ever go green while the
 * guard is gone, the unit project silently becomes an integration project.
 */
describe('anti-I/O guard', () => {
  it('rejects fetch and names the URL that was attempted', () => {
    expect(() => fetch('https://geo.api.gouv.fr/communes')).toThrow(NetworkAccessInUnitTestError);
    expect(() => fetch('https://geo.api.gouv.fr/communes')).toThrow(
      /fetch\("https:\/\/geo\.api\.gouv\.fr\/communes"\)/,
    );
  });

  it('rejects fetch called with a URL or a Request', () => {
    expect(() => fetch(new URL('https://example.org/a'))).toThrow(/https:\/\/example\.org\/a/);
    expect(() => fetch(new Request('https://example.org/b'))).toThrow(/https:\/\/example\.org\/b/);
  });

  it('rejects raw TCP sockets, the transport a Postgres client uses', () => {
    expect(() => new net.Socket().connect(5432, 'db.neon.tech')).toThrow(
      NetworkAccessInUnitTestError,
    );
    expect(() => new net.Socket().connect(5432, 'db.neon.tech')).toThrow(
      /TCP connection to db\.neon\.tech:5432/,
    );
  });

  it('rejects sockets opened through the options form and through unix paths', () => {
    expect(() => new net.Socket().connect({ host: 'example.org', port: 443 })).toThrow(
      /TCP connection to example\.org:443/,
    );
    expect(() => new net.Socket().connect({ path: '/var/run/postgres.sock' })).toThrow(
      /socket connection to \/var\/run\/postgres\.sock/,
    );
  });

  it('rejects node:http, which reaches the network without going through fetch', () => {
    expect(() => http.get('http://example.org')).toThrow(NetworkAccessInUnitTestError);
  });

  it('explains where the test should live instead', () => {
    expect(() => fetch('https://example.org')).toThrow(/tests\/integration\//);
  });
});
