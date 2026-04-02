export default async function NewsAggregator(context: any, myTimer: any): Promise<void> {
  context.log('News aggregation timer trigger function started');
  const startTime = Date.now();

  try {
    const apiUrl = process.env.API_URL || 'http://localhost:3000';
    const triggerToken = process.env.NEWS_AGGREGATOR_TOKEN;

    if (!triggerToken) {
      throw new Error('NEWS_AGGREGATOR_TOKEN is not configured');
    }
    
    context.log(`Calling news aggregation endpoint at ${apiUrl}/api/newsletters/aggregate`);
    
    const response = await fetch(`${apiUrl}/api/newsletters/aggregate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-aggregator-token': triggerToken
      }
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const result = await response.json() as { articlesAdded: number };
    const duration = Date.now() - startTime;
    
    context.log(`✓ News aggregation completed successfully. Added ${result.articlesAdded} articles in ${duration}ms`);
  } catch (error) {
    context.error(`Error in news aggregation: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
