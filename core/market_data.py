import json
import logging
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

YAHOO_BASES = (
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
)
ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query"
DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "market_data.json"
SYMBOL_SUFFIXES = (".TO", ".TRT", ".V", ".NE")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


class MarketDataError(Exception):
    pass


def _canonical_symbol(symbol):
    raw = str(symbol or "").strip().upper()
    if not raw:
        return ""
    for suffix in SYMBOL_SUFFIXES:
        if raw.endswith(suffix) and len(raw) > len(suffix):
            return raw[: -len(suffix)]
    return raw


def _candidate_symbols(symbol):
    raw = str(symbol or "").strip().upper()
    canonical = _canonical_symbol(raw)
    candidates = []

    for value in (raw, canonical):
        if value and value not in candidates:
            candidates.append(value)

    if canonical:
        for suffix in SYMBOL_SUFFIXES:
            candidate = f"{canonical}{suffix}"
            if candidate not in candidates:
                candidates.append(candidate)

    return candidates


def _fetch_yahoo_quote(candidate):
    """
    Fetches real-time quote data from Yahoo Finance without requiring authentication.
    """
    headers = {"User-Agent": USER_AGENT}

    for base in YAHOO_BASES:
        url = f"{base}/v8/finance/chart/{candidate}"
        try:
            req = Request(url, headers=headers)
            with urlopen(req, timeout=6) as response:
                if response.status != 200:
                    continue
                payload = json.loads(response.read().decode("utf-8"))

            result = payload.get("chart", {}).get("result")
            if not result or not isinstance(result, list):
                continue

            meta = result[0].get("meta", {})
            price = meta.get("regularMarketPrice")
            if price is None or float(price) <= 0:
                price = meta.get("chartPreviousClose")
            if price is None or float(price) <= 0:
                price = meta.get("previousClose")

            if price is not None and float(price) > 0:
                change_pct = meta.get("regularMarketChangePercent")
                if change_pct is None:
                    change_pct = meta.get("fulldayChangePercent")

                return {
                    "symbol": candidate,
                    "price": round(float(price), 4),
                    "currency": str(meta.get("currency") or "CAD").upper(),
                    "name": meta.get("shortName") or meta.get("longName") or candidate,
                    "change_pct": round(float(change_pct), 2) if change_pct is not None else None,
                }
        except Exception as exc:
            logger.debug("Yahoo Finance lookup failed for %s on %s: %s", candidate, base, exc)
            continue

    return None


def _get_optional_alpha_vantage_key():
    """
    Returns an Alpha Vantage key if configured, otherwise returns None without error.
    """
    env_key = str(os.environ.get("ALPHA_VANTAGE_API_KEY") or "").strip()
    if env_key:
        return env_key

    config_path = Path(os.environ.get("MARKET_DATA_CONFIG_PATH") or DEFAULT_CONFIG_PATH)
    if config_path.is_file():
        try:
            payload = json.loads(config_path.read_text(encoding="utf-8"))
            file_key = str(payload.get("alpha_vantage_api_key") or "").strip()
            if file_key:
                return file_key
        except Exception:
            pass

    return None


def _fetch_alpha_vantage_quote(candidate, api_key):
    """
    Optional fallback to Alpha Vantage if a key is provided.
    """
    params = {"function": "GLOBAL_QUOTE", "symbol": candidate, "apikey": api_key}
    query = urlencode(params)
    url = f"{ALPHA_VANTAGE_BASE_URL}?{query}"

    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))

        row = payload.get("Global Quote") or {}
        price_raw = row.get("05. price")
        if price_raw is not None and float(price_raw) > 0:
            return {
                "symbol": candidate,
                "price": round(float(price_raw), 4),
                "currency": "USD" if not candidate.endswith(".TO") else "CAD",
                "name": candidate,
                "change_pct": None,
            }
    except Exception:
        pass

    return None


def get_quote(symbol):
    """
    Retrieves real-time market price for a stock/ETF ticker symbol.
    Uses free, zero-authentication market data feeds out of the box with
    automatic suffix resolution for Canadian and US listings.
    """
    normalized = _canonical_symbol(symbol)
    if not normalized:
        raise MarketDataError("symbol is required")

    candidates = _candidate_symbols(symbol)

    # 1. Primary: Free, no-auth market data feed
    for candidate in candidates:
        quote = _fetch_yahoo_quote(candidate)
        if quote:
            return quote

    # 2. Secondary: Optional Alpha Vantage fallback if configured
    av_key = _get_optional_alpha_vantage_key()
    if av_key:
        for candidate in candidates:
            quote = _fetch_alpha_vantage_quote(candidate, av_key)
            if quote:
                return quote

    raise MarketDataError(f"No quote returned for {normalized}")
