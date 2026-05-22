from __future__ import annotations

from app.copilot_runtime._debug_logging.helpers import (
    _lookup_mapping_value,
    _lookup_value,
    _payload_mapping,
    _sanitize_value,
)


# ---------------------------------------------------------------------------
# _lookup_value
# ---------------------------------------------------------------------------


class _FakeObj:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


def test_lookup_value_none_returns_none() -> None:
    assert _lookup_value(None, attr_name="foo", key_name="foo") is None


def test_lookup_value_finds_by_attr_name() -> None:
    obj = _FakeObj(foo="bar")
    assert _lookup_value(obj, attr_name="foo", key_name="bar") == "bar"


def test_lookup_value_falls_back_to_key_name_attr() -> None:
    obj = _FakeObj(bar="baz")
    assert _lookup_value(obj, attr_name="foo", key_name="bar") == "baz"


def test_lookup_value_attr_name_takes_priority_over_key_name() -> None:
    obj = _FakeObj(foo="first", bar="second")
    assert _lookup_value(obj, attr_name="foo", key_name="bar") == "first"


def test_lookup_value_from_mapping() -> None:
    data = {"name": "test"}
    assert _lookup_value(data, attr_name="name", key_name="name") == "test"


def test_lookup_value_mapping_uses_key_name() -> None:
    data = {"my_key": 42}
    assert _lookup_value(data, attr_name="my_attr", key_name="my_key") == 42


def test_lookup_value_non_existent_returns_none() -> None:
    obj = _FakeObj()
    assert _lookup_value(obj, attr_name="missing", key_name="missing") is None


def test_lookup_value_non_dict_mapping_no_attr_returns_none() -> None:
    assert _lookup_value(42, attr_name="x", key_name="x") is None


def test_lookup_value_empty_string_not_found() -> None:
    data = {}
    assert _lookup_value(data, attr_name="missing", key_name="missing") is None


def test_lookup_value_nested_dict_via_mapping() -> None:
    inner = {"key": "nested_value"}
    data = {"payload": inner}
    result = _lookup_value(data, attr_name="payload", key_name="payload")
    assert result is inner
    assert result["key"] == "nested_value"


def test_lookup_value_object_with_snake_case() -> None:
    obj = _FakeObj(provider_profile_id="prov-1")
    assert (
        _lookup_value(obj, attr_name="provider_profile_id", key_name="providerProfileId")
        == "prov-1"
    )


def test_lookup_value_object_with_camel_case_attr() -> None:
    obj = _FakeObj(providerProfileId="prov-2")

    class _Wrapper:
        pass

    _Wrapper.providerProfileId = "prov-2"
    assert (
        _lookup_value(obj, attr_name="provider_profile_id", key_name="providerProfileId")
        == "prov-2"
    )


# ---------------------------------------------------------------------------
# _lookup_mapping_value
# ---------------------------------------------------------------------------


def test_lookup_mapping_value_returns_value() -> None:
    assert _lookup_mapping_value({"a": 1}, "a") == 1


def test_lookup_mapping_value_returns_none_for_missing_key() -> None:
    assert _lookup_mapping_value({"a": 1}, "b") is None


def test_lookup_mapping_value_with_none_value() -> None:
    assert _lookup_mapping_value({"a": None}, "a") is None


# ---------------------------------------------------------------------------
# _sanitize_value
# ---------------------------------------------------------------------------


def test_sanitize_scalar_values_pass_through() -> None:
    assert _sanitize_value(None) is None
    assert _sanitize_value(True) is True
    assert _sanitize_value(42) == 42
    assert _sanitize_value(3.14) == 3.14
    assert _sanitize_value("hello") == "hello"


def test_sanitize_dict_recursively() -> None:
    result = _sanitize_value({"key": "value", "nested": {"deep": 1}})
    assert result == {"key": "value", "nested": {"deep": 1}}
    assert isinstance(result, dict)


def test_sanitize_list_recursively() -> None:
    result = _sanitize_value([1, "text", {"inner": None}])
    assert result == [1, "text", {"inner": None}]


def test_sanitize_tuple_recursively() -> None:
    result = _sanitize_value((1, 2))
    assert result == [1, 2]


def test_sanitize_set_recursively() -> None:
    result = _sanitize_value({1, 2, 3})
    assert isinstance(result, list)
    assert sorted(result) == [1, 2, 3]


def test_sanitize_frozenset_recursively() -> None:
    result = _sanitize_value(frozenset([1, 2]))
    assert isinstance(result, list)
    assert sorted(result) == [1, 2]


def test_sanitize_unknown_type_converts_to_string() -> None:
    class Unknown:
        def __str__(self):
            return "unknown-object"

    result = _sanitize_value(Unknown())
    assert result == "unknown-object"


def test_sanitize_mixed_nested() -> None:
    data = {
        "user": "test",
        "apiKey": "secret-key",
        "tokens": [1, {"secret": "hidden", "public": "visible"}],
    }
    result = _sanitize_value(data)
    assert result["user"] == "test"
    assert result["apiKey"] == "secret-key"
    assert result["tokens"][1]["secret"] == "hidden"
    assert result["tokens"][1]["public"] == "visible"


def test_sanitize_empty_dict_and_list() -> None:
    assert _sanitize_value({}) == {}
    assert _sanitize_value([]) == []


def test_sanitize_none_in_list() -> None:
    assert _sanitize_value([None, 1, "a"]) == [None, 1, "a"]


def test_sanitize_bool_inside_dict() -> None:
    assert _sanitize_value({"enabled": False, "count": 0}) == {
        "enabled": False,
        "count": 0,
    }


def test_sanitize_deeply_nested_list() -> None:
    data = [[[{"key": "value"}]]]
    result = _sanitize_value(data)
    assert result == [[[{"key": "value"}]]]


# ---------------------------------------------------------------------------
# _payload_mapping
# ---------------------------------------------------------------------------


def test_payload_mapping_from_object_with_payload_attr() -> None:
    obj = _FakeObj(payload={"type": "run_started", "sequence": 1})
    result = _payload_mapping(obj)
    assert result == {"type": "run_started", "sequence": 1}


def test_payload_mapping_from_object_with_payload_key_attr() -> None:
    obj = _FakeObj(payload={"key": "value"})
    assert _payload_mapping(obj) == {"key": "value"}


def test_payload_mapping_from_dict() -> None:
    data = {"payload": {"delta": "hello"}}
    assert _payload_mapping(data) == {"delta": "hello"}


def test_payload_mapping_non_mapping_payload_returns_empty_dict() -> None:
    obj = _FakeObj(payload="not-a-mapping")
    assert _payload_mapping(obj) == {}


def test_payload_mapping_no_payload_returns_empty_dict() -> None:
    obj = _FakeObj()
    assert _payload_mapping(obj) == {}


def test_payload_mapping_none_returns_empty_dict() -> None:
    assert _payload_mapping(None) == {}


def test_payload_mapping_payload_is_none_returns_empty_dict() -> None:
    obj = _FakeObj(payload=None)
    assert _payload_mapping(obj) == {}
