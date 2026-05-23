from __future__ import annotations

import html

from app.integrations.sustech.blackboard.api.fetch_helpers import extract_xml_contents


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


def _assert_is_none(actual: object, message: str) -> None:
    if actual is not None:
        raise AssertionError(f"{message}: expected=None, actual={actual!r}")


class TestExtractXmlContents:
    def test_returns_cdata_body_when_xml_contains_cdata(self) -> None:
        xml = '<?xml version="1.0" encoding="UTF-8"?>\n<contents><![CDATA[<div>Hello</div>]]></contents>'
        result = extract_xml_contents(xml)
        _assert_equal(result, "<div>Hello</div>", "CDATA body extracted")

    def test_returns_html_unescaped_body_when_no_cdata(self) -> None:
        xml = '<?xml version="1.0" encoding="UTF-8"?>\n<contents>&lt;div&gt;Hello&lt;/div&gt;</contents>'
        result = extract_xml_contents(xml)
        _assert_equal(result, "<div>Hello</div>", "unescaped HTML body")

    def test_returns_cdata_body_with_newlines(self) -> None:
        xml = '<?xml version="1.0"?>\n<contents><![CDATA[\n<ul>\n  <li>A</li>\n  <li>B</li>\n</ul>\n]]></contents>'
        result = extract_xml_contents(xml)
        assert result is not None
        assert "<li>A</li>" in result
        assert "<li>B</li>" in result

    def test_returns_none_for_empty_string(self) -> None:
        _assert_is_none(extract_xml_contents(""), "empty string → None")

    def test_returns_none_for_none_input(self) -> None:
        _assert_is_none(extract_xml_contents(None), "None input → None")  # type: ignore[arg-type]

    def test_returns_none_for_plain_html_without_xml_declaration(self) -> None:
        result = extract_xml_contents("<html><body><p>Hello</p></body></html>")
        _assert_is_none(result, "plain HTML without xml or contents tag → None")

    def test_returns_none_when_xml_has_no_contents_tag(self) -> None:
        xml = '<?xml version="1.0"?>\n<response><data>42</data></response>'
        _assert_is_none(extract_xml_contents(xml), "XML without contents tag")

    def test_handles_case_insensitive_contents_tag(self) -> None:
        xml = '<?xml version="1.0"?>\n<CONTENTS><![CDATA[data]]></CONTENTS>'
        _assert_equal(extract_xml_contents(xml), "data", "case-insensitive contents tag")

    def test_handles_contents_tag_with_attributes(self) -> None:
        xml = '<?xml version="1.0"?>\n<contents type="html"><![CDATA[data_with_attrs]]></contents>'
        _assert_equal(extract_xml_contents(xml), "data_with_attrs", "contents with attributes")

    def test_returns_none_when_contents_tag_is_empty(self) -> None:
        xml = '<?xml version="1.0"?>\n<contents></contents>'
        result = extract_xml_contents(xml)
        _assert_equal(result, "", "empty contents body → empty string")

    def test_returns_cdata_body_with_special_xml_chars_in_cdata(self) -> None:
        xml = '<?xml version="1.0"?>\n<contents><![CDATA[a < b && c > d & "e"]]></contents>'
        result = extract_xml_contents(xml)
        _assert_equal(result, 'a < b && c > d & "e"', "CDATA preserves raw special chars")

    def test_handles_multiple_contents_tags_returns_first(self) -> None:
        xml = '<?xml version="1.0"?>\n<contents><![CDATA[first]]></contents>\n<contents><![CDATA[second]]></contents>'
        _assert_equal(extract_xml_contents(xml), "first", "first contents body extracted")

    def test_returns_content_when_contents_tag_found_without_xml_declaration(self) -> None:
        text = 'some text <contents><![CDATA[data]]></contents> more text'
        result = extract_xml_contents(text)
        _assert_equal(result, "data", "extracts contents body even without xml declaration")

    def test_nested_cdata_outer_extracted(self) -> None:
        xml = '<?xml version="1.0"?>\n<contents><![CDATA[<![CDATA[inner]]>]]></contents>'
        result = extract_xml_contents(xml)
        _assert_equal(result, "<![CDATA[inner]]>", "nested CDATA extracts outer body")

    def test_unescape_html_entities_when_no_cdata(self) -> None:
        body = "Hello &amp; World &lt;3"
        xml = '<?xml version="1.0"?>\n<contents>' + body + "</contents>"
        expected = html.unescape(body)
        _assert_equal(extract_xml_contents(xml), expected, "HTML entities unescaped without CDATA")
