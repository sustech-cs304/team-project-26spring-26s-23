"""Compat-only shim for the shared SUSTech CAS client.

New code must import from ``app.shared_integrations.sustech_auth.cas_client``.
Do not add business logic to this module.
"""

from app.shared_integrations.sustech_auth.cas_client import CASClient, CASLogger

__all__ = ["CASClient", "CASLogger"]
