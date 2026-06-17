import { describe, it, expect, vi, beforeEach } from 'vitest';

const connectFn = vi.fn().mockResolvedValue(undefined);

vi.mock('../server.js', () => ({
  createServer: () => ({ connect: connectFn }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class StdioServerTransport {
    constructor() {
      this.kind = 'stdio';
    }
  },
}));

beforeEach(() => {
  connectFn.mockClear();
  vi.resetModules();
});

describe('index entry point', () => {
  it('builds the server and wires it to a stdio transport', async () => {
    await import('../index.js');
    expect(connectFn).toHaveBeenCalledTimes(1);
    const transport = connectFn.mock.calls[0][0];
    expect(transport.kind).toBe('stdio');
  });
});
