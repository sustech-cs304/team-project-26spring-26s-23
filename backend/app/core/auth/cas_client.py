"""Compatibility shim for the shared SUSTech CAS client."""

from app.shared_integrations.sustech_auth.cas_client import CASClient, CASLogger

__all__ = ["CASClient", "CASLogger"]
