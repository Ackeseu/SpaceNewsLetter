import { app, InvocationContext, Timer } from '@azure/functions';

export async function SendNewsletter(myTimer: Timer, context: InvocationContext): Promise<void> {
  context.log('Newsletter sending timer trigger function started');
  const startTime = Date.now();

  try {
    const apiUrl = process.env.API_URL || 'http://localhost:3000';
    const senderToken = process.env.NEWSLETTER_SENDER_TOKEN || 'default-token';
    
    context.log(`Calling newsletter sending endpoint at ${apiUrl}/api/newsletters/send-scheduled`);
    
    const response = await fetch(`${apiUrl}/api/newsletters/send-scheduled`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sender-token': senderToken
      },
      body: JSON.stringify({
        frequency: 'weekly'
      })
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const result = await response.json() as { sent: number; failed: number };
    const duration = Date.now() - startTime;
    
    context.log(`✓ Newsletter sending completed. Sent ${result.sent} newsletters, ${result.failed} failed in ${duration}ms`);
  } catch (error) {
    context.error(`Error sending newsletter: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

app.timer('SendNewsletter', {
  schedule: '0 0 9 * * MON', // Every Monday at 9 AM UTC
  handler: SendNewsletter
});
