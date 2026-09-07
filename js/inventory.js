(function (global) {
  'use strict';
  const App = (global.App = global.App || {});
  const Utils = App.Utils;

  // Creates an isolated inventory manager. Each call gets its own Map,
  // so a fresh manager is created per analysis run (no leftover state
  // between two files analyzed in the same page session).
  function createInventoryManager() {
    // groupKey -> { quantity, costValue }
    const groups = new Map();

    function getState(groupKey) {
      if (!groups.has(groupKey)) {
        groups.set(groupKey, { quantity: 0, costValue: 0, lastAverage: 0 });
      }
      return groups.get(groupKey);
    }

    function getAverage(state) {
      if (!state || state.quantity === 0) return 0;
      return state.costValue / state.quantity;
    }

    /**
     * Applies an INPUT movement to a group.
     *
     * `useOwnPrice` decides whether this movement's own inputPrice may
     * enter the cost calculation:
     *   - true  -> addedCost = quantity * inputPrice   (normal, eligible input)
     *   - false -> addedCost = quantity * CURRENT average cost (before
     *              this movement) — the quantity is absorbed "at cost",
     *              which increases inventory quantity without letting
     *              the movement's own price distort the average. This
     *              is how ignored-for-reporting invoice types (and
     *              inputs with no valid price) still affect quantity
     *              without polluting the cost basis.
     *
     * The decision of which case applies belongs to analyzer.js, not here.
     */
    function applyInput(groupKey, quantity, price, useOwnPrice) {
      const state = getState(groupKey);
      const previousQuantity = state.quantity;
      const previousCostValue = state.costValue;
      const previousAverage = getAverage(state);

      const referenceCost = previousQuantity > 0 ? previousAverage : state.lastAverage;
      const effectivePrice = useOwnPrice ? price : referenceCost;

      const addedCost = quantity * effectivePrice;

      const newQuantity = previousQuantity + quantity;
      const newCostValue = previousCostValue + addedCost;

      state.quantity = newQuantity;
      state.costValue = newCostValue;

      const newAverage = getAverage(state);
      if (newQuantity > 0) state.lastAverage = newAverage;   // ← تحديث الذاكرة
      Utils.debugLog('Weighted average calculation (after INPUT):', {
        groupKey,
        totalCostValue: newCostValue,
        totalQuantity: newQuantity,
        weightedAverage: newAverage,
      });

      return {
        previousQuantity,
        previousCostValue,
        previousAverage,
        usedOwnPrice: useOwnPrice,
        effectivePrice,
        addedCost,
        newQuantity,
        newCostValue,
        newAverage,
      };
    }

    /**
     * Applies an OUTPUT movement to a group.
     *
     * The expected price is ALWAYS the weighted-average cost immediately
     * BEFORE this movement. Inventory is consumed at that same average
     * cost — never at the invoice's stated (possibly wrong) output price —
     * so a price error never distorts the average for later movements.
     */
    function applyOutput(groupKey, quantity) {
      const state = getState(groupKey);
      const previousQuantity = state.quantity;
      const previousCostValue = state.costValue;
      const previousAverage = getAverage(state);

      const costReduction = quantity * previousAverage;
      let newQuantity = previousQuantity - quantity;
      let newCostValue = previousCostValue - costReduction;

      // Guard against floating-point dust when inventory empties out
      // exactly (e.g. -1e-13 instead of 0).
      if (Math.abs(newQuantity) < 1e-9) {
        newQuantity = 0;
        newCostValue = 0;
      }

      state.quantity = newQuantity;
      state.costValue = newCostValue;

      const newAverage = getAverage(state);
      if (newQuantity > 0) state.lastAverage = newAverage;   // ← لا حاجة عمليًا هنا لكن للاتساق

      Utils.debugLog('Weighted average calculation (after OUTPUT):', {
        groupKey,
        totalCostValue: newCostValue,
        totalQuantity: newQuantity,
        weightedAverage: newAverage,
      });

      return {
        expectedPrice: previousAverage,
        previousQuantity,
        previousCostValue,
        previousAverage,
        costReduction,
        newQuantity,
        newCostValue,
        newAverage,
      };
    }

    function getSnapshot(groupKey) {
      const state = getState(groupKey);
      return {
        quantity: state.quantity,
        costValue: state.costValue,
        average: getAverage(state),
      };
    }

    function getAllGroupKeys() {
      return Array.from(groups.keys());
    }

    function getGroupCount() {
      return groups.size;
    }

    return {
      getState,
      getAverage,
      applyInput,
      applyOutput,
      getSnapshot,
      getAllGroupKeys,
      getGroupCount,
    };
  }

  App.Inventory = { createInventoryManager };
})(window);