import { aggregateNews } from './src/services/newsAggregator';
import { sequelize } from './src/config/database';

async function main() {
  try {
    console.log('Starting news aggregation...');
    await sequelize.authenticate();
    console.log('✓ Database connected');
    
    const count = await aggregateNews();
    console.log(`\n✓ Complete! Added ${count} new articles`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
