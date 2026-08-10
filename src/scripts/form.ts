/**
 * Contact form: inline validation, submit state machine, and a graceful
 * mailto fallback when no backend endpoint is configured.
 *
 * The form still submits natively if this script fails to load — the <form>
 * carries a real method/action.
 */

type Control = HTMLInputElement | HTMLTextAreaElement;
type State = 'idle' | 'sending' | 'sent' | 'error';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const RULES: Record<string, (value: string) => string | null> = {
  name: (value) => {
    if (!value.trim()) return 'Please tell us your name.';
    if (value.trim().length < 2) return 'That name looks a little short.';
    return null;
  },
  email: (value) => {
    if (!value.trim()) return 'We need an email address to reply to.';
    if (!EMAIL.test(value.trim())) return 'That email address doesn’t look right.';
    return null;
  },
  message: (value) => {
    if (!value.trim()) return 'Please write us a message.';
    if (value.trim().length < 10) return 'A few more words would help.';
    return null;
  },
};

function setError(control: Control, message: string | null) {
  const target = document.querySelector<HTMLElement>(`[data-error-for="${control.id}"]`);
  if (target) target.textContent = message ?? '';
  if (message) control.setAttribute('aria-invalid', 'true');
  else control.removeAttribute('aria-invalid');
}

function initCounter(control: Control) {
  const counter = document.querySelector<HTMLElement>(`[data-counter-for="${control.id}"]`);
  if (!counter) return;

  const max = control.maxLength;
  const update = () => {
    counter.textContent = `${control.value.length} of ${max} characters`;
  };

  control.addEventListener('input', update);
  update();
}

export function initForm() {
  const form = document.querySelector<HTMLFormElement>('[data-contact-form]');
  if (!form) return;

  const button = form.querySelector<HTMLButtonElement>('[data-submit]');
  const label = form.querySelector<HTMLElement>('[data-submit-label]');
  const status = form.querySelector<HTMLElement>('[data-form-status]');
  if (!button || !label || !status) return;

  const endpoint = form.dataset.endpoint ?? '';
  const mailto = form.dataset.mailto ?? '';
  const controls = Array.from(form.querySelectorAll<Control>('.field__control'));

  const openedAt = Date.now();
  const idleLabel = label.textContent ?? 'Send message';

  /** Fields the visitor has actually engaged with, or that a submit flagged. */
  const touched = new WeakSet<Control>();

  for (const control of controls) {
    initCounter(control);

    // Only complain about a field once they've engaged with it. Tabbing
    // straight through an empty form should never light it up red.
    control.addEventListener('blur', () => {
      if (!touched.has(control) && !control.value) return;
      const rule = RULES[control.name];
      if (rule) setError(control, rule(control.value));
    });

    control.addEventListener('input', () => {
      touched.add(control);
      if (control.getAttribute('aria-invalid') === 'true') setError(control, null);
    });
  }

  function setState(state: State, message = '', tone: 'error' | 'success' | '' = '') {
    button!.dataset.state = state === 'idle' ? '' : state;
    button!.disabled = state === 'sending' || state === 'sent';
    label!.textContent =
      state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent' : idleLabel;

    status!.textContent = message;
    if (tone) status!.dataset.tone = tone;
    else delete status!.dataset.tone;
  }

  function validateAll(): Control[] {
    const invalid: Control[] = [];
    for (const control of controls) {
      const rule = RULES[control.name];
      if (!rule) continue;
      // After a submit attempt every field is fair game on subsequent blurs.
      touched.add(control);
      const error = rule(control.value);
      setError(control, error);
      if (error) invalid.push(control);
    }
    return invalid;
  }

  function fallbackToMail(data: Record<string, string>) {
    const subject = encodeURIComponent(`Website enquiry — ${data.name}`);
    const body = encodeURIComponent(`${data.message}\n\n— ${data.name}\n${data.email}`);
    window.location.href = `mailto:${mailto}?subject=${subject}&body=${body}`;
    setState('idle', 'Opening your email app so you can send the message.', 'success');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;

    const invalid = validateAll();
    if (invalid.length) {
      setState(
        'error',
        invalid.length === 1
          ? 'One field needs your attention.'
          : `${invalid.length} fields need your attention.`,
        'error',
      );
      invalid[0]?.focus();
      return;
    }

    // Honeypot: a real person never fills a field they cannot see.
    const trap = form.querySelector<HTMLInputElement>('[name="company"]');
    if (trap?.value) {
      setState('sent', 'Thank you — your message is on its way.', 'success');
      return;
    }

    const data: Record<string, string> = {
      name: (form.elements.namedItem('name') as Control).value.trim(),
      email: (form.elements.namedItem('email') as Control).value.trim(),
      message: (form.elements.namedItem('message') as Control).value.trim(),
      // Lets the backend weigh how fast the form was completed.
      elapsedMs: String(Date.now() - openedAt),
    };

    if (!endpoint) {
      fallbackToMail(data);
      return;
    }

    setState('sending', 'Sending your message…');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) throw new Error(`Request failed: ${response.status}`);

      setState('sent', 'Thank you — your message is on its way.', 'success');
      form.reset();
      for (const control of controls) {
        control.dispatchEvent(new Event('input'));
      }

      window.setTimeout(() => setState('idle', '', ''), 6000);
    } catch {
      setState(
        'error',
        `Something went wrong. Please email us directly at ${mailto}.`,
        'error',
      );
    }
  });
}
