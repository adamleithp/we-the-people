/**
 * The I'm In sign-up: the form, its thank-you overlay, and the pill that
 * steps aside once the form is on screen. Same events and the same rule as
 * JoinFooter.astro: PII goes on the person profile via identify(), never into
 * capture() properties, so the event stays safe to break down on.
 *
 * Expects, inside the page: `[data-signup]` (the form, with #email),
 * `[data-thanks]` (the overlay), and optionally `[data-im-in-pill]`, all
 * relative to `section`, which is what the pill's visibility follows.
 */
type PostHogLike = {
  identify(id: string, props: Record<string, unknown>): void;
  capture(event: string, props?: Record<string, unknown>): void;
};
declare global {
  interface Window {
    posthog?: PostHogLike;
  }
}

export function initSignup(section: HTMLElement) {
  const pill = document.querySelector<HTMLElement>('[data-im-in-pill]');
  const form = section.querySelector<HTMLFormElement>('[data-signup]');
  const email = form?.querySelector<HTMLInputElement>('input[type=email]');
  const thanks = document.querySelector<HTMLElement>('[data-thanks]');
  const closeBtn = thanks?.querySelector<HTMLButtonElement>('.thanks__close');

  let viewed = false;
  new IntersectionObserver(
    ([entry]) => {
      pill?.classList.toggle('is-away', entry.isIntersecting);
      if (entry.isIntersecting && !viewed) {
        viewed = true;
        window.posthog?.capture('join_footer_viewed');
      }
    },
    { threshold: 0.15 },
  ).observe(section);

  pill?.addEventListener('click', () => {
    window.posthog?.capture('im_in_pill_clicked', { path: location.pathname });
  });

  email?.addEventListener('blur', () => {
    if (email.value) window.posthog?.capture('join_signup_attempted');
  });

  // --- thank-you overlay ----------------------------------------------------
  // Scroll is locked on <html>, not <body>: base.css makes body height:100%,
  // so clipping body shrinks the page to one screen and drops you at the top.
  let lastFocused: Element | null = null;
  const openThanks = () => {
    if (!thanks) return;
    lastFocused = document.activeElement;
    thanks.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(() => thanks.classList.add('is-open'));
    closeBtn?.focus();
  };
  const closeThanks = () => {
    if (!thanks || thanks.hidden) return;
    thanks.classList.replace('is-open', 'is-closing');
    setTimeout(() => {
      thanks.hidden = true;
      thanks.classList.remove('is-closing');
      document.documentElement.style.overflow = '';
      (lastFocused as HTMLElement | null)?.focus?.();
    }, 160);
  };
  thanks?.querySelectorAll('[data-thanks-dismiss]').forEach((el) => el.addEventListener('click', closeThanks));
  document.addEventListener('keydown', (e) => {
    if (!thanks || thanks.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeThanks();
    }
    // the close button is the only focusable thing in there — keep focus in
    if (e.key === 'Tab') {
      e.preventDefault();
      closeBtn?.focus();
    }
  });

  // --- sign-up --------------------------------------------------------------
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const data = new FormData(form);
    const field = (k: string) => String(data.get(k) ?? '').trim();
    const contribution = field('contribution');
    const message = field('message');
    window.posthog?.identify(field('email'), {
      email: field('email'),
      name: field('name'),
      contribution,
      message,
    });
    window.posthog?.capture('join_us_submitted', {
      contribution: contribution || 'not_specified',
      has_message: message.length > 0,
    });
    form.reset();
    openThanks();
  });
}
