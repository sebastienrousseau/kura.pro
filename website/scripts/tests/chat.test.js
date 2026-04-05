import { describe, it, expect, vi } from 'vitest';

const { onRequestPost } = await import('../../../functions/api/chat.js');

function makeContext({ body, env = {} }) {
  return {
    request: {
      json: vi.fn().mockResolvedValue(body),
    },
    env: {
      AI: env.AI ?? {
        run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] }),
      },
      VECTOR_INDEX: env.VECTOR_INDEX ?? {
        query: vi.fn().mockResolvedValue({ matches: [] }),
      },
      RATE_KV: 'RATE_KV' in env ? env.RATE_KV : {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}

async function readFullStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

function makeAIStream(chunks) {
  const encoder = new TextEncoder();
  let idx = 0;
  return {
    getReader: () => ({
      read: vi.fn().mockImplementation(() => {
        if (idx < chunks.length) {
          const chunk = chunks[idx++];
          return Promise.resolve({
            done: false,
            value: typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
          });
        }
        return Promise.resolve({ done: true, value: undefined });
      }),
    }),
  };
}

describe('POST /api/chat', () => {
  // --- Input validation ---
  it('returns 400 for missing message', async () => {
    const ctx = makeContext({ body: {} });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Message is required');
  });

  it('returns 400 for empty string message', async () => {
    const ctx = makeContext({ body: { message: '   ' } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-string message', async () => {
    const ctx = makeContext({ body: { message: 123 } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const ctx = makeContext({ body: {} });
    ctx.request.json = vi.fn().mockRejectedValue(new Error('bad json'));
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON body');
  });

  // --- Rate limiting ---
  it('returns 429 when monthly limit reached', async () => {
    const ctx = makeContext({
      body: { message: 'hello' },
      env: {
        RATE_KV: {
          get: vi.fn().mockResolvedValue('1000'),
          put: vi.fn(),
        },
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('limit_reached');
  });

  it('works without RATE_KV binding', async () => {
    const stream = makeAIStream(['data: {"response":"Hi"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hello' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: null,
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    await readFullStream(res);
  });

  it('handles RATE_KV.get error gracefully', async () => {
    const stream = makeAIStream(['data: {"response":"ok"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hello' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: {
          get: vi.fn().mockRejectedValue(new Error('KV down')),
          put: vi.fn(),
        },
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    await readFullStream(res);
  });

  it('handles RATE_KV.put error gracefully', async () => {
    const stream = makeAIStream(['data: {"response":"ok"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hello' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: {
          get: vi.fn().mockResolvedValue('5'),
          put: vi.fn().mockRejectedValue(new Error('KV write fail')),
        },
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    await readFullStream(res);
  });

  // --- AI error ---
  it('returns 500 on AI error', async () => {
    const ctx = makeContext({
      body: { message: 'hello' },
      env: {
        AI: { run: vi.fn().mockRejectedValue(new Error('AI unavailable')) },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(500);
  });

  // --- Streaming with full consumption ---
  it('streams tokens, metadata, and done event with follow-ups', async () => {
    const stream = makeAIStream([
      'data: {"response":"Hello "}\n\n',
      'data: {"response":"world"}\n\ndata: {"response":"\\nFOLLOW_UPS: Q1?|Q2?"}\n\ndata: [DONE]\n\n',
    ]);
    const ctx = makeContext({
      body: { message: 'hi', history: [{ role: 'user', content: 'prev' }, { role: 'assistant', content: 'ans' }] },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: {
          query: vi.fn().mockResolvedValue({
            matches: [
              { score: 0.8, metadata: { source: 'a.md', content: 'Content A.' } },
              { score: 0.7, metadata: { source: 'b.md', content: 'Content B.' } },
            ],
          }),
        },
        RATE_KV: { get: vi.fn().mockResolvedValue('10'), put: vi.fn() },
      },
    });

    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const body = await readFullStream(res);
    expect(body).toContain('event: metadata');
    expect(body).toContain('event: token');
    expect(body).toContain('event: done');
    expect(body).toContain('"followUps"');
  });

  it('handles high confidence (>0.75) and medium confidence paths', async () => {
    // High confidence
    const stream1 = makeAIStream(['data: {"response":"ans"}\n\ndata: [DONE]\n\n']);
    const ctx1 = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream1),
        },
        VECTOR_INDEX: {
          query: vi.fn().mockResolvedValue({
            matches: [{ score: 0.9, metadata: { source: 'a.md', content: 'High.' } }],
          }),
        },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res1 = await onRequestPost(ctx1);
    const body1 = await readFullStream(res1);
    expect(body1).toContain('"confidence":"high"');

    // Medium confidence
    const stream2 = makeAIStream(['data: {"response":"ans"}\n\ndata: [DONE]\n\n']);
    const ctx2 = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream2),
        },
        VECTOR_INDEX: {
          query: vi.fn().mockResolvedValue({
            matches: [{ score: 0.65, metadata: { source: 'a.md', content: 'Med.' } }],
          }),
        },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res2 = await onRequestPost(ctx2);
    const body2 = await readFullStream(res2);
    expect(body2).toContain('"confidence":"medium"');
  });

  it('handles low confidence when no matches above threshold', async () => {
    const stream = makeAIStream(['data: {"response":"dunno"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: {
          query: vi.fn().mockResolvedValue({
            matches: [{ score: 0.3, metadata: { source: 'a.md', content: 'Low.' } }],
          }),
        },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"confidence":"low"');
  });

  it('handles string value from AI stream (typeof value === string)', async () => {
    // Simulate AI stream returning string chunks directly
    let idx = 0;
    const stringChunks = ['data: {"response":"str"}\n\ndata: [DONE]\n\n'];
    const stream = {
      getReader: () => ({
        read: vi.fn().mockImplementation(() => {
          if (idx < stringChunks.length) {
            return Promise.resolve({ done: false, value: stringChunks[idx++] });
          }
          return Promise.resolve({ done: true, value: undefined });
        }),
      }),
    };
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"text":"str"');
  });

  it('handles data without response key (no-op)', async () => {
    const stream = makeAIStream(['data: {"other":"val"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    // Should still have metadata and done, but no token events
    expect(body).toContain('event: metadata');
    expect(body).toContain('event: done');
  });

  it('handles invalid JSON in stream data gracefully', async () => {
    const stream = makeAIStream(['data: {not-json}\n\ndata: {"response":"ok"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"text":"ok"');
  });

  it('handles remaining buffer with valid data after stream ends', async () => {
    // Send data that doesn't end with newline — stays in lineBuffer
    const stream = makeAIStream(['data: {"response":"buf"}\n\ndata: {"response":"tail"}']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"text":"buf"');
    expect(body).toContain('"text":"tail"');
  });

  it('handles remaining buffer with [DONE]', async () => {
    const stream = makeAIStream(['data: {"response":"x"}\n\ndata: [DONE]']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"text":"x"');
  });

  it('handles remaining buffer with invalid JSON', async () => {
    const stream = makeAIStream(['data: {"response":"x"}\n\ndata: {broken']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('event: done');
  });

  it('handles remaining buffer without response key', async () => {
    const stream = makeAIStream(['data: {"other":"val"}']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('event: done');
    expect(body).not.toContain('event: token');
  });

  it('handles remaining buffer that is empty', async () => {
    // Buffer ends cleanly with trailing newline
    const stream = makeAIStream(['data: {"response":"clean"}\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"text":"clean"');
  });

  it('sends error event when stream reader throws', async () => {
    const stream = {
      getReader: () => ({
        read: vi.fn().mockRejectedValue(new Error('stream broke')),
      }),
    };
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('event: error');
    expect(body).toContain('Stream interrupted');
  });

  it('handles non-data lines in stream (skipped)', async () => {
    const stream = makeAIStream([': comment\nevent: ping\ndata: {"response":"ok"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"text":"ok"');
  });

  // --- Extended input validation ---
  it('returns 400 for message with only spaces', async () => {
    const ctx = makeContext({ body: { message: '     ' } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('handles very long message (>10KB)', async () => {
    const longMsg = 'a'.repeat(11000);
    const stream = makeAIStream(['data: {"response":"ok"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: longMsg },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    // Should either 200 (accepted) or 400 (rejected for length) — not crash
    expect([200, 400]).toContain(res.status);
  });

  it('returns 400 for message of type number', async () => {
    const ctx = makeContext({ body: { message: 42 } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for message of type object', async () => {
    const ctx = makeContext({ body: { message: { text: 'hello' } } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for message of type array', async () => {
    const ctx = makeContext({ body: { message: ['hello'] } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
  });

  // --- History edge cases ---
  it('handles history with 20 messages (slicing)', async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
    }));
    const stream = makeAIStream(['data: {"response":"ok"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi', history },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    await readFullStream(res);
  });

  it('handles history with malformed entries gracefully', async () => {
    const history = [
      { role: 'user', content: 'hello' },
      { badKey: 'no role or content' },
      null,
    ];
    const stream = makeAIStream(['data: {"response":"ok"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi', history },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    // Should not crash — either 200 or handle error
    expect([200, 400, 500]).toContain(res.status);
  });

  // --- Rate limit boundary ---
  it('allows request at 99 daily (below soft limit)', async () => {
    const stream = makeAIStream(['data: {"response":"ok"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hello' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue('99'), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    await readFullStream(res);
  });

  // --- Stream with empty chunks ---
  it('handles stream with empty data lines', async () => {
    const stream = makeAIStream(['data: \n\ndata: {"response":"ok"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('event: done');
  });

  // --- AI response with empty sources ---
  it('handles AI response with empty vector matches', async () => {
    const stream = makeAIStream(['data: {"response":"ans"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"sources":[]');
  });

  // --- Confidence boundary ---
  it('returns confidence=high for score exactly 0.76', async () => {
    const stream = makeAIStream(['data: {"response":"ans"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: {
          query: vi.fn().mockResolvedValue({
            matches: [{ score: 0.76, metadata: { source: 'x.md', content: 'data' } }],
          }),
        },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"confidence":"high"');
  });

  it('returns confidence=medium for score 0.65', async () => {
    const stream = makeAIStream(['data: {"response":"ans"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: {
          query: vi.fn().mockResolvedValue({
            matches: [{ score: 0.65, metadata: { source: 'x.md', content: 'data' } }],
          }),
        },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"confidence":"medium"');
  });

  it('returns confidence=low for score exactly 0.49', async () => {
    const stream = makeAIStream(['data: {"response":"ans"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: {
          query: vi.fn().mockResolvedValue({
            matches: [{ score: 0.49, metadata: { source: 'x.md', content: 'data' } }],
          }),
        },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"confidence":"low"');
  });

  // --- SSE format validation ---
  it('SSE response has Content-Type text/event-stream', async () => {
    const stream = makeAIStream(['data: {"response":"test"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: { run: vi.fn().mockResolvedValueOnce({ data: [[0.1]] }).mockResolvedValueOnce(stream) },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    await readFullStream(res);
  });

  it('SSE response has Cache-Control no-cache', async () => {
    const stream = makeAIStream(['data: {"response":"test"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: { run: vi.fn().mockResolvedValueOnce({ data: [[0.1]] }).mockResolvedValueOnce(stream) },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
    await readFullStream(res);
  });

  it('SSE metadata event comes before token events', async () => {
    const stream = makeAIStream(['data: {"response":"word"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: { run: vi.fn().mockResolvedValueOnce({ data: [[0.1]] }).mockResolvedValueOnce(stream) },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    const metaIdx = body.indexOf('event: metadata');
    const tokenIdx = body.indexOf('event: token');
    if (tokenIdx !== -1) {
      expect(metaIdx).toBeLessThan(tokenIdx);
    }
  });

  it('SSE done event comes last', async () => {
    const stream = makeAIStream(['data: {"response":"word"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: { run: vi.fn().mockResolvedValueOnce({ data: [[0.1]] }).mockResolvedValueOnce(stream) },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    const doneIdx = body.lastIndexOf('event: done');
    const lastTokenIdx = body.lastIndexOf('event: token');
    if (lastTokenIdx !== -1) {
      expect(doneIdx).toBeGreaterThan(lastTokenIdx);
    }
  });

  it('400 response is JSON (not SSE)', async () => {
    const ctx = makeContext({ body: {} });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('429 response is JSON (not SSE)', async () => {
    const ctx = makeContext({
      body: { message: 'hello' },
      env: {
        RATE_KV: { get: vi.fn().mockResolvedValue('1000'), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('handles multiple follow-ups separated by pipe', async () => {
    const stream = makeAIStream(['data: {"response":"text\\nFOLLOW_UPS: Question 1?|Question 2?|Question 3?"}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: { run: vi.fn().mockResolvedValueOnce({ data: [[0.1]] }).mockResolvedValueOnce(stream) },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"followUps"');
  });

  it('handles no follow-ups in response text', async () => {
    const stream = makeAIStream(['data: {"response":"No follow-ups here."}\n\ndata: [DONE]\n\n']);
    const ctx = makeContext({
      body: { message: 'hi' },
      env: {
        AI: {
          run: vi.fn()
            .mockResolvedValueOnce({ data: [[0.1]] })
            .mockResolvedValueOnce(stream),
        },
        VECTOR_INDEX: { query: vi.fn().mockResolvedValue({ matches: [] }) },
        RATE_KV: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
      },
    });
    const res = await onRequestPost(ctx);
    const body = await readFullStream(res);
    expect(body).toContain('"followUps":[]');
  });
});
