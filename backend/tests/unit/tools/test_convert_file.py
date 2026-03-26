from pathlib import Path
from app.tools.file_convert import convert_file_to_str

TEST_FILE_DIR = Path(__file__).resolve().parent


def test_convert_pdf() -> None:
    file_path = str(TEST_FILE_DIR / "test_file.pdf")
    result = convert_file_to_str(file_path)
    assert result.startswith(
        """# Page 1:
**Texts:**
测试文件
一段文字：The quick brown fox jumps over the lazy dog

# Page 2:
**Texts:**
图形内文字
text in shape
"""
    )


def test_convert_pptx() -> None:
    file_path = str(TEST_FILE_DIR / "test_file.pptx")
    result = convert_file_to_str(file_path)
    assert result.startswith(
        """# Page 1:
**Texts:**
测试文件
一段文字：The quick brown fox jumps over the lazy dog

# Page 2:
**Texts:**
图形内文字
text in shape
"""
    )
    assert result.endswith(
        """
**Table 1:**
|测试表格|title1|title2|title3|
|1234|2345|345|45678|
|a|b|c|D|"""
    )


def test_convert_docx() -> None:
    file_path = str(TEST_FILE_DIR / "test_file.docx")
    result = convert_file_to_str(file_path)
    assert (
        result
        == """**Texts:**
测试文件
一段文字：The quick brown fox jumps over the lazy dog
另一段文字：Transformer模型是一种基于注意力机制的深度学习模型。

**Table 1:**
|测试表格|title1|title2|title3|
|1234|2345|345|45678|
|a|b|C|D|"""
    )
