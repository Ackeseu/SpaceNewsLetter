const form = document.getElementById('subscriptionForm');
const messageDiv = document.getElementById('message');
const loadingDiv = document.getElementById('loading');
const subscribeButton = document.getElementById('subscribeButton');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value.trim();
    const firstName = document.getElementById('firstName').value.trim();
    const frequencyEl = document.querySelector('input[name="frequency"]:checked');
    const frequency = frequencyEl ? frequencyEl.value : 'weekly';
    const topics = Array.from(document.querySelectorAll('input[name="topics"]:checked'))
      .map(cb => cb.value);

    subscribeButton.disabled = true;
    subscribeButton.textContent = 'Submitting...';
    loadingDiv.classList.add('active');
    loadingDiv.setAttribute('aria-hidden', 'false');
    messageDiv.className = 'message';
    messageDiv.textContent = '';
    let requestSucceeded = false;

    try {
      const response = await fetch('/api/subscriptions/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          firstName: firstName || undefined,
          frequency,
          topics: topics.length > 0 ? topics : ['general']
        })
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        requestSucceeded = true;
        messageDiv.className = 'message success';
        messageDiv.textContent = 'Thanks. Check your inbox to verify your subscription.';
        setTimeout(() => {
          window.location.href = '/thank-you.html';
        }, 1000);
      } else {
        messageDiv.className = 'message error';
        messageDiv.textContent = '✗ ' + (data.error || 'Subscription failed. Please try again.');
      }
    } catch (error) {
      messageDiv.className = 'message error';
      messageDiv.textContent = '✗ Network error. Please try again.';
      console.error('Error:', error);
    } finally {
      loadingDiv.classList.remove('active');
      loadingDiv.setAttribute('aria-hidden', 'true');
      if (!requestSucceeded) {
        subscribeButton.disabled = false;
        subscribeButton.textContent = 'Subscribe Now';
      }
    }
  });
}
