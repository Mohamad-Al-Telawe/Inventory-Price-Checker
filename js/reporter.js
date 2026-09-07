(function (global) {
  'use strict';
  const App = (global.App = global.App || {});

  const Reporter = {};

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function formatNumber(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }

  Reporter.setStatus = function setStatus(message, type) {
    const el = document.getElementById('statusMessage');
    if (!el) return;
    el.textContent = message;
    el.className = 'status-message' + (type ? ' status-' + type : '');
  };

  Reporter.renderSummary = function renderSummary(parseStats, analysisSummary) {
    setText('statTotalRecords', analysisSummary.totalMovements);
    setText('statGroups', analysisSummary.totalGroups);
    setText('statOutputsChecked', analysisSummary.totalOutputsChecked);
    setText('statErrors', analysisSummary.totalErrors);
    setText('statIgnoredForReporting', analysisSummary.totalIgnoredForReporting);
    setText('statSkippedLines', parseStats.skippedCount);

    const summarySection = document.getElementById('summarySection');
    if (summarySection) summarySection.hidden = false;

    const errorsStatCard = document.getElementById('statErrorsCard');
    if (errorsStatCard) {
      errorsStatCard.classList.toggle('stat-card-danger', analysisSummary.totalErrors > 0);
    }
  };

  Reporter.renderErrors = function renderErrors(errors) {
    const tbody = document.getElementById('errorsTableBody');
    const emptyState = document.getElementById('errorsEmptyState');
    const table = document.getElementById('errorsTable');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!errors.length) {
      if (table) table.hidden = true;
      if (emptyState) {
        emptyState.hidden = false;
        emptyState.textContent = 'لم يتم اكتشاف أي أخطاء في أسعار الإخراج.';
      }
      return;
    }

    if (table) table.hidden = false;
    if (emptyState) emptyState.hidden = true;

    const fragment = document.createDocumentFragment();

    errors.forEach((err) => {
      const tr = document.createElement('tr');

      const cells = [
        { value: err.invoiceNumber, numeric: false },
        { value: err.invoiceType, numeric: false },
        { value: err.invoiceDate, numeric: false },
        { value: err.branch, numeric: false },
        { value: err.warehouse, numeric: false },
        { value: err.itemCode, numeric: false },
        { value: formatNumber(err.outputQuantity), numeric: true },
        { value: formatNumber(err.actualOutputPrice), numeric: true },
        { value: formatNumber(err.expectedOutputPrice), numeric: true },
        { value: formatNumber(err.difference), numeric: true },
        { value: err.color || '—', numeric: false },
        { value: err.size || '—', numeric: false },
      ];

      cells.forEach((cell) => {
        const td = document.createElement('td');
        td.textContent = cell.value;
        if (cell.numeric) td.classList.add('cell-numeric');
        tr.appendChild(td);
      });

      fragment.appendChild(tr);
    });

    tbody.appendChild(fragment);
  };

  // Exports the given errors (already filtered/visible, same set as what
  // renderErrors() draws) to a formatted .xlsx file via the ExcelJS library
  // loaded in index.html. Mirrors the visible table columns exactly
  // (invoiceDescription excluded, same as renderErrors) — this does not
  // touch or depend on any other field of the error record. The sheet is
  // right-to-left, the data is a real Excel Table (with autofilter),
  // every cell is centered, the font is Almarai (bold header), and the
  // header/banded rows plus the "الفرق" column are colored for emphasis.
  // Returns a Promise<boolean> — false (and logs) if the library isn't
  // available or the export fails. NOTE: this is now async (ExcelJS's
  // writer is promise-based) — callers must `await` it or use `.then()`
  // instead of reading the return value synchronously as before.
  Reporter.exportErrorsToXlsx = async function exportErrorsToXlsx(errors, filename) {
    if (typeof ExcelJS === 'undefined') {
      console.error('ExcelJS library not loaded — cannot export to xlsx.');
      return false;
    }

    const headers = [
      'رقم الفاتورة', 'نوع الفاتورة', 'التاريخ', 'الفرع', 'المستودع', 'كود الصنف',
      'كمية الإخراج', 'السعر الفعلي', 'السعر المتوقع', 'الفرق', 'اللون', 'المقاس',
    ];
    const NUMERIC_COLS = new Set([6, 7, 8, 9]); // 0-based: كمية الإخراج..الفرق
    const DIFF_COL = 9; // 0-based index of 'الفرق'

    const toCell = (value) => (
      typeof value === 'number' && !Number.isNaN(value) ? value : (value || '')
    );

    const rows = errors.map((err) => ([
      toCell(err.invoiceNumber),
      toCell(err.invoiceType),
      toCell(err.invoiceDate),
      toCell(err.branch),
      toCell(err.warehouse),
      toCell(err.itemCode),
      toCell(err.outputQuantity),
      toCell(err.actualOutputPrice),
      toCell(err.expectedOutputPrice),
      toCell(err.difference),
      err.color || '',
      err.size || '',
    ]));

    // Brand palette — matches the app's teal-ink / red-ink theme.
    const HEADER_FILL = 'FF0F766E';  // teal-700
    const HEADER_FONT = 'FFFFFFFF';  // white
    const BAND_FILL = 'FFF0FDFA';    // teal-50 (alternating rows)
    const BODY_FONT = 'FF1E293B';    // slate-800
    const DIFF_FONT = 'FFDC2626';    // red-600 — draws the eye to the discrepancy
    const BORDER_COLOR = 'FFE2E8F0'; // slate-200
    const THIN_BORDER = { style: 'thin', color: { argb: BORDER_COLOR } };

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'مدقق أسعار حركات المخزون';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('الأخطاء', {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
    });

    worksheet.addTable({
      name: 'ErrorsTable',
      ref: 'A1',
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleLight1', showRowStripes: false },
      columns: headers.map((h) => ({ name: h, filterButton: true })),
      rows,
    });

    headers.forEach((h, i) => {
      const maxLen = rows.reduce((max, row) => {
        const v = row[i] === null || row[i] === undefined ? '' : String(row[i]);
        return Math.max(max, v.length);
      }, h.length);
      worksheet.getColumn(i + 1).width = Math.max(8, maxLen + 3);
    });

    const headerRow = worksheet.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Almarai Bold', bold: true, size: 12, color: { argb: HEADER_FONT } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER, bottom: THIN_BORDER };
    });

    for (let r = 0; r < rows.length; r++) {
      const excelRow = worksheet.getRow(r + 2);
      const isBanded = r % 2 === 1;
      excelRow.eachCell((cell, colNumber) => {
        const isDiffCol = colNumber - 1 === DIFF_COL;
        cell.font = {
          name: 'Almarai',
          size: 11,
          bold: isDiffCol,
          color: { argb: isDiffCol ? DIFF_FONT : BODY_FONT },
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { top: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER, bottom: THIN_BORDER };
        if (isBanded) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_FILL } };
        }
        if (NUMERIC_COLS.has(colNumber - 1)) {
          cell.numFmt = '#,##0.00';
        }
      });
    }

    console.log('=== XLSX EXPORT ===', { rowCount: rows.length, filename });

    try {
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || 'تقرير-اخطاء-الاسعار.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return true;
    } catch (err) {
      console.error('Failed to export xlsx:', err);
      return false;
    }
  };

  Reporter.reset = function reset() {
    const summarySection = document.getElementById('summarySection');
    if (summarySection) summarySection.hidden = true;

    const table = document.getElementById('errorsTable');
    if (table) table.hidden = true;

    const emptyState = document.getElementById('errorsEmptyState');
    if (emptyState) {
      emptyState.hidden = false;
      emptyState.textContent = 'قم برفع ملف واضغط "بدء التحليل" لعرض النتائج.';
    }

    const tbody = document.getElementById('errorsTableBody');
    if (tbody) tbody.innerHTML = '';
  };

  App.Reporter = Reporter;
})(window);