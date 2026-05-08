import { withRetry } from '../retry.js';
import { adapterErrorFromResponse, logAdapterError } from '../errors.js';

export function searchToolDefinition() {
  return {
    kind: 'normalized',
    name: 'web_search',
    description: 'Search the web for current information. Use this whenever a fact needs verification (hours, prices, closures, current events). Pass a focused query string.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
      },
      required: ['query'],
    },
  };
}

export async function search({ query, maxResults = 5, signal = null }) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY not set.');

  const data = await withRetry(async () => {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: false,
        search_depth: 'advanced',
      }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      const cause = await res.text();
      const err = adapterErrorFromResponse({ provider: 'tavily', status: res.status, cause });
      logAdapterError(err);
      throw err;
    }
    return res.json();
  }, { label: 'tavily', signal });

  return (data.results ?? []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}
