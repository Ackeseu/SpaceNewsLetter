const isFileOrigin = window.location.protocol === 'file:' || window.location.origin === 'null';
const API_URL = isFileOrigin
  ? 'https://newspace-newsletter-api.azurewebsites.net'
  : window.location.origin;

let adminToken = localStorage.getItem('adminToken');
let allSubscribers = [];
let allSubscribersForPreferences = [];
let allSources = [];
let currentEditId = null;
let currentEditEmail = null;
let monitorLastUpdatedAt = null;
let monitorLastUpdatedState = 'ok';
let monitorLastUpdatedTimer = null;
let subscriberPageState = {
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 1,
  hasPrev: false,
  hasNext: false
};

const ADMIN_CHANGELOG_FALLBACK_ENTRIES = [
  {
    date: '2026-03-10',
    title: 'Subscriber search, filters, and pagination moved server-side',
    detail: 'Improves performance for larger subscriber lists and keeps filter state queryable.'
  },
  {
    date: '2026-03-10',
    title: 'Source feed test action added',
    detail: 'Sources tab can now validate RSS fetch/parse and show sampled headlines.'
  },
  {
    date: '2026-03-10',
    title: 'Monitoring received freshness and reliability updates',
    detail: 'Includes last-updated ticker and improved bottom-section rendering flow.'
  }
];

function renderAdminChangelog(entries, updatedAt) {
  const listEl = document.getElementById('adminChangelogList');
  const updatedAtEl = document.getElementById('adminChangelogUpdatedAt');
  if (!listEl || !updatedAtEl) {
    return;
  }

  const safeEntries = Array.isArray(entries) && entries.length > 0
    ? entries
    : ADMIN_CHANGELOG_FALLBACK_ENTRIES;

  listEl.innerHTML = safeEntries.map((item) => `
    <li class="changelog-item">
      <div class="changelog-item-title">${item.title}</div>
      <div class="changelog-item-meta">${item.date} | ${item.detail}</div>
    </li>
  `).join('');

  const updatedDate = updatedAt ? new Date(updatedAt) : new Date();
  updatedAtEl.textContent = Number.isNaN(updatedDate.getTime())
    ? `Updated ${new Date().toLocaleTimeString()}`
    : `Updated ${updatedDate.toLocaleTimeString()}`;
}

async function loadAdminChangelog() {
  try {
    const response = await fetch(`${API_URL}/api/newsletters/admin/changelog`, {
      headers: { 'x-admin-token': adminToken }
    });

    if (!response.ok) {
      renderAdminChangelog(ADMIN_CHANGELOG_FALLBACK_ENTRIES, null);
      return;
    }

    const payload = await response.json();
    renderAdminChangelog(payload.entries, payload.updatedAt);
  } catch (error) {
    renderAdminChangelog(ADMIN_CHANGELOG_FALLBACK_ENTRIES, null);
  }
}

function renderMonitorLastUpdated() {
  const updatedEl = document.getElementById('monitorLastUpdated');
  if (!updatedEl) {
    return;
  }

  if (monitorLastUpdatedState === 'updating') {
    updatedEl.textContent = 'Last updated: updating...';
    return;
  }

  if (!monitorLastUpdatedAt) {
    updatedEl.textContent = 'Last updated: unavailable';
    return;
  }

  const ageSeconds = Math.max(Math.floor((Date.now() - monitorLastUpdatedAt) / 1000), 0);
  const staleSuffix = monitorLastUpdatedState === 'stale' ? ' (stale)' : '';
  updatedEl.textContent = `Last updated: ${ageSeconds}s ago${staleSuffix}`;
}

function setMonitorLastUpdatedState(state) {
  monitorLastUpdatedState = state;
  renderMonitorLastUpdated();
}

function ensureMonitorLastUpdatedTimer() {
  if (monitorLastUpdatedTimer) {
    return;
  }
  monitorLastUpdatedTimer = setInterval(() => {
    if (monitorLastUpdatedAt) {
      renderMonitorLastUpdated();
    }
  }, 1000);
}

function formatDateTime(value) {
  if (!value) {
    return 'Never';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Never' : date.toLocaleString();
}

function renderSubscribersTable(subscribers) {
  const tableEl = document.getElementById('subscribersTable');
  if (!tableEl) {
    return;
  }

  if (!subscribers || subscribers.length === 0) {
    tableEl.innerHTML = '<p style="padding: 20px;">No subscribers match current filters.</p>';
    return;
  }

  tableEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Name</th>
          <th>Status</th>
          <th>Frequency</th>
          <th>Last Delivery</th>
          <th>Topics</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${subscribers.map(sub => {
          const delivery = sub.deliveryStatus || {};
          const isRisk = Number(delivery.consecutiveFailures || 0) >= 2;
          const deliveryPill = delivery.lastDeliveryAt
            ? `<span class="delivery-pill ${isRisk ? 'bad' : 'good'}">${isRisk ? 'At Risk' : 'Healthy'}</span>`
            : '<span class="delivery-pill">No History</span>';
          const deliveryMeta = delivery.lastDeliveryAt
            ? `
              <div class="delivery-meta">Last: ${formatDateTime(delivery.lastDeliveryAt)}</div>
              <div class="delivery-meta">Failures streak: ${delivery.consecutiveFailures || 0}</div>
            `
            : '<div class="delivery-meta">No scheduled sends recorded yet</div>';

          return `
            <tr>
              <td>${sub.email}</td>
              <td>${(sub.firstName || '') + ' ' + (sub.lastName || '')}</td>
              <td>
                ${sub.isVerified
                  ? '<span class="status-badge status-verified">Verified</span>'
                  : '<span class="status-badge status-pending">Pending</span>'}
                ${!sub.isActive ? '<br><span class="status-badge status-inactive">Inactive</span>' : ''}
              </td>
              <td>${sub.frequency || 'weekly'}</td>
              <td>
                ${deliveryPill}
                ${deliveryMeta}
              </td>
              <td>${(sub.topics || []).join(', ') || '-'}</td>
              <td>
                <button class="action-btn edit-btn" data-action="edit" data-id="${sub.id}">Edit</button>
                <button class="action-btn delete-btn" data-action="remove" data-id="${sub.id}" data-email="${sub.email}">Remove</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderSubscribersPagination() {
  const paginationEl = document.getElementById('subscribersPagination');
  const metaEl = document.getElementById('subscribersPaginationMeta');
  const prevBtn = document.getElementById('subscribersPrevPage');
  const nextBtn = document.getElementById('subscribersNextPage');

  if (!paginationEl || !metaEl || !prevBtn || !nextBtn) {
    return;
  }

  const total = Number(subscriberPageState.total || 0);
  if (total === 0) {
    paginationEl.style.display = 'none';
    return;
  }

  paginationEl.style.display = 'flex';
  const start = (subscriberPageState.page - 1) * subscriberPageState.pageSize + 1;
  const end = Math.min(start + subscriberPageState.pageSize - 1, total);
  metaEl.textContent = `Showing ${start}-${end} of ${total} subscribers`;
  prevBtn.disabled = !subscriberPageState.hasPrev;
  nextBtn.disabled = !subscriberPageState.hasNext;
}

function buildSubscriberQueryParams(page = 1) {
  const searchInput = document.getElementById('subscriberSearch');
  const statusFilter = document.getElementById('subscriberStatusFilter');
  const frequencyFilter = document.getElementById('subscriberFrequencyFilter');
  const riskFilter = document.getElementById('subscriberDeliveryRiskFilter');

  const searchValue = searchInput && 'value' in searchInput ? String(searchInput.value || '').trim() : '';
  const statusValue = statusFilter && 'value' in statusFilter ? statusFilter.value : 'all';
  const frequencyValue = frequencyFilter && 'value' in frequencyFilter ? frequencyFilter.value : 'all';
  const riskValue = riskFilter && 'value' in riskFilter ? riskFilter.value : 'all';

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(subscriberPageState.pageSize));
  params.set('status', statusValue);
  params.set('frequency', frequencyValue);
  params.set('risk', riskValue);
  if (searchValue) {
    params.set('search', searchValue);
  }

  return params;
}

async function applySubscriberFilters() {
  await loadSubscribers(1);
}

// Login
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = document.getElementById('adminToken').value;
    adminToken = token;
    localStorage.setItem('adminToken', token);

    // Try to fetch stats to verify token
    try {
      const response = await fetch(`${API_URL}/api/subscriptions/stats`, {
        headers: { 'x-admin-token': token }
      });

      if (response.ok) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        loadDashboard();
      } else {
        localStorage.removeItem('adminToken');
        adminToken = null;
        showMessage('loginMessage', `Invalid token (status ${response.status})`, 'error');
      }
    } catch (error) {
      localStorage.removeItem('adminToken');
      adminToken = null;
      showMessage('loginMessage', 'Connection error', 'error');
    }
  });
}

async function loadDashboard() {
  await loadAdminChangelog();
  await loadStats();
  await loadSubscribers();
  await loadPrefEmails();
  await loadSources();
  await loadMonitorStatus();
}

async function loadMonitorStatus() {
  const summaryEl = document.getElementById('monitorSummary');
  const servicesEl = document.getElementById('monitorServices');
  const impactedEl = document.getElementById('monitorImpactedRecipients');
  const timelineEl = document.getElementById('monitorRunTimeline');
  const failureTrendsEl = document.getElementById('monitorFailureTrends');
  const domainHealthEl = document.getElementById('monitorDomainHealth');

  if (!summaryEl || !servicesEl || !impactedEl || !timelineEl || !failureTrendsEl || !domainHealthEl) {
    return;
  }

  ensureMonitorLastUpdatedTimer();
  setMonitorLastUpdatedState('updating');

  servicesEl.innerHTML = '<div class="loading"><span class="spinner"></span>Loading monitor data...</div>';
  impactedEl.innerHTML = '<div class="loading"><span class="spinner"></span>Checking impacted recipients...</div>';
  timelineEl.innerHTML = '<div class="loading"><span class="spinner"></span>Loading run timeline...</div>';
  failureTrendsEl.innerHTML = '<div class="loading"><span class="spinner"></span>Loading failure trends...</div>';
  domainHealthEl.innerHTML = '<div class="loading"><span class="spinner"></span>Loading domain health...</div>';

  try {
    const response = await fetch(`${API_URL}/api/newsletters/monitor/status`, {
      headers: {
        'x-monitor-token': adminToken
      }
    });

    if (!response.ok) {
      summaryEl.innerHTML = `
        <div class="monitor-card">
          <div class="monitor-label">Overall</div>
          <div class="monitor-value">Monitor Unauthorized</div>
        </div>
      `;
      servicesEl.innerHTML = '<div class="message show error">Unable to load monitor status. Verify monitor/admin token permissions.</div>';
      impactedEl.innerHTML = '<div class="message show error">Unable to load impacted recipient status.</div>';
      timelineEl.innerHTML = '<div class="message show error">Unable to load run timeline.</div>';
      failureTrendsEl.innerHTML = '<div class="message show error">Unable to load failure trends.</div>';
      domainHealthEl.innerHTML = '<div class="message show error">Unable to load domain health.</div>';
      setMonitorLastUpdatedState(monitorLastUpdatedAt ? 'stale' : 'unavailable');
      return;
    }

    const data = await response.json();

    const failureRatio = typeof data?.deliveryHealth?.failureRatioLast24h === 'number'
      ? `${(data.deliveryHealth.failureRatioLast24h * 100).toFixed(1)}%`
      : '-';
    const ignoredCount = Number(data?.deliveryHealth?.ignoredDeliveriesLast24h || 0);
    const impactedCount = Number(data?.realRecipientRisk?.impactedDailyRecipientsCount || 0);
    const lookbackHours = Number(data?.realRecipientRisk?.lookbackHours || 48);
    const impactedRecipients = Array.isArray(data?.realRecipientRisk?.recipientsWithoutRecentSuccess)
      ? data.realRecipientRisk.recipientsWithoutRecentSuccess
      : [];
    const finalOutcomeSuccessRate = typeof data?.deliveryOutcome?.finalOutcomeSuccessRateLast24h === 'number'
      ? `${(data.deliveryOutcome.finalOutcomeSuccessRateLast24h * 100).toFixed(1)}%`
      : '-';
    const attemptFailureRate = typeof data?.deliveryOutcome?.attemptFailureRateLast24h === 'number'
      ? `${(data.deliveryOutcome.attemptFailureRateLast24h * 100).toFixed(1)}%`
      : '-';
    const testFailureRatio = typeof data?.testDeliveryHealth?.failureRatioLast24h === 'number'
      ? `${(data.testDeliveryHealth.failureRatioLast24h * 100).toFixed(1)}%`
      : '-';
    const testDeliveryCount = Number(data?.testDeliveryHealth?.deliveriesLast24h || 0);
    const failedTestDeliveryCount = Number(data?.testDeliveryHealth?.failedDeliveriesLast24h || 0);
    const runTimeline = Array.isArray(data?.runTimeline) ? data.runTimeline : [];
    const topFailureReasons = Array.isArray(data?.failureTrends?.topFailureReasons)
      ? data.failureTrends.topFailureReasons
      : [];
    const domainHealth = Array.isArray(data?.domainHealth) ? data.domainHealth : [];

    monitorLastUpdatedAt = Date.now();
    setMonitorLastUpdatedState('ok');

    summaryEl.innerHTML = `
      <div class="monitor-card">
        <div class="monitor-label">Overall</div>
        <div class="monitor-value">${data.overallUp ? 'UP' : 'DOWN'}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Articles (24h)</div>
        <div class="monitor-value">${data.articlesLast24h ?? 0}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Daily Subscribers</div>
        <div class="monitor-value">${data.subscribers?.daily ?? 0}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Weekly Subscribers</div>
        <div class="monitor-value">${data.subscribers?.weekly ?? 0}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Scheduled Failure (24h, Scoped)</div>
        <div class="monitor-value">${failureRatio}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Test Failure (24h)</div>
        <div class="monitor-value">${testFailureRatio}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Test Sends (24h)</div>
        <div class="monitor-value">${failedTestDeliveryCount}/${testDeliveryCount} failed</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Ignored Demo/Test (24h)</div>
        <div class="monitor-value">${ignoredCount}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Impacted Daily (${lookbackHours}h)</div>
        <div class="monitor-value">${impactedCount}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Final Outcome Success (24h)</div>
        <div class="monitor-value">${finalOutcomeSuccessRate}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Attempt Failure Rate (24h)</div>
        <div class="monitor-value">${attemptFailureRate}</div>
      </div>
      <div class="monitor-card">
        <div class="monitor-label">Checked At</div>
        <div class="monitor-value" style="font-size:14px;">${new Date(data.checkedAt).toLocaleString()}</div>
      </div>
    `;

    const services = Array.isArray(data.services) ? data.services : [];
    if (services.length === 0) {
      servicesEl.innerHTML = '<div class="message show error">No service statuses returned by monitor endpoint.</div>';
      return;
    }

    servicesEl.innerHTML = services.map((service) => `
      <div class="service-item">
        <div class="service-meta">
          <div class="service-name">${service.label || service.id || 'Service'}</div>
          <div class="service-detail">${service.detail || 'No detail provided'}</div>
        </div>
        <div class="status-dot ${service.up ? 'up' : 'down'}">${service.up ? 'UP' : 'DOWN'}</div>
      </div>
    `).join('');

    if (impactedRecipients.length === 0) {
      impactedEl.innerHTML = '<div class="impact-item"><div class="impact-email">No impacted daily recipients in current window</div><div class="impact-time">OK</div></div>';
    } else {
      impactedEl.innerHTML = impactedRecipients.map((recipient) => {
        const hasSuccess = Boolean(recipient.lastSuccessAt);
        const lastSuccessDate = hasSuccess ? new Date(recipient.lastSuccessAt) : null;
        const lastSuccessAt = hasSuccess && lastSuccessDate
          ? lastSuccessDate.toLocaleString()
          : 'No recorded success';
        const ageHours = hasSuccess && lastSuccessDate
          ? Math.max(Math.floor((Date.now() - lastSuccessDate.getTime()) / (1000 * 60 * 60)), 0)
          : null;
        const ageText = ageHours === null ? 'Aging: Never succeeded' : `Aging: ${ageHours}h`;
        const ageClass = ageHours === null || ageHours >= 24 ? 'impact-age high' : 'impact-age';
        return `
          <div class="impact-item">
            <div class="impact-email">${recipient.email}</div>
            <div class="impact-time">Last success: ${lastSuccessAt}<span class="${ageClass}">${ageText}</span></div>
          </div>
        `;
      }).join('');
    }

    if (runTimeline.length === 0) {
      timelineEl.innerHTML = '<div class="message show error">No run timeline records available yet.</div>';
    } else {
      timelineEl.innerHTML = `
        <table class="monitor-table">
          <thead>
            <tr>
              <th>Frequency</th>
              <th>Run At</th>
              <th>Total</th>
              <th>Succeeded</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            ${runTimeline.map((item) => `
              <tr>
                <td>${item.frequency}</td>
                <td>${new Date(item.runAt).toLocaleString()}</td>
                <td>${item.total}</td>
                <td>${item.succeeded}</td>
                <td>${item.failed}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    if (topFailureReasons.length === 0) {
      failureTrendsEl.innerHTML = '<div class="impact-item"><div class="impact-email">No failed deliveries in current windows</div><div class="impact-time">OK</div></div>';
    } else {
      failureTrendsEl.innerHTML = `
        <table class="monitor-table">
          <thead>
            <tr>
              <th>Error</th>
              <th>24h</th>
              <th>Prev 24h</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            ${topFailureReasons.map((item) => {
              const delta = Number(item.delta || 0);
              const trendClass = delta > 0 ? 'trend-up' : (delta < 0 ? 'trend-down' : 'trend-flat');
              const trendText = delta > 0 ? `+${delta}` : `${delta}`;
              return `
                <tr>
                  <td>${item.error}</td>
                  <td>${item.currentCount}</td>
                  <td>${item.previousCount}</td>
                  <td class="${trendClass}">${trendText}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    if (domainHealth.length === 0) {
      domainHealthEl.innerHTML = '<div class="impact-item"><div class="impact-email">No scoped domain deliveries in the last 24h</div><div class="impact-time">N/A</div></div>';
    } else {
      domainHealthEl.innerHTML = `
        <table class="monitor-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Total</th>
              <th>Succeeded</th>
              <th>Failed</th>
              <th>Failure Rate</th>
            </tr>
          </thead>
          <tbody>
            ${domainHealth.map((item) => {
              const failurePct = typeof item.failureRate === 'number'
                ? `${(item.failureRate * 100).toFixed(1)}%`
                : '-';
              const isRisk = Number(item.total) >= 5 && Number(item.failureRate) > 0.8;
              const rowClass = isRisk ? 'domain-risk-row' : '';
              return `
                <tr class="${rowClass}">
                  <td>${item.domain}</td>
                  <td>${item.total}</td>
                  <td>${item.succeeded}</td>
                  <td>${item.failed}</td>
                  <td>${failurePct}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (error) {
    summaryEl.innerHTML = `
      <div class="monitor-card">
        <div class="monitor-label">Overall</div>
        <div class="monitor-value">Error</div>
      </div>
    `;
    servicesEl.innerHTML = '<div class="message show error">Error loading monitor status.</div>';
    impactedEl.innerHTML = '<div class="message show error">Error loading impacted recipient status.</div>';
    timelineEl.innerHTML = '<div class="message show error">Error loading run timeline.</div>';
    failureTrendsEl.innerHTML = '<div class="message show error">Error loading failure trends.</div>';
    domainHealthEl.innerHTML = '<div class="message show error">Error loading domain health.</div>';
    setMonitorLastUpdatedState(monitorLastUpdatedAt ? 'stale' : 'unavailable');
  }
}

async function loadStats() {
  try {
    const response = await fetch(`${API_URL}/api/subscriptions/stats`, {
      headers: { 'x-admin-token': adminToken }
    });
    const data = await response.json();

    document.getElementById('statsGrid').innerHTML = `
      <div class="stat-card">
        <h3>Total Subscribers</h3>
        <div class="number">${data.total || 0}</div>
      </div>
      <div class="stat-card">
        <h3>Active</h3>
        <div class="number">${data.active || 0}</div>
      </div>
      <div class="stat-card">
        <h3>Verified</h3>
        <div class="number">${data.verified || 0}</div>
      </div>
      <div class="stat-card">
        <h3>Unsubscribed</h3>
        <div class="number">${data.unsubscribed || 0}</div>
      </div>
    `;
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

async function loadSubscribers(page = 1) {
  try {
    const queryParams = buildSubscriberQueryParams(page);
    const response = await fetch(`${API_URL}/api/subscriptions/admin/list?${queryParams.toString()}`, {
      headers: { 'x-admin-token': adminToken }
    });

    if (!response.ok) {
      document.getElementById('subscribersTable').innerHTML = '<p style="padding: 20px;">Error loading subscribers</p>';
      const paginationEl = document.getElementById('subscribersPagination');
      if (paginationEl) {
        paginationEl.style.display = 'none';
      }
      return;
    }

    const payload = await response.json();
    if (Array.isArray(payload)) {
      allSubscribers = payload;
      subscriberPageState = {
        page: 1,
        pageSize: payload.length || 25,
        total: payload.length,
        totalPages: 1,
        hasPrev: false,
        hasNext: false
      };
    } else {
      allSubscribers = Array.isArray(payload.subscribers) ? payload.subscribers : [];
      subscriberPageState = {
        page: Number(payload.pagination?.page || 1),
        pageSize: Number(payload.pagination?.pageSize || 25),
        total: Number(payload.pagination?.total || 0),
        totalPages: Number(payload.pagination?.totalPages || 1),
        hasPrev: Boolean(payload.pagination?.hasPrev),
        hasNext: Boolean(payload.pagination?.hasNext)
      };
    }

    renderSubscribersTable(allSubscribers);
    renderSubscribersPagination();
  } catch (error) {
    console.error('Error:', error);
    document.getElementById('subscribersTable').innerHTML = '<p style="padding: 20px;">Error loading subscribers</p>';
    const paginationEl = document.getElementById('subscribersPagination');
    if (paginationEl) {
      paginationEl.style.display = 'none';
    }
  }
}

async function loadSources() {
  const tableEl = document.getElementById('sourcesTable');
  if (!tableEl) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/newsletters/sources`, {
      headers: { 'x-admin-token': adminToken }
    });

    if (!response.ok) {
      tableEl.innerHTML = '<p style="padding: 20px;">Error loading sources</p>';
      return;
    }

    const data = await response.json();
    allSources = data.sources || [];

    tableEl.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>URL</th>
            <th>Categories</th>
            <th>Region</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${allSources.map(source => `
            <tr>
              <td>${source.source}</td>
              <td><a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.url}</a></td>
              <td>${(source.category || []).join(', ') || '-'}</td>
              <td>${source.region || 'global'}</td>
              <td>
                <button class="action-btn source-test-btn" data-action="test-source" data-source-id="${source.id}">Test</button>
                <button class="action-btn delete-btn" data-action="remove-source" data-source-id="${source.id}">Remove</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (error) {
    tableEl.innerHTML = '<p style="padding: 20px;">Error loading sources</p>';
  }
}

async function loadPrefEmails() {
  try {
    const response = await fetch(`${API_URL}/api/subscriptions/admin/list?page=1&pageSize=200&status=all&frequency=all&risk=all`, {
      headers: { 'x-admin-token': adminToken }
    });
    if (response.ok) {
      const payload = await response.json();
      if (Array.isArray(payload)) {
        allSubscribersForPreferences = payload;
      } else {
        allSubscribersForPreferences = Array.isArray(payload.subscribers) ? payload.subscribers : [];
      }
    }
  } catch (error) {
    console.error('Error loading preference subscriber list:', error);
  }

  const select = document.getElementById('prefEmail');
  const prefSource = allSubscribersForPreferences;
  select.innerHTML = prefSource.length > 0
    ? prefSource.map(s => `<option value="${s.email}">${s.email}</option>`).join('')
    : '<option>No subscribers</option>';

  if (prefSource.length > 0) {
    select.onchange = (e) => {
      if (e.target.value) {
        showPrefForm(e.target.value);
      }
    };
  }
}

function editSubscriber(id) {
  const sub = allSubscribers.find(s => s.id == id);
  if (sub) {
    currentEditId = sub.id;
    currentEditEmail = sub.email;
    document.getElementById('editEmail').value = sub.email;
    document.getElementById('editFirstName').value = sub.firstName || '';
    document.getElementById('editFrequency').value = sub.frequency || 'weekly';
    const statusEl = document.getElementById('editCurrentStatus');
    if (statusEl) {
      statusEl.textContent = sub.isActive ? 'Active' : 'Inactive';
      statusEl.className = `inline-status-pill ${sub.isActive ? 'active' : 'inactive'}`;
    }
    renderSubscriberStatusHistory([], true);
    document.getElementById('editModal').classList.add('show');
    loadSubscriberStatusHistory(sub.id);
  }
}

function closeModal() {
  document.getElementById('editModal').classList.remove('show');
}

function renderSubscriberStatusHistory(entries, isLoading = false) {
  const historyEl = document.getElementById('subscriberStatusHistory');
  if (!historyEl) {
    return;
  }

  if (isLoading) {
    historyEl.innerHTML = '<div class="subscriber-history-empty">Loading status history...</div>';
    return;
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    historyEl.innerHTML = '<div class="subscriber-history-empty">No status changes recorded yet.</div>';
    return;
  }

  historyEl.innerHTML = entries.map((entry) => {
    const stateLabel = entry.toIsActive ? 'Active' : 'Inactive';
    const sourceLabel = String(entry.changeSource || 'unknown');
    const actorLabel = entry.actor ? ` by ${entry.actor}` : '';
    const changedAt = formatDateTime(entry.createdAt);
    return `
      <div class="subscriber-history-item">
        <div class="subscriber-history-topline">
          <span class="inline-status-pill ${entry.toIsActive ? 'active' : 'inactive'}">${stateLabel}</span>
          <span class="subscriber-history-meta">${changedAt}</span>
        </div>
        <div class="subscriber-history-detail">${entry.changeReason || 'Status updated'}${actorLabel}</div>
        <div class="subscriber-history-meta">Source: ${sourceLabel}</div>
      </div>
    `;
  }).join('');
}

async function loadSubscriberStatusHistory(id) {
  try {
    const response = await fetch(`${API_URL}/api/subscriptions/admin/${id}/history`, {
      headers: { 'x-admin-token': adminToken }
    });

    if (!response.ok) {
      renderSubscriberStatusHistory([], false);
      return;
    }

    const payload = await response.json();
    renderSubscriberStatusHistory(payload.history || [], false);
  } catch (error) {
    renderSubscriberStatusHistory([], false);
  }
}

async function deleteSubscriber(id, email) {
  if (confirm(`Remove ${email} from subscribers?`)) {
    try {
      if (id) {
        const response = await fetch(`${API_URL}/api/subscriptions/admin/${id}`, {
          method: 'DELETE',
          headers: { 'x-admin-token': adminToken }
        });

        if (response.ok) {
          showMessage('dashMessage', 'Subscriber removed', 'success');
          await Promise.all([loadSubscribers(subscriberPageState.page), loadPrefEmails(), loadStats()]);
          return;
        }
      }

      // Fallback path for legacy records or older deployments.
      const sub = allSubscribers.find(s => s.email === email);
      if (sub && sub.unsubscribeToken) {
        const response = await fetch(`${API_URL}/api/subscriptions/unsubscribe/${sub.unsubscribeToken}`);
        if (!response.ok) {
          showMessage('dashMessage', 'Failed to remove subscriber', 'error');
          return;
        }
        showMessage('dashMessage', 'Subscriber marked inactive', 'success');
        await Promise.all([loadSubscribers(subscriberPageState.page), loadPrefEmails(), loadStats()]);
        return;
      }

      showMessage('dashMessage', 'Failed to remove subscriber', 'error');
    } catch (error) {
      showMessage('dashMessage', 'Error removing subscriber', 'error');
    }
  }
}

function showPrefForm(email) {
  const sub = allSubscribersForPreferences.find(s => s.email === email) || allSubscribers.find(s => s.email === email);
  if (sub) {
    document.getElementById('prefForm').style.display = 'block';
    document.getElementById('prefFrequency').value = sub.frequency || 'weekly';

    document.querySelectorAll('.prefTopic').forEach(cb => {
      cb.checked = (sub.topics || []).includes(cb.value);
    });

    document.querySelectorAll('.prefRegion').forEach(cb => {
      cb.checked = (sub.regions || []).includes(cb.value);
    });
  }
}

async function openPreferencesForEmail(email) {
  const targetEmail = email || currentEditEmail;
  if (!targetEmail) {
    showMessage('dashMessage', 'No subscriber selected', 'error');
    return;
  }

  const prefTabBtn = document.querySelector('.tab-btn[data-tab="preferences"]');
  switchTab('preferences', prefTabBtn);

  const select = document.getElementById('prefEmail');
  if (!select || select.options.length === 0) {
    await loadPrefEmails();
  }

  select.value = targetEmail;
  showPrefForm(targetEmail);
  closeModal();
}

function switchTab(tabName, triggerEl) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(tabName).classList.add('active');
  if (triggerEl) {
    triggerEl.classList.add('active');
  }

  if (tabName === 'monitor') {
    loadMonitorStatus();
  }
}

function showMessage(elementId, text, type) {
  const msg = document.getElementById(elementId);
  msg.textContent = text;
  msg.className = `message show ${type}`;
  setTimeout(() => msg.classList.remove('show'), 5000);
}

async function deleteSource(id) {
  if (!confirm('Remove this source?')) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/newsletters/sources/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });

    if (response.ok) {
      showMessage('dashMessage', 'Source removed', 'success');
      await loadSources();
      return;
    }

    const error = await response.json();
    showMessage('dashMessage', error.error || 'Failed to remove source', 'error');
  } catch (error) {
    showMessage('dashMessage', 'Error removing source', 'error');
  }
}

async function testSource(id) {
  const source = allSources.find((item) => String(item.id) === String(id));
  if (!source) {
    showMessage('dashMessage', 'Source not found', 'error');
    return;
  }

  showMessage('dashMessage', `Testing source: ${source.source}...`, 'success');

  try {
    const response = await fetch(`${API_URL}/api/newsletters/sources/${id}/test`, {
      method: 'POST',
      headers: { 'x-admin-token': adminToken }
    });

    const payload = await response.json();
    if (!response.ok) {
      showMessage('dashMessage', payload.error || 'Source test failed', 'error');
      return;
    }

    const sampleCount = Array.isArray(payload.sampleItems) ? payload.sampleItems.length : 0;
    showSourceTestResult(source, payload);
    showMessage('dashMessage', `Source OK: ${payload.itemCount || 0} items fetched (${sampleCount} sampled)`, 'success');
  } catch (error) {
    showMessage('dashMessage', 'Error testing source', 'error');
  }
}

function showSourceTestResult(source, payload) {
  const modalEl = document.getElementById('sourceTestModal');
  const titleEl = document.getElementById('sourceTestModalTitle');
  const summaryEl = document.getElementById('sourceTestSummary');
  const listEl = document.getElementById('sourceTestList');

  if (!modalEl || !titleEl || !summaryEl || !listEl) {
    return;
  }

  const sampleItems = Array.isArray(payload.sampleItems) ? payload.sampleItems : [];
  titleEl.textContent = `Source Test: ${source.source}`;
  summaryEl.textContent = `Feed: ${payload.feedTitle || 'Unknown'} | Parsed items: ${payload.itemCount || 0} | Sampled: ${sampleItems.length}`;

  if (sampleItems.length === 0) {
    listEl.innerHTML = '<li class="source-test-item"><div class="source-test-item-title">No sample items were returned.</div><div class="source-test-item-meta">Feed may be empty or blocked.</div></li>';
  } else {
    listEl.innerHTML = sampleItems.map((item, index) => `
      <li class="source-test-item">
        <div class="source-test-item-title">${index + 1}. ${item.title || 'Untitled'}</div>
        <div class="source-test-item-meta">Published: ${item.pubDate ? new Date(item.pubDate).toLocaleString() : 'Unknown'}</div>
        ${item.link ? `<a class="source-test-item-link" href="${item.link}" target="_blank" rel="noopener noreferrer">${item.link}</a>` : ''}
      </li>
    `).join('');
  }

  modalEl.classList.add('show');
}

function closeSourceTestModal() {
  const modalEl = document.getElementById('sourceTestModal');
  if (modalEl) {
    modalEl.classList.remove('show');
  }
}

function logout() {
  localStorage.removeItem('adminToken');
  location.reload();
}

// Add Subscriber Form
const addForm = document.getElementById('addForm');
if (addForm) {
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const topics = Array.from(document.querySelectorAll('input[id^="newTopic"]:checked')).map(cb => cb.value);
    const regions = Array.from(document.querySelectorAll('input[id^="newRegion"]:checked')).map(cb => cb.value);

    try {
      const response = await fetch(`${API_URL}/api/subscriptions/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('newEmail').value,
          firstName: document.getElementById('newFirstName').value,
          lastName: document.getElementById('newLastName').value,
          frequency: document.getElementById('newFrequency').value,
          topics: topics.length > 0 ? topics : ['general'],
          regions: regions.length > 0 ? regions : ['global']
        })
      });

      if (response.ok) {
        showMessage('dashMessage', 'Subscriber added successfully', 'success');
        document.getElementById('addForm').reset();
        loadSubscribers();
        loadPrefEmails();
      } else {
        const error = await response.json();
        showMessage('dashMessage', error.error || 'Failed to add subscriber', 'error');
      }
    } catch (error) {
      showMessage('dashMessage', 'Error adding subscriber', 'error');
    }
  });
}

// Preferences Form
const prefForm = document.getElementById('prefForm');
if (prefForm) {
  prefForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('prefEmail').value;
    const sub = allSubscribersForPreferences.find(s => s.email === email) || allSubscribers.find(s => s.email === email);

    if (!sub || !sub.preferencesToken) {
      showMessage('dashMessage', 'Cannot update preferences - token missing', 'error');
      return;
    }

    const topics = Array.from(document.querySelectorAll('.prefTopic:checked')).map(cb => cb.value);
    const regions = Array.from(document.querySelectorAll('.prefRegion:checked')).map(cb => cb.value);

    try {
      const response = await fetch(`${API_URL}/api/subscriptions/preferences/${sub.preferencesToken}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frequency: document.getElementById('prefFrequency').value,
          topics: topics.length > 0 ? topics : ['general'],
          regions: regions.length > 0 ? regions : ['global']
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Preferences updated:', result);
        showMessage('dashMessage', 'Preferences updated', 'success');
        document.getElementById('prefForm').style.display = 'none';
        document.getElementById('prefEmail').value = '';
        await loadSubscribers();
        await loadPrefEmails();
      } else {
        const error = await response.json();
        showMessage('dashMessage', error.error || 'Failed to update preferences', 'error');
      }
    } catch (error) {
      console.error('Error updating preferences:', error);
      showMessage('dashMessage', 'Error updating preferences', 'error');
    }
  });
}

const editForm = document.getElementById('editForm');
if (editForm) {
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentEditId) {
      showMessage('dashMessage', 'No subscriber selected', 'error');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/subscriptions/admin/${currentEditId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken
        },
        body: JSON.stringify({
          firstName: document.getElementById('editFirstName').value,
          frequency: document.getElementById('editFrequency').value
        })
      });

      if (response.ok) {
        showMessage('dashMessage', 'Subscriber updated', 'success');
        closeModal();
        await loadSubscribers();
        await loadPrefEmails();
        return;
      }

      const error = await response.json();
      showMessage('dashMessage', error.error || 'Failed to update subscriber', 'error');
    } catch (error) {
      showMessage('dashMessage', 'Error updating subscriber', 'error');
    }
  });
}

const editPrefsBtn = document.getElementById('editPrefsBtn');
if (editPrefsBtn) {
  editPrefsBtn.addEventListener('click', () => {
    openPreferencesForEmail(currentEditEmail);
  });
}

const sourceForm = document.getElementById('sourceForm');
if (sourceForm) {
  sourceForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const categoriesRaw = document.getElementById('sourceCategories').value || '';
    const categories = categoriesRaw
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);

    try {
      const response = await fetch(`${API_URL}/api/newsletters/sources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken
        },
        body: JSON.stringify({
          source: document.getElementById('sourceName').value,
          url: document.getElementById('sourceUrl').value,
          region: document.getElementById('sourceRegion').value || undefined,
          category: categories.length > 0 ? categories : ['space', 'news']
        })
      });

      if (response.ok) {
        showMessage('dashMessage', 'Source added successfully', 'success');
        sourceForm.reset();
        await loadSources();
        return;
      }

      const error = await response.json();
      showMessage('dashMessage', error.error || 'Failed to add source', 'error');
    } catch (error) {
      showMessage('dashMessage', 'Error adding source', 'error');
    }
  });
}

// Bind UI events
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', logout);
}

const refreshMonitorBtn = document.getElementById('refreshMonitorBtn');
if (refreshMonitorBtn) {
  refreshMonitorBtn.addEventListener('click', async () => {
    await loadMonitorStatus();
  });
}

const closeModalBtn = document.getElementById('closeModalBtn');
if (closeModalBtn) {
  closeModalBtn.addEventListener('click', closeModal);
}

const closeSourceTestModalBtn = document.getElementById('closeSourceTestModal');
if (closeSourceTestModalBtn) {
  closeSourceTestModalBtn.addEventListener('click', closeSourceTestModal);
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.getAttribute('data-tab');
    if (tabName) {
      switchTab(tabName, btn);
    }
  });
});

const subscribersTable = document.getElementById('subscribersTable');
if (subscribersTable) {
  subscribersTable.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.getAttribute('data-action');
    if (!action) {
      return;
    }
    if (action === 'edit') {
      const id = target.getAttribute('data-id');
      if (id) {
        editSubscriber(id);
      }
    }
    if (action === 'remove') {
      const id = target.getAttribute('data-id');
      const email = target.getAttribute('data-email');
      if (email) {
        deleteSubscriber(id, email);
      }
    }
  });
}

const sourcesTable = document.getElementById('sourcesTable');
if (sourcesTable) {
  sourcesTable.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.getAttribute('data-action');
    if (!action) {
      return;
    }
    if (action === 'remove-source') {
      const sourceId = target.getAttribute('data-source-id');
      if (sourceId) {
        deleteSource(sourceId);
      }
    }
    if (action === 'test-source') {
      const sourceId = target.getAttribute('data-source-id');
      if (sourceId) {
        testSource(sourceId);
      }
    }
  });
}

const subscriberSearch = document.getElementById('subscriberSearch');
if (subscriberSearch) {
  subscriberSearch.addEventListener('input', () => {
    applySubscriberFilters();
  });
}

const subscriberStatusFilter = document.getElementById('subscriberStatusFilter');
if (subscriberStatusFilter) {
  subscriberStatusFilter.addEventListener('change', () => {
    applySubscriberFilters();
  });
}

const subscriberFrequencyFilter = document.getElementById('subscriberFrequencyFilter');
if (subscriberFrequencyFilter) {
  subscriberFrequencyFilter.addEventListener('change', () => {
    applySubscriberFilters();
  });
}

const subscriberDeliveryRiskFilter = document.getElementById('subscriberDeliveryRiskFilter');
if (subscriberDeliveryRiskFilter) {
  subscriberDeliveryRiskFilter.addEventListener('change', () => {
    applySubscriberFilters();
  });
}

const subscriberFiltersReset = document.getElementById('subscriberFiltersReset');
if (subscriberFiltersReset) {
  subscriberFiltersReset.addEventListener('click', () => {
    if (subscriberSearch) {
      subscriberSearch.value = '';
    }
    if (subscriberStatusFilter) {
      subscriberStatusFilter.value = 'all';
    }
    if (subscriberFrequencyFilter) {
      subscriberFrequencyFilter.value = 'all';
    }
    if (subscriberDeliveryRiskFilter) {
      subscriberDeliveryRiskFilter.value = 'all';
    }
    applySubscriberFilters();
  });
}

const subscribersPrevPage = document.getElementById('subscribersPrevPage');
if (subscribersPrevPage) {
  subscribersPrevPage.addEventListener('click', async () => {
    if (subscriberPageState.hasPrev) {
      await loadSubscribers(subscriberPageState.page - 1);
    }
  });
}

const subscribersNextPage = document.getElementById('subscribersNextPage');
if (subscribersNextPage) {
  subscribersNextPage.addEventListener('click', async () => {
    if (subscriberPageState.hasNext) {
      await loadSubscribers(subscriberPageState.page + 1);
    }
  });
}

// Check if already logged in
if (adminToken) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  loadDashboard();
}
