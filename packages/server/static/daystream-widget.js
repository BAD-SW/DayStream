/*!
 * DayStream Embeddable Booking Widget
 * Paste this once, near the closing </body> tag:
 *   <script src="https://<your-daystream-api-domain>/widget/daystream-widget.js"
 *           data-business-id="YOUR_BUSINESS_ID"
 *           data-app-url="https://<your-daystream-app-domain>"></script>
 * Then mark any button with a Widget_Snippet ("Copy widget snippet" in DayStream's Offerings admin):
 *   <button data-daystream-product="SERVICE_OR_PACKAGE_ID" data-daystream-action="book">Book Now</button>
 * Vanilla JS, zero dependencies, safe to include on any site (WordPress, Squarespace, Webflow, plain HTML).
 *
 * data-app-url: the /booking-widget page is served by DayStream's CLIENT app, which is a
 * separate deployment (Vercel) from the server that hosts this script (Render) — they are
 * never the same origin in this project's deployment topology, so the app origin cannot be
 * inferred from this script's own src. If omitted, this script falls back to its own src's
 * origin, which only works when both happen to be colocated.
 */
(function () {
  'use strict';

  // Requirement 1.7 — idempotent: re-including this tag (or a page re-executing it) must not
  // create duplicate modals/listeners.
  if (window.__daystreamWidgetLoaded) return;
  window.__daystreamWidgetLoaded = true;

  var scriptTag = document.currentScript;
  var BUSINESS_ID = scriptTag ? scriptTag.getAttribute('data-business-id') : null;
  var appUrlAttr = scriptTag ? scriptTag.getAttribute('data-app-url') : null;
  var APP_ORIGIN = appUrlAttr
    ? new URL(appUrlAttr).origin
    : (scriptTag ? new URL(scriptTag.src).origin : window.location.origin);

  if (!BUSINESS_ID) {
    console.error('[DayStream] Widget script is missing a data-business-id attribute.');
    return;
  }

  var overlay = null;
  var iframe = null;
  var closeBtn = null;
  var spinner = null;
  var lastFocusedElement = null;
  var previousBodyOverflow = '';

  function injectStyles() {
    var style = document.createElement('style');
    style.id = 'daystream-widget-styles';
    style.textContent = [
      '.daystream-widget-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(15,15,20,0.55);',
      'display:flex;align-items:center;justify-content:center;padding:0;}',
      '.daystream-widget-frame-wrap{position:relative;width:100%;height:100%;background:#fff;',
      'box-shadow:0 10px 40px rgba(0,0,0,0.25);overflow:hidden;}',
      '@media (min-width:720px){.daystream-widget-frame-wrap{width:min(560px,92vw);height:min(90vh,880px);',
      'border-radius:12px;}}',
      '.daystream-widget-iframe{display:block;width:100%;height:100%;border:0;}',
      '.daystream-widget-close{position:absolute;top:10px;right:10px;z-index:1;width:36px;height:36px;',
      'border-radius:999px;border:0;background:rgba(0,0,0,0.55);color:#fff;font-size:18px;line-height:1;',
      'cursor:pointer;display:flex;align-items:center;justify-content:center;}',
      '.daystream-widget-close:hover{background:rgba(0,0,0,0.75);}',
      '.daystream-widget-spinner{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
      'background:#fff;}',
      '.daystream-widget-spinner::after{content:"";width:32px;height:32px;border-radius:999px;',
      'border:3px solid #d0d0d5;border-top-color:#333;animation:daystream-spin 0.8s linear infinite;}',
      '@keyframes daystream-spin{to{transform:rotate(360deg);}}',
      'body.daystream-widget-open{overflow:hidden;}',
    ].join('');
    document.head.appendChild(style);
  }

  function lockBodyScroll() {
    previousBodyOverflow = document.body.style.overflow;
    document.body.classList.add('daystream-widget-open');
  }

  function unlockBodyScroll() {
    document.body.classList.remove('daystream-widget-open');
    document.body.style.overflow = previousBodyOverflow;
  }

  function getFocusable() {
    return [closeBtn, iframe].filter(Boolean);
  }

  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    var focusable = getFocusable();
    if (focusable.length === 0) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closeModal();
    trapFocus(e);
  }

  // Backstop for trapFocus: a Tab keypress that occurs INSIDE the iframe's own document
  // never reaches this parent-page listener at all (cross-origin — browsers don't bubble
  // iframe keyboard events to the parent), so the only reliable way to catch focus actually
  // escaping frameWrap onto the rest of the host page is to watch where focus LANDS, not the
  // keypress that sent it there.
  function onFocusIn(e) {
    if (!overlay) return;
    var frameWrap = overlay.firstChild;
    if (frameWrap && !frameWrap.contains(e.target)) {
      closeBtn.focus();
    }
  }

  // Requirement 12.8 / 13.6 — never act on a message from an unexpected origin.
  function onMessage(e) {
    if (e.origin !== APP_ORIGIN) return;
    var data = e.data || {};
    if (data.type === 'daystream:ready' && spinner) {
      spinner.remove();
      spinner = null;
    } else if (data.type === 'daystream:close') {
      closeModal();
    } else if (data.type === 'daystream:booking_confirmed') {
      window.dispatchEvent(new CustomEvent('daystreamBookingConfirmed', { detail: data }));
    }
  }

  function openModal(productId, action) {
    if (overlay) return; // already open

    if (!document.getElementById('daystream-widget-styles')) injectStyles();

    lastFocusedElement = document.activeElement;

    overlay = document.createElement('div');
    overlay.className = 'daystream-widget-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var frameWrap = document.createElement('div');
    frameWrap.className = 'daystream-widget-frame-wrap';

    spinner = document.createElement('div');
    spinner.className = 'daystream-widget-spinner';
    frameWrap.appendChild(spinner);

    closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'daystream-widget-close';
    closeBtn.setAttribute('aria-label', 'Close booking');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', closeModal);
    frameWrap.appendChild(closeBtn);

    var src = APP_ORIGIN + '/booking-widget?business_id=' + encodeURIComponent(BUSINESS_ID)
      + '&product_id=' + encodeURIComponent(productId)
      + '&action=' + encodeURIComponent(action || 'book');

    iframe = document.createElement('iframe');
    iframe.className = 'daystream-widget-iframe';
    iframe.src = src;
    iframe.title = 'DayStream booking';
    frameWrap.appendChild(iframe);

    overlay.appendChild(frameWrap);
    document.body.appendChild(overlay);

    lockBodyScroll();
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('focusin', onFocusIn);
    window.addEventListener('message', onMessage);

    closeBtn.focus();
  }

  function closeModal() {
    if (!overlay) return;
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('focusin', onFocusIn);
    window.removeEventListener('message', onMessage);
    overlay.remove();
    overlay = null;
    iframe = null;
    closeBtn = null;
    spinner = null;
    unlockBodyScroll();
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }

  // Requirement 1.3 — event delegation so buttons added to the page after load still work,
  // with a single listener regardless of how many Widget_Buttons exist.
  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    var btn = target.closest('[data-daystream-product]');
    if (!btn) return;
    e.preventDefault();
    openModal(btn.getAttribute('data-daystream-product'), btn.getAttribute('data-daystream-action'));
  });

  // Requirement 1.9 — programmatic trigger for business developers.
  window.DayStream = window.DayStream || {};
  window.DayStream.open = openModal;
})();
