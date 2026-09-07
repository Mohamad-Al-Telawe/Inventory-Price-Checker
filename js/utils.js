(function (global) {
  'use strict';
  const App = (global.App = global.App || {});
  const Config = App.Config;

  const Utils = {};

  // Wrapper so verbose logging can be disabled everywhere at once via
  // Config.DEBUG, without touching any call site.
  Utils.debugLog = function debugLog(...args) {
    if (Config.DEBUG) {
      console.log(...args);
    }
  };

  Utils.normalizeText = function normalizeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  };

  // Converts a raw text cell into a number. Returns NaN when the value
  // cannot be interpreted as a number (including empty string).
  Utils.parseNumber = function parseNumber(value) {
    const text = Utils.normalizeText(value);
    if (text === '') return NaN;

    // Tolerate Arabic-Indic digits (٠-٩) just in case the source file
    // was exported with them.
    const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
    let normalized = text.replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d)));

    // Strip thousands separators; keep sign and decimal point.
    normalized = normalized.replace(/,/g, '');

    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : NaN;
  };

  Utils.isValidNumber = function isValidNumber(n) {
    return typeof n === 'number' && Number.isFinite(n);
  };

  Utils.roundTo = function roundTo(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor + 1e-9) / factor;
  };

  // Two prices are equal if they round to the same value at the
  // configured precision, with a small epsilon as a safety net against
  // floating-point noise.
  Utils.pricesAreEqual = function pricesAreEqual(a, b) {
    if (!Utils.isValidNumber(a) || !Utils.isValidNumber(b)) return false;
    const decimals = Config.PRICE_COMPARISON_DECIMALS;
    const roundedA = Utils.roundTo(a, decimals);
    const roundedB = Utils.roundTo(b, decimals);
    if (roundedA === roundedB) return true;
    return Math.abs(roundedA - roundedB) <= Config.PRICE_COMPARISON_EPSILON;
  };

  // Inventory grouping key: Branch + Warehouse + Item Code + Color + Size.
  // Empty Color/Size are valid, meaningful parts of the key and must NOT
  // be dropped or normalized away.
  Utils.makeGroupKey = function makeGroupKey(branch, warehouse, itemCode, color, size) {
    const sep = Config.GROUP_KEY_SEPARATOR;
    return [
      Utils.normalizeText(branch),
      Utils.normalizeText(warehouse),
      Utils.normalizeText(itemCode),
      Utils.normalizeText(color),
      Utils.normalizeText(size),
    ].join(sep);
  };

  Utils.groupKeyParts = function groupKeyParts(groupKey) {
    const parts = groupKey.split(Config.GROUP_KEY_SEPARATOR);
    return {
      branch: parts[0] || '',
      warehouse: parts[1] || '',
      itemCode: parts[2] || '',
      color: parts[3] || '',
      size: parts[4] || '',
    };
  };

  App.Utils = Utils;
})(window);