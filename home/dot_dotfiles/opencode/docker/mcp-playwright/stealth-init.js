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
  // 1. navigator.webdriver - Most important evasion (bulletproof approach)
  // ==========================================================================
  // Detection scripts check:
  //   - navigator.webdriver === true (basic)
  //   - 'webdriver' in navigator (advanced - checks property existence)
  //   - Object.keys(navigator).includes('webdriver') (enumeration)
  //
  // Solution: Delete the property entirely and use a Proxy to intercept access.
  // This makes the property truly non-existent like in a real browser.
  // ==========================================================================
  try {
    // Step 1: Delete from Navigator.prototype (where it's usually defined)
    // Need to make it configurable first if it isn't
    const protoDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
    if (protoDescriptor) {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: protoDescriptor.get,
        set: protoDescriptor.set,
        configurable: true,
        enumerable: false,
      });
      delete Navigator.prototype.webdriver;
    }

    // Step 2: Delete from navigator instance (in case it's defined there too)
    const instanceDescriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
    if (instanceDescriptor) {
      Object.defineProperty(navigator, 'webdriver', {
        value: instanceDescriptor.value,
        configurable: true,
        enumerable: false,
        writable: true,
      });
      delete navigator.webdriver;
    }

    // Step 3: Proxy the navigator object to intercept 'webdriver' property access
    // This ensures 'webdriver' in navigator returns false and access returns undefined
    const navigatorProxy = new Proxy(navigator, {
      has: (target, prop) => {
        if (prop === 'webdriver') {
          return false;
        }
        return prop in target;
      },
      get: (target, prop, receiver) => {
        if (prop === 'webdriver') {
          return undefined;
        }
        // CRITICAL: Use 'target' instead of 'receiver' for Reflect.get
        // Native browser API getters require the real object as 'this', not the proxy.
        // Using 'receiver' (the proxy) causes "Illegal invocation" errors.
        const value = Reflect.get(target, prop, target);
        // Bind functions to the original navigator to preserve 'this' context
        if (typeof value === 'function') {
          return value.bind(target);
        }
        return value;
      },
      getOwnPropertyDescriptor: (target, prop) => {
        if (prop === 'webdriver') {
          return undefined;
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
      ownKeys: (target) => {
        return Reflect.ownKeys(target).filter((key) => key !== 'webdriver');
      },
    });

    // Step 4: Replace window.navigator with our proxy
    // We need to be careful here - navigator is a getter on window
    Object.defineProperty(window, 'navigator', {
      get: () => navigatorProxy,
      configurable: true,
      enumerable: true,
    });

    // Verify the mask worked
    const inCheck = 'webdriver' in navigator;
    const valueCheck = navigator.webdriver;
    const keysCheck = Object.keys(Object.getPrototypeOf(navigator)).includes('webdriver');

    if (inCheck || valueCheck !== undefined || keysCheck) {
      console.error('[mcp-playwright] Warning: webdriver masking incomplete:', {
        inNavigator: inCheck,
        value: valueCheck,
        inKeys: keysCheck,
      });
    }
  } catch (e) {
    console.error('[mcp-playwright] Failed to mask navigator.webdriver:', e.message);
  }

  // ==========================================================================
  // 1.5. WebDriver Advanced - Remove ChromeDriver/Selenium specific properties
  // ==========================================================================
  // Detection scripts check for various automation-injected properties:
  //   - document.$cdc_ (ChromeDriver < 77)
  //   - document.$wdc_ (older WebDriver)
  //   - window.cdc_adoQpoasnfa76pfcZLmcfl_ (ChromeDriver 77+)
  //   - Various __selenium, __webdriver, __driver prefixed properties
  //   - window.callPhantom, window._phantom (PhantomJS)
  //   - window.domAutomation, window.domAutomationController
  // ==========================================================================
  try {
    // List of known automation properties to remove from document
    const documentAutomationProps = [
      '$cdc_asdjflasutopfhvcZLmcfl_',
      '$cdc_',
      '$wdc_',
      '__selenium_evaluate',
      '__selenium_unwrapped',
      '__webdriver_evaluate',
      '__driver_evaluate',
      '__webdriver_unwrapped',
      '__driver_unwrapped',
      '__fxdriver_evaluate',
      '__fxdriver_unwrapped',
      '__webdriver_script_fn',
    ];

    // List of known automation properties to remove from window
    const windowAutomationProps = [
      'callPhantom',
      '_phantom',
      'phantom',
      '__phantomas',
      'domAutomation',
      'domAutomationController',
      '_Selenium_IDE_Recorder',
      '_selenium',
      'calledSelenium',
      '__nightmare',
      'awesomium',
      '__webdriver_script_fn',
      '__webdriver_script_func',
      'webdriver',
      '__$webdriverAsyncExecutor',
      '__lastWatirAlert',
      '__lastWatirConfirm',
      '__lastWatirPrompt',
    ];

    // Remove document automation properties
    for (const prop of documentAutomationProps) {
      if (prop in document) {
        try {
          delete document[prop];
        } catch (e) {
          // If delete fails, try to make it undefined
          try {
            Object.defineProperty(document, prop, {
              value: undefined,
              configurable: true,
              writable: true,
            });
          } catch (e2) {
            // Ignore if we can't modify it
          }
        }
      }
    }

    // Remove window automation properties
    for (const prop of windowAutomationProps) {
      if (prop in window) {
        try {
          delete window[prop];
        } catch (e) {
          try {
            Object.defineProperty(window, prop, {
              value: undefined,
              configurable: true,
              writable: true,
            });
          } catch (e2) {
            // Ignore if we can't modify it
          }
        }
      }
    }

    // ChromeDriver 77+ uses dynamic property names like cdc_adoQpoasnfa76pfcZLmcfl_
    // We need to find and remove any property starting with cdc_ on window or document
    const cdcPattern = /^cdc_/;
    const wdcPattern = /^\$?wdc_/;
    const cdcPrefixPattern = /^[$_]*cdc_/;

    // Check window for cdc_ prefixed properties
    for (const prop of Object.getOwnPropertyNames(window)) {
      if (cdcPattern.test(prop) || wdcPattern.test(prop) || cdcPrefixPattern.test(prop)) {
        try {
          delete window[prop];
        } catch (e) {
          try {
            Object.defineProperty(window, prop, { value: undefined, configurable: true, writable: true });
          } catch (e2) {
            // Ignore
          }
        }
      }
    }

    // Check document for cdc_ prefixed properties
    for (const prop of Object.getOwnPropertyNames(document)) {
      if (cdcPattern.test(prop) || wdcPattern.test(prop) || cdcPrefixPattern.test(prop)) {
        try {
          delete document[prop];
        } catch (e) {
          try {
            Object.defineProperty(document, prop, { value: undefined, configurable: true, writable: true });
          } catch (e2) {
            // Ignore
          }
        }
      }
    }

    // Intercept future property additions that match automation patterns
    // This catches late-injected properties
    const automationPatterns = [cdcPattern, wdcPattern, /^__selenium/, /^__webdriver/, /^__driver/];

    const createPropertyTrap = (target) => {
      return new Proxy(target, {
        set(obj, prop, value) {
          if (typeof prop === 'string') {
            for (const pattern of automationPatterns) {
              if (pattern.test(prop)) {
                // Silently ignore automation property assignments
                return true;
              }
            }
          }
          return Reflect.set(obj, prop, value);
        },
        defineProperty(obj, prop, descriptor) {
          if (typeof prop === 'string') {
            for (const pattern of automationPatterns) {
              if (pattern.test(prop)) {
                // Silently ignore automation property definitions
                return true;
              }
            }
          }
          return Reflect.defineProperty(obj, prop, descriptor);
        },
      });
    };

    // Note: We can't easily replace window/document with proxies without breaking things,
    // but the initial cleanup should catch most cases
  } catch (e) {
    console.error('[mcp-playwright] Failed to remove automation properties:', e.message);
  }

  // ==========================================================================
  // 2. User Agent - Remove "HeadlessChrome" indicator
  // ==========================================================================
  try {
    const originalUA = navigator.userAgent;
    // Replace HeadlessChrome with Chrome to look like a normal browser
    const cleanedUA = originalUA.replace(/HeadlessChrome/g, 'Chrome');

    Object.defineProperty(Navigator.prototype, 'userAgent', {
      get: () => cleanedUA,
      configurable: true,
      enumerable: true,
    });

    // Also set on navigator instance
    Object.defineProperty(navigator, 'userAgent', {
      get: () => cleanedUA,
      configurable: true,
      enumerable: true,
    });

    // Also fix appVersion which may contain Headless
    const originalAppVersion = navigator.appVersion;
    const cleanedAppVersion = originalAppVersion.replace(/HeadlessChrome/g, 'Chrome');

    Object.defineProperty(Navigator.prototype, 'appVersion', {
      get: () => cleanedAppVersion,
      configurable: true,
      enumerable: true,
    });

    Object.defineProperty(navigator, 'appVersion', {
      get: () => cleanedAppVersion,
      configurable: true,
      enumerable: true,
    });

    if (cleanedUA !== originalUA) {
      console.error('[mcp-playwright] Cleaned HeadlessChrome from User Agent');
    }
  } catch (e) {
    console.error('[mcp-playwright] Failed to clean User Agent:', e.message);
  }

  // ==========================================================================
  // 3. Chrome runtime - Make it look like a real Chrome browser
  // ==========================================================================
  // Based on puppeteer-extra-plugin-stealth chrome.runtime evasion
  // This creates a realistic window.chrome object with proper methods
  // ==========================================================================
  try {
    // Static data from real Chrome (from puppeteer-extra-plugin-stealth)
    const STATIC_DATA = {
      OnInstalledReason: {
        CHROME_UPDATE: 'chrome_update',
        INSTALL: 'install',
        SHARED_MODULE_UPDATE: 'shared_module_update',
        UPDATE: 'update',
      },
      OnRestartRequiredReason: {
        APP_UPDATE: 'app_update',
        OS_UPDATE: 'os_update',
        PERIODIC: 'periodic',
      },
      PlatformArch: {
        ARM: 'arm',
        ARM64: 'arm64',
        MIPS: 'mips',
        MIPS64: 'mips64',
        X86_32: 'x86-32',
        X86_64: 'x86-64',
      },
      PlatformNaclArch: {
        ARM: 'arm',
        MIPS: 'mips',
        MIPS64: 'mips64',
        X86_32: 'x86-32',
        X86_64: 'x86-64',
      },
      PlatformOs: {
        ANDROID: 'android',
        CROS: 'cros',
        LINUX: 'linux',
        MAC: 'mac',
        OPENBSD: 'openbsd',
        WIN: 'win',
      },
      RequestUpdateCheckStatus: {
        NO_UPDATE: 'no_update',
        THROTTLED: 'throttled',
        UPDATE_AVAILABLE: 'update_available',
      },
    };

    // Valid Extension IDs are 32 characters in length and use the letter `a` to `p`
    const isValidExtensionID = (str) => str.length === 32 && str.toLowerCase().match(/^[a-p]+$/);

    const makeCustomRuntimeErrors = (preamble, method, extensionId) => ({
      NoMatchingSignature: new TypeError(`${preamble}No matching signature.`),
      MustSpecifyExtensionID: new TypeError(
        `${preamble}${method} called from a webpage must specify an Extension ID (string) for its first argument.`
      ),
      InvalidExtensionID: new TypeError(`${preamble}Invalid extension id: '${extensionId}'`),
    });

    // Create chrome object if it doesn't exist (with exact property descriptor from real Chrome)
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', {
        writable: true,
        enumerable: true,
        configurable: false,
        value: {},
      });
    }

    // Mock chrome.app (required for some detection scripts)
    window.chrome.app = {
      isInstalled: false,
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed',
      },
      RunningState: {
        CANNOT_RUN: 'cannot_run',
        READY_TO_RUN: 'ready_to_run',
        RUNNING: 'running',
      },
      getDetails: function getDetails() {
        return null;
      },
      getIsInstalled: function getIsInstalled() {
        return false;
      },
      runningState: function runningState() {
        return 'cannot_run';
      },
    };

    // Mock chrome.runtime with proper error handling like real Chrome
    window.chrome.runtime = {
      ...STATIC_DATA,
      // chrome.runtime.id is extension related and returns undefined in Chrome
      get id() {
        return undefined;
      },
      // These require more sophisticated mocks with proper error handling
      connect: null,
      sendMessage: null,
    };

    // Create sendMessage with proper proxy handler for realistic error behavior
    const sendMessageHandler = {
      apply: function (target, ctx, args) {
        const [extensionId, options, responseCallback] = args || [];
        const errorPreamble =
          'Error in invocation of runtime.sendMessage(optional string extensionId, any message, optional object options, optional function responseCallback): ';
        const Errors = makeCustomRuntimeErrors(errorPreamble, 'chrome.runtime.sendMessage()', extensionId);

        const noArguments = args.length === 0;
        const tooManyArguments = args.length > 4;
        const incorrectOptions = options && typeof options !== 'object';
        const incorrectResponseCallback = responseCallback && typeof responseCallback !== 'function';

        if (noArguments || tooManyArguments || incorrectOptions || incorrectResponseCallback) {
          throw Errors.NoMatchingSignature;
        }
        if (args.length < 2) {
          throw Errors.MustSpecifyExtensionID;
        }
        if (typeof extensionId !== 'string') {
          throw Errors.NoMatchingSignature;
        }
        if (!isValidExtensionID(extensionId)) {
          throw Errors.InvalidExtensionID;
        }
        return undefined;
      },
    };

    const sendMessageFunc = function sendMessage() {};
    window.chrome.runtime.sendMessage = new Proxy(sendMessageFunc, sendMessageHandler);

    // Create connect with proper proxy handler for realistic error behavior
    const connectHandler = {
      apply: function (target, ctx, args) {
        const [extensionId, connectInfo] = args || [];
        const errorPreamble =
          'Error in invocation of runtime.connect(optional string extensionId, optional object connectInfo): ';
        const Errors = makeCustomRuntimeErrors(errorPreamble, 'chrome.runtime.connect()', extensionId);

        const noArguments = args.length === 0;
        const emptyStringArgument = args.length === 1 && extensionId === '';
        if (noArguments || emptyStringArgument) {
          throw Errors.MustSpecifyExtensionID;
        }

        const tooManyArguments = args.length > 2;
        const incorrectConnectInfoType = connectInfo && typeof connectInfo !== 'object';
        if (tooManyArguments || incorrectConnectInfoType) {
          throw Errors.NoMatchingSignature;
        }

        const extensionIdIsString = typeof extensionId === 'string';
        if (extensionIdIsString && extensionId === '') {
          throw Errors.MustSpecifyExtensionID;
        }
        if (extensionIdIsString && !isValidExtensionID(extensionId)) {
          throw Errors.InvalidExtensionID;
        }

        // Handle connectInfo as first param edge case
        if (typeof extensionId === 'object') {
          if (args.length > 1) {
            throw Errors.NoMatchingSignature;
          }
          if (Object.keys(extensionId).length === 0) {
            throw Errors.MustSpecifyExtensionID;
          }
          for (const [k, v] of Object.entries(extensionId)) {
            const isExpected = ['name', 'includeTlsChannelId'].includes(k);
            if (!isExpected) {
              throw new TypeError(`${errorPreamble}Unexpected property: '${k}'.`);
            }
            if (k === 'name' && typeof v !== 'string') {
              throw new TypeError(`${errorPreamble}Error at property '${k}': Invalid type: expected string, found ${typeof v}.`);
            }
            if (k === 'includeTlsChannelId' && typeof v !== 'boolean') {
              throw new TypeError(`${errorPreamble}Error at property '${k}': Invalid type: expected boolean, found ${typeof v}.`);
            }
          }
        }

        // Return a mock Port object
        return {
          name: '',
          sender: undefined,
          onDisconnect: { addListener: function () {}, removeListener: function () {} },
          onMessage: { addListener: function () {}, removeListener: function () {} },
          postMessage: function () {},
          disconnect: function () {},
        };
      },
    };

    const connectFunc = function connect() {};
    window.chrome.runtime.connect = new Proxy(connectFunc, connectHandler);

    // chrome.csi - returns timing information
    window.chrome.csi = function csi() {
      return {
        onloadT: Date.now(),
        pageT: performance.now(),
        startE: Date.now() - performance.now(),
        tran: 15, // Navigation type
      };
    };

    // chrome.loadTimes - deprecated but still checked
    window.chrome.loadTimes = function loadTimes() {
      const navTiming = performance.timing;
      const now = Date.now() / 1000;
      return {
        commitLoadTime: navTiming.responseStart / 1000 || now - Math.random() * 2,
        connectionInfo: 'h2',
        finishDocumentLoadTime: navTiming.domContentLoadedEventEnd / 1000 || now - Math.random() * 0.5,
        finishLoadTime: navTiming.loadEventEnd / 1000 || now - Math.random() * 0.2,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: navTiming.responseEnd / 1000 || now - Math.random() * 0.5,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: navTiming.requestStart / 1000 || now - Math.random() * 3,
        startLoadTime: navTiming.navigationStart / 1000 || now - Math.random() * 2.5,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      };
    };
  } catch (e) {
    console.error('[mcp-playwright] Failed to mock chrome runtime:', e.message);
  }

  // ==========================================================================
  // 4. Permissions API - Mask automation indicators
  // ==========================================================================
  try {
    // Store references to the original permissions object and query method
    // We need to use the real navigator (not proxy) to avoid "Illegal invocation"
    const realPermissions = Navigator.prototype.__lookupGetter__('permissions')
      ? Navigator.prototype.__lookupGetter__('permissions').call(navigator)
      : navigator.permissions;

    if (realPermissions && realPermissions.query) {
      const originalQuery = realPermissions.query.bind(realPermissions);

      // Create a new query function that masks notification permission
      const maskedQuery = function (parameters) {
        // Return 'prompt' for notifications instead of 'denied' (automation giveaway)
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({ state: 'prompt', onchange: null });
        }
        return originalQuery(parameters);
      };

      // Override the query method on the permissions object
      Object.defineProperty(realPermissions, 'query', {
        value: maskedQuery,
        writable: true,
        configurable: true,
      });
    }
  } catch (e) {
    console.error('[mcp-playwright] Failed to mask permissions:', e.message);
  }

  // ==========================================================================
  // 5. Plugins and MimeTypes - Emulate real browser plugins
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
  // 6. Languages - Ensure consistency
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
  // 7. WebGL Vendor and Renderer - Spoof to common values
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
  // 8. Hardware Concurrency - Common value
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
  // 9. Device Memory - Common value (8GB) - bulletproof approach
  // ==========================================================================
  try {
    // Define on prototype first
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      get: () => 8,
      configurable: true,
      enumerable: true,
    });

    // Also define on navigator instance
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
      configurable: true,
      enumerable: true,
    });

    // Verify it worked
    if (navigator.deviceMemory !== 8) {
      console.error('[mcp-playwright] Warning: deviceMemory masking may not have worked, value:', navigator.deviceMemory);
    }
  } catch (e) {
    console.error('[mcp-playwright] Failed to set deviceMemory:', e.message);
  }

  // ==========================================================================
  // 10. Connection type - Looks like broadband
  // ==========================================================================
  try {
    // Get the real connection object to avoid "Illegal invocation"
    // navigator.connection is a getter that requires proper 'this' context
    const connectionGetter = Navigator.prototype.__lookupGetter__('connection');
    const realConnection = connectionGetter ? connectionGetter.call(navigator) : navigator.connection;

    if (realConnection) {
      Object.defineProperty(realConnection, 'rtt', { get: () => 50, enumerable: true, configurable: true });
      Object.defineProperty(realConnection, 'downlink', { get: () => 10, enumerable: true, configurable: true });
      Object.defineProperty(realConnection, 'effectiveType', { get: () => '4g', enumerable: true, configurable: true });
    }
  } catch (e) {
    console.error('[mcp-playwright] Failed to set connection:', e.message);
  }

  // ==========================================================================
  // 11. Iframe contentWindow - Prevent detection via iframe checks
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
  // 12. toString() spoofing - Make native functions look native
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
    // Access permissions.query through the real navigator to avoid proxy issues
    try {
      const permissionsGetter = Navigator.prototype.__lookupGetter__('permissions');
      const realPermissions = permissionsGetter ? permissionsGetter.call(navigator) : null;
      if (realPermissions && realPermissions.query) {
        spoofedFunctions.add(realPermissions.query);
      }
    } catch (e) {
      // Permissions may not be available, ignore
    }
  } catch (e) {
    console.error('[mcp-playwright] Failed to spoof Function.toString:', e.message);
  }

  // ==========================================================================
  // 13. Brave Browser detection - Not Brave
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
