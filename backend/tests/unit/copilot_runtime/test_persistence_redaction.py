from __future__ import annotations

from app.copilot_runtime.persistence.redaction import (
    DEFAULT_REDACTION_VERSION,
    REDACTED_VALUE,
    RedactionResult,
    redact_payload,
)


def test_redact_payload_removes_top_level_sensitive_key() -> None:
    result = redact_payload({"apiKey": "secret-value", "name": "test"})
    assert result.is_redacted is True
    assert result.redaction_version == DEFAULT_REDACTION_VERSION
    assert result.value == {"apiKey": REDACTED_VALUE, "name": "test"}


def test_redact_payload_removes_nested_sensitive_key() -> None:
    result = redact_payload({
        "level1": {
            "level2": {
                "secret": "hidden",
                "data": "visible",
            },
        },
    })
    assert result.is_redacted is True
    assert result.value["level1"]["level2"]["secret"] == REDACTED_VALUE
    assert result.value["level1"]["level2"]["data"] == "visible"


def test_redact_payload_removes_sensitive_key_in_list() -> None:
    result = redact_payload({
        "items": [
            {"name": "item1", "password": "pwd1"},
            {"name": "item2", "password": "pwd2"},
        ],
    })
    assert result.is_redacted is True
    assert result.value["items"][0]["password"] == REDACTED_VALUE
    assert result.value["items"][1]["password"] == REDACTED_VALUE
    assert result.value["items"][0]["name"] == "item1"


def test_redact_payload_does_not_modify_non_sensitive_keys() -> None:
    result = redact_payload({
        "username": "alice",
        "displayName": "Alice",
        "role": "admin",
        "settings": {"theme": "dark"},
    })
    assert result.is_redacted is False
    assert result.value == {
        "username": "alice",
        "displayName": "Alice",
        "role": "admin",
        "settings": {"theme": "dark"},
    }


def test_redact_payload_handles_empty_payload() -> None:
    result = redact_payload({})
    assert result.is_redacted is False
    assert result.value == {}


def test_redact_payload_handles_none_payload() -> None:
    result = redact_payload(None)
    assert result.is_redacted is False
    assert result.value == {}


def test_redact_payload_handles_key_variants() -> None:
    cases = [
        ("accesskey", "accesskey"),
        ("access_key", "access_key"),
        ("accessKey", "accessKey"),
        ("ACCESS_KEY", "ACCESS_KEY"),
        ("access-token", "access-token"),
        ("Access-Token", "Access-Token"),
        ("authorization", "authorization"),
        ("bearer", "bearer"),
        ("bearer_token", "bearer_token"),
        ("cookie", "cookie"),
        ("id_token", "id_token"),
        ("password", "password"),
        ("refresh_token", "refresh_token"),
        ("secret", "secret"),
        ("secretkey", "secretkey"),
        ("session_cookie", "session_cookie"),
        ("session_secret", "session_secret"),
        ("session_token", "session_token"),
        ("sessionid", "sessionid"),
    ]
    for key, _expected in cases:
        result = redact_payload({key: "should-be-redacted"})
        assert result.is_redacted is True, f"Key '{key}' should be redacted"
        assert result.value[key] == REDACTED_VALUE, f"Key '{key}' value should be [redacted]"


def test_redact_payload_handles_compact_key_variants() -> None:
    result = redact_payload({
        "ApiKey": "redact-me",
        "accessToken": "redact-me",
        "auth_token": "redact-me",
        "bearerToken": "redact-me",
        "IDToken": "redact-me",
        "refreshToken": "redact-me",
        "sessionId": "redact-me",
    })
    assert result.is_redacted is True
    for key in ("ApiKey", "accessToken", "auth_token", "bearerToken", "IDToken", "refreshToken", "sessionId"):
        assert result.value[key] == REDACTED_VALUE, f"Key '{key}' should be redacted"


def test_redact_payload_empty_string_key_not_sensitive() -> None:
    result = redact_payload({"": "empty-key-value"})
    assert result.is_redacted is False


def test_redact_payload_deeply_nested() -> None:
    result = redact_payload({
        "config": {
            "providers": [
                {
                    "name": "openai",
                    "credentials": {
                        "bearer_token": "tok-abc",
                        "apiKey": "sk-xyz",
                    },
                },
            ],
        },
    })
    assert result.is_redacted is True
    provider = result.value["config"]["providers"][0]
    assert provider["credentials"]["bearer_token"] == REDACTED_VALUE
    assert provider["credentials"]["apiKey"] == REDACTED_VALUE
    assert provider["name"] == "openai"


def test_redact_payload_redacts_entire_value_for_sensitive_top_key() -> None:
    result = redact_payload({"auth": {"bearer": "tok-abc", "secret": "sk-xyz"}})
    assert result.is_redacted is True
    assert result.value["auth"] == REDACTED_VALUE


def test_redact_payload_handles_tuple() -> None:
    result = redact_payload({
        "entries": (
            {"apiKey": "key1"},
            {"secret": "secret1"},
        ),
    })
    assert result.is_redacted is True
    assert result.value["entries"][0]["apiKey"] == REDACTED_VALUE
    assert result.value["entries"][1]["secret"] == REDACTED_VALUE
    assert isinstance(result.value["entries"], tuple)
