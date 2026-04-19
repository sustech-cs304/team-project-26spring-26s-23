from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

Table = list[list[str]]


@dataclass
class PageContents:
    texts: list[str] = field(default_factory=list)
    tables: list[Table] = field(default_factory=list)

    def to_string(self) -> str:
        parts = []
        if self.texts:
            parts.append("**Texts:**\n" + "\n".join(self.texts))
        for i, table in enumerate(self.tables):
            table_str = "\n".join(["|" + "|".join(row) + "|" for row in table])
            parts.append(f"**Table {i + 1}:**\n{table_str}")
        return "\n\n".join(parts)


# file path | bytes
File = str | BytesIO


def convert_pdf(file: File) -> list[PageContents]:
    import pdfplumber

    contents: list[PageContents] = []
    with pdfplumber.open(file) as pdf:
        for page in pdf.pages:
            texts = [line["text"] for line in page.extract_text_lines()]
            tables = page.extract_tables()
            full_tables = [
                [[cell or "" for cell in row] for row in table] for table in tables
            ]
            contents.append(PageContents(texts, full_tables))
    return contents


def convert_pptx(file: File) -> list[PageContents]:
    import pptx
    import pptx.table
    import pptx.text.text

    contents: list[PageContents] = []
    ppt = pptx.Presentation(file)
    for slide in ppt.slides:
        content = PageContents()
        for shape in slide.shapes:
            if shape.has_table:
                table: pptx.table.Table = shape.table  # type:ignore
                str_table = [[cell.text for cell in row.cells] for row in table.rows]
                content.tables.append(str_table)
            if shape.has_text_frame:
                text_frame: pptx.text.text.TextFrame = shape.text_frame  # type:ignore
                text = text_frame.text
                content.texts.append(text)
        contents.append(content)
    return contents


def convert_docx(file: File) -> list[PageContents]:
    import docx

    doc = docx.Document(file)
    texts = [para.text for para in doc.paragraphs]
    tables = [
        [[cell.text for cell in row.cells] for row in table.rows]
        for table in doc.tables
    ]
    return [PageContents(texts, tables)]


def convert_file(file: File, suffix: str | None = None) -> list[PageContents]:
    """Convert a file to a list of PageContents. The suffix can be provided to specify the file type, or it will be inferred from the file path if possible.
    Args:
        file: The file to convert, either as a path string or a BytesIO object.
        suffix: The file suffix (e.g. ".pdf", ".pptx", ".docx"). If None, it will be inferred from the file path if possible.
    Returns:
        A list of PageContents, each representing the contents of a page or slide.
    """
    if suffix is None:
        if isinstance(file, str):
            suffix = Path(file).suffix.lower()
        else:
            raise ValueError("suffix must be provided when file is not a path string")
    if suffix == ".pdf":
        return convert_pdf(file)
    elif suffix == ".pptx":
        return convert_pptx(file)
    elif suffix == ".docx":
        return convert_docx(file)
    else:
        raise ValueError(f"unsupported file type: {suffix}")


def convert_file_to_str(file: File, suffix: str | None = None) -> str:
    """Convert a file to a string. The suffix can be provided to specify the file type, or it will be inferred from the file path if possible.
    Args:
        file: The file to convert, either as a path string or a BytesIO object.
        suffix: The file suffix (e.g. ".pdf", ".pptx", ".docx"). If None, it will be inferred from the file path if possible.
    Returns:
        A string representing the contents of the file.
    """
    texts = [page.to_string() for page in convert_file(file, suffix)]
    if len(texts) == 1:
        return texts[0]
    return "\n\n".join(f"# Page {i + 1}:\n{text}" for i, text in enumerate(texts))
