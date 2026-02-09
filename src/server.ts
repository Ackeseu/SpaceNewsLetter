import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { sequelize } from './config/database';
import subscriptionRoutes from './routes/subscriptionRoutes';
import newsletterRoutes from './routes/newsletterRoutes';

// Load environment variables
dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Routes
app.get('/', (req: Request, res: Response) => {
  res.sendFile('./public/index.html');
});

app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/newsletters', newsletterRoutes);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Database connection and server start
const startServer = async () => {
  try {
    console.log('Starting NewSpace Newsletter Server...');
    console.log('Database Host:', process.env.DB_HOST);
    
    // Set a timeout for database connection (10 seconds)
    const dbConnectionPromise = sequelize.authenticate();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database connection timeout')), 10000)
    );

    try {
      // Test database connection with timeout
      await Promise.race([dbConnectionPromise, timeoutPromise]);
      console.log('✓ Database connection established successfully');

      // Sync database models - use alter: true only on first run to add missing columns
      // Set ALTER_DB=true environment variable if you need to alter existing schema
      const shouldAlter = process.env.ALTER_DB === 'true' || process.env.NODE_ENV === 'development';
      await sequelize.sync({ alter: shouldAlter });
      console.log(`✓ Database models synchronized${shouldAlter ? ' (with schema modifications)' : ''}`);
    } catch (dbError) {
      if (dbError instanceof Error && dbError.message === 'Database connection timeout') {
        console.warn('⚠️  Database connection timeout - starting server without database');
      } else {
        console.warn('⚠️  Database connection failed - starting server without database');
        console.warn('Error:', dbError instanceof Error ? dbError.message : String(dbError));
      }
    }

    // Start server
    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ API available at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('✗ Unable to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
