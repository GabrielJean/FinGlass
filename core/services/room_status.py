"""
Shared contribution room status computation.

This module is the single source of truth for the TFSA/RRSP/FHSA status labels
('over-limit', 'near-limit', 'full') that were previously duplicated across
tfsa.js, rrsp.js and fhsa.js.  By computing them on the server side and
surfacing the result as a ``room_status`` field in each summary API response we
guarantee that the compliance-critical badge logic is always consistent.

Constants
---------
ROOM_EPSILON
    Floating-point tolerance used to avoid spurious "full/over" signals from
    tiny rounding errors.  Must match the ``ROOM_EPSILON`` already used in the
    individual service modules.
NEAR_LIMIT_THRESHOLD
    The used-to-available ratio at which an account is considered "near limit"
    (currently 90 %).  Previously duplicated as the magic number ``0.9`` in
    every JS file.
"""

ROOM_EPSILON = 0.005
NEAR_LIMIT_THRESHOLD = 0.9


def compute_room_status(total_available_room, room_used, total_remaining, taxable_excess_amount=0.0):
    """Return the contribution room status string.

    Parameters
    ----------
    total_available_room:
        Total room the account holder has (opening balance + accumulated annual
        limits, or FHSA simulation result before current-year deposits).
    room_used:
        Room consumed so far.  For FHSA this should be the *consumed* room
        (``max(0, total_available_room - total_remaining)``), not raw deposits,
        so that the ratio reflects actual room pressure.
    total_remaining:
        Remaining room (already clamped to 0 for over-contribution cases on the
        caller side).
    taxable_excess_amount:
        Amount by which contributions exceed the allowable room.  For RRSP,
        pass ``max(taxable_excess_amount, cra_over_contribution_amount)`` so
        that over-deduction-limit contributions within the $2 000 cushion also
        trigger the 'over-limit' badge.

    Returns
    -------
    str or None
        One of ``'over-limit'``, ``'full'``, ``'near-limit'``, or ``None``.
    """
    available = float(total_available_room or 0.0)
    used = float(room_used or 0.0)
    remaining = float(total_remaining or 0.0)
    excess = float(taxable_excess_amount or 0.0)

    if excess > ROOM_EPSILON:
        return "over-limit"

    if available <= ROOM_EPSILON or remaining <= ROOM_EPSILON or (available > ROOM_EPSILON and used >= available - ROOM_EPSILON):
        return "full"

    used_ratio = used / available if available > ROOM_EPSILON else 0.0
    if used_ratio >= NEAR_LIMIT_THRESHOLD:
        return "near-limit"

    return None
