(function (global) {
  'use strict';
  const App = (global.App = global.App || {});
  const Parser = App.Parser;
  const Analyzer = App.Analyzer;
  const Reporter = App.Reporter;

  // ---- Input-source state -------------------------------------------
  // Three independent input methods are supported, switched via tabs.
  // Each keeps its own state so switching tabs to peek at another method
  // never loses what was already selected/typed in the others; only the
  // CURRENTLY ACTIVE tab's data is what "بدء التحليل" actually reads.
  let activeMode = 'txt'; // 'txt' | 'csv' | 'paste'
  let txtFile = null;
  let csvFile = null;
  let isProcessing = false;
  let lastErrors = null;
  let lastSummary = null;
  let lastStats = null;
  let lastVisibleErrors = null; // the currently-filtered set shown in the table, used by xlsx export

  // يعيد رسم الملخص وجدول الأخطاء من آخر نتيجة تحليل، مع تطبيق فلتر
  // "تجاهل أخطاء الأوتليت" دون إعادة تحليل الملف/النص من جديد.
  function renderFilteredResults() {
    if (!lastErrors || !lastSummary || !lastStats) return;
    const outletToggle = document.getElementById('ignoreOutletErrorsToggle');
    const currentPriceToggle = document.getElementById('ignoreCurrentPriceErrorsToggle');
    const ignoreOutlet = outletToggle ? outletToggle.checked : false;
    const ignoreCurrentPriceMatch = currentPriceToggle ? currentPriceToggle.checked : false;
    const visibleErrors = lastErrors.filter((e) => {
      if (ignoreOutlet && e.isOutletError) return false;
      if (ignoreCurrentPriceMatch && e.isSmallDiffCurrentPriceMatch) return false;
      return true;
    });

    lastVisibleErrors = visibleErrors;

    Reporter.renderSummary(lastStats, { ...lastSummary, totalErrors: visibleErrors.length });
    Reporter.renderErrors(visibleErrors);
    setExportButtonDisabled(false);

    Reporter.setStatus(
      `تم الانتهاء من التحليل: تم اكتشاف ${visibleErrors.length} خطأ من أصل ${lastSummary.totalOutputsChecked} حركة إخراج تم فحصها.`,
      visibleErrors.length > 0 ? 'warning' : 'success'
    );
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(reader.error || new Error('FileReader error'));
      reader.readAsText(file, 'utf-8');
    });
  }

  // Yields one tick so a "جارٍ ..." status message can paint before the
  // synchronous parse/analyze work runs on the main thread.
  function nextTick(value) {
    return new Promise((resolve) => setTimeout(() => resolve(value), 0));
  }

  function getPastedText() {
    const el = document.getElementById('pastedTextInput');
    return el ? el.value : '';
  }

  function hasActiveInput() {
    if (activeMode === 'csv') return !!csvFile;
    if (activeMode === 'paste') return isNonBlankText(getPastedText());
    return !!txtFile;
  }

  // Small local helper (kept out of Utils since it's purely a UI-state
  // check, not a parsing rule).
  function isNonBlankText(text) {
    return typeof text === 'string' && text.trim() !== '';
  }

  function setExportButtonDisabled(disabled) {
    const exportXlsxButton = document.getElementById('exportXlsxButton');
    if (exportXlsxButton) exportXlsxButton.disabled = disabled;
  }

  // Clears both the visible UI (via Reporter.reset) AND the in-memory
  // last-result state, so the export button and any stale filtering
  // never refer to a result set that's no longer on screen.
  function resetResults() {
    lastErrors = null;
    lastSummary = null;
    lastStats = null;
    lastVisibleErrors = null;
    Reporter.reset();
    setExportButtonDisabled(true);
  }

  // Reads the "تقليم ملف CSV" checkbox. Only meaningful for the CSV file
  // tab — see runAnalysis, where it's applied to the CSV file's raw text
  // before Parser.parseCSVFile ever sees it.
  function shouldTrimCsv() {
    const el = document.getElementById('trimCsvToggle');
    return el ? el.checked : false;
  }

  function runAnalysis() {
    if (!hasActiveInput()) {
      const message =
        activeMode === 'paste'
          ? 'الرجاء لصق النص أولاً.'
          : 'الرجاء اختيار ملف أولاً.';
      Reporter.setStatus(message, 'error');
      return;
    }
    if (isProcessing) return;

    isProcessing = true;
    setButtonsDisabled(true);
    resetResults();
    Reporter.setStatus('جارٍ قراءة البيانات...', 'info');

    let sourcePromise;

    if (activeMode === 'paste') {
      const text = getPastedText();
      console.log('=== PASTED TEXT INPUT ===');
      console.log('Pasted text length (characters):', text.length);
      sourcePromise = Promise.resolve(text);
    } else {
      const file = activeMode === 'csv' ? csvFile : txtFile;
      console.log('=== FILE LOADED ===');
      console.log('File name:', file.name);
      console.log('File size (bytes):', file.size);
      sourcePromise = readFileAsText(file).then((text) => {
        if (activeMode === 'csv' && shouldTrimCsv()) {
          console.log('=== CSV TRIM: APPLYING (remove column A + first row) ===');
          return Parser.trimCSVFirstColumnAndRow(text);
        }
        return text;
      });
    }

    sourcePromise
      .then((text) => {
        Reporter.setStatus('جارٍ تحليل البيانات...', 'info');
        return nextTick(text);
      })
      .then((text) => {
        let parseResult;
        if (activeMode === 'csv') {
          parseResult = Parser.parseCSVFile(text);
        } else if (activeMode === 'paste') {
          parseResult = Parser.parseText(text);
        } else {
          parseResult = Parser.parseFile(text);
        }

        const { movements, stats } = parseResult;

        console.log('=== INPUT LOADED SUMMARY ===', {
          mode: activeMode,
          totalLines: stats.totalLines,
          parsedCount: stats.parsedCount,
          skippedCount: stats.skippedCount,
        });

        const { errors, summary } = Analyzer.analyze(movements);

        lastErrors = errors;
        lastSummary = summary;
        lastStats = stats;
        renderFilteredResults();
      })
      .catch((err) => {
        console.error('Unexpected error while analyzing input', err);
        Reporter.setStatus('حدث خطأ غير متوقع أثناء التحليل. راجع الـ Console (F12) لمزيد من التفاصيل.', 'error');
      })
      .finally(() => {
        isProcessing = false;
        setButtonsDisabled(false);
      });
  }

  function setButtonsDisabled(disabled) {
    const analyzeButton = document.getElementById('analyzeButton');
    if (analyzeButton) analyzeButton.disabled = disabled || !hasActiveInput();
  }

  // ---- TXT file selection (existing dropzone, unchanged behavior) ----
  function onTxtFileSelected(file) {
    if (!file) return;

    if (!/\.txt$/i.test(file.name)) {
      console.warn('Selected file does not have a .txt extension — attempting to read it anyway', {
        fileName: file.name,
      });
    }

    txtFile = file;

    const fileNameLabel = document.getElementById('selectedFileName');
    if (fileNameLabel) fileNameLabel.textContent = file.name;

    resetResults();
    Reporter.setStatus('تم اختيار الملف. اضغط "بدء التحليل" للمتابعة.', 'info');
    setButtonsDisabled(false);
  }

  // ---- CSV file selection (new) --------------------------------------
  function onCsvFileSelected(file) {
    if (!file) return;

    if (!/\.csv$/i.test(file.name)) {
      console.warn('Selected file does not have a .csv extension — attempting to read it anyway', {
        fileName: file.name,
      });
    }

    csvFile = file;

    const fileNameLabel = document.getElementById('selectedCsvFileName');
    if (fileNameLabel) fileNameLabel.textContent = file.name;

    resetResults();
    Reporter.setStatus('تم اختيار ملف CSV. اضغط "بدء التحليل" للمتابعة.', 'info');
    setButtonsDisabled(false);
  }

  // ---- Tabs: switch which input method is active ----------------------
  function setActiveMode(mode) {
    if (mode === activeMode) return;
    activeMode = mode;

    const tabs = document.querySelectorAll('.input-tab');
    tabs.forEach((tab) => {
      const isActive = tab.getAttribute('data-mode') === mode;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const panels = document.querySelectorAll('.input-panel');
    panels.forEach((panel) => {
      panel.hidden = panel.getAttribute('data-panel') !== mode;
    });

    resetResults();

    if (mode === 'paste') {
      Reporter.setStatus(
        isNonBlankText(getPastedText())
          ? 'جاهز للتحليل. اضغط "بدء التحليل" للمتابعة.'
          : 'الصق النص المطلوب تحليله في المربع أعلاه.',
        'info'
      );
    } else if (mode === 'csv') {
      Reporter.setStatus(
        csvFile ? 'جاهز للتحليل. اضغط "بدء التحليل" للمتابعة.' : 'اختر ملف CSV للمتابعة.',
        'info'
      );
    } else {
      Reporter.setStatus(
        txtFile ? 'جاهز للتحليل. اضغط "بدء التحليل" للمتابعة.' : 'اختر ملف TXT للمتابعة.',
        'info'
      );
    }

    setButtonsDisabled(false);
  }

  function init() {
    // TXT dropzone (existing behavior, unchanged)
    const fileInput = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        onTxtFileSelected(file);
      });
    }

    if (dropZone) {
      dropZone.addEventListener('click', () => fileInput && fileInput.click());
      dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput && fileInput.click();
        }
      });
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        onTxtFileSelected(file);
      });
    }

    // CSV file zone (new — same click/drag pattern as the TXT dropzone)
    const csvFileInput = document.getElementById('csvFileInput');
    const csvDropZone = document.getElementById('dropZoneCsv');

    if (csvFileInput) {
      csvFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        onCsvFileSelected(file);
      });
    }

    if (csvDropZone) {
      csvDropZone.addEventListener('click', () => csvFileInput && csvFileInput.click());
      csvDropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          csvFileInput && csvFileInput.click();
        }
      });
      csvDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        csvDropZone.classList.add('drag-over');
      });
      csvDropZone.addEventListener('dragleave', () => {
        csvDropZone.classList.remove('drag-over');
      });
      csvDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        csvDropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        onCsvFileSelected(file);
      });
    }

    // Paste-text panel (new)
    const pastedTextInput = document.getElementById('pastedTextInput');
    const clearPasteButton = document.getElementById('clearPasteButton');
    const pasteCharCount = document.getElementById('pasteCharCount');

    function updatePasteCharCount() {
      if (!pasteCharCount) return;
      const len = pastedTextInput ? pastedTextInput.value.length : 0;
      pasteCharCount.textContent = len > 0 ? `${len.toLocaleString('en-US')} حرف` : '';
    }

    if (pastedTextInput) {
      pastedTextInput.addEventListener('input', () => {
        updatePasteCharCount();
        setButtonsDisabled(false);
      });
    }

    if (clearPasteButton) {
      clearPasteButton.addEventListener('click', () => {
        if (pastedTextInput) pastedTextInput.value = '';
        updatePasteCharCount();
        resetResults();
        Reporter.setStatus('الصق النص المطلوب تحليله في المربع أعلاه.', 'info');
        setButtonsDisabled(false);
      });
    }

    // Tabs
    const tabs = document.querySelectorAll('.input-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const mode = tab.getAttribute('data-mode');
        if (mode) setActiveMode(mode);
      });
    });

    const analyzeButton = document.getElementById('analyzeButton');
    if (analyzeButton) {
      analyzeButton.addEventListener('click', runAnalysis);
    }

    const ignoreOutletErrorsToggle = document.getElementById('ignoreOutletErrorsToggle');
    if (ignoreOutletErrorsToggle) {
      ignoreOutletErrorsToggle.addEventListener('change', renderFilteredResults);
    }

    const ignoreCurrentPriceErrorsToggle = document.getElementById('ignoreCurrentPriceErrorsToggle');
    if (ignoreCurrentPriceErrorsToggle) {
      ignoreCurrentPriceErrorsToggle.addEventListener('change', renderFilteredResults);
    }

    const exportXlsxButton = document.getElementById('exportXlsxButton');
    if (exportXlsxButton) {
      exportXlsxButton.addEventListener('click', () => {
        if (!lastVisibleErrors) return;
        const success = Reporter.exportErrorsToXlsx(lastVisibleErrors, 'تقرير-اخطاء-الاسعار.xlsx');
        if (!success) {
          Reporter.setStatus('تعذّر تصدير الملف: مكتبة Excel لم يتم تحميلها (تحقّق من الاتصال بالإنترنت).', 'error');
        }
      });
    }

    resetResults();
    setButtonsDisabled(false);
    console.log('App initialized. DEBUG mode:', App.Config.DEBUG);
    console.log('IGNORED_INVOICE_TYPES:', App.Config.IGNORED_INVOICE_TYPES);
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);