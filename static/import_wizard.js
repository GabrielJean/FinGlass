// Import Wizard - Guided file import experience
const { fetchJson, escapeHtml, defaultCurrencyFormatter, markTableBodyRefreshed } = window.FinGlassCommon || {};
const common = window.FinGlassCommon || {};
const applyPageEnterMotion = common.applyPageEnterMotion;
const WIZARD_MOTION_MS = 220;

// State
let currentStep = 1;
let selectedImportType = null;
let uploadedFile = null;
let parsedData = null;
let batchId = null;
let selectedCreditCardProvider = '';
let selectedCreditCardLabel = '';
let newCreditCardLabel = '';
let creditCardLabelMode = 'existing';
let selectedChequingAccount = '';
let newChequingAccountLabel = '';
let chequingAccountMode = 'existing';
let isPreviewFullscreen = false;

// DOM Elements
const wizardSteps = document.querySelectorAll('.wizard-step');
const stepContents = document.querySelectorAll('.wizard-step-content');
const backBtn = document.getElementById('backBtn');
const nextBtn = document.getElementById('nextBtn');
const submitBtn = document.getElementById('submitBtn');
const importTypeCards = document.querySelectorAll('.import-type-card');
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const fileInfo = document.getElementById('fileInfo');
const uploadError = document.getElementById('uploadError');
const formatRequirements = document.getElementById('formatRequirements');
const templateDownload = document.getElementById('templateDownload');
const creditCardProviderGroup = document.getElementById('creditCardProviderGroup');
const creditCardProviderSelect = document.getElementById('creditCardProvider');
const creditCardLabelSelect = document.getElementById('creditCardLabelSelect');
const creditCardNewLabel = document.getElementById('creditCardNewLabel');
const creditCardExistingWrap = document.getElementById('creditCardExistingWrap');
const creditCardNewWrap = document.getElementById('creditCardNewWrap');
const toggleCreditCardLabelModeBtn = document.getElementById('toggleCreditCardLabelModeBtn');
const chequingAccountGroup = document.getElementById('chequingAccountGroup');
const chequingAccountSelect = document.getElementById('chequingAccountSelect');
const chequingAccountNewLabel = document.getElementById('chequingAccountNewLabel');
const chequingAccountExistingWrap = document.getElementById('chequingAccountExistingWrap');
const chequingAccountNewWrap = document.getElementById('chequingAccountNewWrap');
const toggleChequingAccountModeBtn = document.getElementById('toggleChequingAccountModeBtn');
const previewTableContainer = document.getElementById('previewTableContainer');
const togglePreviewFullscreenBtn = document.getElementById('togglePreviewFullscreenBtn');
const previewTableHead = document.getElementById('previewTableHead');
const previewTableBody = document.getElementById('previewTableBody');
const previewStats = document.getElementById('previewStats');
const previewWarnings = document.getElementById('previewWarnings');
const completionMessage = document.getElementById('completionMessage');
const importAnotherBtn = document.getElementById('importAnotherBtn');

// Import type configurations
const importTypeConfig = {
  transactions: {
    title: 'Investment Transactions',
    fileTypes: ['.csv'],
    accept: 'text/csv,.csv',
    description: 'Upload your broker\'s activity report CSV file',
    requirements: `
      <h4>Required CSV Columns:</h4>
      <ul>
        <li><code>transaction_date</code> - Trade date (YYYY-MM-DD or YYYY-MMM-DD)</li>
        <li><code>symbol</code> - Stock ticker symbol</li>
        <li><code>activity_type</code> - Transaction type: Trade, ReturnOfCapital, Dividend, etc.</li>
        <li><code>activity_sub_type</code> - For trades: BUY or SELL</li>
        <li><code>quantity</code> - Number of shares</li>
        <li><code>net_cash_amount</code> - Total transaction amount</li>
        <li><code>commission</code> - Trading fees (optional)</li>
      </ul>
    `,
    templateName: 'transactions_template.csv',
    endpoint: '/api/import/review',
    subtype: 'activities_csv'
  },
  holdings: {
    title: 'Holdings Snapshot',
    fileTypes: ['.csv'],
    accept: 'text/csv,.csv',
    description: 'Upload your broker\'s portfolio holdings CSV file',
    requirements: `
      <h4>Required CSV Columns:</h4>
      <ul>
        <li><code>Symbol</code> - Stock ticker symbol</li>
        <li><code>Account Number</code> - Your account number</li>
        <li><code>Account Name</code> - Account name/description</li>
        <li><code>Account Type</code> - Account type (RRSP, TFSA, etc.)</li>
        <li><code>Quantity</code> - Number of shares held</li>
        <li><code>Market Price</code> - Current market price per share</li>
        <li><code>Market Value</code> - Total market value</li>
        <li><code>Book Value (CAD)</code> - Original purchase cost</li>
      </ul>
    `,
    templateName: 'holdings_template.csv',
    endpoint: '/api/import/holdings-csv',
    direct: true
  },
  'credit-card': {
    title: 'Credit Card Transactions',
    fileTypes: ['.csv'],
    accept: 'text/csv,.csv',
    description: 'Upload your credit card statement CSV file',
    requirements: `
      <h4>Supported Formats:</h4>
      <ul>
        <li><strong>Rogers Bank Mastercard:</strong> Download transaction history from online banking</li>
        <li><strong>Scotiabank Credit Card:</strong> Download account activity/statement CSV export</li>
        <li>File should include: Transaction Date, Posted Date, Description, Amount, Category</li>
        <li>Select the bank before uploading so the correct parser is used</li>
        <li>Categories are automatically normalized for tracking</li>
      </ul>
    `,
    templateName: 'credit_card_template.csv',
    endpoint: '/api/import/credit-card/rogers-csv',
    direct: true
  },
  chequing: {
    title: 'Chequing Transactions',
    fileTypes: ['.csv'],
    accept: 'text/csv,.csv',
    description: 'Upload your chequing account transaction CSV file',
    requirements: `
      <h4>Expected CSV Columns:</h4>
      <ul>
        <li><code>date</code> - Transaction date (YYYY-MM-DD)</li>
        <li><code>transaction</code> - Bank transaction code (e.g. AFT_IN, E_TRFOUT)</li>
        <li><code>description</code> - Transaction description</li>
        <li><code>amount</code> - Positive for money in, negative for money out</li>
        <li><code>balance</code> - Account balance after transaction</li>
        <li><code>currency</code> - Currency code (e.g. CAD)</li>
      </ul>
    `,
    templateName: 'chequing_template.csv',
    endpoint: '/api/import/chequing/courant-csv',
    direct: true
  },
  'tax-pdf': {
    title: 'Tax Documents',
    fileTypes: ['.pdf'],
    accept: 'application/pdf,.pdf',
    description: 'Upload your T3/T5 tax slip PDF file',
    requirements: `
      <h4>Supported Documents:</h4>
      <ul>
        <li><strong>Return of Capital (ROC):</strong> Box 42 from T3 slips</li>
        <li><strong>Reinvested Capital Gains:</strong> From T3/T5 slips</li>
        <li>PDF will be automatically parsed for relevant transactions</li>
        <li>Security symbol should be in the PDF filename (e.g., "VDY-T3-2024.pdf")</li>
      </ul>
    `,
    endpoint: '/api/import/review',
    subtype: 'tax_pdf'
  }
};

// Initialize
function init() {
  applyPageEnterMotion?.({ selector: ".page-header, .card, .wizard-step", maxItems: 12, staggerMs: 18 });
  setupEventListeners();
  renderStep(1);
}

function setupEventListeners() {
  // Import type selection
  importTypeCards.forEach(card => {
    card.addEventListener('click', () => selectImportType(card.dataset.type));
  });

  // Navigation
  backBtn.addEventListener('click', () => goToStep(currentStep - 1));
  nextBtn.addEventListener('click', () => goToStep(currentStep + 1));
  submitBtn.addEventListener('click', submitImport);
  importAnotherBtn.addEventListener('click', () => {
    resetWizard();
    goToStep(1);
  });

  // File upload
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', handleDragOver);
  dropzone.addEventListener('dragleave', handleDragLeave);
  dropzone.addEventListener('drop', handleDrop);
  fileInput.addEventListener('change', handleFileSelect);

  if (creditCardProviderSelect) {
    creditCardProviderSelect.addEventListener('change', async () => {
      selectedCreditCardProvider = creditCardProviderSelect.value;
      await loadCreditCardLabels();
      // Bank selection affects parsing rules; force re-upload when it changes.
      if (uploadedFile) {
        clearFile();
      }
    });
  }

  if (creditCardLabelSelect) {
    creditCardLabelSelect.addEventListener('change', () => {
      selectedCreditCardLabel = String(creditCardLabelSelect.value || '').trim();
      if (uploadedFile) {
        clearFile();
      }
    });
  }

  if (creditCardNewLabel) {
    creditCardNewLabel.addEventListener('input', () => {
      newCreditCardLabel = String(creditCardNewLabel.value || '').trim();
      if (uploadedFile) {
        clearFile();
      }
    });
  }

  if (toggleCreditCardLabelModeBtn) {
    toggleCreditCardLabelModeBtn.addEventListener('click', () => {
      const nextMode = creditCardLabelMode === 'existing' ? 'new' : 'existing';
      setCreditCardLabelMode(nextMode);
      if (uploadedFile) {
        clearFile();
      }
    });
  }

  if (chequingAccountSelect) {
    chequingAccountSelect.addEventListener('change', () => {
      selectedChequingAccount = String(chequingAccountSelect.value || '').trim();
      if (uploadedFile) {
        clearFile();
      }
    });
  }

  if (chequingAccountNewLabel) {
    chequingAccountNewLabel.addEventListener('input', () => {
      newChequingAccountLabel = String(chequingAccountNewLabel.value || '').trim();
      if (uploadedFile) {
        clearFile();
      }
    });
  }

  if (toggleChequingAccountModeBtn) {
    toggleChequingAccountModeBtn.addEventListener('click', () => {
      const nextMode = chequingAccountMode === 'existing' ? 'new' : 'existing';
      setChequingAccountMode(nextMode);
      if (uploadedFile) {
        clearFile();
      }
    });
  }

  if (togglePreviewFullscreenBtn) {
    togglePreviewFullscreenBtn.addEventListener('click', () => {
      setPreviewFullscreen(!isPreviewFullscreen);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isPreviewFullscreen) {
      setPreviewFullscreen(false);
    }
  });
}

function setPreviewFullscreen(enabled) {
  isPreviewFullscreen = Boolean(enabled);

  if (previewTableContainer) {
    previewTableContainer.classList.toggle('fullscreen', isPreviewFullscreen);
  }

  document.body.classList.toggle('preview-fullscreen-open', isPreviewFullscreen);

  if (togglePreviewFullscreenBtn) {
    togglePreviewFullscreenBtn.textContent = isPreviewFullscreen ? '🗕 Exit Full Screen' : '⛶ Full Screen';
  }
}

function setCreditCardLabelMode(mode) {
  creditCardLabelMode = mode === 'new' ? 'new' : 'existing';

  if (creditCardExistingWrap) {
    creditCardExistingWrap.style.display = creditCardLabelMode === 'existing' ? 'block' : 'none';
  }
  if (creditCardNewWrap) {
    creditCardNewWrap.style.display = creditCardLabelMode === 'new' ? 'block' : 'none';
  }
  if (toggleCreditCardLabelModeBtn) {
    toggleCreditCardLabelModeBtn.textContent = creditCardLabelMode === 'existing' ? 'Create New Card' : 'Use Existing Card';
  }

  if (creditCardLabelMode === 'new') {
    selectedCreditCardLabel = '';
    if (creditCardLabelSelect) {
      creditCardLabelSelect.value = '';
    }
  } else {
    newCreditCardLabel = '';
    if (creditCardNewLabel) {
      creditCardNewLabel.value = '';
    }
  }
}

function setChequingAccountMode(mode) {
  chequingAccountMode = mode === 'new' ? 'new' : 'existing';

  if (chequingAccountExistingWrap) {
    chequingAccountExistingWrap.style.display = chequingAccountMode === 'existing' ? 'block' : 'none';
  }
  if (chequingAccountNewWrap) {
    chequingAccountNewWrap.style.display = chequingAccountMode === 'new' ? 'block' : 'none';
  }
  if (toggleChequingAccountModeBtn) {
    toggleChequingAccountModeBtn.textContent = chequingAccountMode === 'existing' ? 'Create New Account' : 'Use Existing Account';
  }

  if (chequingAccountMode === 'new') {
    selectedChequingAccount = '';
    if (chequingAccountSelect) {
      chequingAccountSelect.value = '';
    }
  } else {
    newChequingAccountLabel = '';
    if (chequingAccountNewLabel) {
      chequingAccountNewLabel.value = '';
    }
  }
}

function setAnimatedVisibility(element, visible, displayValue = 'block') {
  if (!element) {
    return;
  }

  if (element.__wizardHideTimer) {
    clearTimeout(element.__wizardHideTimer);
    element.__wizardHideTimer = null;
  }

  if (visible) {
    element.style.display = displayValue;
    requestAnimationFrame(() => {
      element.classList.remove('wizard-motion-hidden');
    });
    return;
  }

  element.classList.add('wizard-motion-hidden');
  element.__wizardHideTimer = setTimeout(() => {
    if (element.classList.contains('wizard-motion-hidden')) {
      element.style.display = 'none';
    }
    element.__wizardHideTimer = null;
  }, WIZARD_MOTION_MS);
}

function selectImportType(type) {
  selectedImportType = type;

  // Update UI
  importTypeCards.forEach(card => {
    card.classList.toggle('selected', card.dataset.type === type);
  });

  // Enable next button
  nextBtn.style.display = 'inline-block';
}

function goToStep(step) {
  if (step < 1 || step > 4) return;

  // Validate before proceeding
  if (step > currentStep) {
    if (currentStep === 1 && !selectedImportType) {
      showError('Please select an import type');
      return;
    }
    if (currentStep === 2 && !uploadedFile) {
      showError('Please upload a file');
      return;
    }
  }

  currentStep = step;
  renderStep(step);
}

function renderStep(step) {
  // Update step indicators
  wizardSteps.forEach((stepEl, index) => {
    const stepNum = index + 1;
    stepEl.classList.remove('active', 'completed');

    if (stepNum === step) {
      stepEl.classList.add('active');
    } else if (stepNum < step) {
      stepEl.classList.add('completed');
    }
  });

  // Show/hide step content
  stepContents.forEach((content, index) => {
    setAnimatedVisibility(content, index + 1 === step, 'block');
  });

  // Update navigation buttons
  backBtn.style.display = step > 1 && step < 4 ? 'inline-block' : 'none';
  nextBtn.style.display = 'none';
  submitBtn.style.display = 'none';

  if (step !== 3 && isPreviewFullscreen) {
    setPreviewFullscreen(false);
  }

  if (step === 1) {
    nextBtn.style.display = selectedImportType ? 'inline-block' : 'none';
  } else if (step === 2) {
    setupStep2();
    if (uploadedFile) {
      nextBtn.style.display = 'inline-block';
    }
  } else if (step === 3) {
    submitBtn.style.display = 'inline-block';
    renderPreview();
  }
}

async function setupStep2() {
  const config = importTypeConfig[selectedImportType];

  document.getElementById('step2Title').textContent = `Upload ${config.title}`;
  document.getElementById('step2Description').textContent = config.description;

  formatRequirements.innerHTML = config.requirements;

  const isCreditCardImport = selectedImportType === 'credit-card';
  setAnimatedVisibility(creditCardProviderGroup, isCreditCardImport, 'block');
  if (isCreditCardImport) {
    setCreditCardLabelMode('existing');
    await loadCreditCardLabels();
  } else if (creditCardProviderSelect) {
    selectedCreditCardProvider = '';
    creditCardProviderSelect.value = '';
    selectedCreditCardLabel = '';
    newCreditCardLabel = '';
    if (creditCardLabelSelect) {
      creditCardLabelSelect.innerHTML = '<option value="">Use bank default label</option>';
      creditCardLabelSelect.value = '';
    }
    if (creditCardNewLabel) {
      creditCardNewLabel.value = '';
    }
    setCreditCardLabelMode('existing');
  }

  const isChequingImport = selectedImportType === 'chequing';
  setAnimatedVisibility(chequingAccountGroup, isChequingImport, 'block');
  if (isChequingImport) {
    setChequingAccountMode('existing');
    await loadChequingAccounts();
  } else {
    selectedChequingAccount = '';
    newChequingAccountLabel = '';
    if (chequingAccountSelect) {
      chequingAccountSelect.innerHTML = '<option value="">Select an account</option>';
      chequingAccountSelect.value = '';
    }
    if (chequingAccountNewLabel) {
      chequingAccountNewLabel.value = '';
    }
    setChequingAccountMode('existing');
  }

  // Set file input accept attribute
  fileInput.setAttribute('accept', config.accept);

  // Template download (if applicable)
  if (config.templateName && selectedImportType !== 'tax-pdf') {
    templateDownload.innerHTML = `
      <a href="/api/import/template/${selectedImportType}" class="download-template-link" download="${config.templateName}">
        📥 Download Template File
      </a>
    `;
  } else {
    templateDownload.innerHTML = '';
  }

  // Reset file state when coming back to this step
  if (!uploadedFile) {
    setAnimatedVisibility(dropzone, true, 'block');
    setAnimatedVisibility(fileInfo, false, 'block');
    setAnimatedVisibility(uploadError, false, 'block');
  }
}

async function loadCreditCardLabels() {
  if (!creditCardLabelSelect) {
    return;
  }

  const previousValue = String(creditCardLabelSelect.value || selectedCreditCardLabel || '').trim();
  const provider = String(selectedCreditCardProvider || creditCardProviderSelect?.value || '').trim();
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';

  let labels = [];
  try {
    const rows = await fetchJson(`/api/credit-card/cards${query}`);
    if (Array.isArray(rows)) {
      labels = rows.map((value) => String(value || '').trim()).filter((value) => value);
    }
  } catch (_) {
    labels = [];
  }

  const uniqueLabels = Array.from(new Set(labels)).sort((a, b) => a.localeCompare(b));
  creditCardLabelSelect.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Use bank default label';
  creditCardLabelSelect.appendChild(defaultOption);

  uniqueLabels.forEach((label) => {
    const option = document.createElement('option');
    option.value = label;
    option.textContent = label;
    creditCardLabelSelect.appendChild(option);
  });

  creditCardLabelSelect.value = previousValue;
  if (creditCardLabelSelect.value !== previousValue) {
    creditCardLabelSelect.value = '';
  }
  selectedCreditCardLabel = String(creditCardLabelSelect.value || '').trim();
}

async function loadChequingAccounts() {
  if (!chequingAccountSelect) {
    return;
  }

  const previousValue = String(chequingAccountSelect.value || selectedChequingAccount || '').trim();
  const accounts = await fetchJson('/api/chequing/accounts?include_hidden=true');
  const accountLabels = Array.isArray(accounts)
    ? accounts.map((row) => String(row?.label || '').trim()).filter((value) => value)
    : [];

  const uniqueLabels = Array.from(new Set(accountLabels)).sort((a, b) => a.localeCompare(b));

  chequingAccountSelect.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Select an account';
  chequingAccountSelect.appendChild(defaultOption);

  uniqueLabels.forEach((label) => {
    const option = document.createElement('option');
    option.value = label;
    option.textContent = label;
    chequingAccountSelect.appendChild(option);
  });

  chequingAccountSelect.value = previousValue;
  if (chequingAccountSelect.value !== previousValue) {
    chequingAccountSelect.value = '';
  }
  selectedChequingAccount = String(chequingAccountSelect.value || '').trim();
}

function handleDragOver(e) {
  e.preventDefault();
  dropzone.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  dropzone.classList.remove('drag-over');

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    processFile(files[0]);
  }
}

function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    processFile(files[0]);
  }
}

async function processFile(file) {
  if (selectedImportType === 'credit-card' && !selectedCreditCardProvider) {
    showError('Please select a credit card bank before uploading your file');
    return;
  }

  if (selectedImportType === 'chequing') {
    const accountLabel = getSelectedChequingAccountLabel();
    if (!accountLabel) {
      showError('Please select or enter a chequing account label before uploading your file');
      return;
    }
  }

  uploadedFile = file;
  setAnimatedVisibility(uploadError, false, 'block');

  const config = importTypeConfig[selectedImportType];
  const fileExt = '.' + file.name.split('.').pop().toLowerCase();

  // Validate file type
  if (!config.fileTypes.includes(fileExt)) {
    showError(`Invalid file type. Expected: ${config.fileTypes.join(', ')}`);
    uploadedFile = null;
    return;
  }

  // Show file info
  setAnimatedVisibility(dropzone, false, 'block');
  setAnimatedVisibility(fileInfo, true, 'block');
  // Build file info DOM safely without using innerHTML
  fileInfo.innerHTML = '';

  const infoContainer = document.createElement('div');
  infoContainer.classList.add('file-info');

  const iconEl = document.createElement('div');
  iconEl.classList.add('file-info-icon');
  iconEl.textContent = fileExt === '.pdf' ? '📄' : '📊';
  infoContainer.appendChild(iconEl);

  const detailsEl = document.createElement('div');
  detailsEl.classList.add('file-info-details');

  const nameEl = document.createElement('div');
  nameEl.classList.add('file-info-name');
  // Using textContent ensures the file name is not interpreted as HTML
  nameEl.textContent = file.name;
  detailsEl.appendChild(nameEl);

  const metaEl = document.createElement('div');
  metaEl.classList.add('file-info-meta');
  metaEl.textContent = `${formatFileSize(file.size)} • ${fileExt.toUpperCase().substring(1)}`;
  detailsEl.appendChild(metaEl);

  infoContainer.appendChild(detailsEl);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.classList.add('btn-secondary');
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', clearFile);
  infoContainer.appendChild(removeBtn);

  fileInfo.appendChild(infoContainer);

  // Parse file
  try {
    await parseFile(file);
    nextBtn.style.display = 'inline-block';
  } catch (error) {
    showError(error.message || 'Failed to parse file');
    uploadedFile = null;
  }
}

async function parseFile(file) {
  const config = importTypeConfig[selectedImportType];
  const formData = buildImportFormData(file, { previewOnly: true });

  const result = await fetchJson(config.endpoint, {
    method: 'POST',
    body: formData,
    credentials: 'include'
  });

  // Preview-only pass for all imports.
  batchId = null;
  parsedData = {
    rows: result.rows || [],
    parsed: result.parsed || (result.rows ? result.rows.length : 0),
    imported: 0,
  };
}

function renderPreview() {
  if (!parsedData) return;

  const config = importTypeConfig[selectedImportType];

  // For direct imports, show summary
  if (config.direct) {
    const rowCount = parsedData.rows?.length || parsedData.parsed || 0;
    previewStats.innerHTML = `
      <div class="warning-message">
        <strong>Found ${rowCount} record(s)</strong> • Review before importing
      </div>
    `;

    previewWarnings.innerHTML = '';

    if (parsedData.rows && parsedData.rows.length > 0) {
      renderDirectPreviewTable(parsedData.rows);
    } else {
      previewTableHead.innerHTML = '';
      previewTableBody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 2rem; color: #64748b;">
            File processed successfully. ${rowCount} record(s) found.
          </td>
        </tr>
      `;
      markTableBodyRefreshed?.(previewTableBody);
    }
  } else {
    // Transactions/Tax preview
    const rows = parsedData.rows || [];

    previewStats.innerHTML = `
      <div class="warning-message">
        <strong>Found ${rows.length} transaction(s)</strong> • Review and edit before importing
      </div>
    `;

    renderStagedPreviewTable(rows);
  }
}

function renderDirectPreviewTable(rows) {
  if (!rows || rows.length === 0) return;

  const firstRow = rows[0];
  const columns = Object.keys(firstRow).filter((col) => {
    if (selectedImportType === 'chequing' && col === 'transaction_code') {
      return false;
    }
    return true;
  });

  // Render header
  previewTableHead.innerHTML = `
    <tr>
      ${columns.map(col => `<th>${escapeHtml(formatColumnName(col))}</th>`).join('')}
    </tr>
  `;

  // Render rows (limit to first 50 for performance)
  const displayRows = rows.slice(0, 50);
  previewTableBody.innerHTML = displayRows.map(row => `
    <tr>
      ${columns.map(col => {
        const value = row[col];
        const formatted = formatCellValue(col, value);
        return `<td>${escapeHtml(String(formatted))}</td>`;
      }).join('')}
    </tr>
  `).join('');

  if (rows.length > 50) {
    previewTableBody.innerHTML += `
      <tr>
        <td colspan="${columns.length}" style="text-align: center; padding: 1rem; color: #64748b;">
          ... and ${rows.length - 50} more record(s)
        </td>
      </tr>
    `;
  }

  markTableBodyRefreshed?.(previewTableBody);
}

function renderStagedPreviewTable(rows) {
  previewTableHead.innerHTML = `
    <tr>
      <th>Date</th>
      <th>Security</th>
      <th>Type</th>
      <th>Amount</th>
      <th>Shares</th>
      <th>Price/Share</th>
      <th>Commission</th>
    </tr>
  `;

  previewTableBody.innerHTML = rows.map((row, index) => `
    <tr>
      <td>${escapeHtml(row.trade_date || '')}</td>
      <td>${escapeHtml(row.security || '')}</td>
      <td>${escapeHtml(row.transaction_type || '')}</td>
      <td>${formatMoney(row.amount || 0)}</td>
      <td>${formatNumber(row.shares || 0, 6)}</td>
      <td>${formatMoney(row.amount_per_share || 0)}</td>
      <td>${formatMoney(row.commission || 0)}</td>
    </tr>
  `).join('');

  markTableBodyRefreshed?.(previewTableBody);
}

async function submitImport() {
  submitBtn.disabled = true;
  submitBtn.textContent = 'Importing...';

  try {
    const config = importTypeConfig[selectedImportType];

    if (config.direct) {
      if (!uploadedFile) {
        throw new Error('Please upload a file before importing');
      }

      const importResult = await fetchJson(config.endpoint, {
        method: 'POST',
        body: buildImportFormData(uploadedFile, { previewOnly: false }),
        credentials: 'include'
      });

      showCompletion(`Successfully imported ${importResult.imported || importResult.inserted || 0} record(s)`);
      goToStep(4);
    } else {
      if (!uploadedFile) {
        throw new Error('Please upload a file before importing');
      }

      const createResult = await fetchJson(config.endpoint, {
        method: 'POST',
        body: buildImportFormData(uploadedFile, { previewOnly: false }),
        credentials: 'include'
      });

      const commitBatchId = createResult.batch?.id || createResult.batch_id;
      if (!commitBatchId) {
        throw new Error('Failed to create import batch');
      }

      const result = await fetchJson(`/api/import/commit/${commitBatchId}`, {
        method: 'POST'
      });

      showCompletion(`Successfully imported ${result.imported || 0} transaction(s)`);
      goToStep(4);
    }
  } catch (error) {
    showError(error.message || 'Failed to import data');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Import Data';
  }
}

function buildImportFormData(file, options = {}) {
  const { previewOnly = false } = options;
  const config = importTypeConfig[selectedImportType];
  const formData = new FormData();
  formData.append('file', file);

  if (config?.subtype) {
    formData.append('import_type', config.subtype);
  }

  if (selectedImportType === 'credit-card') {
    formData.append('provider', selectedCreditCardProvider);
    const cardLabel = getSelectedCreditCardLabel();
    if (cardLabel) {
      formData.append('card_label', cardLabel);
    }
  }

  if (selectedImportType === 'chequing') {
    formData.append('account_label', getSelectedChequingAccountLabel());
  }

  if (previewOnly) {
    formData.append('preview_only', '1');
  }

  return formData;
}

function getSelectedCreditCardLabel() {
  if (creditCardLabelMode === 'new') {
    return String(creditCardNewLabel?.value || newCreditCardLabel || '').trim();
  }

  const typed = String(creditCardNewLabel?.value || newCreditCardLabel || '').trim();
  if (typed) {
    return typed;
  }

  const selected = String(creditCardLabelSelect?.value || selectedCreditCardLabel || '').trim();
  if (selected) {
    return selected;
  }

  return '';
}

function getSelectedChequingAccountLabel() {
  if (chequingAccountMode === 'new') {
    return String(chequingAccountNewLabel?.value || newChequingAccountLabel || '').trim();
  }

  const typed = String(chequingAccountNewLabel?.value || newChequingAccountLabel || '').trim();
  if (typed) {
    return typed;
  }

  const selected = String(chequingAccountSelect?.value || selectedChequingAccount || '').trim();
  if (selected) {
    return selected;
  }

  return '';
}

function showCompletion(message) {
  completionMessage.textContent = message;
}

function showError(message) {
  uploadError.className = 'error-message';
  uploadError.textContent = message;
  setAnimatedVisibility(uploadError, true, 'block');
}

function clearFile() {
  uploadedFile = null;
  parsedData = null;
  batchId = null;
  fileInput.value = '';
  setAnimatedVisibility(dropzone, true, 'block');
  setAnimatedVisibility(fileInfo, false, 'block');
  setAnimatedVisibility(uploadError, false, 'block');
  nextBtn.style.display = 'none';
}

function resetWizard() {
  currentStep = 1;
  selectedImportType = null;
  uploadedFile = null;
  parsedData = null;
  batchId = null;
  selectedCreditCardProvider = '';
  selectedCreditCardLabel = '';
  newCreditCardLabel = '';
  creditCardLabelMode = 'existing';
  selectedChequingAccount = '';
  newChequingAccountLabel = '';
  chequingAccountMode = 'existing';
  fileInput.value = '';
  if (creditCardProviderSelect) {
    creditCardProviderSelect.value = '';
  }
  if (creditCardLabelSelect) {
    creditCardLabelSelect.innerHTML = '<option value="">Use bank default label</option>';
    creditCardLabelSelect.value = '';
  }
  if (creditCardNewLabel) {
    creditCardNewLabel.value = '';
  }
  setCreditCardLabelMode('existing');
  if (chequingAccountSelect) {
    chequingAccountSelect.innerHTML = '<option value="">Select an account</option>';
    chequingAccountSelect.value = '';
  }
  if (chequingAccountNewLabel) {
    chequingAccountNewLabel.value = '';
  }
  setChequingAccountMode('existing');

  importTypeCards.forEach(card => card.classList.remove('selected'));
  setAnimatedVisibility(dropzone, true, 'block');
  setAnimatedVisibility(fileInfo, false, 'block');
  setAnimatedVisibility(uploadError, false, 'block');
}

// Utility functions
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatColumnName(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatCellValue(columnName, value) {
  if (value === null || value === undefined) return '';

  const lowerCol = columnName.toLowerCase();

  if (lowerCol.includes('amount') || lowerCol.includes('value') || lowerCol.includes('price')) {
    return formatMoney(value);
  }

  if (lowerCol.includes('quantity') || lowerCol.includes('shares')) {
    return formatNumber(value, 6);
  }

  return value;
}

function formatMoney(value) {
  const num = Number(value);
  if (isNaN(num)) return value;
  return defaultCurrencyFormatter.format(num);
}

function formatNumber(value, decimals = 2) {
  const num = Number(value);
  if (isNaN(num)) return value;
  return num.toFixed(decimals);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
