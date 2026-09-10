const fs = require('fs');
const path = require('path');
const vm = require('vm');

const script = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'index.js'),
  'utf8'
);

const createElement = (initialValue = '') => ({
  value: initialValue,
  className: '',
  textContent: '',
  disabled: false,
  attributes: {},
  addEventListener: jest.fn(),
  classList: {
    add: jest.fn(),
    remove: jest.fn()
  },
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
});

const loadPage = ({ response, topics = [] } = {}) => {
  const form = createElement();
  const email = createElement('member@example.com');
  const firstName = createElement('Member');
  const frequency = { value: 'weekly' };
  const message = createElement();
  const loading = createElement();
  const subscribeButton = createElement('Subscribe Now');
  const elements = { subscriptionForm: form, email, firstName, message, loading, subscribeButton };
  const fetchMock = jest.fn().mockResolvedValue(response || {
    ok: true,
    json: async () => ({})
  });
  const context = {
    console,
    document: {
      getElementById: jest.fn((id) => elements[id]),
      querySelector: jest.fn(() => frequency),
      querySelectorAll: jest.fn(() => topics)
    },
    fetch: fetchMock,
    setTimeout: jest.fn()
  };

  vm.runInNewContext(script, context);
  const submit = form.addEventListener.mock.calls[0][1];
  return { elements, fetchMock, submit };
};

describe('registration page', () => {
  test('submits trimmed form values and shows a success message', async () => {
    const { elements, fetchMock, submit } = loadPage();

    await submit({ preventDefault: jest.fn() });

    expect(fetchMock).toHaveBeenCalledWith('/api/subscriptions/subscribe', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        email: 'member@example.com',
        firstName: 'Member',
        frequency: 'weekly',
        topics: ['general']
      })
    }));
    expect(elements.message.className).toBe('message success');
  });

  test('restores the submit button with a useful duplicate message', async () => {
    const { elements, submit } = loadPage({
      response: {
        ok: false,
        json: async () => ({ error: 'Email already subscribed' })
      }
    });

    await submit({ preventDefault: jest.fn() });

    expect(elements.message.textContent).toContain('already subscribed');
    expect(elements.subscribeButton.disabled).toBe(false);
    expect(elements.subscribeButton.textContent).toBe('Subscribe Now');
  });
});