/* ZAISEN bundle checkout, native Shopify discount codes + cart permalinks.
   The main product is fixed; shoppers can uncheck either curated complement.
   Prices use current storefront variant prices; checkout is authoritative.
   Discount rules use native Shopify codes (15% min 2, 25% min 3).
*/
(() => {
  if (customElements.get('zs-bundle-builder')) return;

  class ZaisenBundleBuilder extends HTMLElement {
    connectedCallback() {
      this.main = this.querySelector('[data-zs-main]');
      this.rows = [...this.querySelectorAll('[data-zs-row]')];
      this.extras = [...this.querySelectorAll('[data-zs-optional]')];
      this.button = this.querySelector('[data-zs-checkout]');
      this.errorNode = this.querySelector('[data-zs-error]');
      this.mainChoices = this.querySelector('[data-zs-main-variants]');
      this.priceFormatter = null;
      try {
        this.priceFormatter = new Intl.NumberFormat(this.dataset.locale || 'en-US', {
          style: 'currency',
          currency: this.dataset.currency || 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      } catch (_) {
        this.priceFormatter = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'});
      }
      this.onLocalChange = (event) => {
        if (event.target.matches('[data-zs-variant]')) {
          const row = event.target.closest('[data-zs-row]');
          const selected = event.target.selectedOptions[0];
          if (row && selected) {
            row.dataset.variantId = selected.value;
            row.dataset.priceCents = selected.dataset.price || row.dataset.priceCents;
          }
        }
        this.refresh();
      };
      this.onDocumentChange = (event) => {
        const form = event.target.closest?.('product-form-component');
        if (form?.dataset.productId === this.dataset.productId) {
          setTimeout(() => this.refresh(), 80);
          setTimeout(() => this.refresh(), 240);
        }
      };
      this.onClick = () => this.buy();
      this.addEventListener('change', this.onLocalChange);
      document.addEventListener('change', this.onDocumentChange, true);
      this.button?.addEventListener('click', this.onClick);
      this.refresh();
    }
    disconnectedCallback() {
      this.removeEventListener('change', this.onLocalChange);
      document.removeEventListener('change', this.onDocumentChange, true);
      this.button?.removeEventListener('click', this.onClick);
    }
    money(cents) {
      return this.priceFormatter.format(Math.round(cents) / 100);
    }
    syncMainVariant() {
      const input = document.querySelector(
        'product-form-component[data-product-id="' + this.dataset.productId + '"] input[name="id"]'
      );
      const matched = [...this.mainChoices?.options || []].find(option => option.value === input?.value);
      if (matched) {
        this.main.dataset.variantId = matched.value;
        this.main.dataset.priceCents = matched.dataset.price;
        this.mainChoices.value = matched.value;
      }
    }
    selectedRows() {
      return this.rows.filter(row => row.hasAttribute('data-zs-main') ||
        row.querySelector('[data-zs-check]')?.checked);
    }
    refresh() {
      if (!this.main) return;
      this.syncMainVariant();
      const selected = this.selectedRows();
      const count = selected.length;
      const percent = count === 3 ? 25 : (count === 2 ? 15 : 0);
      let before = 0, after = 0;
      for (const row of this.rows) {
        const checked = selected.includes(row);
        row.classList.toggle('zs-bundle__row--unselected', !checked);
        const price = Number(row.dataset.priceCents) || 0;
        const discountPrice = checked ? Math.round(price * (100 - percent) / 100) : price;
        if (checked) { before += price; after += discountPrice; }
        const original = row.querySelector('[data-zs-original]');
        const current = row.querySelector('[data-zs-price]');
        const saved = row.querySelector('[data-zs-saved]');
        if (original) {
          original.textContent = this.money(price);
          original.hidden = !checked || !percent;
        }
        if (current) current.textContent = this.money(discountPrice);
        if (saved) saved.textContent = checked && percent ? 'Save ' + this.money(price - discountPrice) : '';
      }
      const tier = this.querySelector('[data-zs-tier]');
      if (tier) tier.textContent = percent ? percent + '% OFF' : 'SELECT MORE';
      const description = this.querySelector('[data-zs-tier-description]');
      if (description) {
        description.textContent = percent
          ? 'Save ' + percent + '% on ' + count + ' products'
          : 'Add one more item to unlock 15%';
      }
      const regular = this.querySelector('[data-zs-regular-total]');
      if (regular) regular.textContent = this.money(before);
      const total = this.querySelector('[data-zs-bundle-total]');
      if (total) total.textContent = this.money(after);
      const savedTotal = this.querySelector('[data-zs-save-total]');
      if (savedTotal) savedTotal.textContent = percent ? 'SAVE ' + this.money(before - after) : '—';
      const shipping = this.querySelector('[data-zs-shipping]');
      if (shipping) shipping.textContent = this.dataset.freeShipping === 'true'
        ? (count >= 2 ? '✦ FREE SHIPPING INCLUDED' : 'Free shipping unlocks with 2 products')
        : 'Shipping options depend on your destination';
      if (this.button) {
        this.button.disabled = count < 2;
        const label = this.button.querySelector('span');
        if (label) label.textContent = percent
          ? 'BUY BUNDLE — SAVE ' + percent + '%'
          : 'CHOOSE A MATCHING PRODUCT';
      }
      this.currentPercent = percent;
    }
    buy() {
      this.refresh();
      if (!this.currentPercent) return;
      const selected = this.selectedRows();
      const ids = selected.map(row => row.dataset.variantId);
      if (ids.some(id => !/^\d+$/.test(id || '')) || new Set(ids).size !== ids.length) {
        this.showError('Please select a valid available variant for each product.');
        return;
      }
      const discount = this.currentPercent === 25 ? 'ZS-BUNDLE25-2026' : 'ZS-BUNDLE15-2026';
      const codes = [discount];
      if (this.dataset.freeShipping === 'true') codes.push('ZS-BUNDLESHIP-2026');
      const cartPath = this.dataset.cartPath || '/cart/';
      const url = cartPath + ids.map(id => id + ':1').join(',') +
        '?discount=' + encodeURIComponent(codes.join(','));
      window.location.assign(url);
    }
    showError(message) {
      if (!this.errorNode) return;
      this.errorNode.hidden = false;
      this.errorNode.textContent = message;
    }
  }
  customElements.define('zs-bundle-builder', ZaisenBundleBuilder);
})();
