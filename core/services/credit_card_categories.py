import re
from collections import Counter, defaultdict
from functools import lru_cache

MAX_FALLBACK_WORDS = 4

HOTEL_KEYWORDS = {
    "hotel", "motel", "inn", "resort", "lodging",
    "hyatt", "marriott", "hilton", "sheraton", "westin",
    "fairmont", "holiday inn", "doubletree", "hampton",
    "four points", "best western", "comfort inn", "radisson",
}

GATEWAY_PREFIX_RE = re.compile(
    r"^(?:sq\s*\*|squ\s*\*|tst\s*\*|sp\s*\*|paypal\s*\*|stripe\s*\*|abc\s*\*|pp\s*\*|py\s*\*|pos\s+|debit\s+memo\s+|pre-authorized\s+debit\s+)",
    re.IGNORECASE,
)

STORE_ID_SUFFIX_RE = re.compile(
    r"\s+(?:#[0-9a-z-]+|[0-9]{3,}|store\s+[0-9]+)$",
    re.IGNORECASE,
)


def _slug(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def clean_merchant_name(raw_name):
    """
    Strips common point-of-sale gateway prefixes (SQ*, TST*, ABC*, PP*, etc.)
    and store number suffixes to extract the core merchant business name.
    """
    text = str(raw_name or "").strip()
    if not text:
        return ""
    # Strip prefix
    text = GATEWAY_PREFIX_RE.sub("", text).strip()
    # Strip store number suffix
    text = STORE_ID_SUFFIX_RE.sub("", text).strip()
    return text


def clean_merchant_slug(raw_name):
    cleaned = clean_merchant_name(raw_name)
    return _slug(cleaned)


def _fallback(slug):
    if not slug:
        return "Uncategorized"
    return " ".join(w.capitalize() for w in slug.split()[:MAX_FALLBACK_WORDS])


RULES = [

    # --- FOOD ---

    ("Groceries", ["grocery stores", "supermarkets"]),

    ("Dining", ["restaurants", "eating places", "caterers", "restaurant", "bistro"]),

    ("Fast Food", ["fast food"]),

    ("Coffee & Snacks", ["bakeries", "candy", "confectionery"]),

    ("Alcohol & Bars", ["drinking places", "liquor", "package stores", "bars and nightlife"]),

    # --- TRANSPORT ---

    ("Fuel", ["service stations", "automated fuel dispensers"]),

    ("Parking", ["parking lots", "garages", "parking", "parking and tolls"]),

    ("Transit & Taxi", [
        "taxicabs", "limousines", "bus lines",
        "commuter transportation", "passenger rail"
    ]),

    ("Auto Maintenance", ["automotive service shops", "repair shops"]),

    # --- HOME & BILLS ---

    ("Telecom", [
        "telecommunication services",
        "telecommunication equipment",
        "cable satellite",
    ]),

    ("Utilities", ["utilities"]),

    ("Insurance", ["insurance sales and underwriting"]),

    # --- SHOPPING ---

    ("Clothing", [
        "clothing stores", "family clothing",
        "mens and womens clothing"
    ]),

    ("Electronics", ["electronics stores"]),

    ("Home & Furniture", ["furniture", "home furnishings"]),

    ("General Retail", [
        "department stores", "discount stores",
        "miscellaneous retail", "specialty retail",
        "hardware stores", "office supplies"
    ]),

    ("Wholesale", ["wholesale club"]),

    # --- DIGITAL ---

    ("Software & SaaS", [
        "computer software stores",
        "computers computer peripheral equipment",
        "software and saas",
    ]),

    ("Gaming", ["digital goods games"]),

    ("Streaming & Digital", [
        "digital goods",
        "large digital goods merchant"
    ]),

    ("Online Subscriptions", [
        "continuity subscription",
        "direct marketing",
        "computer network information services",
        "online services",
        "subscriptions",
    ]),

    # --- HEALTH ---

    ("Medical", ["doctors and physicians", "hospitals"]),

    ("Pharmacy", ["drug stores and pharmacies"]),

    ("Dental", ["dentists and orthodontists"]),

    ("Medical Supplies", [
        "dental laboratory medical ophthalmic hospital equipment"
    ]),

    # --- LIFESTYLE ---

    ("Entertainment & Events", [
        "theatrical", "bands", "orchestras",
        "motion picture", "amusement parks",
        "tourist attractions"
    ]),

    ("Hobbies & Toys", ["hobby toy and game stores"]),

    ("Sports & Outdoors", ["sporting goods", "riding apparel", "fitness"]),

    # --- TRAVEL ---

    ("Travel", ["airlines", "travel agencies", "car rental"]),

    ("Lodging", []),  # handled separately

    # --- MONEY & GOV ---

    ("Taxes & Government", ["tax payments", "government services"]),

    ("Fees & Fines", ["fines", "court costs"]),

    # --- SERVICES ---

    ("Professional Services", [
        "professional services", "legal services", "accounting"
    ]),

    ("Personal Services", [
        "personal services", "business services", "services"
    ]),

    ("Education & Memberships", [
        "schools", "colleges", "membership clubs",
        "civic social", "charitable"
    ]),

    ("Cashback", ["cashback", "remises"]),
]


WEALTHSIMPLE_CATEGORY_MAP = {
    "restaurants": "Dining",
    "other food and drink": "Dining",
    "coffee": "Coffee & Snacks",
    "gas parking and tolls": "Fuel",
    "gas parking tolls": "Fuel",
    "bars and nightlife": "Alcohol & Bars",
    "fitness": "Sports & Outdoors",
    "subscriptions": "Software & SaaS",
    "services": "Personal Services",
    "groceries": "Groceries",
    "travel": "Travel",
    "shopping": "General Retail",
    "entertainment": "Entertainment & Events",
    "health": "Medical",
    "uncategorized": "Uncategorized",
}


@lru_cache(maxsize=2048)
def normalize_credit_card_category(value):
    raw = str(value or "").strip()
    if not raw:
        return "Uncategorized"

    slug = _slug(raw)

    # Direct Wealthsimple category lookup
    if slug in WEALTHSIMPLE_CATEGORY_MAP:
        return WEALTHSIMPLE_CATEGORY_MAP[slug]

    # --- HOTEL BRAND DETECTION ---
    if any(k in slug for k in HOTEL_KEYWORDS):
        return "Lodging"

    # --- RULE MATCH ---
    for category, keywords in RULES:
        if any(k in slug for k in keywords):
            return category

    # --- FALLBACK ---
    return _fallback(slug)


MERCHANT_CATEGORY_RULES = [
    ("Transfers & Payments", ["chequing", "payment", "transfer", "deposit", "bill payment", "withdrawal"]),
    ("Groceries", [
        "grocery", "supermarket", "loblaw", "metro", "sobeys", "safeway",
        "no frills", "whole foods", "food basics", "farm boy", "walmart",
        "t&t", "maxi", "iga", "provigo", "longos", "freshco", "superstore",
    ]),
    ("Wholesale", ["costco"]),
    ("Dining", [
        "restaurant", "cafe", "bistro", "grill", "sushi", "pizza", "kitchen",
        "diner", "eatery", "bar", "pub", "brewery", "tavern", "bbq", "steak",
        "buffet", "cantine", "brasserie", "deli", "vending",
    ]),
    ("Fast Food", [
        "mcdonald", "wendy", "burger", "subway", "tim horton", "starbucks",
        "aw canada", "a&w", "kfc", "taco bell", "popeyes", "harvey", "dairy queen",
        "five guys", "chipotle", "new york fries",
    ]),
    ("Coffee & Snacks", ["coffee", "bakery", "bagel", "donuts", "second cup", "davidstea", "pretzel", "pretzels"]),
    ("Fuel", ["gas", "fuel", "petro", "shell", "esso", "chevron", "circle k", "ultramar", "pioneer", "mobil"]),
    ("Parking", ["paybyphone", "parking", "green p", "meter", "park"]),
    ("Transit & Taxi", ["uber", "lyft", "taxi", "transit", "train", "bus", "presto", "stm", "ttc", "go transit"]),
    ("Travel", ["air canada", "westjet", "airline", "expedia", "booking.com", "airbnb", "flight"]),
    ("Lodging", list(HOTEL_KEYWORDS)),
    ("Telecom", ["rogers", "bell", "telus", "fido", "koodo", "freedom mobile", "shaw", "virgin plus"]),
    ("Utilities", ["hydro", "energy", "power", "enbridge", "utilities", "water"]),
    ("Software & SaaS", [
        "backblaze", "github", "adobe", "microsoft", "openai", "chatgpt", "dropbox",
        "aws", "digitalocean", "hosting", "cloud", "software", "vpn", "jetbrains",
        "google workspace", "slack", "notion", "heroku", "cloudflare", "gitlab",
    ]),
    ("Streaming & Digital", ["netflix", "spotify", "apple.com", "youtube", "disney", "prime video", "crave", "audible", "hulu", "paramount"]),
    ("Gaming", ["playstation", "steam", "nintendo", "xbox", "blizzard", "epic games", "riot games", "ea games"]),
    ("Sports & Outdoors", ["fitness", "gym", "goodlife", "anytime fitness", "planet fitness", "crossfit", "ymca", "sporting", "decathlon"]),
    ("Pharmacy", ["shoppers drug mart", "pharmacy", "rexall", "guardian", "pharma", "jean coutu"]),
    ("General Retail", ["amazon", "ebay", "best buy", "canadian tire", "winners", "homesense", "ikea", "dollarama", "staples"]),
    ("Entertainment & Events", ["cinema", "theatre", "cineplex", "ticketmaster", "eventbrite"]),
]


def get_user_merchant_category_map(user_id):
    """
    Builds an in-memory dictionary of the user's historical merchant categorizations
    from existing CreditCardTransaction records.
    Returns:
        {
            "exact": { lowercase_merchant_name: category },
            "slug": { cleaned_merchant_slug: category }
        }
    """
    if not user_id:
        return {"exact": {}, "slug": {}}

    try:
        from core.models import CreditCardTransaction

        rows = (
            CreditCardTransaction.objects
            .filter(user_id=user_id)
            .exclude(merchant_category__in=["", "Uncategorized", None])
            .values("merchant_name", "merchant_category")
        )

        raw_exact_counts = defaultdict(Counter)
        slug_counts = defaultdict(Counter)

        for r in rows:
            name = str(r.get("merchant_name") or "").strip()
            cat = str(r.get("merchant_category") or "").strip()
            if not name or not cat:
                continue

            raw_exact_counts[name.lower()][cat] += 1
            cleaned_slug = clean_merchant_slug(name)
            if cleaned_slug:
                slug_counts[cleaned_slug][cat] += 1

        exact_map = {name: counter.most_common(1)[0][0] for name, counter in raw_exact_counts.items()}
        slug_map = {slug: counter.most_common(1)[0][0] for slug, counter in slug_counts.items()}

        return {"exact": exact_map, "slug": slug_map}
    except Exception:
        return {"exact": {}, "slug": {}}


def infer_credit_card_category_from_merchant(merchant_name, tx_type=None, user_category_map=None, raw_category=None):
    """
    Infers the credit card category based on:
    1. Transaction type (Payments/Transfers).
    2. User's existing transaction history (exact and cleaned slug matches).
    3. Category column from CSV (e.g. Wealthsimple custom export), with refinement if broad.
    4. Keyword and merchant rule matching.
    5. Fallback to 'Uncategorized'.
    """
    # 1. Payment / transfer detection
    if tx_type and any(p in str(tx_type).lower() for p in ("payment", "transfer")):
        return "Transfers & Payments"

    raw = str(merchant_name or "").strip()
    raw_lower = raw.lower()
    cleaned_name = clean_merchant_name(raw)
    cleaned_slug = _slug(cleaned_name)

    # 2. Check user's historical transactions (1,400+ production transactions)
    if user_category_map:
        exact_map = user_category_map.get("exact") or {}
        slug_map = user_category_map.get("slug") or {}

        # Exact merchant name match
        if raw_lower in exact_map:
            return exact_map[raw_lower]
        # Cleaned merchant name match
        if cleaned_name.lower() in exact_map:
            return exact_map[cleaned_name.lower()]
        # Cleaned slug match
        if cleaned_slug in slug_map:
            return slug_map[cleaned_slug]

    # 3. If raw category was provided in the CSV (e.g. Wealthsimple custom export)
    if raw_category and str(raw_category).strip().lower() not in {"", "uncategorized"}:
        norm_cat = normalize_credit_card_category(raw_category)
        # If the category is very broad (e.g. Subscriptions, Services, Fuel for "gas, parking, and tolls"),
        # check if the merchant name gives a more specific category (e.g. Paybyphone -> Parking, Netflix -> Streaming)
        if norm_cat in {"Software & SaaS", "Personal Services", "Fuel", "Online Subscriptions"}:
            for category, keywords in MERCHANT_CATEGORY_RULES:
                if any(k in cleaned_slug for k in keywords):
                    return category
        return norm_cat

    if not raw:
        return "Uncategorized"

    # 4. Keyword / dictionary matching
    for category, keywords in MERCHANT_CATEGORY_RULES:
        if any(k in cleaned_slug for k in keywords):
            return category

    # Check hotel keywords
    if any(k in cleaned_slug for k in HOTEL_KEYWORDS):
        return "Lodging"

    # Standard MCC rule check
    for category, keywords in RULES:
        if any(k in cleaned_slug for k in keywords):
            return category

    # 5. Fallback to Uncategorized
    return "Uncategorized"
