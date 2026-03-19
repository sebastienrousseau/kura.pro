const MONTHLY_LIMIT = 1000;
const DAILY_SOFT_LIMIT = 100;

export async function onRequestPost(context) {
  const { AI, VECTOR_INDEX, RATE_KV } = context.env;

  // --- Rate limiting via KV ---
  const now = new Date();
  const monthKey = `queries:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const dayKey = `queries:${now.toISOString().slice(0, 10)}`;

  let monthCount = 0;
  let dayCount = 0;

  if (RATE_KV) {
    try {
      monthCount = parseInt(await RATE_KV.get(monthKey)) || 0;
      dayCount = parseInt(await RATE_KV.get(dayKey)) || 0;
    } catch {}

    if (monthCount >= MONTHLY_LIMIT) {
      return Response.json(
        { error: 'limit_reached', message: 'Monthly query limit reached. The Concierge will be back next month.' },
        { status: 429 }
      );
    }
  }

  let message, history;
  try {
    const body = await context.request.json();
    message = body.message;
    history = body.history || [];
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return Response.json({ error: 'Message is required' }, { status: 400 });
  }

  try {
    // 1. Embed the user's question
    const { data: queryVector } = await AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [message],
    });

    // 2. Query Vectorize for top-5 relevant chunks
    const matches = await VECTOR_INDEX.query(queryVector[0], {
      topK: 5,
      returnMetadata: 'all',
    });

    const relevantMatches = matches.matches.filter((m) => m.score > 0.5);
    const contextText = relevantMatches
      .map((m, i) => `[${i + 1}] [Source: ${m.metadata.source}]\n${m.metadata.content}`)
      .join('\n\n---\n\n');

    const sources = [...new Set(relevantMatches.map((m) => m.metadata.source))];
    const avgScore = relevantMatches.length > 0
      ? relevantMatches.reduce((sum, m) => sum + m.score, 0) / relevantMatches.length
      : 0;
    const confidence = avgScore > 0.75 ? 'high' : avgScore > 0.6 ? 'medium' : 'low';

    // 3. System prompt
    const systemPrompt = `You are the CloudCDN Concierge — a knowledgeable, concise, and professional AI assistant for cloudcdn.pro.

RULES:
- Answer based ONLY on the context provided below.
- If the answer isn't in the context, say: "I don't have that specific information. Please contact support@cloudcdn.pro for help."
- NEVER copy-paste raw documentation. Always SUMMARIZE in your own words.
- Keep responses to 2-4 sentences maximum. Be punchy and direct.
- For pricing: give a brief summary (e.g., "We have 3 tiers: Free ($0), Pro ($29/mo), and Enterprise (custom).") then highlight key differences in one sentence.
- Only show bullet lists if the user explicitly asks for details or a comparison.
- Use markdown for **bold** emphasis and \`code\` but keep it minimal.
- When showing CLI commands, use proper code blocks.
- Never invent pricing, features, or limits not in the context.
- Reference your source numbers inline like [1], [2] when citing specific facts.
- At the END of your response, on a new line, output exactly: FOLLOW_UPS: followed by 2-3 short follow-up questions the user might ask next, separated by |. Example: FOLLOW_UPS: How do I upgrade?|What formats are supported?|Is there a free trial?

CONTEXT:
${contextText || 'No relevant context found for this query.'}`;

    // 4. Build messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-5).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    // 5. Increment counters early (before streaming)
    if (RATE_KV) {
      try {
        await RATE_KV.put(monthKey, String(monthCount + 1), { expirationTtl: 86400 * 35 });
        await RATE_KV.put(dayKey, String(dayCount + 1), { expirationTtl: 86400 * 2 });
      } catch {}
    }

    const remaining = RATE_KV ? MONTHLY_LIMIT - monthCount - 1 : null;

    // 6. Stream inference via TransformStream
    const aiStream = await AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages,
      max_tokens: 512,
      stream: true,
    });

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Process in background — return Response immediately
    (async () => {
      try {
        // Send metadata event
        await writer.write(
          encoder.encode(`event: metadata\ndata: ${JSON.stringify({ sources, confidence, remaining })}\n\n`)
        );

        // Read AI stream and forward tokens
        const reader = aiStream.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let lineBuffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
          lineBuffer += chunk;

          // Process complete lines only
          const parts = lineBuffer.split('\n');
          lineBuffer = parts.pop() || '';

          for (const line of parts) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.response) {
                  fullText += parsed.response;
                  await writer.write(
                    encoder.encode(`event: token\ndata: ${JSON.stringify({ text: parsed.response })}\n\n`)
                  );
                }
              } catch {}
            }
          }
        }

        // Process any remaining buffer
        if (lineBuffer.startsWith('data: ')) {
          const data = lineBuffer.slice(6).trim();
          if (data && data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              if (parsed.response) {
                fullText += parsed.response;
                await writer.write(
                  encoder.encode(`event: token\ndata: ${JSON.stringify({ text: parsed.response })}\n\n`)
                );
              }
            } catch {}
          }
        }

        // Parse follow-ups from full text
        let followUps = [];
        const fuMatch = fullText.match(/FOLLOW_UPS:\s*(.+)/);
        if (fuMatch) {
          followUps = fuMatch[1].split('|').map((s) => s.trim()).filter(Boolean).slice(0, 3);
        }

        // Send done event
        await writer.write(
          encoder.encode(`event: done\ndata: ${JSON.stringify({ followUps })}\n\n`)
        );
      } catch (err) {
        try {
          await writer.write(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`)
          );
        } catch {}
      } finally {
        try { await writer.close(); } catch {}
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return Response.json(
      { error: 'An internal error occurred. Please try again.' },
      { status: 500 }
    );
  }
}
