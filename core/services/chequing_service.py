from core.services.settings_service import parse_setting_bool


OUTFLOW_CODES = {
    "E_TRFOUT",
    "AFT_OUT",
    "TRFOUT",
    "TRFOUTTF",
    "P2P_SENT",
    "OBP_OUT",
    "INTERNAL_TRANSFER_SOURCE",
}
INFLOW_CODES = {
    "AFT_IN",
    "E_TRFIN",
    "P2P_RECEIVED",
    "INT",
    "TRFINTF",
    "TRFIN",
    "INTERNAL_TRANSFER_DESTINATION",
    "OVERDRAFT_TRANSFER_DESTINATION",
}


def parse_bool_query(value):
    return parse_setting_bool(value)


def normalize_chequing_category(transaction_code=None, description=None, amount=0, tx_type=None, sub_type=None):
    """
    Normalizes chequing transactions into standardized FinGlass categories based on:
    - Wealthsimple activity transaction_type and transaction_sub_type
    - Standard transaction codes (e.g., TRFOUT, AFT_IN, E_TRFIN)
    - Description hints
    - Amount direction

    Categories are strictly from the chequing account point of view:
    - 'Saving Money': money leaves chequing and goes to savings/investments.
    - 'Drawing from Savings': money enters chequing and comes from savings/investments.
    """
    code = str(transaction_code or "").strip().upper()
    t = str(tx_type or "").strip().lower()
    st = str(sub_type or "").strip().lower()
    desc = str(description or "").strip().lower()
    numeric_amount = float(amount or 0)

    # 1. Wealthsimple custom activity type & sub-type mapping
    if t == "internal transfer":
        return "Saving Money" if st == "source" or numeric_amount < 0 else "Drawing from Savings"
    if t == "overdraft transfer":
        return "Drawing from Savings"
    if t == "interest" or "interest" in code:
        return "Interest Earned"
    if t == "credit card payment":
        return "Pre-Authorized Debit"
    if t == "spend" or code in {"SPEND", "PREPAID"}:
        return "Debit Card Purchase"
    if t in {"promotion", "reimbursement"}:
        return "Other Inflow"
    if t in {"p 2 p payment", "p2p payment", "p2p"}:
        return "Cash Received (People)" if "receive" in st or numeric_amount > 0 else "Cash Sent (People)"
    if t == "withdrawal":
        if "e transfer" in st or "etransfer" in st:
            return "Cash Sent (People)"
        if "bill pay" in st or "bill_pay" in st:
            return "Online Bill Payments"
        if st in {"aft", "eft"}:
            return "Pre-Authorized Debit"
        return "Other Outflow"
    if t == "deposit":
        if "e transfer" in st or "etransfer" in st:
            return "Cash Received (People)"
        if st in {"aft", "cheque"}:
            return "Direct Deposit"
        return "Other Inflow"

    # 2. Transaction code mapping
    if code in {"SPEND", "PREPAID"}:
        return "Debit Card Purchase"
    if code in {"INT", "INTEREST"}:
        return "Interest Earned"
    if code in {"AFT_IN", "DIRECT_DEPOSIT"}:
        return "Direct Deposit"
    if code in {"AFT_OUT", "EFT_OUT", "CREDIT_CARD_PAYMENT"}:
        return "Pre-Authorized Debit"
    if code in {"E_TRFIN", "P2P_RECEIVED"}:
        return "Cash Received (People)"
    if code in {"E_TRFOUT", "P2P_SENT"}:
        return "Cash Sent (People)"
    if code in {"OBP_OUT", "BILL_PAY"}:
        return "Online Bill Payments"
    if code in {"TRFOUT", "TRFOUTTF", "INTERNAL_TRANSFER_SOURCE"}:
        return "Saving Money"
    if code in {"TRFINTF", "TRFIN", "INTERNAL_TRANSFER_DESTINATION", "OVERDRAFT_TRANSFER_DESTINATION"}:
        return "Drawing from Savings"
    if code in {"PROMOTION", "REIMBURSEMENT"}:
        return "Other Inflow"

    # 3. Description keyword fallback
    if "interac e-transfer" in desc or "e-transfer" in desc:
        return "Cash Received (People)" if numeric_amount > 0 else "Cash Sent (People)"
    if "interest" in desc and numeric_amount > 0:
        return "Interest Earned"
    if "payroll" in desc or "direct dep" in desc:
        return "Direct Deposit"

    # 4. Fallback based on sign of amount
    if numeric_amount > 0:
        return "Other Inflow"
    if numeric_amount < 0:
        return "Other Outflow"
    return "Other"
