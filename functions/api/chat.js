export async function onRequestPost(context) {
  const { AI, VECTOR_INDEX } = context.env;

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
- Keep responses concise — 2-3 sentences unless the user asks for detail.
- Use markdown formatting for code blocks, lists, and emphasis.
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

    return new Response(
      JSON.stringify({
        response: response.response,
        sources,
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
