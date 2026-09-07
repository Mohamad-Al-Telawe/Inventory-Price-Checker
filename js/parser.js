(function (global) {
  'use strict';
  const App = (global.App = global.App || {});
  const Config = App.Config;
  const Utils = App.Utils;

  const Parser = {};

  // Heuristic to detect a header row: the columns that must be numeric
  // (quantities/prices) are present but contain non-numeric text.
  // Delimiter-agnostic on purpose: it only ever looks at an already-split
  // `columns` array, so it works unchanged for TAB rows (TXT) and for
  // COMMA rows (CSV).
  function looksLikeHeaderRow(columns) {
    const idx = Config.COLUMN_INDEX;
    const numericIndexes = [
      idx.INPUT_QUANTITY,
      idx.OUTPUT_QUANTITY,
      idx.BALANCE,
      idx.INPUT_PRICE,
      idx.OUTPUT_PRICE,
      idx.CURRENT_PRICE,
    ];

    let nonEmptyCount = 0;
    let nonNumericCount = 0;

    numericIndexes.forEach((i) => {
      const raw = Utils.normalizeText(columns[i]);
      if (raw === '') return;
      nonEmptyCount += 1;
      if (Number.isNaN(Utils.parseNumber(raw))) {
        nonNumericCount += 1;
      }
    });

    return nonEmptyCount > 0 && nonNumericCount === nonEmptyCount;
  }

  // A row where every single column is empty. Used to skip fully-blank
  // rows. This is NOT the same check as "the raw line is empty": a TXT
  // line made only of tabs already collapses to '' under String.trim()
  // (tabs are whitespace), but a CSV row made only of commas — e.g.
  // ",,,,,,,,,,,,,," — does NOT collapse under trim(), since commas are
  // not whitespace. Spreadsheet exports commonly produce exactly this:
  // exporting a selected range that extends below the real data pads
  // every extra row with an empty value per column.
  function isBlankRow(columns) {
    return columns.every((col) => Utils.normalizeText(col) === '');
  }

  // Builds a movement object from an already-split columns array. This is
  // the shared core used by every input path (TXT line, CSV row, or a
  // pasted-text row of either kind) — delimiter-specific code only needs
  // to turn its raw input into a `columns` array and a `rawForLog` string
  // for warnings, and this function does the rest identically for all of
  // them: padding, field extraction, validation, and movement/groupKey
  // construction.
  function buildMovementFromColumns(columns, lineNumber, rawForLog) {
    if (columns.length !== Config.EXPECTED_COLUMN_COUNT) {
      console.warn('Malformed line: unexpected number of columns', {
        lineNumber,
        expectedColumns: Config.EXPECTED_COLUMN_COUNT,
        actualColumns: columns.length,
        raw: rawForLog,
      });
    }

    // Best-effort: pad missing trailing columns so indexing never
    // shifts and never throws, per the "empty values must not shift
    // later columns" requirement.
    while (columns.length < Config.EXPECTED_COLUMN_COUNT) columns.push('');

    const idx = Config.COLUMN_INDEX;

    const invoiceNumber = Utils.normalizeText(columns[idx.INVOICE_NUMBER]);
    const invoiceType = Utils.normalizeText(columns[idx.INVOICE_TYPE]);
    const invoiceDate = Utils.normalizeText(columns[idx.INVOICE_DATE]);
    const branch = Utils.normalizeText(columns[idx.BRANCH]);
    const warehouse = Utils.normalizeText(columns[idx.WAREHOUSE]);
    const itemCode = Utils.normalizeText(columns[idx.ITEM_CODE]);
    const invoiceDescription = Utils.normalizeText(columns[idx.INVOICE_DESCRIPTION]);
    const color = Utils.normalizeText(columns[idx.COLOR]);
    const size = Utils.normalizeText(columns[idx.SIZE]);

    const inputQuantityRaw = Utils.normalizeText(columns[idx.INPUT_QUANTITY]);
    const outputQuantityRaw = Utils.normalizeText(columns[idx.OUTPUT_QUANTITY]);
    const balanceRaw = Utils.normalizeText(columns[idx.BALANCE]);
    const inputPriceRaw = Utils.normalizeText(columns[idx.INPUT_PRICE]);
    const outputPriceRaw = Utils.normalizeText(columns[idx.OUTPUT_PRICE]);
    const currentPriceRaw = Utils.normalizeText(columns[idx.CURRENT_PRICE]);

    // Quantities default to 0 when empty (no movement on that side).
    const inputQuantity = inputQuantityRaw === '' ? 0 : Utils.parseNumber(inputQuantityRaw);
    const outputQuantity = outputQuantityRaw === '' ? 0 : Utils.parseNumber(outputQuantityRaw);

    // Prices default to NaN when empty (unknown / not applicable) — an
    // empty price is NOT the same thing as a price of zero.
    const balance = balanceRaw === '' ? NaN : Utils.parseNumber(balanceRaw);
    const inputPrice = inputPriceRaw === '' ? NaN : Utils.parseNumber(inputPriceRaw);
    const outputPrice = outputPriceRaw === '' ? NaN : Utils.parseNumber(outputPriceRaw);
    // Current Price is parsed for completeness only. It must NEVER be
    // used by inventory.js or analyzer.js in any calculation.
    const currentPrice = currentPriceRaw === '' ? NaN : Utils.parseNumber(currentPriceRaw);

    if (invoiceDescription === '' || color === '' || size === '') {
      Utils.debugLog('Empty field detected:', {
        lineNumber,
        invoiceDescription,
        color,
        size,
      });
    }

    if (!invoiceNumber) {
      console.warn('Suspicious record: missing invoice number', { lineNumber, raw: rawForLog });
    }
    if (inputQuantityRaw !== '' && Number.isNaN(inputQuantity)) {
      console.warn('Suspicious record: non-numeric Input Quantity', {
        lineNumber, raw: rawForLog, value: inputQuantityRaw,
      });
    }
    if (outputQuantityRaw !== '' && Number.isNaN(outputQuantity)) {
      console.warn('Suspicious record: non-numeric Output Quantity', {
        lineNumber, raw: rawForLog, value: outputQuantityRaw,
      });
    }
    if (inputPriceRaw !== '' && Number.isNaN(inputPrice)) {
      console.warn('Suspicious record: non-numeric Input Price', {
        lineNumber, raw: rawForLog, value: inputPriceRaw,
      });
    }
    if (outputPriceRaw !== '' && Number.isNaN(outputPrice)) {
      console.warn('Suspicious record: non-numeric Output Price', {
        lineNumber, raw: rawForLog, value: outputPriceRaw,
      });
    }
    if (inputQuantity > 0 && outputQuantity > 0) {
      console.warn('Suspicious record: both Input Quantity and Output Quantity are > 0 on the same line', {
        lineNumber, invoiceNumber, raw: rawForLog,
      });
    }

    const movement = {
      lineNumber,
      invoiceNumber,
      invoiceType,
      invoiceDate,
      branch,
      warehouse,
      itemCode,
      inputQuantity,
      outputQuantity,
      balance, // parsed but NOT used by the calculation, per spec
      inputPrice,
      outputPrice,
      currentPrice, // parsed but NEVER used by the calculation, per spec
      invoiceDescription,
      color,
      size,
      groupKey: Utils.makeGroupKey(branch, warehouse, itemCode, color, size),
    };

    Utils.debugLog('Parsed movement:', movement);
    Utils.debugLog('Inventory group key:', movement.groupKey);

    return movement;
  }

  // Parses a single TAB-separated line into a movement object.
  // Never throws — malformed lines are logged and handled defensively
  // so one bad line never crashes the whole analysis.
  Parser.parseLine = function parseLine(line, lineNumber) {
    return buildMovementFromColumns(line.split('\t'), lineNumber, line);
  };

  // Parses the full file text into an ordered array of movement objects.
  // Original record order is preserved (movements.push in line order).
  // TAB-delimited (.txt) input path — unchanged from before CSV/paste
  // support was added.
  Parser.parseFile = function parseFile(text) {
    console.log('=== FILE PARSING STARTED ===');

    const rawLines = text.split(/\r\n|\r|\n/);
    // Drop a single trailing empty line caused by a final newline in the file.
    const lines =
      rawLines.length > 0 && rawLines[rawLines.length - 1] === ''
        ? rawLines.slice(0, -1)
        : rawLines;

    console.log('Number of lines:', lines.length);

    const movements = [];
    let skippedCount = 0;
    let headerChecked = false;

    lines.forEach((line, i) => {
      const lineNumber = i + 1;

      if (Utils.normalizeText(line) === '') {
        Utils.debugLog('Skipping blank line', { lineNumber });
        skippedCount += 1;
        return;
      }

      if (!headerChecked) {
        headerChecked = true;
        const columns = line.split('\t');
        if (looksLikeHeaderRow(columns)) {
          console.warn('Header row detected and skipped', { lineNumber, raw: line });
          skippedCount += 1;
          return;
        }
      }

      const movement = Parser.parseLine(line, lineNumber);
      movements.push(movement);
    });

    const stats = {
      totalLines: lines.length,
      parsedCount: movements.length,
      skippedCount,
    };

    console.log('=== FILE PARSING FINISHED ===');
    console.log('Parsing stats:', stats);

    return { movements, stats };
  };

  // ---- CSV support ------------------------------------------------------
  // Tokenizes raw CSV text into rows of columns, per RFC 4180 semantics:
  //   - A field may be wrapped in double quotes.
  //   - A doubled quote ("") inside a quoted field is one literal quote
  //     character.
  //   - A comma or a line break INSIDE a quoted field is part of the
  //     field's value, not a delimiter/row separator.
  //   - \r\n, \r, and \n are all accepted as row separators outside of
  //     quotes (the sample export file uses \r\n).
  // This has to be a full text-level tokenizer rather than "split into
  // lines, then split each line by comma", because a quoted field is
  // allowed to contain an embedded newline — splitting into lines first
  // would incorrectly cut such a field in half.
  function parseCSVRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    const len = text.length;

    while (i < len) {
      const char = text[i];

      if (inQuotes) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            inQuotes = false;
            i += 1;
          }
        } else {
          field += char;
          i += 1;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }

      if (char === ',') {
        row.push(field);
        field = '';
        i += 1;
        continue;
      }

      if (char === '\r' || char === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        if (char === '\r' && text[i + 1] === '\n') {
          i += 2; // consume the \n half of a \r\n pair together
        } else {
          i += 1;
        }
        continue;
      }

      field += char;
      i += 1;
    }

    // Flush a trailing field/row not terminated by a final line break
    // (a file that doesn't end with a newline).
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  // Re-serializes a rows-of-columns array back into RFC4180 CSV text.
  // Only quotes a field when strictly necessary (it contains a comma, a
  // double quote, or a line break), doubling any internal quotes — the
  // mirror image of parseCSVRows above. Rows are joined with CRLF to
  // match the sample export format.
  function csvEscapeField(value) {
    const text = value === null || value === undefined ? '' : String(value);
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function serializeCSVRows(rows) {
    return rows.map((row) => row.map(csvEscapeField).join(',')).join('\r\n');
  }

  // Trims a raw CSV file's text: drops row 1 entirely (e.g. a header /
  // title row) and drops column A from every remaining row (e.g. a
  // leading serial-number or blank column that isn't part of the app's
  // 15-column layout). Used as an optional pre-processing step, driven
  // by the "تقليم ملف CSV" checkbox in the UI, BEFORE the text is handed
  // to Parser.parseCSVFile — it does not parse into movements itself.
  Parser.trimCSVFirstColumnAndRow = function trimCSVFirstColumnAndRow(text) {
    const rows = parseCSVRows(text);
    console.log('=== CSV TRIM: BEFORE ===', { totalRows: rows.length });

    const trimmedRows = rows.slice(1).map((row) => row.slice(1));

    console.log('=== CSV TRIM: AFTER (row 1 + column A removed) ===', {
      totalRows: trimmedRows.length,
    });

    return serializeCSVRows(trimmedRows);
  };

  // Parses CSV text into an ordered array of movement objects. Mirrors
  // Parser.parseFile (the TAB/.txt path) as closely as possible: same
  // header detection, same per-row field validation via
  // buildMovementFromColumns, same returned {movements, stats} shape —
  // the only real difference is the delimiter and the extra
  // all-columns-empty guard described above isBlankRow.
  Parser.parseCSVFile = function parseCSVFile(text) {
    console.log('=== CSV FILE PARSING STARTED ===');

    const rows = parseCSVRows(text);
    console.log('Number of CSV rows:', rows.length);

    const movements = [];
    let skippedCount = 0;
    let headerChecked = false;
    let rowNumber = 0;

    rows.forEach((columns) => {
      rowNumber += 1;

      if (isBlankRow(columns)) {
        Utils.debugLog('Skipping blank CSV row (all columns empty)', { rowNumber });
        skippedCount += 1;
        return;
      }

      if (!headerChecked) {
        headerChecked = true;
        if (looksLikeHeaderRow(columns)) {
          console.warn('Header row detected and skipped (CSV)', {
            rowNumber,
            raw: columns.join(','),
          });
          skippedCount += 1;
          return;
        }
      }

      const movement = buildMovementFromColumns(columns, rowNumber, columns.join(','));
      movements.push(movement);
    });

    const stats = {
      totalLines: rows.length,
      parsedCount: movements.length,
      skippedCount,
    };

    console.log('=== CSV FILE PARSING FINISHED ===');
    console.log('Parsing stats:', stats);

    return { movements, stats };
  };

  // ---- Pasted-text support ----------------------------------------------
  // Pasted text has no file extension to go by, so the delimiter is
  // guessed from the first non-blank line: whichever of TAB/COMMA yields
  // a column count closer to the expected column count wins. Copy-pasting
  // cells from Excel/Sheets into a plain textarea normally preserves TAB
  // characters between cells, so TAB is the fallback whenever the line is
  // ambiguous (neither character present, or a tie).
  function detectDelimiter(text) {
    const lines = text.split(/\r\n|\r|\n/);
    const sampleLine = lines.find((l) => Utils.normalizeText(l) !== '');
    if (!sampleLine) return '\t';

    const target = Config.EXPECTED_COLUMN_COUNT;
    const tabColumnCount = sampleLine.split('\t').length;
    const commaColumnCount = sampleLine.split(',').length;
    const tabDiff = Math.abs(tabColumnCount - target);
    const commaDiff = Math.abs(commaColumnCount - target);

    if (commaColumnCount > 1 && commaDiff < tabDiff) return ',';
    return '\t';
  }

  // Entry point for the "paste text directly" input method: detects the
  // delimiter, then delegates to the matching parser, so pasted TAB data
  // and pasted CSV-style data both work without the user having to pick
  // a format themselves.
  Parser.parseText = function parseText(text) {
    const delimiter = detectDelimiter(text);
    console.log('=== PASTED TEXT: DETECTED DELIMITER ===', delimiter === '\t' ? 'TAB' : 'COMMA');
    return delimiter === ',' ? Parser.parseCSVFile(text) : Parser.parseFile(text);
  };

  App.Parser = Parser;
})(window);