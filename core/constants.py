CASH_ACCOUNT_NUMBER = "__CASH__"
HOLDINGS_SYMBOL_SUFFIXES = (".TO", ".TRT", ".V", ".NE")

DEFAULT_FEATURE_SETTINGS = {
    "imports": True,
    "holdings_overview": True,
    "acb_tracker": True,
    "net_worth": True,
    "credit_card": True,
    "chequing_tracker": True,
    "tfsa_tracker": True,
    "rrsp_tracker": True,
    "fhsa_tracker": True,
    "retirement_planner": True,
}

SUPPORTED_TRANSACTION_TYPES = {
    "Buy",
    "Sell",
    "Return of Capital",
    "Capital Gains Dividend",
    "Reinvested Dividend",
    "Reinvested Capital Gains Distribution",
    "Split",
}

SUPPORTED_IMPORT_BROKER = "Wealthsimple"
SUPPORTED_IMPORT_BROKERS = {
    "wealthsimple": "Wealthsimple",
}

CHEQUING_DEFAULT_PROVIDER = "WealthSimple"
CHEQUING_SUPPORTED_PROVIDERS = {
    "wealthsimple": "WealthSimple",
}
