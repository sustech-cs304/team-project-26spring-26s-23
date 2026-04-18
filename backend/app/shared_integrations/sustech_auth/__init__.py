"""Shared SUSTech authentication integration exports.

Canonical CAS imports live in ``app.shared_integrations.sustech_auth.cas_client``.
Package-level re-exports remain as a thin convenience surface.
"""

from .cas_client import CASClient, CASLogger

__all__ = ["CASClient", "CASLogger"]
