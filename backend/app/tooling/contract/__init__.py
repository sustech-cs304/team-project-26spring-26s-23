"""Runtime-agnostic contract types for tool metadata, invocation, and results."""

from .context import ToolInvocationContext
from .errors import (
    NORMALIZED_TOOL_ERROR_CODES,
    RETRYABLE_NORMALIZED_TOOL_ERROR_CODES,
    NormalizedToolError,
    NormalizedToolErrorCode,
)
from .metadata import ToolMetadata
from .requirements import (
    HOST_CAPABILITY_NAMES,
    HostCapabilityName,
    HostCapabilityRequirement,
)
from .results import (
    STRUCTURED_RESULT_STATUSES,
    StructuredResultStatus,
    ToolArtifactReference,
    ToolResultEnvelope,
)
from .schema import ToolSchema
from .tool import ToolContract

__all__ = [
    "HOST_CAPABILITY_NAMES",
    "NORMALIZED_TOOL_ERROR_CODES",
    "RETRYABLE_NORMALIZED_TOOL_ERROR_CODES",
    "STRUCTURED_RESULT_STATUSES",
    "HostCapabilityName",
    "HostCapabilityRequirement",
    "NormalizedToolError",
    "NormalizedToolErrorCode",
    "StructuredResultStatus",
    "ToolArtifactReference",
    "ToolContract",
    "ToolInvocationContext",
    "ToolMetadata",
    "ToolResultEnvelope",
    "ToolSchema",
]
