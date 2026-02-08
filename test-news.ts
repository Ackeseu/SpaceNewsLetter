import dotenv from 'dotenv';
import { aggregateNews, fetchNewsAPI } from './src/services/newsAggregator';

dotenv.config();

async function testNewsAggregation() {
  try {
    console.log('Starting news aggregation test...\n');
    
    // Note: This will fail without database connection
    // We'll create a standalone version next
    const articlesAdded = await aggregateNews();
    
    console.log(`\n✓ Test complete! Added ${articlesAdded} articles`);
    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error);
    process.exit(1);
  }
}

testNewsAggregation();
