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

export async function search({ query, maxResults = 5 }) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY not set.');

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
  });

  if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.results ?? []).map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}
