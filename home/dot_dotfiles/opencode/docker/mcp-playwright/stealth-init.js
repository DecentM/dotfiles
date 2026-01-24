/**
 * Stealth evasions for Playwright MCP
 *
 * This script is injected into every page context via --init-script.
 * It applies browser fingerprint evasions to avoid bot detection.
 *
 * Based on puppeteer-extra-plugin-stealth evasions that work at page level.
 */

(() => {
  'use strict';

  // Skip if already initialized
  if (window.__stealthInitialized) return;
  window.__stealthInitialized = true;

  // Log initialization (goes to stderr for MCP)
  console.error('[mcp-playwright] Applying stealth evasions');

  // ==========================================================================
  // 1. navigator.webdriver - Most important evasion
  // ==========================================================================
  try {
    // Delete the webdriver property
    delete Object.getPrototypeOf(navigator).webdriver;

    // Redefine it as undefined (some sites check with 'in' operator)
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch (e) {
    console.error('[mcp-playwright] Failed to mask navigator.webdriver:', e.message);
  }

  // ==========================================================================
  // 2. Chrome runtime - Make it look like a real Chrome browser
  // ==========================================================================
  try {
    window.chrome = {
      runtime: {
        // PNaCl is no longer supported, but some detection scripts check for it
        PnaclEncoder: class {},
        // Provide empty sendMessage to look like a real extension environment
        sendMessage: () => {},
        connect: () => ({
          onMessage: { addListener: () => {} },
          postMessage: () => {},
          disconnect: () => {},
        }),
        onMessage: {
          addListener: () => {},
          removeListener: () => {},
        },
        onConnect: {
          addListener: () => {},
          removeListener: () => {},
        },
      },
      // csi is used by some detection scripts
      csi: () => ({}),
      loadTimes: () => ({
        commitLoadTime: Date.now() / 1000 - Math.random() * 2,
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000 - Math.random(),
        finishLoadTime: Date.now() / 1000 - Math.random() * 0.5,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 - Math.random() * 0.5,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000 - Math.random() * 3,
        startLoadTime: Date.now() / 1000 - Math.random() * 2.5,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      }),
    };
  } catch (e) {
    console.error('[mcp-playwright] Failed to mock chrome runtime:', e.message);
  }

  // ==========================================================================
  // 3. Permissions API - Mask automation indicators
  // ==========================================================================
  try {
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = function (parameters) {
      // Return 'prompt' for notifications instead of 'denied' (automation giveaway)
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: 'prompt', onchange: null });
      }
      return originalQuery.call(this, parameters);
    };
  } catch (e) {
    console.error('[mcp-playwright] Failed to mask permissions:', e.message);
  }

  // ==========================================================================
  // 4. Plugins and MimeTypes - Emulate real browser plugins
  // ==========================================================================
  try {
    const mockPlugins = [
      {
        name: 'Chrome PDF Plugin',
        description: 'Portable Document Format',
        filename: 'internal-pdf-viewer',
        mimeTypes: [
          { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        ],
      },
      {
        name: 'Chrome PDF Viewer',
        description: '',
        filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
        mimeTypes: [
          { type: 'application/pdf', suffixes: 'pdf', description: '' },
        ],
      },
      {
        name: 'Native Client',
        description: '',
        filename: 'internal-nacl-plugin',
        mimeTypes: [
          { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
          { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' },
        ],
      },
    ];

    const pluginArray = Object.create(PluginArray.prototype);
    const mimeTypeArray = Object.create(MimeTypeArray.prototype);

    const plugins = [];
    const mimeTypes = [];

    mockPlugins.forEach((pluginData, pluginIdx) => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name: { value: pluginData.name, enumerable: true },
        description: { value: pluginData.description, enumerable: true },
        filename: { value: pluginData.filename, enumerable: true },
        length: { value: pluginData.mimeTypes.length, enumerable: true },
      });

      pluginData.mimeTypes.forEach((mt, mtIdx) => {
        const mimeType = Object.create(MimeType.prototype);
        Object.defineProperties(mimeType, {
          type: { value: mt.type, enumerable: true },
          suffixes: { value: mt.suffixes, enumerable: true },
          description: { value: mt.description, enumerable: true },
          enabledPlugin: { value: plugin, enumerable: true },
        });

        Object.defineProperty(plugin, mtIdx, { value: mimeType, enumerable: true });
        Object.defineProperty(plugin, mt.type, { value: mimeType, enumerable: false });

        mimeTypes.push(mimeType);
      });

      plugins.push(plugin);
    });

    plugins.forEach((plugin, idx) => {
      Object.defineProperty(pluginArray, idx, { value: plugin, enumerable: true });
      Object.defineProperty(pluginArray, plugin.name, { value: plugin, enumerable: false });
    });
    Object.defineProperty(pluginArray, 'length', { value: plugins.length, enumerable: true });
    Object.defineProperty(pluginArray, 'item', { value: (idx) => plugins[idx] || null });
    Object.defineProperty(pluginArray, 'namedItem', { value: (name) => plugins.find((p) => p.name === name) || null });
    Object.defineProperty(pluginArray, 'refresh', { value: () => {} });

    mimeTypes.forEach((mt, idx) => {
      Object.defineProperty(mimeTypeArray, idx, { value: mt, enumerable: true });
      Object.defineProperty(mimeTypeArray, mt.type, { value: mt, enumerable: false });
    });
    Object.defineProperty(mimeTypeArray, 'length', { value: mimeTypes.length, enumerable: true });
    Object.defineProperty(mimeTypeArray, 'item', { value: (idx) => mimeTypes[idx] || null });
    Object.defineProperty(mimeTypeArray, 'namedItem', { value: (type) => mimeTypes.find((m) => m.type === type) || null });

    Object.defineProperty(navigator, 'plugins', { get: () => pluginArray, enumerable: true });
    Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeTypeArray, enumerable: true });
  } catch (e) {
    console.error('[mcp-playwright] Failed to mock plugins/mimeTypes:', e.message);
  }

  // ==========================================================================
  // 5. Languages - Ensure consistency
  // ==========================================================================
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
      enumerable: true,
    });
  } catch (e) {
    console.error('[mcp-playwright] Failed to set languages:', e.message);
  }

  // ==========================================================================
  // 6. WebGL Vendor and Renderer - Spoof to common values
  // ==========================================================================
  try {
    const getParameterProxyHandler = {
      apply: function (target, thisArg, args) {
        const param = args[0];
        const gl = thisArg;

        // UNMASKED_VENDOR_WEBGL
        if (param === 37445) {
          return 'Intel Inc.';
        }
        // UNMASKED_RENDERER_WEBGL
        if (param === 37446) {
          return 'Intel Iris OpenGL Engine';
        }

        return Reflect.apply(target, thisArg, args);
      },
    };

    // Patch both WebGL and WebGL2
    const webglGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = new Proxy(webglGetParameter, getParameterProxyHandler);

    if (typeof WebGL2RenderingContext !== 'undefined') {
      const webgl2GetParameter = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = new Proxy(webgl2GetParameter, getParameterProxyHandler);
    }
  } catch (e) {
    console.error('[mcp-playwright] Failed to spoof WebGL:', e.message);
  }

  // ==========================================================================
  // 7. Hardware Concurrency - Common value
  // ==========================================================================
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
      enumerable: true,
    });
  } catch (e) {
    console.error('[mcp-playwright] Failed to set hardwareConcurrency:', e.message);
  }

  // ==========================================================================
  // 8. Device Memory - Common value (4GB)
  // ==========================================================================
  try {
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
      enumerable: true,
    });
  } catch (e) {
    console.error('[mcp-playwright] Failed to set deviceMemory:', e.message);
  }

  // ==========================================================================
  // 9. Connection type - Looks like broadband
  // ==========================================================================
  try {
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, 'rtt', { get: () => 50, enumerable: true });
      Object.defineProperty(navigator.connection, 'downlink', { get: () => 10, enumerable: true });
      Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g', enumerable: true });
    }
  } catch (e) {
    console.error('[mcp-playwright] Failed to set connection:', e.message);
  }

  // ==========================================================================
  // 10. Iframe contentWindow - Prevent detection via iframe checks
  // ==========================================================================
  try {
    // Some detection scripts check if contentWindow.chrome exists in iframes
    const originalContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: function () {
        const win = originalContentWindow.get.call(this);
        if (win && !win.chrome) {
          try {
            Object.defineProperty(win, 'chrome', {
              value: window.chrome,
              writable: false,
              configurable: false,
            });
          } catch (e) {
            // Cross-origin frames will throw, that's expected
          }
        }
        return win;
      },
    });
  } catch (e) {
    console.error('[mcp-playwright] Failed to patch iframe contentWindow:', e.message);
  }

  // ==========================================================================
  // 11. toString() spoofing - Make native functions look native
  // ==========================================================================
  try {
    const nativeToString = Function.prototype.toString;
    const spoofedFunctions = new WeakSet();

    const customToString = function () {
      if (spoofedFunctions.has(this)) {
        return `function ${this.name || ''}() { [native code] }`;
      }
      return nativeToString.call(this);
    };

    Function.prototype.toString = customToString;
    spoofedFunctions.add(customToString);

    // Mark our spoofed functions
    if (navigator.permissions?.query) {
      spoofedFunctions.add(navigator.permissions.query);
    }
  } catch (e) {
    console.error('[mcp-playwright] Failed to spoof Function.toString:', e.message);
  }

  // ==========================================================================
  // 12. Brave Browser detection - Not Brave
  // ==========================================================================
  try {
    Object.defineProperty(navigator, 'brave', {
      get: () => undefined,
      enumerable: false,
    });
  } catch (e) {
    console.error('[mcp-playwright] Failed to hide Brave:', e.message);
  }

  console.error('[mcp-playwright] Stealth evasions applied successfully');
})();
