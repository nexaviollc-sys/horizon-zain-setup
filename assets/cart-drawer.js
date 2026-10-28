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
    if (!(message instanceof HTMLElement) || !(track instanceof HTMLElement) || !(fill instanceof HTMLElement)) {
      return;
    }

    const baseCurrency = (element.dataset.shopCurrency || '').toUpperCase();
    const currency = (element.dataset.currency || baseCurrency).toUpperCase();
    const goalUsdCents = Number(element.dataset.thresholdUsdCents);
    const subtotalCents = Number(element.dataset.cartTotalCents);
    const shopifyRate = Number(window.Shopify?.currency?.rate);
    const rate = currency === 'USD' ? 1 : (baseCurrency === 'USD' ? shopifyRate : NaN);
    const locale = (element.dataset.locale || 'en').split('-')[0].toLowerCase();
    const hasBundleShipping = element.dataset.bundleShipping === 'true';

    const translations = {
      en: {
        eligible: "You've unlocked FREE shipping!",
        bundle: 'Your bundle unlocks FREE shipping!',
        remaining: (amount) => `Add ${amount} more for FREE shipping`,
        free: 'FREE',
        notFree: 'Not free yet',
        unknown: 'At checkout',
        unknownProgress: 'Shipping confirmed at checkout',
      },
      de: {
        eligible: 'Kostenloser Versand freigeschaltet!',
        bundle: 'Dein Bundle erhält kostenlosen Versand!',
        remaining: (amount) => `Noch ${amount} bis zum kostenlosen Versand`,
        free: 'KOSTENLOS',
        notFree: 'Noch nicht kostenlos',
        unknown: 'An der Kasse',
        unknownProgress: 'Versand an der Kasse bestätigt',
      },
      fr: {
        eligible: 'Livraison gratuite débloquée !',
        bundle: 'Livraison gratuite avec votre lot !',
        remaining: (amount) => `Plus que ${amount} pour la livraison gratuite`,
        free: 'GRATUITE',
        notFree: 'Pas encore gratuite',
        unknown: 'À la caisse',
        unknownProgress: 'Livraison confirmée à la caisse',
      },
      ar: {
        eligible: 'لقد حصلت على الشحن المجاني!',
        bundle: 'طلبك المجمع مؤهل للشحن المجاني!',
        remaining: (amount) => `أضف ${amount} للشحن المجاني`,
        free: 'مجاني',
        notFree: 'ليس مجانيًا بعد',
        unknown: 'عند الدفع',
        unknownProgress: 'يتم تأكيد الشحن عند الدفع',
      },
    };
    const words = translations[locale] || translations.en;

    const setStatus = (status, qualified) => {
      if (shippingStatus instanceof HTMLElement && shippingStatus.textContent.trim() !== status) {
        shippingStatus.textContent = status;
      }
      shippingRow?.classList.toggle('is-free', qualified);
    };

    const canConvert = baseCurrency === 'USD' &&
      Number.isFinite(rate) && rate > 0 &&
      Number.isFinite(goalUsdCents) && goalUsdCents > 0 &&
      Number.isFinite(subtotalCents) && subtotalCents >= 0;

    if (!canConvert && !hasBundleShipping) {
      track.hidden = true;
      element.classList.remove('is-qualified');
      if (message.textContent.trim() !== words.unknownProgress) message.textContent = words.unknownProgress;
      setStatus(words.unknown, false);
      return;
    }

    const goalCents = canConvert ? Math.ceil(goalUsdCents * rate) : 0;
    const isQualified = hasBundleShipping || (canConvert && subtotalCents >= goalCents);
    const remainingCents = canConvert ? Math.max(0, goalCents - subtotalCents) : 0;
    const completion = hasBundleShipping ? 100 : Math.min(100, Math.round((subtotalCents / goalCents) * 100));

    let formattedAmount;
    try {
      formattedAmount = new Intl.NumberFormat(element.dataset.locale || 'en', {
        style: 'currency',
        currency,
      }).format(remainingCents / 100);
    } catch {
      formattedAmount = `${(remainingCents / 100).toFixed(2)} ${currency}`;
    }

    const nextMessage = hasBundleShipping ? words.bundle :
      isQualified ? words.eligible : words.remaining(formattedAmount);
    if (message.textContent.trim() !== nextMessage) message.textContent = nextMessage;
    element.classList.toggle('is-qualified', isQualified);
    track.hidden = false;
    track.setAttribute('aria-valuenow', String(completion));
    fill.style.width = `${completion}%`;
    setStatus(isQualified ? words.free : words.notFree, isQualified);
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
