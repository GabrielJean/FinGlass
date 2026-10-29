import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

// Register all required Chart.js modules
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// Clean StockBot / FinGlass dark theme defaults
ChartJS.defaults.font.family = "'Manrope', system-ui, -apple-system, sans-serif";
ChartJS.defaults.font.size = 12;
ChartJS.defaults.color = "#9bb2d1";
ChartJS.defaults.borderColor = "rgba(39, 64, 99, 0.4)";

export const CHART_PALETTE = [
  "#38bdf8", // Sky / Cyan
  "#34d399", // Emerald
  "#a78bfa", // Purple
  "#fbbf24", // Amber
  "#f87171", // Coral / Red
  "#60a5fa", // Blue
  "#2dd4bf", // Teal
  "#f472b6", // Pink
  "#fb923c", // Orange
  "#818cf8", // Indigo
  "#a3e635", // Lime
  "#e879f9", // Fuchsia
];

export function getPaletteColor(index) {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}

export function formatCompactMoney(value) {
  const num = Number(value || 0);
  if (Math.abs(num) >= 1000000) {
    return `$${(num / 1000000).toFixed(1)}M`;
  }
  if (Math.abs(num) >= 1000) {
    return `$${(num / 1000).toFixed(1)}k`;
  }
  return `$${num.toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export const commonTooltipOptions = {
  backgroundColor: "#0c1728",
  borderColor: "#274063",
  borderWidth: 1,
  titleColor: "#f0f6fc",
  titleFont: {
    weight: "700",
    size: 13,
  },
  bodyColor: "#cbd5e1",
  bodyFont: {
    size: 12,
  },
  padding: 10,
  cornerRadius: 8,
  boxPadding: 4,
  usePointStyle: true,
};

export const commonScaleOptions = {
  grid: {
    color: "rgba(255, 255, 255, 0.05)",
    tickColor: "transparent",
  },
  ticks: {
    color: "#7e9ec2",
    font: {
      size: 11,
    },
  },
  border: {
    color: "rgba(39, 64, 99, 0.5)",
  },
};
