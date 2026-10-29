export const QUICK_DATE_RANGES = [
  { id: "all", label: "All Time" },
  { id: "7d", label: "Last 7 Days" },
  { id: "30d", label: "Last 30 Days" },
  { id: "90d", label: "Last 90 Days" },
  { id: "ytd", label: "YTD" },
  { id: "12m", label: "Last 12 Months" },
];

export function computeQuickDateRange(rangeId) {
  if (!rangeId || rangeId === "all") {
    return { startDate: "", endDate: "" };
  }

  const now = new Date();
  const formatYmd = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const endDate = formatYmd(now);
  let startDate = "";

  if (rangeId === "7d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    startDate = formatYmd(d);
  } else if (rangeId === "30d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    startDate = formatYmd(d);
  } else if (rangeId === "90d") {
    const d = new Date(now);
    d.setDate(d.getDate() - 89);
    startDate = formatYmd(d);
  } else if (rangeId === "ytd") {
    startDate = `${now.getFullYear()}-01-01`;
  } else if (rangeId === "12m") {
    const d = new Date(now);
    d.setFullYear(d.getFullYear() - 1);
    startDate = formatYmd(d);
  }

  return { startDate, endDate };
}

