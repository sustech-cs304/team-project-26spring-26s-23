"""Legacy backward-compatibility shim.

Re-exports CASClient from the canonical shared_integrations package.
All new code should import from ``app.shared_integrations.sustech_auth.cas_client``
directly.
"""

from app.shared_integrations.sustech_auth.cas_client import *  # noqa: F401, F403
