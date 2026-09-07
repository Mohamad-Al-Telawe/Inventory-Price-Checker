(function (global) {
  'use strict';
  const App = (global.App = global.App || {});
  const Config = App.Config;
  const Utils = App.Utils;
  const Inventory = App.Inventory;

  const Analyzer = {};

  // ---- Isolated classification helpers -------------------------------
  // Kept small and separate on purpose (see spec §17): any one of these
  // rules can be changed later without touching the processing loop.

  function isIgnoredType(invoiceType) {
    return Config.IGNORED_INVOICE_TYPES.includes(invoiceType);
  }

  function isInputMovement(movement) {
    return Utils.isValidNumber(movement.inputQuantity) && movement.inputQuantity > 0;
  }

  function isOutputMovement(movement) {
    return Utils.isValidNumber(movement.outputQuantity) && movement.outputQuantity > 0;
  }

  function hasValidInputPrice(movement) {
    return Utils.isValidNumber(movement.inputPrice) && movement.inputPrice >= 0;
  }

  function hasValidOutputPrice(movement) {
    return Utils.isValidNumber(movement.outputPrice) && movement.outputPrice >= 0;
  }

  // "خطأ أوتليت": فرق سعر متعمّد ومقبول، وليس خطأ تسعير حقيقي.
  function isOutletError(actualOutputPrice, expectedOutputPrice) {
    return actualOutputPrice === 10 && expectedOutputPrice > 10;
  }

  // فرق صغير مطابق لعمود "السعر الحالي" (Current Price): إذا كان الفرق
  // بين السعر الفعلي والسعر المتوقع صغيرًا جدًا (ضمن الحد المسموح في
  // Config)، وكان السعر الفعلي نفسه يساوي عمود "السعر الحالي" لنفس
  // الحركة، فهذا ليس خطأ تسعير حقيقي بل تطابق مع سعر معتمد مسبقًا —
  // يُعامل مثل خطأ الأوتليت تمامًا (يُصنَّف فقط، ولا يُستبعد من التقرير
  // إلا عبر مفتاح التبديل الخاص به في الواجهة).
  //
  // ملاحظة: عمود "السعر الحالي" لا يُستخدم أبدًا في أي حساب للمخزون أو
  // المتوسط المرجّح — هذا الاستثناء الوحيد المتعمَّد، وهو مجرّد مقارنة
  // تصنيفية بعد اكتشاف الخطأ، وليس جزءًا من حساب expectedOutputPrice.
  function isSmallDifferenceMatchingCurrentPrice(difference, actualOutputPrice, currentPrice) {
    const threshold = Config.SMALL_DIFFERENCE_CURRENT_PRICE_THRESHOLD;
    const isSmallDifference = difference >= -threshold && difference <= threshold;
    if (!isSmallDifference) return false;
    if (!Utils.isValidNumber(currentPrice)) return false;
    return Utils.pricesAreEqual(actualOutputPrice, currentPrice);
  }

  // An input movement's OWN price may enter the cost calculation only
  // when its invoice type is not ignored AND it has a valid price.
  // Otherwise its quantity is still added to inventory, but absorbed at
  // the current average cost (see inventory.js applyInput).
  function mayUseOwnInputPrice(movement) {
    return !isIgnoredType(movement.invoiceType) && hasValidInputPrice(movement);
  }

  // ---- Main sequential analysis ---------------------------------------

  Analyzer.analyze = function analyze(movements) {
    console.log('=== ANALYSIS STARTED ===');

    const inventory = Inventory.createInventoryManager();
    const errors = [];

    let totalOutputsChecked = 0;
    let totalIgnoredForReporting = 0;
    let totalOutputsSkippedNoPrice = 0;

    movements.forEach((movement) => {
      const {
        invoiceNumber, invoiceType, invoiceDate, branch, warehouse, itemCode,
        inputQuantity, outputQuantity, inputPrice, outputPrice, currentPrice, groupKey,
      } = movement;

      const ignored = isIgnoredType(invoiceType);
      if (ignored) {
        Utils.debugLog(
          'Invoice type is ignored for error reporting, but inventory effect is still processed:',
          invoiceType
        );
      }

      const before = inventory.getSnapshot(groupKey);
      Utils.debugLog('=== BEFORE MOVEMENT ===', {
        invoiceNumber,
        invoiceType,
        invoiceDate,
        groupKey,
        previousQuantity: before.quantity,
        previousCostValue: before.costValue,
        previousAverageCost: before.average,
        inputQuantity,
        outputQuantity,
        inputPrice,
        outputPrice,
      });

      const isInput = isInputMovement(movement);
      const isOutput = isOutputMovement(movement);

      if (isInput && isOutput) {
        console.warn('Movement has both Input and Output quantity — processing input then output', {
          invoiceNumber, lineNumber: movement.lineNumber,
        });
      }

      // ---- INPUT side ----------------------------------------------
      if (isInput) {
        const useOwnPrice = mayUseOwnInputPrice(movement);

        if (!useOwnPrice && !ignored) {
          console.warn('Input movement has no valid Input Price — quantity absorbed at current average cost', {
            invoiceNumber, lineNumber: movement.lineNumber, groupKey, inputPrice,
          });
        }

        const result = inventory.applyInput(groupKey, inputQuantity, inputPrice, useOwnPrice);

        Utils.debugLog('=== AFTER MOVEMENT (INPUT) ===', {
          invoiceNumber,
          newQuantity: result.newQuantity,
          newCostValue: result.newCostValue,
          newAverageCost: result.newAverage,
        });
      }

      // ---- OUTPUT side -----------------------------------------------
      if (isOutput) {
        const preOutputSnapshot = inventory.getSnapshot(groupKey);
        const expectedOutputPrice = preOutputSnapshot.average;

        if (preOutputSnapshot.quantity <= 0) {
          console.warn(
            'Output movement when no valid cost basis exists (zero/negative inventory before this movement)',
            {
              invoiceNumber, lineNumber: movement.lineNumber, groupKey,
              quantityBefore: preOutputSnapshot.quantity,
            }
          );
        }
        if (outputQuantity > preOutputSnapshot.quantity) {
          console.warn('Output quantity greater than available quantity', {
            invoiceNumber, lineNumber: movement.lineNumber, groupKey,
            outputQuantity, availableQuantity: preOutputSnapshot.quantity,
          });
        }

        const result = inventory.applyOutput(groupKey, outputQuantity);

        Utils.debugLog('=== AFTER MOVEMENT (OUTPUT) ===', {
          invoiceNumber,
          newQuantity: result.newQuantity,
          newCostValue: result.newCostValue,
          newAverageCost: result.newAverage,
        });

        const canCompare = hasValidOutputPrice(movement);
        if (!canCompare) {
          console.warn('Output Price missing/invalid — price comparison skipped for this movement', {
            invoiceNumber, lineNumber: movement.lineNumber, outputPrice,
          });
          totalOutputsSkippedNoPrice += 1;
        }

        if (ignored) {
          totalIgnoredForReporting += 1;
        }

        // Only non-ignored outputs with a usable actual price are
        // eligible to appear in the error report — but note the
        // inventory reduction above already happened regardless.
        if (canCompare && !ignored) {
          totalOutputsChecked += 1;

          const difference = outputPrice - expectedOutputPrice;
          const isError = !Utils.pricesAreEqual(outputPrice, expectedOutputPrice);

          Utils.debugLog('=== OUTPUT PRICE CHECK ===', {
            invoiceNumber,
            actualOutputPrice: outputPrice,
            expectedOutputPrice,
            difference,
            isError,
          });

          if (isError) {
            const errorRecord = {
              invoiceNumber,
              invoiceType,
              invoiceDate,
              branch,
              warehouse,
              itemCode,
              outputQuantity,
              actualOutputPrice: outputPrice,
              expectedOutputPrice,
              difference,
              invoiceDescription: movement.invoiceDescription,
              color: movement.color,
              size: movement.size,
              lineNumber: movement.lineNumber,
              isOutletError: isOutletError(outputPrice, expectedOutputPrice),
              isSmallDiffCurrentPriceMatch: isSmallDifferenceMatchingCurrentPrice(
                difference, outputPrice, currentPrice
              ),
            };
            errors.push(errorRecord);

            console.log('!!! PRICE ERROR DETECTED !!!', {
              movement,
              expectedOutputPrice,
              actualOutputPrice: outputPrice,
              currentQuantity: result.newQuantity,
              currentCostValue: result.newCostValue,
              currentAverageCost: result.newAverage,
            });
          }
        }
      }

      if (!isInput && !isOutput) {
        Utils.debugLog('Movement has neither Input nor Output quantity — no inventory effect', {
          invoiceNumber, lineNumber: movement.lineNumber,
        });
      }
    });

    const summary = {
      totalMovements: movements.length,
      totalGroups: inventory.getGroupCount(),
      totalOutputsChecked,
      totalIgnoredForReporting,
      totalOutputsSkippedNoPrice,
      totalErrors: errors.length,
    };

    console.log('=== FINAL ANALYSIS SUMMARY ===', summary);

    return { errors, summary };
  };

  App.Analyzer = Analyzer;
})(window);