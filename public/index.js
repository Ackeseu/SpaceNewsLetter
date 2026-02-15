const form = document.getElementById('subscriptionForm');
const messageDiv = document.getElementById('message');
const loadingDiv = document.getElementById('loading');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = document.getElementById('email').value;
    const firstName = document.getElementById('firstName').value;
    const frequencyEl = document.querySelector('input[name="frequency"]:checked');
    const frequency = frequencyEl ? frequencyEl.value : 'weekly';
    const topics = Array.from(document.querySelectorAll('input[name="topics"]:checked'))
      .map(cb => cb.value);

    // Show loading state
    loadingDiv.classList.add('active');
    messageDiv.className = 'message';
    messageDiv.textContent = '';

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

      const data = await response.json();

      if (response.ok) {
        // Redirect to thank you page after 1 second
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
    }
  });
}
