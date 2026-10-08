/**
 * SarrafPay Drop-in Checkout SDK v1.0.0
 * Zero-dependency embeddable checkout for any web application or website.
 */
(function(window) {
  'use strict';

  var SarrafPay = {
    version: '1.0.0',
    baseUrl: (function() {
      var script = document.currentScript;
      if (script && script.src) {
        var url = new URL(script.src);
        return url.origin;
      }
      return window.location.origin;
    })(),

    /**
     * Launch Hosted Checkout Modal or Redirect
     */
    checkout: function(options) {
      options = options || {};

      if (!options.sessionId && (!options.publicKey || !options.amount)) {
        console.error('[SarrafPay] Either sessionId OR (publicKey and amount) must be provided.');
        if (typeof options.onError === 'function') {
          options.onError({ error: 'MISSING_PARAMETERS', message: 'Either sessionId OR (publicKey and amount) is required.' });
        }
        return;
      }

      var self = this;
      if (options.sessionId) {
        self._openModal(options.sessionId, options);
      } else {
        // Create session via Public Key
        var createUrl = (options.gatewayUrl || self.baseUrl) + '/api/v1/checkout/sessions';
        var payload = {
          amount: parseFloat(options.amount),
          orderId: options.orderId || ('ORD-' + Math.random().toString(36).substring(2, 9).toUpperCase()),
          customerName: options.customerName || '',
          customerPhone: options.customerPhone || '',
          customerEmail: options.customerEmail || '',
          returnUrl: options.returnUrl || '',
          metadata: options.metadata || {}
        };

        var xhr = new XMLHttpRequest();
        xhr.open('POST', createUrl, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('X-Public-Key', options.publicKey);
        xhr.onreadystatechange = function() {
          if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                var res = JSON.parse(xhr.responseText);
                self._openModal(res.id, options);
              } catch (e) {
                if (typeof options.onError === 'function') options.onError(e);
              }
            } else {
              var errData;
              try { errData = JSON.parse(xhr.responseText); } catch(e) { errData = { error: 'REQUEST_FAILED' }; }
              if (typeof options.onError === 'function') options.onError(errData);
            }
          }
        };
        xhr.send(JSON.stringify(payload));
      }
    },

    _openModal: function(sessionId, options) {
      var self = this;
      var checkoutUrl = (options.gatewayUrl || self.baseUrl) + '/pay/' + encodeURIComponent(sessionId) + '?embedded=true';

      // Check if user preferred full page redirect instead of iframe
      if (options.redirect === true) {
        window.location.href = checkoutUrl;
        return;
      }

      // Remove any existing modal
      var existing = document.getElementById('sarraf-checkout-overlay');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.id = 'sarraf-checkout-overlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(15,23,42,0.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:999999;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.25s ease-in-out;padding:12px;box-sizing:border-box;';

      var container = document.createElement('div');
      container.style.cssText = 'position:relative;width:100%;max-width:480px;height:92vh;max-height:760px;background:#ffffff;border-radius:24px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.35);overflow:hidden;transform:scale(0.95);transition:transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);display:flex;flex-direction:column;';

      var closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&times;';
      closeBtn.setAttribute('aria-label', 'Close Payment Modal');
      closeBtn.style.cssText = 'position:absolute;top:14px;left:14px;width:34px;height:34px;border-radius:50%;background:#f1f5f9;border:none;cursor:pointer;font-size:22px;color:#475569;display:flex;align-items:center;justify-content:center;z-index:10;box-shadow:0 1px 3px rgba(0,0,0,0.1);transition:all 0.15s;';
      closeBtn.onmouseenter = function() { closeBtn.style.background = '#e2e8f0'; closeBtn.style.color = '#0f172a'; };
      closeBtn.onmouseleave = function() { closeBtn.style.background = '#f1f5f9'; closeBtn.style.color = '#475569'; };

      var iframe = document.createElement('iframe');
      iframe.src = checkoutUrl;
      iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:24px;flex:1;';

      container.appendChild(closeBtn);
      container.appendChild(iframe);
      overlay.appendChild(container);
      document.body.appendChild(overlay);

      // Trigger animation
      setTimeout(function() {
        overlay.style.opacity = '1';
        container.style.transform = 'scale(1)';
      }, 10);

      var closeModal = function() {
        overlay.style.opacity = '0';
        container.style.transform = 'scale(0.95)';
        setTimeout(function() {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 250);
        window.removeEventListener('message', handlePostMessage);
        if (typeof options.onClose === 'function') options.onClose();
      };

      closeBtn.onclick = closeModal;

      var handlePostMessage = function(event) {
        if (!event.data || typeof event.data !== 'object') return;
        if (event.data.type === 'SARRAF_PAYMENT_SUCCESS') {
          if (typeof options.onSuccess === 'function') {
            options.onSuccess(event.data.payload);
          }
          if (options.returnUrl) {
            setTimeout(function() {
              window.location.href = options.returnUrl;
            }, 1200);
          }
        }
        if (event.data.type === 'SARRAF_PAYMENT_CLOSE') {
          closeModal();
        }
      };

      window.addEventListener('message', handlePostMessage);
    }
  };

  window.SarrafPay = SarrafPay;
})(window);
