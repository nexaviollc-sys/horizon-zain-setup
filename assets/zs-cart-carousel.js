/**
 * ZAISEN cart: compact one-product recommendation carousel.
 * Native Shopify product data comes from Liquid; native add-to-cart remains
 * delegated to cart-drawer-component. Rotates every 2 seconds only while the
 * drawer is open, visible and not being interacted with.
 */
class ZaisenCartRecommendations extends HTMLElement {
  /** @type {number | undefined} */
  #timer;
  /** @type {MutationObserver | undefined} */
  #drawerObserver;
  /** @type {MutationObserver | undefined} */
  #slidesObserver;
  /** @type {HTMLElement | null} */
  #track = null;
  /** @type {HTMLElement[]} */
  #slides = [];
  #index = 0;
  #hovered = false;
  #focused = false;
  #swipe = null;
  #suppressClick = false;
  #suppressClickTimer = undefined;
  #reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  #drawer = null;

  connectedCallback() {
    this.#track = this.querySelector('.zs-cart-upsells__track');
    this.#slides = Array.from(this.querySelectorAll('.zs-cart-upsell__item'));
    if (!this.#track || !this.#slides.length) return;

    // Vary the initial item on every freshly rendered cart, rather than
    // always displaying the same first two products.
    this.#index = this.#slides.length > 1 ? Math.floor(Math.random() * this.#slides.length) : 0;
    this.#render();
    this.dataset.zsCarouselReady = 'true';

    this.addEventListener('click', this.#onClick);
    this.addEventListener('mouseenter', this.#onMouseEnter);
    this.addEventListener('mouseleave', this.#onMouseLeave);
    this.addEventListener('focusin', this.#onFocusIn);
    this.addEventListener('focusout', this.#onFocusOut);
    this.addEventListener('pointerdown', this.#onPointerDown, { passive: true });
    this.addEventListener('pointerup', this.#onPointerUp, { passive: true });
    this.addEventListener('pointercancel', this.#onPointerCancel);
    document.addEventListener('visibilitychange', this.#syncTimer);
    this.#reducedMotion.addEventListener('change', this.#syncTimer);

    this.#drawer = this.closest('theme-drawer');
    if (this.#drawer) {
      this.#drawerObserver = new MutationObserver(this.#syncTimer);
      this.#drawerObserver.observe(this.#drawer, { attributes: true, attributeFilter: ['open'] });
    }

    // Shopify's hydration can morph the recommendation slide children in place.
    this.#slidesObserver = new MutationObserver(() => {
      this.#slides = Array.from(this.querySelectorAll('.zs-cart-upsell__item'));
      this.#track = this.querySelector('.zs-cart-upsells__track');
      if (this.#index >= this.#slides.length) this.#index = 0;
      this.#render();
      this.#syncTimer();
    });
    this.#slidesObserver.observe(this, { childList: true, subtree: true });
    this.#syncTimer();
  }

  disconnectedCallback() {
    this.#clearTimer();
    this.#drawerObserver?.disconnect();
    this.#drawerObserver = undefined;
    this.#slidesObserver?.disconnect();
    this.#slidesObserver = undefined;
    document.removeEventListener('visibilitychange', this.#syncTimer);
    this.#reducedMotion.removeEventListener('change', this.#syncTimer);
    this.removeEventListener('click', this.#onClick);
    this.removeEventListener('mouseenter', this.#onMouseEnter);
    this.removeEventListener('mouseleave', this.#onMouseLeave);
    this.removeEventListener('focusin', this.#onFocusIn);
    this.removeEventListener('focusout', this.#onFocusOut);
    this.removeEventListener('pointerdown', this.#onPointerDown);
    this.removeEventListener('pointerup', this.#onPointerUp);
    this.removeEventListener('pointercancel', this.#onPointerCancel);
    if (this.#suppressClickTimer !== undefined) clearTimeout(this.#suppressClickTimer);
  }

  #render() {
    if (!this.#track || !this.#slides.length) return;
    this.#track.style.transform = `translate3d(-${this.#index * 100}%, 0, 0)`;
    for (let i = 0; i < this.#slides.length; i++) {
      const active = i === this.#index;
      this.#slides[i].toggleAttribute('inert', !active);
      this.#slides[i].setAttribute('aria-hidden', String(!active));
    }
  }

  #show(index) {
    if (this.#slides.length < 2) return;
    const count = this.#slides.length;
    this.#index = ((index % count) + count) % count;
    this.#render();
  }

  #clearTimer() {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  #syncTimer = () => {
    this.#clearTimer();
    const drawerOpen = this.#drawer?.hasAttribute('open') ?? false;
    if (
      !drawerOpen ||
      document.hidden ||
      this.#hovered ||
      this.#focused ||
      this.#reducedMotion.matches ||
      this.#slides.length < 2
    ) return;
    this.#timer = setInterval(() => this.#show(this.#index + 1), 2000);
  };

  #onClick = (event) => {
    if (!(event.target instanceof Element)) return;
    if (this.#suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const arrow = event.target.closest('button[data-zs-slide-direction]');
    if (!(arrow instanceof HTMLButtonElement) || !this.contains(arrow)) return;
    const direction = Number(arrow.dataset.zsSlideDirection);
    if (direction !== 1 && direction !== -1) return;
    this.#show(this.#index + direction);
    this.#syncTimer();
  };

  #onMouseEnter = () => {
    this.#hovered = true;
    this.#syncTimer();
  };
  #onMouseLeave = () => {
    this.#hovered = false;
    this.#syncTimer();
  };
  #onFocusIn = () => {
    this.#focused = true;
    this.#syncTimer();
  };
  #onFocusOut = (event) => {
    if (!(event.relatedTarget instanceof Node) || !this.contains(event.relatedTarget)) {
      this.#focused = false;
      this.#syncTimer();
    }
  };

  #onPointerDown = (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.zs-cart-upsells__viewport')) return;
    this.#swipe = { x: event.clientX, y: event.clientY };
  };

  #onPointerUp = (event) => {
    if (!this.#swipe) return;
    const dx = event.clientX - this.#swipe.x;
    const dy = event.clientY - this.#swipe.y;
    this.#swipe = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
    this.#show(this.#index + (dx < 0 ? 1 : -1));
    this.#syncTimer();
    // A swipe on a product image must not accidentally navigate to that item.
    this.#suppressClick = true;
    if (this.#suppressClickTimer !== undefined) clearTimeout(this.#suppressClickTimer);
    this.#suppressClickTimer = setTimeout(() => {
      this.#suppressClick = false;
      this.#suppressClickTimer = undefined;
    }, 300);
  };

  #onPointerCancel = () => {
    this.#swipe = null;
  };
}

if (!customElements.get('zs-cart-recommendations')) {
  customElements.define('zs-cart-recommendations', ZaisenCartRecommendations);
}
