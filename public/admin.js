const isFileOrigin = window.location.protocol === 'file:' || window.location.origin === 'null';
const API_URL = isFileOrigin
  ? 'https://newspace-newsletter-api.azurewebsites.net'
  : window.location.origin;

let adminToken = localStorage.getItem('adminToken');
let allSubscribers = [];
let allSources = [];

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
  await loadStats();
  await loadSubscribers();
  await loadPrefEmails();
  await loadSources();
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

async function loadSubscribers() {
  try {
    const response = await fetch(`${API_URL}/api/subscriptions/admin/list`, {
      headers: { 'x-admin-token': adminToken }
    });

    if (!response.ok) {
      document.getElementById('subscribersTable').innerHTML = '<p style="padding: 20px;">Error loading subscribers</p>';
      return;
    }

    allSubscribers = await response.json();

    const table = `
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Status</th>
            <th>Frequency</th>
            <th>Topics</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${allSubscribers.map(sub => `
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
              <td>${(sub.topics || []).join(', ') || '-'}</td>
              <td>
                <button class="action-btn edit-btn" data-action="edit" data-id="${sub.id}">Edit</button>
                <button class="action-btn delete-btn" data-action="remove" data-email="${sub.email}">Remove</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    document.getElementById('subscribersTable').innerHTML = table;
  } catch (error) {
    console.error('Error:', error);
    document.getElementById('subscribersTable').innerHTML = '<p style="padding: 20px;">Error loading subscribers</p>';
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
  const select = document.getElementById('prefEmail');
  select.innerHTML = allSubscribers.length > 0
    ? allSubscribers.map(s => `<option value="${s.email}">${s.email}</option>`).join('')
    : '<option>No subscribers</option>';

  if (allSubscribers.length > 0) {
    select.addEventListener('change', (e) => {
      if (e.target.value) {
        showPrefForm(e.target.value);
      }
    });
  }
}

function editSubscriber(id) {
  const sub = allSubscribers.find(s => s.id == id);
  if (sub) {
    document.getElementById('editEmail').value = sub.email;
    document.getElementById('editFirstName').value = sub.firstName || '';
    document.getElementById('editFrequency').value = sub.frequency || 'weekly';
    document.getElementById('editModal').classList.add('show');
  }
}

function closeModal() {
  document.getElementById('editModal').classList.remove('show');
}

async function deleteSubscriber(email) {
  if (confirm(`Remove ${email} from subscribers?`)) {
    const sub = allSubscribers.find(s => s.email === email);
    if (sub && sub.unsubscribeToken) {
      try {
        await fetch(`${API_URL}/api/subscriptions/unsubscribe/${sub.unsubscribeToken}`);
        showMessage('dashMessage', 'Subscriber removed', 'success');
        loadSubscribers();
      } catch (error) {
        showMessage('dashMessage', 'Error removing subscriber', 'error');
      }
    }
  }
}

function showPrefForm(email) {
  const sub = allSubscribers.find(s => s.email === email);
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

function switchTab(tabName, triggerEl) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(tabName).classList.add('active');
  if (triggerEl) {
    triggerEl.classList.add('active');
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
    const sub = allSubscribers.find(s => s.email === email);

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
        showMessage('dashMessage', 'Preferences updated', 'success');
        loadSubscribers();
      } else {
        showMessage('dashMessage', 'Failed to update preferences', 'error');
      }
    } catch (error) {
      showMessage('dashMessage', 'Error updating preferences', 'error');
    }
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

const closeModalBtn = document.getElementById('closeModalBtn');
if (closeModalBtn) {
  closeModalBtn.addEventListener('click', closeModal);
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
      const email = target.getAttribute('data-email');
      if (email) {
        deleteSubscriber(email);
      }
    }
    if (action === 'remove-source') {
      const sourceId = target.getAttribute('data-source-id');
      if (sourceId) {
        deleteSource(sourceId);
      }
    }
  });
}

// Check if already logged in
if (adminToken) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  loadDashboard();
}
