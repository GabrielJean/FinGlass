from core.services.settings_service import parse_setting_bool


OUTFLOW_CODES = {"E_TRFOUT", "AFT_OUT", "TRFOUT", "TRFOUTTF", "P2P_SENT", "OBP_OUT"}
INFLOW_CODES = {"AFT_IN", "E_TRFIN", "P2P_RECEIVED", "INT", "TRFINTF", "TRFIN"}


def parse_bool_query(value):
    return parse_setting_bool(value)


def normalize_chequing_category(transaction_code, description, amount):
    # Categories are always from the chequing account point of view:
    # - TRFOUT/TRFOUTTF: money leaves chequing and goes to savings/investing.
    # - TRFIN/TRFINTF: money enters chequing and comes from savings/investing.
    code = str(transaction_code or "").strip().upper()
    numeric_amount = float(amount or 0)

    if code == "SPEND":
        return "Debit Card Purchase"
    if code == "INT":
        return "Interest Earned"
    if code == "AFT_IN":
        return "Direct Deposit"
    if code == "AFT_OUT":
        return "Pre-Authorized Debit"
    if code in {"E_TRFIN", "P2P_RECEIVED"}:
        return "Cash Received (People)"
    if code in {"E_TRFOUT", "P2P_SENT"}:
        return "Cash Sent (People)"
    if code == "OBP_OUT":
        return "Online Bill Payments"
    if code in {"TRFOUT", "TRFOUTTF"}:
        return "Transfer To Savings/Investments"
    if code in {"TRFINTF", "TRFIN"}:
        return "Transfer From Savings/Investments"

    if numeric_amount > 0:
        return "Other Inflow"
    if numeric_amount < 0:
        return "Other Outflow"
    return "Other"
