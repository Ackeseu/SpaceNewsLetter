# NewSpace Newsletter Project - Workspace Instructions

This is a Node.js/Express application for managing a NewSpace newsletter subscription system running on Azure.

## Project Stack
- Backend: Node.js + Express + TypeScript
- Database: Azure Database for PostgreSQL with Sequelize ORM
- Email: Azure Communication Services
- Scheduling: Azure Functions
- News Sources: RSS feeds (SpaceNews, NASA, ESA) + NewsAPI

## Project Structure
- `/src` - Main application code
- `/src/controllers` - Route handlers
- `/src/models` - Database models
- `/src/services` - Business logic (email, news aggregation)
- `/src/utils` - Helper functions
- `/src/config` - Configuration files
- `/azure-functions` - Azure Functions for scheduled tasks

## Development Guidelines
- Use TypeScript for all new code
- Follow RESTful API conventions
- Use async/await for asynchronous operations
- Implement proper error handling
- Use environment variables for sensitive data
- Follow Azure best practices for service integration
