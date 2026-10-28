/*
 * ZAISEN bundle controls for the EXISTING Add to Cart + Buy Now buttons.
 * Two curated optional additions; native 15% / 25% product discount codes.
 * Free shipping is either earned via the normal country minimum or the
 * separate qualifying bundle shipping code. Only eligible destinations are
 * shown as free. No separate bundle purchase button is rendered.
 *
 * Shopify Ajax Cart API: POST cart/add.js with items, followed by
 * POST cart/update.js with comma-separated discount codes.
 * Intercept theme form only when extras are checked. Main-only actions
 * continue to use their original native theme handlers.
 */
(() => {
  if (customElements.get('zs-bundle-builder')) return;

  class ZaisenBundleBuilder extends HTMLElement {
    connectedCallback() {
      this.main = this.querySelector('[data-zs-main]');
      this.rows = [...this.querySelectorAll('[data-zs-row]')];
      this.extras = [...this.querySelectorAll('[data-zs-optional]')];
      this.mainChoices = this.querySelector('[data-zs-main-variants]');
      this.formComponent = this.closest('.buy-buttons-block')?.querySelector('product-form-component');
      this.form = this.formComponent?.querySelector('form') || null;
      this.errorNode = this.querySelector('[data-zs-error]');
      this.promo = this.querySelector('[data-zs-delivery-zone]');
      this.progress = this.querySelector('[data-zs-progress]');
      this.progressFill = this.querySelector('[data-zs-progress-fill]');
      this.processing = false;
      this.currency = (this.dataset.currency || 'USD').toUpperCase();

      try {
        this.format = new Intl.NumberFormat(this.dataset.locale || 'en-US', {
          style: 'currency', currency: this.currency,
          minimumFractionDigits: 2, maximumFractionDigits: 2
        });
      } catch (_) {
        this.format = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'});
      }

      this.onLocalChange = event => {
        if (event.target.matches('[data-zs-variant]')) {
          const row = event.target.closest('[data-zs-row]');
          const variant = event.target.selectedOptions[0];
          if (row && variant) {
            row.dataset.variantId = variant.value;
            row.dataset.priceCents = variant.dataset.price || row.dataset.priceCents;
          }
        }
        this.refresh();
      };
      this.onFormChange = event => {
        const withinDetails = this.closest('.product-details')?.contains(event.target);
        if (withinDetails && !this.contains(event.target)) {
          this.refresh();
          setTimeout(() => this.refresh(), 80);
          setTimeout(() => this.refresh(), 240);
        }
      };
      this.onVariantUpdate = () => {
        this.refresh();
        setTimeout(() => this.refresh(), 80);
      };
      this.onSubmitCapture = event => {
        if (event.target !== this.form || this.selectedRows().length < 2) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (this.processing || !this.form?.reportValidity()) return;
        this.purchase('cart');
      };
      this.onClickCapture = event => {
        const target = event.target instanceof Element
          ? event.target.closest('[data-zs-buy-now]') : null;
        if (!target || !this.form?.contains(target) || this.selectedRows().length < 2) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (this.processing || target.disabled || !this.form.reportValidity()) return;
        this.purchase('checkout');
      };
      this.addEventListener('change', this.onLocalChange);
      document.addEventListener('change', this.onFormChange, true);
      document.addEventListener('variant:update', this.onVariantUpdate);
      document.addEventListener('submit', this.onSubmitCapture, true);
      document.addEventListener('click', this.onClickCapture, true);
      this.refresh();
    }
    disconnectedCallback() {
      this.removeEventListener('change', this.onLocalChange);
      document.removeEventListener('change', this.onFormChange, true);
      document.removeEventListener('variant:update', this.onVariantUpdate);
      document.removeEventListener('submit', this.onSubmitCapture, true);
      document.removeEventListener('click', this.onClickCapture, true);
    }
    money(cents) { return this.format.format(Math.round(cents) / 100); }

    syncMainVariant() {
      const chosenId = this.form?.querySelector('input[name="id"]')?.value;
      const option = [...(this.mainChoices?.options || [])].find(o => o.value === chosenId);
      if (option && this.main) {
        this.main.dataset.variantId = option.value;
        this.main.dataset.priceCents = option.dataset.price;
        this.mainChoices.value = option.value;
      }
    }

    selectedRows() {
      return this.rows.filter(row =>
        row.hasAttribute('data-zs-main') ||
        (!!row.querySelector('[data-zs-check]')?.checked &&
         !row.querySelector('[data-zs-check]')?.disabled));
    }

    quantity() {
      const field = this.form?.querySelector('input[name="quantity"]');
      const qty = Number(field?.value || '1');
      return Number.isInteger(qty) && qty > 0 ? Math.min(qty, 999) : 1;
    }

    refresh() {
      if (!this.main) return;
      this.syncMainVariant();
      const selected = this.selectedRows();
      const count = selected.length;
      const rate = count === 3 ? 25 : count === 2 ? 15 : 0;
      const mainQty = this.quantity();
      let before = 0, after = 0;

      for (const row of this.rows) {
        const checked = selected.includes(row);
        row.classList.toggle('zs-bundle__row--unselected', !checked);
        const unit = Number(row.dataset.priceCents) || 0;
        const discounted = checked ? Math.round(unit * (100 - rate) / 100) : unit;
        const units = row === this.main ? mainQty : 1;
        if (checked) {
          before += unit * units;
          after += discounted * units;
        }
        const oldPrice = row.querySelector('[data-zs-original]');
        const price = row.querySelector('[data-zs-price]');
        const saved = row.querySelector('[data-zs-saved]');
        if (oldPrice) {
          oldPrice.textContent = this.money(unit);
          oldPrice.hidden = !checked || !rate;
        }
        if (price) price.textContent = this.money(discounted);
        if (saved) saved.textContent = checked && rate
          ? 'Save ' + this.money((unit - discounted) * units) : '';
      }

      const tier = this.querySelector('[data-zs-tier]');
      if (tier) tier.textContent = rate ? rate + '% OFF' : 'UP TO 25% OFF';
      const desc = this.querySelector('[data-zs-tier-description]');
      if (desc) desc.textContent = rate
        ? 'Save ' + rate + '% on ' + count + ' selected products'
        : 'Add 1 piece: 15% off · Add both: 25% off';
      const regular = this.querySelector('[data-zs-regular-total]');
      if (regular) regular.textContent = this.money(before);
      const total = this.querySelector('[data-zs-bundle-total]');
      if (total) total.textContent = this.money(after);
      const savings = this.querySelector('[data-zs-save-total]');
      if (savings) savings.textContent = rate ? 'SAVE ' + this.money(before - after) : '—';

      this.currentRate = rate;
      this.selectedTotal = after;
      this.updateShipping(count, after);

      // The original Add to Cart and Buy Now buttons stay present, active,
      // and controlled by the native product form and variant availability.
      if (this.errorNode) {
        this.errorNode.hidden = true;
        this.errorNode.textContent = '';
      }
    }

    updateShipping(count, totalCents) {
      const supported = this.dataset.freeShipping === 'true';
      const thresholdUSD = Number(this.dataset.shippingThresholdCents) || 0;
      const currency = this.currency;
      const marketRate = Number(window.Shopify?.currency?.rate);
      // Shopify's own storefront rate can help estimate progress in local currencies.
      // Avoid assuming that $60 USD and €60 are equivalent if the rate isn't available.
      const thresholdLocal = currency === 'USD' ? thresholdUSD :
        Number.isFinite(marketRate) && marketRate > 0 && marketRate < 5000
          ? thresholdUSD * marketRate : null;
      const normalEligible = supported && thresholdLocal != null &&
        thresholdLocal > 0 && totalCents >= thresholdLocal;
      const bundleEligible = supported && count >= 2;
      const unlocked = normalEligible || bundleEligible;
      const percentage = !supported ? 0 : unlocked ? 100 :
        thresholdLocal != null && thresholdLocal > 0
          ? Math.max(0, Math.min(99, Math.round(totalCents / thresholdLocal * 100)))
          : 0;
      const label = this.querySelector('[data-zs-shipping-label]');
      const check = this.querySelector('[data-zs-shipping-check]');
      const formattedThreshold = '$' + thresholdUSD / 100 + '+';
      this.promo?.classList.toggle('is-unlocked', unlocked);
      if (check) {
        check.hidden = !unlocked;
        // Only one checkmark: the circular icon. Never duplicate it in text.
        check.textContent = '✓';
      }
      if (this.progress) {
        this.progress.setAttribute('aria-valuenow', String(percentage));
        this.progress.setAttribute('aria-label', unlocked
          ? 'Free shipping unlocked'
          : 'Free shipping progress to ' + formattedThreshold + ' USD');
      }
      if (this.progressFill) this.progressFill.style.width = percentage + '%';
      if (!label) return;
      if (!supported) {
        label.textContent = 'SHIPPING CALCULATED AT CHECKOUT';
      } else if (normalEligible) {
        label.textContent = 'YOUR ORDER QUALIFIES FOR FREE SHIPPING (' + formattedThreshold + ' USD)';
      } else if (bundleEligible) {
        label.textContent = 'YOUR BUNDLE QUALIFIES FOR FREE SHIPPING';
      } else {
        label.textContent = 'FREE SHIPPING ON ORDERS ' + formattedThreshold + ' USD';
      }
    }

    lines() {
      const selected = this.selectedRows();
      const variants = selected.map(row => String(row.dataset.variantId || ''));
      if (variants.some(id => !/^\d+$/.test(id)) || new Set(variants).size !== variants.length) {
        throw new Error('Please choose an available variant for each selected product.');
      }
      const formData = new FormData(this.form);
      const mainId = String(formData.get('id') || '');
      if (!mainId || mainId !== variants[0]) {
        throw new Error('Your main product option is updating. Please try again.');
      }
      const properties = {};
      for (const [key, value] of formData.entries()) {
        const match = key.match(/^properties\[([^\]]+)\]$/);
        if (match && typeof value === 'string' && value) properties[match[1]] = value;
      }
      const main = {id:Number(mainId),quantity:this.quantity()};
      if (Object.keys(properties).length) main.properties = properties;
      const sellingPlan = formData.get('selling_plan');
      if (sellingPlan) main.selling_plan = Number(sellingPlan);
      return [main, ...variants.slice(1).map(id => ({id:Number(id),quantity:1}))];
    }

    async purchase(destination) {
      if (this.processing || this.selectedRows().length < 2) return;
      let items;
      try { this.syncMainVariant(); items = this.lines(); }
      catch (error) { this.showError(error.message); return; }
      this.processing = true;
      const buttons = [...this.form.querySelectorAll('button[name="add"],[data-zs-buy-now]')];
      const disabledBefore = buttons.map(button => button.disabled);
      buttons.forEach(button => {button.disabled = true; button.setAttribute('aria-busy','true');});
      const root = window.Shopify?.routes?.root || this.dataset.cartPath?.replace(/cart\/?$/, '') || '/';
      const base = root.endsWith('/') ? root : root + '/';
      const discount = this.currentRate === 25 ? 'ZS-BUNDLE25-2026' : 'ZS-BUNDLE15-2026';
      const codes = [discount];
      if (this.dataset.freeShipping === 'true') codes.push('ZS-BUNDLESHIP-2026');

      try {
        const addResponse = await fetch(base + 'cart/add.js', {
          method:'POST', credentials:'same-origin',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({items})
        });
        const added = await addResponse.json();
        if (!addResponse.ok || added.status) {
          throw new Error(added.description || added.message || 'Could not add the selected products.');
        }
        // Shopify supports multiple comma-separated discount codes in cart/update.js.
        const updateResponse = await fetch(base + 'cart/update.js', {
          method:'POST', credentials:'same-origin',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({discount:codes.join(',')})
        });
        const updated = await updateResponse.json();
        if (!updateResponse.ok || updated.status) {
          throw new Error('Products were added, but the bundle discount could not be applied. Please review your cart.');
        }
        if (destination === 'checkout') {
          window.location.assign(base + 'checkout');
          return;
        }
        await this.openCartDrawer(base);
        this.processing = false;
        buttons.forEach((button, index) => {
          button.disabled = disabledBefore[index];
          button.removeAttribute('aria-busy');
        });
      } catch (error) {
        this.processing = false;
        buttons.forEach((button, index) => {
          button.disabled = disabledBefore[index];
          button.removeAttribute('aria-busy');
        });
        this.showError(error?.message || 'Something went wrong. Please try again.');
      }
    }

    /**
     * Keep bundle Add to Cart on the product page and show the latest
     * Shopify-calculated discounts in the native ZAISEN side drawer.
     * Buy Now continues to checkout.
     */
    async openCartDrawer(base) {
      const drawer = document.getElementById('cart-drawer');
      if (!drawer) {
        window.location.assign(base + 'cart');
        return;
      }

      const response = await fetch(base + '?sections=cart-drawer-section', {
        credentials: 'same-origin',
        headers: {'Accept': 'application/json'}
      });
      if (!response.ok) throw new Error('Could not update the cart drawer.');
      const sections = await response.json();
      const renderedHtml = sections['cart-drawer-section'];
      if (typeof renderedHtml !== 'string' || !renderedHtml) {
        throw new Error('Could not load the updated cart drawer.');
      }

      const parsed = new DOMParser().parseFromString(renderedHtml, 'text/html');
      const replacement = parsed.querySelector('#cart-drawer .cart-drawer__inner');
      const current = drawer.querySelector('.cart-drawer__inner');
      if (!replacement || !current) throw new Error('Cart drawer content unavailable.');

      current.replaceWith(replacement);

      // Bundle form uses Ajax directly rather than the native Horizon
      // product-form events: synchronize the header count ourselves.
      try {
        const cartResponse = await fetch(base + 'cart.js', {
          credentials: 'same-origin',
          headers: {'Accept': 'application/json'}
        });
        if (cartResponse.ok) {
          const cart = await cartResponse.json();
          const icon = document.querySelector('cart-icon');
          if (icon?.renderCartBubble) icon.renderCartBubble(cart.item_count, true);
        }
      } catch (_) {
        // The visible drawer still contains Shopify's latest rendered cart.
      }

      await customElements.whenDefined('theme-drawer');
      drawer.open();
    }

    showError(message) {
      if (!this.errorNode) return;
      this.errorNode.hidden = false;
      this.errorNode.textContent = message;
    }
  }
  customElements.define('zs-bundle-builder', ZaisenBundleBuilder);
})();
