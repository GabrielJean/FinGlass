const statusEl = document.getElementById("status");
const chequingAsOfEl = document.getElementById("chequingAsOf");
const summaryMoneyInEl = document.getElementById("summaryMoneyIn");
const summaryMoneyOutEl = document.getElementById("summaryMoneyOut");
const summaryNetFlowEl = document.getElementById("summaryNetFlow");
const summaryTransactionsEl = document.getElementById("summaryTransactions");
const summarySavingsRateEl = document.getElementById("summarySavingsRate");
const summaryAvgMonthlyInEl = document.getElementById("summaryAvgMonthlyIn");
const summaryAvgMonthlyOutEl = document.getElementById("summaryAvgMonthlyOut");
const summaryPositiveMonthsEl = document.getElementById("summaryPositiveMonths");
const summaryTopSpendingCategoryEl = document.getElementById("summaryTopSpendingCategory");
const summaryLargestExpenseEl = document.getElementById("summaryLargestExpense");

const filtersForm = document.getElementById("chequingFiltersForm");
const filterStartDateEl = document.getElementById("filterStartDate");
const filterEndDateEl = document.getElementById("filterEndDate");
const filterAccountLabelEl = document.getElementById("filterAccountLabel");
const filterCategoryEl = document.getElementById("filterCategory");
const filterDirectionEl = document.getElementById("filterDirection");
const filterSearchEl = document.getElementById("filterSearch");
const filterIncludeHiddenEl = document.getElementById("filterIncludeHidden");
const quickDateButtonsEl = filtersForm?.querySelector("[data-quick-date-buttons]");
const resetFiltersBtn = document.getElementById("resetFiltersBtn");
const selectAllTxEl = document.getElementById("selectAllTx");
const hideSelectedBtn = document.getElementById("hideSelectedBtn");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
const deleteAllBtn = document.getElementById("deleteAllBtn");
const selectionStatusEl = document.getElementById("selectionStatus");

const categoryBody = document.querySelector("#chequingCategoryTable tbody");
const transactionsTableHead = document.querySelector("#chequingTransactionsTable thead");
const transactionsBody = document.querySelector("#chequingTransactionsTable tbody");
const chequingMonthlyCtx = document.getElementById("chequingMonthlyChart");

const chequingSettingsSectionEl = document.getElementById("chequingSettingsSection");
const chequingSettingsToggleBtnEl = document.getElementById("chequingSettingsToggleBtn");
const chequingSettingsBackdropEl = document.getElementById("chequingSettingsBackdrop");
const chequingDialogBackdropEl = document.getElementById("chequingDialogBackdrop");
const chequingAccountAddFormEl = document.getElementById("chequing-account-add-form");
const chequingAccountAddProviderSelectEl = document.getElementById("chequing-account-add-provider");
const chequingAccountAddLabelInputEl = document.getElementById("chequing-account-add-label");
const chequingAccountsListBodyEl = document.getElementById("chequing-accounts-list-body");
const chequingRecategorizeBtnEl = document.getElementById("chequing-recategorize-btn");

const chequingAccountRenameModalEl = document.getElementById("chequingAccountRenameModal");
const chequingAccountRenameFormEl = document.getElementById("chequing-account-rename-form");
const chequingAccountRenameOldLabelEl = document.getElementById("chequing-account-rename-old-label");
const chequingAccountRenameNewLabelEl = document.getElementById("chequing-account-rename-new-label");
const chequingAccountRenameCancelBtnEl = document.getElementById("chequing-account-rename-cancel-btn");

const chequingAccountDeleteConfirmModalEl = document.getElementById("chequingAccountDeleteConfirmModal");
const chequingAccountDeleteLabelDisplayEl = document.getElementById("chequing-account-delete-label-display");
const chequingAccountDeleteConfirmInputEl = document.getElementById("chequing-account-delete-confirm-input");
const chequingAccountDeleteConfirmErrorEl = document.getElementById("chequing-account-delete-confirm-error");
const chequingAccountDeleteCancelBtnEl = document.getElementById("chequing-account-delete-cancel-btn");
const chequingAccountDeleteConfirmBtnEl = document.getElementById("chequing-account-delete-confirm-btn");

const common = window.FinGlassCommon || {};
const fetchJson = common.fetchJson;
const escapeHtml = common.escapeHtml;
const markTableBodyRefreshed = common.markTableBodyRefreshed;
const applyPageEnterMotion = common.applyPageEnterMotion;
const currencyFormatter = common.defaultCurrencyFormatter;
const ensureOverlayElementsAtBody = common.ensureOverlayElementsAtBody;
const setupQuickDateButtons = common.setupQuickDateButtons;

let chequingMonthlyChart;
let loadedTransactions = [];
let currentSort = { key: "transaction_date", direction: "desc" };
const selectedTransactionIds = new Set();
let chequingAccountsList = [];
let renamingAccountLabel = null;
let deletingAccountLabel = null;

if (window.Chart) {
  common.applyChartDefaults?.();
}

function setStatus(message) {
  common.setStatus?.(statusEl, message, "info");
}

function setErrorStatus(message) {
  common.setStatus?.(statusEl, message, "error");
}

function fmtMoney(value) {
  return common.fmtMoney(value, currencyFormatter);
}

function setSummaryTone(element, tone) {
  if (!element) {
    return;
  }
  element.classList.remove("summary-value-positive", "summary-value-negative", "summary-value-neutral");
  if (!tone) {
    return;
  }
  element.classList.add(`summary-value-${tone}`);
}

function moneyTickCallback(value) {
  return fmtMoney(value);
}

function createOrReplaceChart(currentChart, ctx, config) {
  if (!window.Chart) {
    return null;
  }
  if (currentChart) {
    currentChart.destroy();
  }
  return new Chart(ctx, config);
}

function buildQueryFromFilters() {
  const params = new URLSearchParams();
  const start = String(filterStartDateEl?.value || "").trim();
  const end = String(filterEndDateEl?.value || "").trim();
  const account = String(filterAccountLabelEl?.value || "").trim();
  const category = String(filterCategoryEl?.value || "").trim();
  const direction = String(filterDirectionEl?.value || "").trim();
  const search = String(filterSearchEl?.value || "").trim();
  const includeHidden = String(filterIncludeHiddenEl?.value || "false").trim();

  if (start) params.set("start_date", start);
  if (end) params.set("end_date", end);
  if (account) params.set("account_label", account);
  if (category) params.set("category", category);
  if (direction) params.set("direction", direction);
  if (search) params.set("search", search);
  if (includeHidden) params.set("include_hidden", includeHidden);

  return params;
}

function renderSummary(data) {
  const summary = data.summary || {};
  const insights = data.insights || {};
  const totalIn = Number(summary.total_in || 0);
  const totalOut = Number(summary.total_out || 0);
  const netFlow = Number(summary.net_flow || 0);

  summaryMoneyInEl.textContent = fmtMoney(totalIn);
  summaryMoneyOutEl.textContent = fmtMoney(totalOut);
  summaryNetFlowEl.textContent = fmtMoney(netFlow);
  summaryTransactionsEl.textContent = Number(summary.transactions || 0).toString();

  setSummaryTone(summaryMoneyInEl, null);
  setSummaryTone(summaryMoneyOutEl, null);
  setSummaryTone(summaryNetFlowEl, netFlow > 0 ? "positive" : netFlow < 0 ? "negative" : "neutral");

  if (summarySavingsRateEl) {
    const savingsRatePct = Number(insights.savings_rate_pct || 0);
    summarySavingsRateEl.textContent = `${savingsRatePct.toFixed(1)}% kept`;
    setSummaryTone(summarySavingsRateEl, null);
  }
  if (summaryAvgMonthlyInEl) {
    summaryAvgMonthlyInEl.textContent = `${fmtMoney(Number(insights.avg_monthly_in || 0))}/mo`;
    setSummaryTone(summaryAvgMonthlyInEl, null);
  }
  if (summaryAvgMonthlyOutEl) {
    summaryAvgMonthlyOutEl.textContent = `${fmtMoney(Number(insights.avg_monthly_out || 0))}/mo`;
    setSummaryTone(summaryAvgMonthlyOutEl, null);
  }
  if (summaryPositiveMonthsEl) {
    const positiveMonths = Number(insights.positive_months || 0);
    const monthsCount = Number(insights.months_count || 0);
    summaryPositiveMonthsEl.textContent = `${positiveMonths} of ${monthsCount} cash-positive`;
    setSummaryTone(summaryPositiveMonthsEl, null);
  }
  if (summaryTopSpendingCategoryEl) {
    const topCategory = insights.top_spending_category || null;
    summaryTopSpendingCategoryEl.textContent = topCategory
      ? `${String(topCategory.category || "Other")} · ${Number(topCategory.share_pct || 0).toFixed(1)}%`
      : "None";
    setSummaryTone(summaryTopSpendingCategoryEl, null);
  }
  if (summaryLargestExpenseEl) {
    const largestExpense = insights.largest_outflow || null;
    summaryLargestExpenseEl.textContent = largestExpense
      ? `${fmtMoney(Number(largestExpense.amount || 0))} · ${String(largestExpense.category || "Other")}`
      : fmtMoney(0);
    setSummaryTone(summaryLargestExpenseEl, null);
  }

  chequingAsOfEl.textContent = data.latest_transaction_date
    ? `Imported through ${data.latest_transaction_date}.`
    : "No chequing data imported yet.";
}

function renderMonthlyChart(monthlyRows) {
  const rows = monthlyRows || [];
  chequingMonthlyChart = createOrReplaceChart(chequingMonthlyChart, chequingMonthlyCtx, {
    type: "bar",
    data: {
      labels: rows.map((row) => row.month),
      datasets: [
        {
          label: "Money In",
          data: rows.map((row) => Number(row.in || 0)),
          backgroundColor: "rgba(16, 185, 129, 0.5)",
          borderColor: "#10b981",
          borderWidth: 1,
        },
        {
          label: "Money Out",
          data: rows.map((row) => Number(row.out || 0)),
          backgroundColor: "rgba(239, 68, 68, 0.5)",
          borderColor: "#ef4444",
          borderWidth: 1,
          stack: "outflow",
        },
        {
          label: "Savings Out",
          data: rows.map((row) => Number(row.internal_out || 0)),
          backgroundColor: "rgba(59, 130, 246, 0.55)",
          borderColor: "#3b82f6",
          borderWidth: 1,
          stack: "outflow",
        },
        {
          label: "Net",
          type: "line",
          data: rows.map((row) => Number(row.net || 0)),
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.2)",
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { ticks: { callback: moneyTickCallback } },
      },
    },
  });
}

function renderCategoryTable(categories) {
  categoryBody.innerHTML = "";
  const rows = categories || [];

  if (!rows.length) {
    common.renderEmptyTableRow?.(categoryBody, 5, "No category data for the selected filters.");
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(String(row.category || "Other"))}</td>
      <td>${fmtMoney(row.total_out || 0)}</td>
      <td>${fmtMoney(row.total_in || 0)}</td>
      <td>${fmtMoney(row.net || 0)}</td>
      <td>${Number(row.count || 0)}</td>
    `;
    categoryBody.appendChild(tr);
  });

  markTableBodyRefreshed?.(categoryBody);
}

function updateSelectionStatus() {
  selectionStatusEl.textContent = `${selectedTransactionIds.size} selected`;
}

function sortRows(rows) {
  const sorted = [...rows];
  const direction = currentSort.direction === "asc" ? 1 : -1;
  const key = currentSort.key;

  sorted.sort((a, b) => {
    if (key === "amount" || key === "balance") {
      const left = Number(a[key] ?? 0);
      const right = Number(b[key] ?? 0);
      if (left === right) {
        return Number(b.id || 0) - Number(a.id || 0);
      }
      return (left - right) * direction;
    }

    const leftRaw = String(a[key] ?? "").toLowerCase();
    const rightRaw = String(b[key] ?? "").toLowerCase();
    if (leftRaw === rightRaw) {
      return Number(b.id || 0) - Number(a.id || 0);
    }
    return leftRaw.localeCompare(rightRaw) * direction;
  });

  return sorted;
}

function updateSortHeaderUi() {
  if (!transactionsTableHead) {
    return;
  }
  const headers = transactionsTableHead.querySelectorAll("th[data-sort-key]");
  headers.forEach((th) => {
    const key = th.dataset.sortKey;
    const baseLabel = th.dataset.baseLabel || th.textContent.replace(/\s*[▲▼↕]$/, "").trim();
    th.dataset.baseLabel = baseLabel;
    th.textContent = baseLabel;
    th.setAttribute(
      "aria-sort",
      key === currentSort.key ? (currentSort.direction === "asc" ? "ascending" : "descending") : "none"
    );
  });
}

function renderTransactions(rows) {
  loadedTransactions = rows || [];
  const sortedRows = sortRows(loadedTransactions);
  transactionsBody.innerHTML = "";

  if (!sortedRows.length) {
    common.renderEmptyTableRow?.(transactionsBody, 8, "No chequing transactions for the selected filters.");
    selectedTransactionIds.clear();
    updateSelectionStatus();
    updateSortHeaderUi();
    return;
  }

  sortedRows.forEach((row) => {
    const id = Number(row.id || 0);
    const isHidden = Boolean(row.is_hidden);
    const tr = document.createElement("tr");
    if (isHidden) {
      tr.classList.add("muted");
    }
    tr.innerHTML = `
      <td><input type="checkbox" class="tx-select" data-id="${id}" ${selectedTransactionIds.has(id) ? "checked" : ""} /></td>
      <td>${escapeHtml(String(row.transaction_date || ""))}</td>
      <td>${escapeHtml(String(row.account_label || ""))}</td>
      <td>${escapeHtml(String(row.description || ""))}</td>
      <td>${escapeHtml(String(row.category || ""))}</td>
      <td>${fmtMoney(row.amount || 0)}</td>
      <td>${row.balance === null || row.balance === undefined ? "" : fmtMoney(row.balance)}</td>
      <td>
        <button class="btn-secondary tx-hide-btn" type="button" data-id="${id}" data-hidden="${isHidden ? "true" : "false"}">${isHidden ? "Unhide" : "Hide"}</button>
        <button class="btn-secondary tx-delete-btn" type="button" data-id="${id}">Delete</button>
      </td>
    `;
    transactionsBody.appendChild(tr);
  });

  markTableBodyRefreshed?.(transactionsBody);
  updateSelectionStatus();
  updateSortHeaderUi();
}

async function loadAccounts() {
  const previousValue = String(filterAccountLabelEl?.value || "").trim();
  const includeHidden = String(filterIncludeHiddenEl?.value || "false").trim();
  const accounts = await fetchJson(`/api/chequing/accounts?include_hidden=${encodeURIComponent(includeHidden)}`);
  filterAccountLabelEl.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All accounts";
  filterAccountLabelEl.appendChild(allOption);

  accounts.forEach((account) => {
    const label = String(account?.label || "").trim();
    const provider = String(account?.provider || "WealthSimple").trim() || "WealthSimple";
    if (!label) {
      return;
    }
    const option = document.createElement("option");
    option.value = label;
    option.textContent = `${label} (${provider})`;
    filterAccountLabelEl.appendChild(option);
  });

  filterAccountLabelEl.value = previousValue;
  if (filterAccountLabelEl.value !== previousValue) {
    filterAccountLabelEl.value = "";
  }
}

async function loadCategories() {
  const previousValue = String(filterCategoryEl?.value || "").trim();
  const includeHidden = String(filterIncludeHiddenEl?.value || "false").trim();
  const categories = await fetchJson(`/api/chequing/categories?include_hidden=${encodeURIComponent(includeHidden)}`);
  filterCategoryEl.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All categories";
  filterCategoryEl.appendChild(allOption);

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = String(category || "").trim();
    option.textContent = option.value;
    filterCategoryEl.appendChild(option);
  });

  filterCategoryEl.value = previousValue;
  if (filterCategoryEl.value !== previousValue) {
    filterCategoryEl.value = "";
  }
}

async function refreshDashboard() {
  const params = buildQueryFromFilters();
  const data = await fetchJson(`/api/chequing/dashboard?${params.toString()}`);
  renderSummary(data);
  renderMonthlyChart(data.monthly || []);
  renderCategoryTable(data.categories || []);
}

async function refreshTransactions() {
  const params = buildQueryFromFilters();
  params.set("limit", "500");
  const rows = await fetchJson(`/api/chequing/transactions?${params.toString()}`);
  renderTransactions(rows);
}

async function refreshAll() {
  await Promise.all([refreshDashboard(), refreshTransactions()]);
}

async function refreshChequingAccountsList() {
  if (!chequingAccountsListBodyEl) {
    return;
  }

  chequingAccountsListBodyEl.innerHTML = "";
  const accounts = await fetchJson("/api/chequing/accounts?include_hidden=true");
  chequingAccountsList = Array.isArray(accounts) ? accounts.map((row) => String(row.label || "")) : [];

  if (!Array.isArray(accounts) || !accounts.length) {
    chequingAccountsListBodyEl.innerHTML = "<tr><td colspan='4' class='muted'>No chequing accounts found</td></tr>";
    return;
  }

  accounts.forEach((row) => {
    const label = String(row.label || "").trim();
    const provider = String(row.provider || "WealthSimple").trim() || "WealthSimple";
    const txCount = Number(row.transactions || 0);
    const tr = document.createElement("tr");

    const providerTd = document.createElement("td");
    providerTd.textContent = provider;
    tr.appendChild(providerTd);

    const labelTd = document.createElement("td");
    labelTd.textContent = label;
    tr.appendChild(labelTd);

    const txTd = document.createElement("td");
    txTd.textContent = String(txCount);
    tr.appendChild(txTd);

    const actionsTd = document.createElement("td");
    actionsTd.className = "chequing-account-actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "btn-link chequing-account-rename-btn";
    renameBtn.textContent = "Rename";
    renameBtn.dataset.accountLabel = label;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-link chequing-account-delete-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.dataset.accountLabel = label;

    actionsTd.appendChild(renameBtn);
    actionsTd.appendChild(deleteBtn);
    tr.appendChild(actionsTd);

    chequingAccountsListBodyEl.appendChild(tr);
  });

  chequingAccountsListBodyEl.querySelectorAll(".chequing-account-rename-btn").forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      openChequingAccountRenameModal(String(buttonEl.dataset.accountLabel || ""));
    });
  });

  chequingAccountsListBodyEl.querySelectorAll(".chequing-account-delete-btn").forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      openChequingAccountDeleteConfirmModal(String(buttonEl.dataset.accountLabel || ""));
    });
  });
}

async function createChequingAccount(label, provider) {
  await fetchJson("/api/chequing/accounts/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, provider }),
  });
}

async function renameChequingAccount(oldLabel, newLabel) {
  await fetchJson(`/api/chequing/accounts/${encodeURIComponent(oldLabel)}/rename`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_label: newLabel }),
  });
}

async function deleteChequingAccount(label) {
  await fetchJson(`/api/chequing/accounts/${encodeURIComponent(label)}`, {
    method: "DELETE",
  });
}

function openChequingSettingsMenu() {
  if (!chequingSettingsSectionEl || !chequingSettingsToggleBtnEl) {
    return;
  }

  ensureOverlayElementsAtBody?.(chequingSettingsBackdropEl, chequingSettingsSectionEl);
  chequingSettingsSectionEl.classList.remove("hidden");
  chequingSettingsSectionEl.setAttribute("aria-hidden", "false");
  chequingSettingsToggleBtnEl.setAttribute("aria-expanded", "true");

  if (chequingSettingsBackdropEl) {
    chequingSettingsBackdropEl.classList.remove("hidden");
    chequingSettingsBackdropEl.setAttribute("aria-hidden", "false");
  }

  refreshChequingAccountsList();
}

function closeChequingSettingsMenu() {
  if (!chequingSettingsSectionEl || !chequingSettingsToggleBtnEl) {
    return;
  }

  chequingSettingsSectionEl.classList.add("hidden");
  chequingSettingsSectionEl.setAttribute("aria-hidden", "true");
  chequingSettingsToggleBtnEl.setAttribute("aria-expanded", "false");

  if (chequingSettingsBackdropEl) {
    chequingSettingsBackdropEl.classList.add("hidden");
    chequingSettingsBackdropEl.setAttribute("aria-hidden", "true");
  }
}

function openChequingAccountRenameModal(accountLabel) {
  if (!chequingAccountRenameModalEl) {
    return;
  }

  ensureOverlayElementsAtBody?.(chequingDialogBackdropEl, chequingAccountRenameModalEl);
  renamingAccountLabel = accountLabel;
  chequingAccountRenameOldLabelEl.value = accountLabel;
  chequingAccountRenameNewLabelEl.value = "";
  if (chequingDialogBackdropEl) {
    chequingDialogBackdropEl.classList.remove("hidden");
    chequingDialogBackdropEl.setAttribute("aria-hidden", "false");
  }
  chequingAccountRenameModalEl.classList.remove("hidden");
  chequingAccountRenameModalEl.setAttribute("aria-hidden", "false");
  chequingAccountRenameNewLabelEl.focus();
}

function closeChequingAccountRenameModal() {
  if (!chequingAccountRenameModalEl) {
    return;
  }

  chequingAccountRenameModalEl.classList.add("hidden");
  chequingAccountRenameModalEl.setAttribute("aria-hidden", "true");
  chequingAccountRenameOldLabelEl.value = "";
  chequingAccountRenameNewLabelEl.value = "";
  renamingAccountLabel = null;
  if (chequingDialogBackdropEl && (chequingAccountDeleteConfirmModalEl?.classList.contains("hidden") ?? true)) {
    chequingDialogBackdropEl.classList.add("hidden");
    chequingDialogBackdropEl.setAttribute("aria-hidden", "true");
  }
}

function updateChequingDeleteConfirmButtonState() {
  if (!chequingAccountDeleteConfirmInputEl || !chequingAccountDeleteConfirmBtnEl || !deletingAccountLabel) {
    chequingAccountDeleteConfirmBtnEl.disabled = true;
    if (chequingAccountDeleteConfirmErrorEl) {
      chequingAccountDeleteConfirmErrorEl.textContent = "";
      chequingAccountDeleteConfirmErrorEl.classList.add("hidden");
    }
    return;
  }
  chequingAccountDeleteConfirmBtnEl.disabled = false;
}

function openChequingAccountDeleteConfirmModal(accountLabel) {
  if (!chequingAccountDeleteConfirmModalEl) {
    return;
  }

  ensureOverlayElementsAtBody?.(chequingDialogBackdropEl, chequingAccountDeleteConfirmModalEl);
  deletingAccountLabel = accountLabel;
  chequingAccountDeleteLabelDisplayEl.textContent = accountLabel;
  chequingAccountDeleteConfirmInputEl.value = "";
  if (chequingAccountDeleteConfirmErrorEl) {
    chequingAccountDeleteConfirmErrorEl.textContent = "";
    chequingAccountDeleteConfirmErrorEl.classList.add("hidden");
  }
  if (chequingDialogBackdropEl) {
    chequingDialogBackdropEl.classList.remove("hidden");
    chequingDialogBackdropEl.setAttribute("aria-hidden", "false");
  }
  chequingAccountDeleteConfirmModalEl.classList.remove("hidden");
  chequingAccountDeleteConfirmModalEl.setAttribute("aria-hidden", "false");
  updateChequingDeleteConfirmButtonState();
  chequingAccountDeleteConfirmInputEl.focus();
}

function closeChequingAccountDeleteConfirmModal() {
  if (!chequingAccountDeleteConfirmModalEl) {
    return;
  }

  chequingAccountDeleteConfirmModalEl.classList.add("hidden");
  chequingAccountDeleteConfirmModalEl.setAttribute("aria-hidden", "true");
  chequingAccountDeleteLabelDisplayEl.textContent = "";
  chequingAccountDeleteConfirmInputEl.value = "";
  deletingAccountLabel = null;
  updateChequingDeleteConfirmButtonState();
  if (chequingDialogBackdropEl && (chequingAccountRenameModalEl?.classList.contains("hidden") ?? true)) {
    chequingDialogBackdropEl.classList.add("hidden");
    chequingDialogBackdropEl.setAttribute("aria-hidden", "true");
  }
}

async function deleteTransaction(id) {
  await fetchJson(`/api/chequing/transactions/${id}`, { method: "DELETE" });
}

async function deleteSelectedTransactions() {
  const ids = Array.from(selectedTransactionIds);
  if (!ids.length) {
    setStatus("Select at least one transaction first.");
    return;
  }

  const confirmed = window.confirm(`Delete ${ids.length} selected transaction(s)?`);
  if (!confirmed) {
    return;
  }

  await fetchJson("/api/chequing/transactions/delete-many", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

  selectedTransactionIds.clear();
  selectAllTxEl.checked = false;
  await refreshChequingAccountsList();
  await loadAccounts();
  await loadCategories();
  await refreshAll();
  setStatus(`Deleted ${ids.length} transaction(s).`);
}

async function setManyHidden(ids, hidden) {
  await fetchJson("/api/chequing/transactions/hide-many", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, hidden }),
  });
}

async function setTransactionHidden(id, hidden) {
  await fetchJson(`/api/chequing/transactions/${id}/hidden`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hidden }),
  });
}

async function hideSelectedTransactions() {
  const ids = Array.from(selectedTransactionIds);
  if (!ids.length) {
    setStatus("Select at least one transaction first.");
    return;
  }

  await setManyHidden(ids, true);
  selectedTransactionIds.clear();
  selectAllTxEl.checked = false;
  await loadAccounts();
  await loadCategories();
  await refreshAll();
  setStatus(`Hidden ${ids.length} transaction(s).`);
}

async function deleteAllTransactions() {
  const confirmed = window.confirm("Delete all chequing transactions in the current filters? This cannot be undone.");
  if (!confirmed) {
    return;
  }

  const params = buildQueryFromFilters();
  await fetchJson(`/api/chequing/transactions?${params.toString()}`, { method: "DELETE" });
  selectedTransactionIds.clear();
  selectAllTxEl.checked = false;
  await refreshChequingAccountsList();
  await loadAccounts();
  await loadCategories();
  await refreshAll();
  setStatus("Deleted chequing transactions.");
}

async function recategorizeChequingTransactions() {
  const response = await fetchJson("/api/chequing/transactions/recategorize", {
    method: "POST",
  });
  return {
    scanned: Number(response?.scanned || 0),
    updated: Number(response?.updated || 0),
  };
}

filtersForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await loadAccounts();
    await loadCategories();
    await refreshAll();
    setStatus("Filters applied.");
  } catch (err) {
    setErrorStatus(err.message);
  }
});

const quickDateControls = setupQuickDateButtons?.({
  container: quickDateButtonsEl,
  startInput: filterStartDateEl,
  endInput: filterEndDateEl,
  onApply: async () => {
    try {
      await loadAccounts();
      await loadCategories();
      await refreshAll();
      setStatus("Quick date filter applied.");
    } catch (err) {
      setErrorStatus(err.message);
    }
  },
});

resetFiltersBtn?.addEventListener("click", async () => {
  if (filterStartDateEl) filterStartDateEl.value = "";
  if (filterEndDateEl) filterEndDateEl.value = "";
  quickDateControls?.clearActive?.();
  if (filterAccountLabelEl) filterAccountLabelEl.value = "";
  if (filterCategoryEl) filterCategoryEl.value = "";
  if (filterDirectionEl) filterDirectionEl.value = "";
  if (filterSearchEl) filterSearchEl.value = "";
  if (filterIncludeHiddenEl) filterIncludeHiddenEl.value = "false";

  try {
    await loadAccounts();
    await loadCategories();
    await refreshAll();
    setStatus("Filters reset.");
  } catch (err) {
    setErrorStatus(err.message);
  }
});

selectAllTxEl?.addEventListener("change", () => {
  const checked = Boolean(selectAllTxEl.checked);
  document.querySelectorAll(".tx-select").forEach((checkboxEl) => {
    if (!(checkboxEl instanceof HTMLInputElement)) {
      return;
    }
    checkboxEl.checked = checked;
    const id = Number(checkboxEl.dataset.id || 0);
    if (checked) {
      selectedTransactionIds.add(id);
    } else {
      selectedTransactionIds.delete(id);
    }
  });
  updateSelectionStatus();
});

transactionsBody?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.classList.contains("tx-select")) {
    return;
  }
  const id = Number(target.dataset.id || 0);
  if (target.checked) {
    selectedTransactionIds.add(id);
  } else {
    selectedTransactionIds.delete(id);
  }
  updateSelectionStatus();
});

transactionsBody?.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.classList.contains("tx-hide-btn")) {
    const id = Number(target.dataset.id || 0);
    const currentlyHidden = String(target.dataset.hidden || "false") === "true";
    try {
      await setTransactionHidden(id, !currentlyHidden);
      await loadAccounts();
      await loadCategories();
      await refreshAll();
      setStatus(currentlyHidden ? "Transaction unhidden." : "Transaction hidden.");
    } catch (err) {
      setErrorStatus(err.message);
    }
    return;
  }

  if (!target.classList.contains("tx-delete-btn")) {
    return;
  }

  const id = Number(target.dataset.id || 0);
  const confirmed = window.confirm("Delete this transaction?");
  if (!confirmed) {
    return;
  }

  try {
    await deleteTransaction(id);
    selectedTransactionIds.delete(id);
    await refreshChequingAccountsList();
    await loadAccounts();
    await refreshAll();
    setStatus("Transaction deleted.");
  } catch (err) {
    setErrorStatus(err.message);
  }
});

if (transactionsTableHead) {
  transactionsTableHead.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTableCellElement)) {
      return;
    }

    const sortKey = target.dataset.sortKey;
    if (!sortKey) {
      return;
    }

    if (currentSort.key === sortKey) {
      currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      currentSort.key = sortKey;
      currentSort.direction = sortKey === "amount" || sortKey === "balance" ? "desc" : "asc";
    }

    renderTransactions(loadedTransactions);
  });
}

deleteSelectedBtn?.addEventListener("click", async () => {
  try {
    await deleteSelectedTransactions();
  } catch (err) {
    setErrorStatus(err.message);
  }
});

hideSelectedBtn?.addEventListener("click", async () => {
  try {
    await hideSelectedTransactions();
  } catch (err) {
    setErrorStatus(err.message);
  }
});

deleteAllBtn?.addEventListener("click", async () => {
  try {
    await deleteAllTransactions();
  } catch (err) {
    setErrorStatus(err.message);
  }
});

if (chequingSettingsToggleBtnEl) {
  chequingSettingsToggleBtnEl.addEventListener("click", openChequingSettingsMenu);
}

if (chequingSettingsBackdropEl) {
  chequingSettingsBackdropEl.addEventListener("click", closeChequingSettingsMenu);
}

if (chequingDialogBackdropEl) {
  chequingDialogBackdropEl.addEventListener("click", () => {
    if (chequingAccountDeleteConfirmModalEl && !chequingAccountDeleteConfirmModalEl.classList.contains("hidden")) {
      closeChequingAccountDeleteConfirmModal();
      return;
    }
    if (chequingAccountRenameModalEl && !chequingAccountRenameModalEl.classList.contains("hidden")) {
      closeChequingAccountRenameModal();
    }
  });
}

if (chequingAccountAddFormEl) {
  chequingAccountAddFormEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const label = String(chequingAccountAddLabelInputEl?.value || "").trim();
      if (!label) {
        setErrorStatus("Account label cannot be empty.");
        return;
      }
      if (chequingAccountsList.includes(label)) {
        setErrorStatus("An account with this label already exists.");
        return;
      }

      const provider = String(chequingAccountAddProviderSelectEl?.value || "wealthsimple").trim().toLowerCase();

      await createChequingAccount(label, provider);
      if (chequingAccountAddLabelInputEl) {
        chequingAccountAddLabelInputEl.value = "";
      }
      await refreshChequingAccountsList();
      await loadAccounts();
      setStatus(`Account "${label}" added.`);
    } catch (err) {
      setErrorStatus(err.message);
    }
  });
}

if (chequingAccountRenameCancelBtnEl) {
  chequingAccountRenameCancelBtnEl.addEventListener("click", closeChequingAccountRenameModal);
}

if (chequingAccountRenameFormEl) {
  chequingAccountRenameFormEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (!renamingAccountLabel) {
        return;
      }

      const newLabel = String(chequingAccountRenameNewLabelEl?.value || "").trim();
      if (!newLabel) {
        setErrorStatus("New account label cannot be empty.");
        return;
      }
      if (newLabel === renamingAccountLabel) {
        closeChequingAccountRenameModal();
        return;
      }
      if (chequingAccountsList.includes(newLabel)) {
        setErrorStatus("An account with this label already exists.");
        return;
      }

      const oldLabel = renamingAccountLabel;
      await renameChequingAccount(oldLabel, newLabel);
      closeChequingAccountRenameModal();
      await refreshChequingAccountsList();
      await loadAccounts();
      await refreshAll();
      setStatus(`Account renamed from "${oldLabel}" to "${newLabel}".`);
    } catch (err) {
      setErrorStatus(err.message);
    }
  });
}

if (chequingAccountDeleteCancelBtnEl) {
  chequingAccountDeleteCancelBtnEl.addEventListener("click", closeChequingAccountDeleteConfirmModal);
}

if (chequingAccountDeleteConfirmInputEl) {
  chequingAccountDeleteConfirmInputEl.addEventListener("input", () => {
    if (chequingAccountDeleteConfirmErrorEl && !chequingAccountDeleteConfirmErrorEl.classList.contains("hidden")) {
      chequingAccountDeleteConfirmErrorEl.textContent = "";
      chequingAccountDeleteConfirmErrorEl.classList.add("hidden");
    }
    updateChequingDeleteConfirmButtonState();
  });
  chequingAccountDeleteConfirmInputEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (!chequingAccountDeleteConfirmBtnEl?.disabled) {
      chequingAccountDeleteConfirmBtnEl.click();
    }
  });
}

if (chequingAccountDeleteConfirmBtnEl) {
  chequingAccountDeleteConfirmBtnEl.addEventListener("click", async () => {
    try {
      if (!deletingAccountLabel) {
        return;
      }

      const typedLabel = String(chequingAccountDeleteConfirmInputEl?.value || "").trim();
      if (typedLabel !== deletingAccountLabel) {
        if (chequingAccountDeleteConfirmErrorEl) {
          chequingAccountDeleteConfirmErrorEl.textContent = `Account label does not match. Type "${deletingAccountLabel}" exactly.`;
          chequingAccountDeleteConfirmErrorEl.classList.remove("hidden");
        }
        return;
      }

      if (chequingAccountDeleteConfirmErrorEl) {
        chequingAccountDeleteConfirmErrorEl.textContent = "";
        chequingAccountDeleteConfirmErrorEl.classList.add("hidden");
      }

      const label = deletingAccountLabel;
      await deleteChequingAccount(label);
      closeChequingAccountDeleteConfirmModal();
      await refreshChequingAccountsList();
      await loadAccounts();
      await loadCategories();
      await refreshAll();
      setStatus(`Account "${label}" and its transactions deleted.`);
    } catch (err) {
      setErrorStatus(err.message);
    }
  });
}

if (chequingRecategorizeBtnEl) {
  chequingRecategorizeBtnEl.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Rebuild categories for existing chequing transactions using current mapping rules?"
    );
    if (!confirmed) {
      return;
    }

    const previousDisabled = chequingRecategorizeBtnEl.disabled;
    chequingRecategorizeBtnEl.disabled = true;
    try {
      const result = await recategorizeChequingTransactions();
      await loadCategories();
      await refreshAll();
      setStatus(`Recategorized ${result.updated} of ${result.scanned} chequing transaction(s).`);
    } catch (err) {
      setErrorStatus(err.message);
    } finally {
      chequingRecategorizeBtnEl.disabled = previousDisabled;
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (chequingAccountDeleteConfirmModalEl && !chequingAccountDeleteConfirmModalEl.classList.contains("hidden")) {
    closeChequingAccountDeleteConfirmModal();
    return;
  }

  if (chequingAccountRenameModalEl && !chequingAccountRenameModalEl.classList.contains("hidden")) {
    closeChequingAccountRenameModal();
    return;
  }

  if (chequingSettingsSectionEl && !chequingSettingsSectionEl.classList.contains("hidden")) {
    closeChequingSettingsMenu();
  }
});

(async function init() {
  try {
    applyPageEnterMotion?.({ selector: ".page-header, .card", maxItems: 10, staggerMs: 20 });
    common.setLoadingState?.(document.body, true, "Loading chequing tracker…");
    await Promise.all([loadAccounts(), loadCategories(), refreshChequingAccountsList()]);
    await refreshAll();
    setStatus("Ready.");
  } catch (err) {
    setErrorStatus(err.message);
  } finally {
    common.setLoadingState?.(document.body, false);
  }
})();
