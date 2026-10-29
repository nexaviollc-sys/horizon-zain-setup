import { Component } from '@theme/component';
import { StandardEvents, CartLinesUpdateEvent } from '@shopify/events';
import { DrawerOpenEvent } from '@theme/theme-drawer';
import { ThemeEvents } from '@theme/events';

/**
 * A custom element that manages cart drawer behavior within a `<theme-drawer>`.
 *
 * Dialog lifecycle (open/close, squeeze, history, animations) is owned by `<theme-drawer>`.
 * The `cart:view` event is auto-dispatched by `CartItemsComponent` via the
 * `view-event-trigger="dialog"` attribute (see `snippets/cart-items-component.liquid`).
 * Cart count announcements are owned by `<header-actions>`.
 * This component handles the remaining cart-specific concerns: auto-open on add-to-cart,
 * sticky summary layout, and the installments CTA close-on-click.
 *
 * @extends {Component}
 */
class CartDrawerComponent extends Component {
  /** @type {number} */
  #summaryThreshold = 0.5;

  /** @type {MutationObserver | null} */
  #shippingObserver = null;

  /** @type {import('@theme/theme-drawer').ThemeDrawer | null} */
  get #themeDrawer() {
    return /** @type {import('@theme/theme-drawer').ThemeDrawer | null} */ (this.closest('theme-drawer'));
  }

  /** @type {HTMLDialogElement | null} */
  get #dialog() {
    return this.closest('dialog');
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartLinesUpdate);
    this.addEventListener('click', this.#handleUpsellClick);
    this.#shippingObserver = new MutationObserver(() => this.#updateShippingProgress());
    this.#shippingObserver.observe(this, { childList: true, subtree: true });
    this.#updateShippingProgress();
    this.#themeDrawer?.addEventListener(DrawerOpenEvent.eventName, this.#handleDrawerOpen);
    this.addEventListener(ThemeEvents.cartSectionRestored, this.#handleCartSectionRestored);

    // The restore path sets [open] before this module loads, so the
    // theme-drawer:open event will have already fired. Use the attribute
    // check so this works even before <theme-drawer> upgrades.
    if (this.#themeDrawer?.hasAttribute('open')) {
      this.#handleDrawerOpen();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(StandardEvents.cartLinesUpdate, this.#handleCartLinesUpdate);
    this.removeEventListener('click', this.#handleUpsellClick);
    this.#shippingObserver?.disconnect();
    this.#shippingObserver = null;
    this.#themeDrawer?.removeEventListener(DrawerOpenEvent.eventName, this.#handleDrawerOpen);
    this.removeEventListener(ThemeEvents.cartSectionRestored, this.#handleCartSectionRestored);
  }

  /**
   * Recomputes the sticky summary after a back/forward cache restore re-renders the cart items.
   *
   * On viewports at or above 990px an open drawer survives a navigation and is reopened during
   * parsing (see the restore script in `snippets/theme-drawer.liquid`), so no open event fires
   * on the way back and the measurement taken before the shopper left is the one still applied.
   * An empty drawer measured as unpinned would keep the checkout CTA scrolling away once the
   * restore fills it with line items.
   */
  #handleCartSectionRestored = () => {
    requestAnimationFrame(() => this.#updateStickyState());
  };

  /**
   * Handles the theme-drawer opening — updates sticky state and wires up the installments CTA.
   */
  #handleDrawerOpen = () => {
    // Always show the chosen items first, not a previously scrolled recommendation area.
    this.#resetScrollPosition();
    requestAnimationFrame(() => this.#resetScrollPosition());
    this.#updateStickyState();
    this.#updateShippingProgress();

    // Close cart drawer when installments CTA is clicked to avoid overlapping dialogs.
    // Re-queried on every open so it survives cart content re-renders that
    // replace the shopify-payment-terms shadow root.
    customElements.whenDefined('shopify-payment-terms').then(() => {
      const cta = this.querySelector('shopify-payment-terms')?.shadowRoot?.querySelector('#shopify-installments-cta');
      cta?.addEventListener('click', () => this.#themeDrawer?.close(), { once: true });
    });
  };

  /**
   * @param {import('@shopify/events').CartLinesUpdateEvent} event
   */
  #handleCartLinesUpdate = (event) => {
    const shouldAutoOpen = this.hasAttribute('auto-open') && event.action === 'add' && !this.#themeDrawer?.isOpen;

    // When the event originates inside an open MODAL <dialog> (e.g. quick-add),
    // defer the auto-open until that dialog's native `close` fires so its focus
    // restoration runs first — otherwise we'd capture the wrong
    // `#previouslyFocused`. Non-modal dialogs (e.g. the hotspot preview) don't
    // close on add and don't move focus, so `:modal` excludes them.
    const sourceModal = /** @type {HTMLDialogElement | null} */ (
      event.target instanceof Element ? event.target.closest('dialog:modal') : null
    );

    if (shouldAutoOpen && !sourceModal && !this.#isCartEmpty()) {
      this.#themeDrawer?.open();
    }

    event.promise
      ?.then(({ detail }) => {
        const settle = () => requestAnimationFrame(() => {
          this.#updateStickyState();
          this.#updateShippingProgress();
          if (event.action === 'add') this.#resetScrollPosition();
        });

        if (!shouldAutoOpen || detail?.didError) {
          settle();
          return;
        }

        const openAndSettle = () => {
          if (!this.#themeDrawer?.isOpen) this.#themeDrawer?.open();
          settle();
        };

        if (sourceModal?.open) {
          sourceModal.addEventListener('close', openAndSettle, { once: true });
        } else {
          openAndSettle();
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[cart-drawer] Event promise rejected:', error);
      });
  };


  /**
   * Keep shipping progress accurate for the Shopify Market's presentment currency.
   * We hide the progress bar if a trusted Shopify conversion rate is unavailable,
   * rather than promise free shipping based on a misleading currency threshold.
   */
  #updateShippingProgress = () => {
    const element = this.querySelector('[data-zs-shipping-progress]');
    if (!(element instanceof HTMLElement)) return;

    const message = element.querySelector('[data-zs-shipping-message]');
    const track = element.querySelector('[data-zs-shipping-track]');
    const fill = element.querySelector('[data-zs-shipping-fill]');
    const shippingRow = this.querySelector('[data-zs-shipping-summary]');
    const shippingStatus = shippingRow?.querySelector('[data-zs-shipping-status]');
    if (!(message instanceof HTMLElement) || !(track instanceof HTMLElement) || !(fill instanceof HTMLElement)) return;

    const baseCurrency = (element.dataset.shopCurrency || '').toUpperCase();
    const currency = (element.dataset.currency || baseCurrency).toUpperCase();
    const goalUsdCents = Number(element.dataset.thresholdUsdCents);
    const totalCents = Number(element.dataset.cartTotalCents);
    const shopifyRate = Number(window.Shopify?.currency?.rate);
    const rate = currency === 'USD' ? 1 : baseCurrency === 'USD' ? shopifyRate : NaN;
    const localeTag = element.dataset.locale || 'en';
    const locale = localeTag.split('-')[0].toLowerCase();
    const country = element.dataset.countryName || 'your country';
    const hasBundleOffer = element.dataset.bundleShipping === 'true';
    const usdGoal = '$' + String(goalUsdCents / 100) + ' USD';

    const translations = {
      en: {
        reached: (name, goal) => 'Your discounted cart meets the ' + goal + ' free-shipping minimum for ' + name + '. Final shipping confirmed at checkout.',
        remaining: (amount, goal, name) => 'Add ' + amount + ' more toward free shipping to ' + name + ' (' + goal + ' minimum). Checkout confirms rates.',
        unknown: (goal, name) => 'Free shipping to ' + name + ' on orders ' + goal + '+. Rates and eligibility confirmed at checkout.',
        bundle: 'Bundle offer applied. ',
        met: 'Minimum reached',
        notMet: 'Minimum not reached',
        checkout: 'At checkout',
      },
      de: {
        reached: (name, goal) => 'Dein Warenkorb nach Rabatten erreicht den Mindestwert von ' + goal + ' für ' + name + '. Versand wird an der Kasse bestätigt.',
        remaining: (amount, goal, name) => 'Noch ' + amount + ' bis zum Versand-Mindestwert für ' + name + ' (' + goal + '). Bestätigung an der Kasse.',
        unknown: (goal, name) => 'Kostenloser Versand nach ' + name + ' ab ' + goal + '. Bestätigung an der Kasse.',
        bundle: 'Bundle-Angebot angewendet. ',
        met: 'Mindestwert erreicht',
        notMet: 'Mindestwert nicht erreicht',
        checkout: 'An der Kasse',
      },
      fr: {
        reached: (name, goal) => 'Votre panier après remises atteint le seuil de ' + goal + ' pour ' + name + '. Livraison confirmée à la caisse.',
        remaining: (amount, goal, name) => 'Encore ' + amount + ' pour atteindre le seuil vers ' + name + ' (' + goal + '). Vérification à la caisse.',
        unknown: (goal, name) => 'Livraison gratuite vers ' + name + ' dès ' + goal + '. Confirmation à la caisse.',
        bundle: 'Offre groupée appliquée. ',
        met: 'Seuil atteint',
        notMet: 'Seuil non atteint',
        checkout: 'À la caisse',
      },
      ar: {
        reached: (name, goal) => 'قيمة السلة بعد الخصومات بلغت حد الشحن المجاني ' + goal + ' إلى ' + name + '. يتم تأكيد الشحن عند الدفع.',
        remaining: (amount, goal, name) => 'أضف ' + amount + ' للوصول إلى حد الشحن المجاني إلى ' + name + ' (' + goal + '). يتم التأكيد عند الدفع.',
        unknown: (goal, name) => 'الشحن المجاني إلى ' + name + ' للطلبات بقيمة ' + goal + ' أو أكثر. يتم تأكيد الأسعار عند الدفع.',
        bundle: 'تم تطبيق عرض الحزمة. ',
        met: 'تم بلوغ الحد',
        notMet: 'لم يتم بلوغ الحد',
        checkout: 'عند الدفع',
      },
    };
    const words = translations[locale] || translations.en;

    const setStatus = (status, minimumMet) => {
      if (shippingStatus instanceof HTMLElement && shippingStatus.textContent.trim() !== status) {
        shippingStatus.textContent = status;
      }
      shippingRow?.classList.toggle('is-free', minimumMet);
    };

    // Use the discounted Shopify cart total. Never invent a converted threshold.
    const canConvert = (currency === 'USD' || baseCurrency === 'USD') &&
      Number.isFinite(rate) && rate > 0 &&
      Number.isFinite(goalUsdCents) && goalUsdCents > 0 &&
      Number.isFinite(totalCents) && totalCents >= 0;

    if (!canConvert) {
      track.hidden = true;
      element.classList.remove('is-qualified');
      const copy = words.unknown(usdGoal, country);
      if (message.textContent.trim() !== copy) message.textContent = copy;
      setStatus(words.checkout, false);
      return;
    }

    const goalCents = Math.ceil(goalUsdCents * rate);
    const minimumMet = totalCents >= goalCents;
    const remainingCents = Math.max(0, goalCents - totalCents);
    const completion = Math.min(100, Math.round((totalCents / goalCents) * 100));

    let formattedAmount;
    try {
      formattedAmount = new Intl.NumberFormat(localeTag, { style: 'currency', currency }).format(remainingCents / 100);
    } catch {
      formattedAmount = (remainingCents / 100).toFixed(2) + ' ' + currency;
    }

    // Bundle product discounts remain untouched, but a bundle discount
    // alone must not force a full progress bar or promise free delivery.
    const prefix = hasBundleOffer && !minimumMet ? words.bundle : '';
    const copy = prefix + (minimumMet
      ? words.reached(country, usdGoal)
      : words.remaining(formattedAmount, usdGoal, country));
    if (message.textContent.trim() !== copy) message.textContent = copy;
    element.classList.toggle('is-qualified', minimumMet);
    track.hidden = false;
    track.setAttribute('aria-label', 'Progress toward free-shipping minimum for ' + country);
    track.setAttribute('aria-valuenow', String(completion));
    fill.style.width = String(completion) + '%';
    setStatus(minimumMet ? words.met : words.notMet, minimumMet);
  };

  /**
   * AJAX quick add for the complementary single-variant items.
   * Uses the same CartLinesUpdateEvent contract as Horizon's product forms
   * so native cart rendering, quantity updates, and discounts are preserved.
   * @param {MouseEvent} event
   */
  #handleUpsellClick = async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button[data-zs-upsell-variant]');
    if (!(button instanceof HTMLButtonElement) || !this.contains(button) || button.disabled) return;

    const variantId = button.dataset.zsUpsellVariant || '';
    if (!/^\d+$/.test(variantId)) return;

    const errorMessage = this.querySelector('[data-zs-upsell-error]');
    if (errorMessage instanceof HTMLElement) errorMessage.hidden = true;
    button.disabled = true;

    const sectionIds = Array.from(document.querySelectorAll('cart-items-component'))
      .map((element) => element instanceof HTMLElement ? element.dataset.sectionId : '')
      .filter(Boolean);

    const deferred = CartLinesUpdateEvent.createPromise();
    this.dispatchEvent(new CartLinesUpdateEvent({
      action: 'add',
      context: 'product',
      lines: [{ merchandiseId: variantId, quantity: 1 }],
      promise: deferred.promise,
    }));

    try {
      const response = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          items: [{ id: Number(variantId), quantity: 1 }],
          sections: Array.from(new Set(sectionIds)).join(','),
          sections_url: window.location.pathname,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.status) {
        throw new Error(data.description || data.message || 'Unable to add this product');
      }

      const cartResponse = await fetch(`${Theme.routes.cart_url}.json`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!cartResponse.ok) throw new Error('Unable to refresh cart');
      const cart = await cartResponse.json();

      deferred.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
        detail: {
          items: cart.items,
          sections: data.sections,
          source: 'zs-cart-upsell',
          didError: false,
        },
      });
    } catch (error) {
      deferred.reject(error);
      if (errorMessage instanceof HTMLElement) {
        errorMessage.textContent = error instanceof Error ? error.message : 'Unable to add this product';
        errorMessage.hidden = false;
      }
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };

  /**
   * Prevent the drawer from reopening at a stale scroll position.
   * Quantity changes can preserve the shopper's position; only opening
   * and adding items scroll back to the selected products.
   */
  #resetScrollPosition() {
    const content = this.querySelector('.cart-drawer__content');
    if (content instanceof HTMLElement) content.scrollTop = 0;
    const products = this.querySelector('.cart-drawer__items');
    if (products instanceof HTMLElement) products.scrollTop = 0;
  }

  #isCartEmpty() {
    return Boolean(this.querySelector('.cart-drawer--empty'));
  }

  #updateStickyState() {
    const dialog = this.#dialog;
    if (!dialog) return;

    // Refs do not cross nested `*-component` boundaries (e.g., `cart-items-component`), so we query within the dialog.
    const content = dialog.querySelector('.cart-drawer__content');
    const summary = dialog.querySelector('.cart-drawer__summary');

    if (!content || !summary) {
      // Ensure the dialog doesn't get stuck in "unsticky" mode when summary disappears (e.g., empty cart).
      dialog.setAttribute('cart-summary-sticky', 'false');
      return;
    }

    const drawerHeight = dialog.getBoundingClientRect().height;
    const summaryHeight = summary.getBoundingClientRect().height;
    const ratio = summaryHeight / drawerHeight;
    dialog.setAttribute('cart-summary-sticky', ratio > this.#summaryThreshold ? 'false' : 'true');
  }
}

if (!customElements.get('cart-drawer-component')) {
  customElements.define('cart-drawer-component', CartDrawerComponent);
}
