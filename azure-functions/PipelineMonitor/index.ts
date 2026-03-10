let lastHealthyState: boolean | null = null;
let lastAlertAt: number | null = null;

const getMonitorToken = (): string => {
  return process.env.MONITOR_TOKEN || process.env.NEWSLETTER_SENDER_TOKEN || '';
};

const shouldSendAlert = (isHealthy: boolean, cooldownMinutes: number): boolean => {
  if (isHealthy) {
    return false;
  }

  const now = Date.now();
  const inCooldown =
    lastAlertAt !== null && now - lastAlertAt < cooldownMinutes * 60 * 1000;

  const stateChangedToUnhealthy = lastHealthyState !== false;
  return stateChangedToUnhealthy || !inCooldown;
};

const sendAlert = async (
  apiUrl: string,
  monitorToken: string,
  status: Record<string, unknown>,
  context: any
): Promise<void> => {
  const response = await fetch(`${apiUrl}/api/newsletters/monitor/alert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-monitor-token': monitorToken
    },
    body: JSON.stringify({
      subject: 'NewSpace Newsletter Monitor Alert',
      details: 'Pipeline health check detected stale ingestion or delivery risk.',
      status
    })
  });

  if (!response.ok) {
    throw new Error(`Alert endpoint returned ${response.status}: ${response.statusText}`);
  }

  context.log('✓ Monitor alert sent successfully');
};

export default async function PipelineMonitor(context: any, myTimer: any): Promise<void> {
  context.log('Pipeline monitor timer started');

  const apiUrl = process.env.API_URL || 'http://localhost:3000';
  const monitorToken = getMonitorToken();
  const cooldownMinutes = Number(process.env.MONITOR_ALERT_COOLDOWN_MINUTES || 180);

  if (!monitorToken) {
    context.error('MONITOR_TOKEN or NEWSLETTER_SENDER_TOKEN is required for PipelineMonitor');
    throw new Error('Missing monitor token');
  }

  try {
    const statusResponse = await fetch(`${apiUrl}/api/newsletters/monitor/status`, {
      method: 'GET',
      headers: {
        'x-monitor-token': monitorToken
      }
    });

    if (!statusResponse.ok) {
      throw new Error(`Status endpoint returned ${statusResponse.status}: ${statusResponse.statusText}`);
    }

    const status = (await statusResponse.json()) as Record<string, unknown> & { healthy?: boolean };
    const isHealthy = Boolean(status.healthy);

    context.log(`Pipeline monitor status: healthy=${isHealthy}`);

    if (isHealthy) {
      lastHealthyState = true;
      return;
    }

    if (shouldSendAlert(false, cooldownMinutes)) {
      await sendAlert(apiUrl, monitorToken, status, context);
      lastAlertAt = Date.now();
    } else {
      context.log('Monitor alert suppressed due to cooldown window');
    }

    lastHealthyState = false;
  } catch (error) {
    context.error(`Pipeline monitor error: ${error instanceof Error ? error.message : String(error)}`);

    if (shouldSendAlert(false, cooldownMinutes)) {
      try {
        await sendAlert(apiUrl, monitorToken, {
          healthy: false,
          monitorError: error instanceof Error ? error.message : String(error),
          checkedAt: new Date().toISOString()
        }, context);
        lastAlertAt = Date.now();
      } catch (alertError) {
        context.error(`Failed to send monitor alert: ${alertError instanceof Error ? alertError.message : String(alertError)}`);
      }
    }

    lastHealthyState = false;
    throw error;
  }
}
