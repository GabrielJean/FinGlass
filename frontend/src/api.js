function getCookie(name) {
  if (typeof document === "undefined" || !document.cookie) return "";
  const cookieName = `${name}=`;
  const entries = document.cookie.split(";");
  for (let entry of entries) {
    const trimmed = entry.trim();
    if (trimmed.startsWith(cookieName)) {
      return decodeURIComponent(trimmed.slice(cookieName.length));
    }
  }
  return "";
}

let cachedCsrfToken = "";

export function setCsrfToken(token) {
  cachedCsrfToken = token;
}

export function getCsrfToken() {
  return cachedCsrfToken || getCookie("csrf_token") || getCookie("csrftoken");
}

export async function request(path, options = {}) {
  const url = path.startsWith("http") || path.startsWith("/") ? path : `/${path}`;
  const headers = {
    ...(options.headers || {}),
  };

  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const token = getCsrfToken();
    if (token) {
      headers["X-CSRF-TOKEN"] = token;
      headers["X-CSRFToken"] = token;
    }
  }

  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  let body = null;
  if (isJson) {
    body = await response.json();
  } else {
    const text = await response.text();
    body = { text, error: !response.ok ? (text || "Unexpected server error") : undefined };
  }

  if (!response.ok) {
    const errorMsg = body?.error || body?.detail || body?.message || `Request failed with status ${response.status}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = body;
    throw error;
  }

  return body;
}

// ----------------- Auth API -----------------
export const api = {
  auth: {
    checkSetup: () => request("/api/auth/check-setup"),
    setupSuperuser: (username, password) =>
      request("/api/auth/setup-superuser", { method: "POST", body: { username, password } }),
    login: (username, password) =>
      request("/api/auth/login", { method: "POST", body: { username, password } }),
    register: (username, password) =>
      request("/api/auth/register", { method: "POST", body: { username, password } }),
    logout: () => request("/api/auth/logout", { method: "POST" }),
    me: () => request("/api/auth/me"),
    changePassword: (current_password, new_password) =>
      request("/api/auth/change-password", {
        method: "POST",
        body: { current_password, new_password },
      }),
  },

  admin: {
    getUsers: () => request("/api/auth/admin/users"),
    setUserPassword: (userId, password) =>
      request(`/api/auth/admin/users/${userId}/password`, {
        method: "POST",
        body: { new_password: password, password },
      }),
    setUserSuperuser: (userId, is_superuser) =>
      request(`/api/auth/admin/users/${userId}/superuser`, {
        method: "POST",
        body: { is_superuser },
      }),
    setUserActive: (userId, is_active) =>
      request(`/api/auth/admin/users/${userId}/active`, {
        method: "POST",
        body: { is_active },
      }),
    deleteUser: (userId, confirm_username) =>
      request(`/api/auth/admin/users/${userId}`, {
        method: "DELETE",
        body: { confirm_username },
      }),
    getAuditLogs: (limit = 100) => request(`/api/auth/admin/audit-logs?limit=${limit}`),
  },

  settings: {
    getFeatures: () => request("/api/settings/features"),
    updateFeatures: (features) =>
      request("/api/settings/features", { method: "PUT", body: { features } }),
  },

  holdings: {
    getDashboard: () => request("/api/accounts/dashboard"),
    list: (params = "") => request(`/api/holdings${params ? `?${params}` : ""}`),
    create: (data) => request("/api/holdings", { method: "POST", body: data }),
    update: (id, data) => request(`/api/holdings/${id}`, { method: "PUT", body: data }),
    delete: (id) => request(`/api/holdings/${id}`, { method: "DELETE" }),
    upsertCashAccount: (data) => request("/api/accounts/cash", { method: "PUT", body: data }),
    getQuote: (symbol) => request(`/api/market-data/quote?symbol=${encodeURIComponent(symbol)}`),
    refreshMarketValues: (as_of) =>
      request("/api/market-data/refresh-holdings", { method: "POST", body: { as_of } }),
  },

  chequing: {
    getDashboard: (params = "") => request(`/api/chequing/dashboard${params ? `?${params}` : ""}`),
    getAccounts: () => request("/api/chequing/accounts"),
    createAccount: (data) => request("/api/chequing/accounts/create", { method: "POST", body: data }),
    renameAccount: (label, new_label) =>
      request(`/api/chequing/accounts/${encodeURIComponent(label)}/rename`, { method: "POST", body: { label: new_label } }),
    deleteAccount: (label) => request(`/api/chequing/accounts/${encodeURIComponent(label)}`, { method: "DELETE" }),
    getCategories: () => request("/api/chequing/categories"),
    getTransactions: (params = "") =>
      request(`/api/chequing/transactions${params ? `?${params}` : ""}`),
    deleteTransaction: (id) => request(`/api/chequing/transactions/${id}`, { method: "DELETE" }),
    setHidden: (id, is_hidden) =>
      request(`/api/chequing/transactions/${id}/hidden`, { method: "POST", body: { is_hidden } }),
    hideMany: (transaction_ids, is_hidden) =>
      request("/api/chequing/transactions/hide-many", {
        method: "POST",
        body: { transaction_ids, is_hidden },
      }),
    recategorize: (transaction_ids, category) =>
      request("/api/chequing/transactions/recategorize", {
        method: "POST",
        body: { transaction_ids, category },
      }),
    deleteMany: (transaction_ids) =>
      request("/api/chequing/transactions/delete-many", {
        method: "POST",
        body: { transaction_ids },
      }),
    importCsv: (formData) =>
      request("/api/import/chequing-courant-csv", { method: "POST", body: formData }),
  },

  creditCard: {
    getDashboard: (params = "") =>
      request(`/api/credit-card/dashboard${params ? `?${params}` : ""}`),
    getCards: () => request("/api/credit-card/cards"),
    createCard: (data) => request("/api/credit-card/cards/create", { method: "POST", body: data }),
    renameCard: (label, new_label) =>
      request(`/api/credit-card/cards/${encodeURIComponent(label)}/rename`, { method: "POST", body: { label: new_label } }),
    deleteCard: (label) => request(`/api/credit-card/cards/${encodeURIComponent(label)}`, { method: "DELETE" }),
    getCategories: () => request("/api/credit-card/categories"),
    getTransactions: (params = "") =>
      request(`/api/credit-card/transactions${params ? `?${params}` : ""}`),
    deleteTransaction: (id) =>
      request(`/api/credit-card/transactions/${id}`, { method: "DELETE" }),
    setHidden: (id, is_hidden) =>
      request(`/api/credit-card/transactions/${id}/hidden`, {
        method: "POST",
        body: { is_hidden },
      }),
    hideMany: (transaction_ids, is_hidden) =>
      request("/api/credit-card/transactions/hide-many", {
        method: "POST",
        body: { transaction_ids, is_hidden },
      }),
    recategorize: (transaction_ids, merchant_category) =>
      request("/api/credit-card/transactions/recategorize", {
        method: "POST",
        body: { transaction_ids, merchant_category },
      }),
    deleteMany: (transaction_ids) =>
      request("/api/credit-card/transactions/delete-many", {
        method: "POST",
        body: { transaction_ids },
      }),
    importRogersCsv: (formData) =>
      request("/api/import/rogers-credit-csv", { method: "POST", body: formData }),
  },

  tfsa: {
    getSummary: () => request("/api/tfsa/summary"),
    getAccounts: () => request("/api/tfsa/accounts"),
    createAccount: (data) => request("/api/tfsa/accounts", { method: "POST", body: data }),
    deleteAccount: (id) => request(`/api/tfsa/accounts/${id}`, { method: "DELETE" }),
    getOpeningBalance: () => request("/api/tfsa/opening-balance"),
    setOpeningBalance: (amount, base_year) =>
      request("/api/tfsa/opening-balance", {
        method: "PUT",
        body: { opening_balance: amount, base_year },
      }),
    getAnnualLimits: () => request("/api/tfsa/annual-limits"),
    upsertAnnualLimit: (year, annual_limit) =>
      request(`/api/tfsa/annual-limits/${year}`, { method: "PUT", body: { annual_limit } }),
    deleteAnnualLimit: (year) =>
      request(`/api/tfsa/annual-limits/${year}`, { method: "DELETE" }),
    getTransactions: () => request("/api/tfsa/transactions"),
    createContribution: (data) =>
      request("/api/tfsa/contributions", { method: "POST", body: data }),
    createTransfer: (data) => request("/api/tfsa/transfers", { method: "POST", body: data }),
    deleteTransaction: (id) => request(`/api/tfsa/transactions/${id}`, { method: "DELETE" }),
    reset: () => request("/api/tfsa/reset", { method: "POST" }),
    importCsv: (formData) => request("/api/tfsa/import-csv", { method: "POST", body: formData }),
  },

  rrsp: {
    getSummary: () => request("/api/rrsp/summary"),
    getAccounts: () => request("/api/rrsp/accounts"),
    createAccount: (data) => request("/api/rrsp/accounts", { method: "POST", body: data }),
    deleteAccount: (id) => request(`/api/rrsp/accounts/${id}`, { method: "DELETE" }),
    getOpeningBalance: () => request("/api/rrsp/opening-balance"),
    setOpeningBalance: (amount, base_year) =>
      request("/api/rrsp/opening-balance", {
        method: "PUT",
        body: { opening_balance: amount, base_year },
      }),
    getAnnualLimits: () => request("/api/rrsp/annual-limits"),
    upsertAnnualLimit: (year, annual_limit) =>
      request(`/api/rrsp/annual-limits/${year}`, { method: "PUT", body: { annual_limit } }),
    deleteAnnualLimit: (year) =>
      request(`/api/rrsp/annual-limits/${year}`, { method: "DELETE" }),
    getTransactions: () => request("/api/rrsp/transactions"),
    createContribution: (data) =>
      request("/api/rrsp/contributions", { method: "POST", body: data }),
    createTransfer: (data) => request("/api/rrsp/transfers", { method: "POST", body: data }),
    deleteTransaction: (id) => request(`/api/rrsp/transactions/${id}`, { method: "DELETE" }),
    reset: () => request("/api/rrsp/reset", { method: "POST" }),
    importCsv: (formData) => request("/api/rrsp/import-csv", { method: "POST", body: formData }),
  },

  fhsa: {
    getSummary: () => request("/api/fhsa/summary"),
    getAccounts: () => request("/api/fhsa/accounts"),
    createAccount: (data) => request("/api/fhsa/accounts", { method: "POST", body: data }),
    deleteAccount: (id) => request(`/api/fhsa/accounts/${id}`, { method: "DELETE" }),
    getOpeningBalance: () => request("/api/fhsa/opening-balance"),
    setOpeningBalance: (amount, base_year) =>
      request("/api/fhsa/opening-balance", {
        method: "PUT",
        body: { opening_balance: amount, base_year },
      }),
    getTransactions: () => request("/api/fhsa/transactions"),
    createContribution: (data) =>
      request("/api/fhsa/contributions", { method: "POST", body: data }),
    createTransfer: (data) => request("/api/fhsa/transfers", { method: "POST", body: data }),
    deleteTransaction: (id) => request(`/api/fhsa/transactions/${id}`, { method: "DELETE" }),
    reset: () => request("/api/fhsa/reset", { method: "POST" }),
    importCsv: (formData) => request("/api/fhsa/import-csv", { method: "POST", body: formData }),
  },

  acb: {
    getSecurities: () => request("/api/securities"),
    getLedger: (security) =>
      request(`/api/ledger${security ? `?security=${encodeURIComponent(security)}` : ""}`),
    getTransactionTypes: () => request("/api/transaction-types"),
    getTransactions: (security) =>
      request(`/api/transactions${security ? `?security=${encodeURIComponent(security)}` : ""}`),
    createTransaction: (data) => request("/api/transactions", { method: "POST", body: data }),
    updateTransaction: (id, data) =>
      request(`/api/transactions/${id}`, { method: "PUT", body: data }),
    deleteTransaction: (id) => request(`/api/transactions/${id}`, { method: "DELETE" }),
    deleteMany: (transaction_ids) =>
      request("/api/transactions/delete-many", { method: "POST", body: { transaction_ids } }),
  },

  netWorth: {
    getHistory: () => request("/api/net-worth"),
    createEntry: (data) => request("/api/net-worth", { method: "POST", body: data }),
    deleteEntry: (id) => request(`/api/net-worth/${id}`, { method: "DELETE" }),
  },

  imports: {
    createReview: (formData) => request("/api/import/review", { method: "POST", body: formData }),
    getReview: (batchId) => request(`/api/import/review/${batchId}`),
    updateReviewRow: (rowId, data) =>
      request(`/api/import/review/rows/${rowId}`, { method: "PUT", body: data }),
    deleteReviewRow: (rowId) =>
      request(`/api/import/review/rows/${rowId}`, { method: "DELETE" }),
    commitReview: (batchId) =>
      request("/api/import/review/commit", { method: "POST", body: { batch_id: batchId } }),
    importHoldingsCsv: (formData) =>
      request("/api/import/holdings-csv", { method: "POST", body: formData }),
    importBackup: (formData) =>
      request("/api/import/backup", { method: "POST", body: formData }),
  },
};
