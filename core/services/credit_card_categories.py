import re
from functools import lru_cache

MAX_FALLBACK_WORDS = 4

HOTEL_KEYWORDS = {
    "hotel", "motel", "inn", "resort", "lodging",
    "hyatt", "marriott", "hilton", "sheraton", "westin",
    "fairmont", "holiday inn", "doubletree", "hampton",
    "four points", "best western", "comfort inn", "radisson",
}


def _slug(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _fallback(slug):
    if not slug:
        return "Uncategorized"
    return " ".join(w.capitalize() for w in slug.split()[:MAX_FALLBACK_WORDS])


RULES = [

    # --- FOOD ---

    ("Groceries", ["grocery stores", "supermarkets"]),

    ("Dining", ["restaurants", "eating places", "caterers"]),

    ("Fast Food", ["fast food"]),

    ("Coffee & Snacks", ["bakeries", "candy", "confectionery"]),

    ("Alcohol & Bars", ["drinking places", "liquor", "package stores"]),

    # --- TRANSPORT ---

    ("Fuel", ["service stations", "automated fuel dispensers"]),

    ("Parking", ["parking lots", "garages"]),

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
        "computers computer peripheral equipment"
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
        "online services"
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

    ("Sports & Outdoors", ["sporting goods", "riding apparel"]),

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
        "personal services", "business services"
    ]),

    ("Education & Memberships", [
        "schools", "colleges", "membership clubs",
        "civic social", "charitable"
    ]),

    ("Cashback", ["cashback", "remises"]),
]


@lru_cache(maxsize=2048)
def normalize_credit_card_category(value):

    raw = str(value or "").strip()
    if not raw:
        return "Uncategorized"

    slug = _slug(raw)

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
    ]),
    ("Fast Food", [
        "mcdonald", "wendy", "burger", "subway", "tim horton", "starbucks",
        "aw canada", "a&w", "kfc", "taco bell", "popeyes", "harvey", "dairy queen",
        "five guys", "chipotle",
    ]),
    ("Coffee & Snacks", ["coffee", "bakery", "bagel", "donuts", "second cup", "davidstea"]),
    ("Fuel", ["gas", "fuel", "petro", "shell", "esso", "chevron", "circle k", "ultramar", "pioneer", "mobil"]),
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


@lru_cache(maxsize=2048)
def infer_credit_card_category_from_merchant(merchant_name, tx_type=None):
    if tx_type and any(p in str(tx_type).lower() for p in ("payment", "transfer")):
        return "Transfers & Payments"

    raw = str(merchant_name or "").strip()
    if not raw:
        return "Uncategorized"

    slug = _slug(raw)

    for category, keywords in MERCHANT_CATEGORY_RULES:
        if any(k in slug for k in keywords):
            return category

    # Check hotel keywords
    if any(k in slug for k in HOTEL_KEYWORDS):
        return "Lodging"

    # Fallback to standard MCC rule check
    for category, keywords in RULES:
        if any(k in slug for k in keywords):
            return category

    return "General Retail" if slug else "Uncategorized"