(function (global) {
  'use strict';
  const App = (global.App = global.App || {});

  /**
   * ============================================================
   *  CONFIGURATION
   * ============================================================
   *  Single source of truth for every business-rule "knob" in the
   *  app. Change values here — never hunt through parser.js /
   *  inventory.js / analyzer.js to change behavior.
   * ============================================================
   */
  const Config = {};

  // ---- Debug mode -------------------------------------------------
  // When true, every Utils.debugLog() call throughout the app prints
  // to the console. Flip to false to silence verbose logging without
  // touching any other file. Warnings/errors (console.warn/console.error)
  // always print regardless of DEBUG, since they flag real data problems.
  Config.DEBUG = true;

  // ---- Invoice types ignored ONLY for error reporting --------------
  // A type listed here still fully affects inventory quantity/cost
  // according to the calculation rules in inventory.js + analyzer.js.
  // It is simply never shown in the detected-errors table.
  //
  // IMPORTANT: "مناقلة" (transfer) is intentionally NOT listed here
  // by default — transfers must be evaluated like any other movement
  // unless you deliberately add it below.
  //
  // Add the EXACT invoice type strings as they appear in your data, e.g.:
  //   Config.IGNORED_INVOICE_TYPES = ['فاتورة إدخال مواد مستودعية'];
  Config.IGNORED_INVOICE_TYPES = [
    // 'فاتورة إدخال مواد مستودعية',
    // 'فاتورة إخراج مواد مستودعية',
    'فاتورة مبيعات انستغرام',
    'فاتورة مبيعات سعر التوزيع',
    'فاتورة مبيعات سعر الجمله',
    'فاتورة مبيعات سعر المبيع',
    'فاتورة مبيعات سعر نصف الجمله',
    'مبيعات متجر الكتروني',
    'مرتجع مبيعات متجر الكتروني',
    'فاتورة مرتجع مبيعات سعر المبيع',
    'فاتورة مرتجع مبيعات سعر التوزيع',
    'فاتورة مرتجع مبيعات سعر الجمله',
    'فاتورة مرتجع مبيعات سعر نصف الجمله',
    'مرتجع مبيعات انستغرام',
  ];

  // ---- Price comparison precision -----------------------------------
  // Two prices are considered equal if they round to the same value at
  // this many decimal places.
  Config.PRICE_COMPARISON_DECIMALS = 2;
  // Absolute tolerance used as a secondary safety net against floating
  // point noise (e.g. 14.2799999999 vs 14.28 must NOT be flagged as an error).
  Config.PRICE_COMPARISON_EPSILON = 0.005;

  // ---- Small-difference errors matched against "السعر الحالي" -------
  // If a DETECTED error's difference (actual − expected) falls within
  // [-threshold, +threshold], AND the movement's actual output price
  // equals its own "Current Price" column (index CURRENT_PRICE, parsed
  // but otherwise never used in any calculation), the error is flagged
  // as isSmallDiffCurrentPriceMatch and can be hidden from the report
  // via its own toggle — same idea/UX as isOutletError.
  Config.SMALL_DIFFERENCE_CURRENT_PRICE_THRESHOLD = 0.01;

  // ---- Expected input-file column layout (TAB separated) ------------
  Config.EXPECTED_COLUMN_COUNT = 15;
  Config.COLUMN_INDEX = {
    INVOICE_NUMBER: 0,
    INVOICE_TYPE: 1,
    INVOICE_DATE: 2,
    BRANCH: 3,
    WAREHOUSE: 4,
    ITEM_CODE: 5,
    INPUT_QUANTITY: 6,
    OUTPUT_QUANTITY: 7,
    BALANCE: 8,
    INPUT_PRICE: 9,
    OUTPUT_PRICE: 10,
    CURRENT_PRICE: 11, // NEVER used in any calculation — see analyzer.js
    INVOICE_DESCRIPTION: 12,
    COLOR: 13,
    SIZE: 14,
  };

  // Separator used to build inventory group keys. Chosen to be a
  // character that will essentially never appear in real invoice data.
  Config.GROUP_KEY_SEPARATOR = '␟';

  App.Config = Config;
})(window);