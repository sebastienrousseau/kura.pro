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
      return new Response(
        JSON.stringify({ error: 'limit_reached', message: 'Monthly query limit reached. The Concierge will be back next month.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  let message, history;
  try {
    const body = await context.request.json();
    message = body.message;
    history = body.history || [];
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Generate embedding for the user's question
    const { data: queryVector } = await AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [message],
    });

    // 2. Query Vectorize for the top 5 most relevant context chunks
    const matches = await VECTOR_INDEX.query(queryVector[0], {
      topK: 5,
      returnMetadata: 'all',
    });

    const contextText = matches.matches
      .filter((m) => m.score > 0.5)
      .map((m) => `[Source: ${m.metadata.source}]\n${m.metadata.content}`)
      .join('\n\n---\n\n');

    // 3. Build the System Prompt
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

CONTEXT:
${contextText || 'No relevant context found for this query.'}`;

    // 4. Run inference with conversation history
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-5).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    const response = await AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
      messages,
      max_tokens: 512,
    });

    const sources = [
      ...new Set(
        matches.matches
          .filter((m) => m.score > 0.5)
          .map((m) => m.metadata.source)
      ),
    ];

    // 5. Increment counters
    if (RATE_KV) {
      try {
        await RATE_KV.put(monthKey, String(monthCount + 1), { expirationTtl: 86400 * 35 });
        await RATE_KV.put(dayKey, String(dayCount + 1), { expirationTtl: 86400 * 2 });
      } catch {}
    }

    return new Response(
      JSON.stringify({
        response: response.response,
        sources,
        remaining: RATE_KV ? MONTHLY_LIMIT - monthCount - 1 : null,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'An internal error occurred. Please try again.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
