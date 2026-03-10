export default async function SendNewsletter(context: any, myTimer: any): Promise<void> {
  context.log('Newsletter sending timer trigger function started');
  const startTime = Date.now();

  try {
    const apiUrl = process.env.API_URL || 'http://localhost:3000';
    const senderToken = process.env.NEWSLETTER_SENDER_TOKEN;

    if (!senderToken) {
      throw new Error('NEWSLETTER_SENDER_TOKEN is not configured');
    }

    const sendByFrequency = async (frequency: 'daily' | 'weekly') => {
      context.log(`Calling newsletter endpoint for ${frequency} subscribers at ${apiUrl}/api/newsletters/send-scheduled`);

      const response = await fetch(`${apiUrl}/api/newsletters/send-scheduled`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sender-token': senderToken,
          'x-scheduled-source': 'function'
        },
        body: JSON.stringify({ frequency })
      });

      if (!response.ok) {
        throw new Error(`[${frequency}] API returned ${response.status}: ${response.statusText}`);
      }

      return await response.json() as { sent: number; failed: number };
    };

    const dailyResult = await sendByFrequency('daily');

    let weeklyResult: { sent: number; failed: number } = { sent: 0, failed: 0 };
    const isMondayUtc = new Date().getUTCDay() === 1;
    if (isMondayUtc) {
      weeklyResult = await sendByFrequency('weekly');
    }

    const result = {
      sent: dailyResult.sent + weeklyResult.sent,
      failed: dailyResult.failed + weeklyResult.failed
    };
    const duration = Date.now() - startTime;

    context.log(`✓ Newsletter sending completed. Daily sent=${dailyResult.sent}, Daily failed=${dailyResult.failed}, Weekly sent=${weeklyResult.sent}, Weekly failed=${weeklyResult.failed}. Total sent ${result.sent}, failed ${result.failed} in ${duration}ms`);
  } catch (error) {
    context.error(`Error sending newsletter: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
