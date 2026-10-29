/* ZAISEN storefront shipping display only.
 * Source rules remain USD in Shopify; presentment-currency figures are estimates.
 * Never write prices or shipping eligibility back to Shopify from this module.
 */
(() => {
  const root = document.documentElement;
  const currency = (root.dataset.zsDisplayCurrency || window.Shopify?.currency?.active || 'USD').toUpperCase();
  const shopCurrency = (root.dataset.zsShopCurrency || 'USD').toUpperCase();
  const locale = root.lang || 'en';
  const rate = currency === 'USD' ? 1 : shopCurrency === 'USD' ? Number(window.Shopify?.currency?.rate) : NaN;
  const available = Number.isFinite(rate) && rate > 0;
  const format = (value, digits = 2) => {
    if (!Number.isFinite(value)) return null;
    const options = { minimumFractionDigits: digits, maximumFractionDigits: digits };
    try {
      if (currency === 'CAD' || currency === 'AUD' || currency === 'AED') {
        return currency + ' ' + new Intl.NumberFormat(locale, options).format(value);
      }
      return new Intl.NumberFormat(locale, { style: 'currency', currency, ...options }).format(value);
    } catch {
      return currency + ' ' + value.toFixed(digits);
    }
  };
  const convert = (usdCents, kind = 'rate') => {
    if (!available || !Number.isFinite(Number(usdCents))) return null;
    const amount = Number(usdCents) / 100 * rate;
    // Round displayed free-shipping minima upward to whole market-currency units.
    // Actual Shopify eligibility can differ because Markets rounds independently.
    return format(kind === 'minimum' ? Math.ceil(amount) : Math.round(amount * 100) / 100, kind === 'minimum' ? 0 : 2);
  };
  const update = (scope = document) => {
    const nodes = [];
    if (scope.nodeType === 1 && scope.matches?.('[data-zs-usd-amount-cents]')) nodes.push(scope);
    scope.querySelectorAll?.('[data-zs-usd-amount-cents]').forEach((el) => nodes.push(el));
    nodes.forEach((el) => {
      const value = convert(el.dataset.zsUsdAmountCents, el.dataset.zsCurrencyKind || 'minimum');
      // When Shopify has not supplied a usable rate, hide the foreign USD amount.
      const text = value || (el.dataset.zsCurrencyFallback || 'At checkout');
      if (el.textContent.trim() !== text) el.textContent = text;
    });
  };
  window.ZaisenShippingCurrency = Object.freeze({ currency, rate, available, format, convert, update });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => update(), { once: true });
  else update();
  document.addEventListener('shopify:section:load', (event) => update(event.target || document));
})();
