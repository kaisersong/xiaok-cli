#!/usr/bin/env python3
"""
End-to-end verification of the Office/PDF read path in a real terminal.

Launches the real built CLI inside a real tmux TTY against a local
OpenAI-compatible SSE server. The scripted model issues `read` tool calls on
real Office documents, and the test asserts what actually reaches the pane.

This is the E2E counterpart to the unit tests in tests/ai/tools/read.test.ts:
those prove the tool returns text, this proves the whole agent loop — tool
dispatch, permission gate, tool-result rendering — surfaces that text to the
user instead of mojibake.

Usage:
    python3 tests/e2e/office-read-e2e.py --project-dir /path/to/xiaok-cli
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import sys
import tempfile
import zlib
from pathlib import Path


def load_harness():
    """tmux-e2e.py has a dash in its name, so import it by path."""
    harness_path = Path(__file__).resolve().parent / "tmux-e2e.py"
    spec = importlib.util.spec_from_file_location("tmux_e2e_harness", harness_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load harness at {harness_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["tmux_e2e_harness"] = module
    spec.loader.exec_module(module)
    return module


H = load_harness()


def build_zip(entries: list[tuple[str, bytes]]) -> bytes:
    """Minimal ZIP writer; mirrors what Word/PowerPoint/Excel emit."""
    local = bytearray()
    central = bytearray()
    offset = 0
    for name, data in entries:
        name_bytes = name.encode("utf-8")
        compressor = zlib.compressobj(9, zlib.DEFLATED, -zlib.MAX_WBITS)
        compressed = compressor.compress(data) + compressor.flush()
        header = bytearray()
        header += (0x04034B50).to_bytes(4, "little")
        header += (20).to_bytes(2, "little")
        header += (0).to_bytes(2, "little")
        header += (8).to_bytes(2, "little")
        header += (0).to_bytes(4, "little")
        header += (0).to_bytes(4, "little")
        header += len(compressed).to_bytes(4, "little")
        header += len(data).to_bytes(4, "little")
        header += len(name_bytes).to_bytes(2, "little")
        header += (0).to_bytes(2, "little")
        local += header + name_bytes + compressed

        entry = bytearray()
        entry += (0x02014B50).to_bytes(4, "little")
        entry += (20).to_bytes(2, "little")
        entry += (20).to_bytes(2, "little")
        entry += (0).to_bytes(2, "little")
        entry += (8).to_bytes(2, "little")
        entry += (0).to_bytes(4, "little")
        entry += (0).to_bytes(4, "little")
        entry += len(compressed).to_bytes(4, "little")
        entry += len(data).to_bytes(4, "little")
        entry += len(name_bytes).to_bytes(2, "little")
        entry += (0).to_bytes(2, "little")
        entry += (0).to_bytes(2, "little")
        entry += (0).to_bytes(2, "little")
        entry += (0).to_bytes(2, "little")
        entry += (0).to_bytes(4, "little")
        entry += offset.to_bytes(4, "little")
        central += entry + name_bytes
        offset += len(header) + len(name_bytes) + len(compressed)

    eocd = bytearray()
    eocd += (0x06054B50).to_bytes(4, "little")
    eocd += (0).to_bytes(2, "little")
    eocd += (0).to_bytes(2, "little")
    eocd += len(entries).to_bytes(2, "little")
    eocd += len(entries).to_bytes(2, "little")
    eocd += len(central).to_bytes(4, "little")
    eocd += offset.to_bytes(4, "little")
    eocd += (0).to_bytes(2, "little")
    return bytes(local + central + eocd)


CONTENT_TYPES = (
    '<?xml version="1.0"?><Types '
    'xmlns="http://schemas.openxmlformats.org/package/2006/content-types" />'
).encode("utf-8")


def make_docx(paragraphs: list[str]) -> bytes:
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    ).encode("utf-8")
    return build_zip([("[Content_Types].xml", CONTENT_TYPES), ("word/document.xml", document)])


def make_pptx_single_paragraph_runs(runs: list[str]) -> bytes:
    """One a:p holding several a:r — the D2 fragmentation case."""
    run_xml = "".join(f'<a:r><a:rPr lang="zh-CN"/><a:t>{r}</a:t></a:r>' for r in runs)
    slide = (
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
        ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        f"<p:cSld><p:spTree><p:sp><p:txBody><a:p>{run_xml}</a:p>"
        "</p:txBody></p:sp></p:spTree></p:cSld></p:sld>"
    ).encode("utf-8")
    return build_zip([("[Content_Types].xml", CONTENT_TYPES), ("ppt/slides/slide1.xml", slide)])


def make_xlsx_sparse(sheet_label: str, cells: list[tuple[str, str]]) -> bytes:
    """Cells addressed by reference with gaps — the D3a/D3b case."""
    shared = [text for _ref, text in cells]
    sst = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        f'count="{len(shared)}" uniqueCount="{len(shared)}">'
        + "".join(f"<si><t>{t}</t></si>" for t in shared)
        + "</sst>"
    ).encode("utf-8")
    cell_xml = "".join(
        f'<c r="{ref}" t="s"><v>{index}</v></c>' for index, (ref, _t) in enumerate(cells)
    )
    sheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData><row r="1">{cell_xml}</row></sheetData></worksheet>'
    ).encode("utf-8")
    workbook = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{sheet_label}" sheetId="1" r:id="rId1"/></sheets></workbook>'
    ).encode("utf-8")
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        'relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    ).encode("utf-8")
    return build_zip([
        ("[Content_Types].xml", CONTENT_TYPES),
        ("xl/workbook.xml", workbook),
        ("xl/_rels/workbook.xml.rels", rels),
        ("xl/sharedStrings.xml", sst),
        ("xl/worksheets/sheet1.xml", sheet),
    ])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--keep", action="store_true", help="keep the temp workspace")
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    cli_entry = project_dir / "dist" / "index.js"
    if not cli_entry.exists():
        print(f"FAIL: missing built CLI at {cli_entry}; run npm run build first")
        return 1

    tmux_bin = H.resolve_tmux_binary()
    workspace = Path(tempfile.mkdtemp(prefix="xiaok-office-e2e-"))
    fixtures = workspace / "fixtures"
    fixtures.mkdir(parents=True)

    docx_path = fixtures / "董事会评审报告.docx"
    docx_path.write_bytes(make_docx(["这是一份董事会评审报告。", "请进行对抗性评审。"]))

    pptx_path = fixtures / "季度复盘.pptx"
    pptx_path.write_bytes(make_pptx_single_paragraph_runs(["小K ", "在本季度", "实现了增长"]))

    xlsx_path = fixtures / "经营数据.xlsx"
    xlsx_path.write_bytes(make_xlsx_sparse("2026预算", [("A1", "客户"), ("C1", "收入"), ("E1", "毛利")]))

    legacy_xls_path = fixtures / "其实是旧版.xlsx"
    legacy_xls_path.write_bytes(bytes.fromhex("d0cf11e0a1b11ae1") + b"\x00" * 512)

    pdf_path = fixtures / "扫描合同.pdf"
    pdf_path.write_bytes(b"%PDF-1.7\n<< binary payload >>\n")

    png_path = fixtures / "logo.png"
    png_path.write_bytes(bytes.fromhex("89504e470d0a1a0a") + b"\x00" * 64)

    responses = [
        H.tool_call_response_events("read", {"file_path": str(docx_path)}, "call_docx"),
        H.text_response_events("OFFICE_E2E_DOCX_DONE"),
        H.tool_call_response_events("read", {"file_path": str(pptx_path)}, "call_pptx"),
        H.text_response_events("OFFICE_E2E_PPTX_DONE"),
        H.tool_call_response_events("read", {"file_path": str(xlsx_path)}, "call_xlsx"),
        H.text_response_events("OFFICE_E2E_XLSX_DONE"),
        H.tool_call_response_events("read", {"file_path": str(legacy_xls_path)}, "call_legacy"),
        H.text_response_events("OFFICE_E2E_LEGACY_DONE"),
        H.tool_call_response_events("read", {"file_path": str(pdf_path)}, "call_pdf"),
        H.text_response_events("OFFICE_E2E_PDF_DONE"),
        H.tool_call_response_events("read", {"file_path": str(png_path)}, "call_png"),
        H.text_response_events("OFFICE_E2E_PNG_DONE"),
    ]

    server = H.FakeOpenAIServer(responses, first_token_delay=0.1)
    server.start()

    config_dir = workspace / "config"
    home_dir = workspace / "home"
    home_dir.mkdir(parents=True)
    H.write_config(config_dir, server.base_url)

    harness = H.TmuxHarness(
        session="xiaok-office-e2e",
        project_dir=workspace,
        config_dir=config_dir,
        home_dir=home_dir,
        cli_entry=cli_entry,
        tmux_bin=tmux_bin,
    )

    failures: list[str] = []

    def check(name: str, condition: bool, detail: str = "") -> None:
        if condition:
            print(f"PASS: {name}")
        else:
            print(f"FAIL: {name}")
            if detail:
                print(detail[-1600:])
            failures.append(name)

    def tool_results_for(call_id: str) -> str:
        """The text this tool call handed back to the model, across all requests."""
        chunks: list[str] = []
        for request in server.requests:
            for message in request.get("messages", []):
                if message.get("role") != "tool":
                    continue
                if message.get("tool_call_id") != call_id:
                    continue
                content = message.get("content")
                if isinstance(content, str):
                    chunks.append(content)
                elif isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and isinstance(part.get("text"), str):
                            chunks.append(part["text"])
        return "\n".join(chunks)

    try:
        harness.start(cols=140, rows=45)
        harness.wait_for(lambda text: "❯" in text or ">" in text, timeout=45.0)

        # 每一轮：发一句话 → 等模型的收尾文本出现，确保该轮的 tool 结果已回传
        rounds = [
            ("读一下 docx", "OFFICE_E2E_DOCX_DONE"),
            ("读一下 pptx", "OFFICE_E2E_PPTX_DONE"),
            ("读一下 xlsx", "OFFICE_E2E_XLSX_DONE"),
            ("读一下假 xlsx", "OFFICE_E2E_LEGACY_DONE"),
            ("读一下 pdf", "OFFICE_E2E_PDF_DONE"),
            ("读一下 png", "OFFICE_E2E_PNG_DONE"),
        ]
        for prompt, sentinel in rounds:
            harness.type_text(prompt)
            harness.send_key("Enter")
            harness.wait_for(lambda text, s=sentinel: s in text, timeout=90.0)

        # TUI 故意把工具输出折叠成一行摘要，所以断言必须落在"模型实际收到的
        # tool 结果"上，而不是屏幕内容 —— 否则只会命中文件名，形成假阳性。
        docx_result = tool_results_for("call_docx")
        check(
            "D1 docx 交给模型的是正文而不是乱码",
            "董事会评审报告" in docx_result
            and "对抗性评审" in docx_result
            and "\ufffd" not in docx_result
            and "PK\u0003\u0004" not in docx_result,
            docx_result,
        )

        pptx_result = tool_results_for("call_pptx")
        check(
            "D2 同段落多 run 合并成一行",
            "小K 在本季度实现了增长" in pptx_result,
            pptx_result,
        )

        xlsx_result = tool_results_for("call_xlsx")
        check(
            "D3a 稀疏列按引用补位，不左移",
            "客户\t\t收入\t\t毛利" in xlsx_result,
            xlsx_result,
        )
        check(
            "D3b 表头是真实标签名 2026预算 而不是 sheet1",
            "2026预算" in xlsx_result and "# sheet1" not in xlsx_result,
            xlsx_result,
        )

        legacy_result = tool_results_for("call_legacy")
        check(
            "D4 OLE2 假 xlsx 给出可执行提示",
            ".xls" in legacy_result
            and "另存为" in legacy_result
            and "end of central directory" not in legacy_result,
            legacy_result,
        )

        pdf_result = tool_results_for("call_pdf")
        check(
            "D1 PDF 返回明确错误而不是字节",
            pdf_result.startswith("Error:")
            and "PDF" in pdf_result
            and "\ufffd" not in pdf_result,
            pdf_result,
        )

        png_result = tool_results_for("call_png")
        check(
            "D1 未知二进制返回明确错误而不是乱码",
            png_result.startswith("Error:")
            and "二进制" in png_result
            and "\ufffd" not in png_result,
            png_result,
        )

        print(f"\n--- Requests observed by fake OpenAI server: {len(server.requests)} ---")
    finally:
        harness.stop()
        server.close()
        if args.keep:
            print(f"workspace kept at {workspace}")
        else:
            shutil.rmtree(workspace, ignore_errors=True)

    if failures:
        print(f"\nFAIL: office read e2e — {len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("\nPASS: office read e2e completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
