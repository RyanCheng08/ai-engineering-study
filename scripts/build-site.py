"""Assemble the public learning site without collecting private source files."""
from __future__ import annotations

import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import stat
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).absolute().parent.parent
NOTES_DIR = PurePosixPath('可视化页面')
VIDEO_DIR = PurePosixPath('讲解视频/成片')
NOTE_FILES = (
    'chapter-one.html',
    'chapter-one-quiz.html',
    '第一章测试题-题目版.txt',
    '第一章测试题-答案解析.txt',
)
MEDIA_SUFFIXES = {'.mp4', '.vtt', '.srt', '.jpg', '.png'}
PRIVATE_PATTERNS = (b'internal-api-drive-stream', b'authcode/?code=')
ANCHOR = re.compile(r'<a\b[^>]*>.*?</a\s*>', re.IGNORECASE | re.DOTALL)
HREF = re.compile(r'(\bhref\s*=\s*)([\'"])(.*?)\2', re.IGNORECASE | re.DOTALL)
IMAGE_REFERENCE = re.compile(
    r'<span\b[^>]*\bclass\s*=\s*([\'"])[^\'"]*\bimage-reference\b[^\'"]*\1[^>]*>.*?</span\s*>',
    re.IGNORECASE | re.DOTALL,
)


def reject_links(path: Path, root: Path) -> None:
    """Check the un-resolved path so symlinks and directory junctions stay visible."""
    path.relative_to(root)
    current = path
    while True:
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            metadata = None
        reparse = metadata is not None and bool(
            getattr(metadata, 'st_file_attributes', 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        )
        if current.is_symlink() or reparse:
            raise ValueError(f'Symbolic links and directory junctions are not allowed: {current}')
        if current == root:
            break
        current = current.parent


def read_source(root: Path, relative: PurePosixPath) -> Path:
    source = root.joinpath(*relative.parts)
    reject_links(source, root)
    if not source.is_file():
        raise ValueError(f'Required regular source file is missing: {relative}')
    return source


def is_private_image_url(value: str) -> bool:
    decoded = unquote(html.unescape(value)).lower()
    return 'internal-api-drive-stream' in decoded or 'authcode/?code=' in decoded


def public_notes(text: str) -> str:
    def remove_resume(match: re.Match[str]) -> str:
        href = HREF.search(match.group(0))
        if href and unquote(urlsplit(html.unescape(href.group(3))).path).split('/')[-1].lower() == 'resume.html':
            return ''
        return match.group(0)

    text = ANCHOR.sub(remove_resume, text)
    text = text.replace('个人履历与学习笔记', '第一章学习中心')

    def replace_image_notice(match: re.Match[str]) -> str:
        if is_private_image_url(match.group(0)) or any(href.group(3) == '#chapter-3' for href in HREF.finditer(match.group(0))):
            return ('<span class="image-reference"><b>原文图片</b>'
                    '原笔记图片需要授权，公开版请参考本节学习主线图。'
                    '<br><a href="#chapter-3">查看本节学习主线 →</a></span>')
        return match.group(0)

    text = IMAGE_REFERENCE.sub(replace_image_notice, text)
    text = HREF.sub(lambda match: match.group(1) + match.group(2) +
                    ('#chapter-3' if is_private_image_url(match.group(3)) else match.group(3)) +
                    match.group(2), text)
    if 'resume.html' in text.lower() or '个人履历与学习笔记' in text:
        raise ValueError('A private navigation entry remains in the public notes')
    return text


def video_allowed(name: str) -> bool:
    return (
        Path(name).suffix.lower() in MEDIA_SUFFIXES
        or name in {'index.html', '使用说明.txt', '课程目录.json'}
        or re.fullmatch(r'1\.[2-7]-.+-旁白稿\.txt', name) is not None
        or re.fullmatch(r'1\.[2-7]-章节时间轴\.json', name) is not None
    )


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: list[str] = []
        self.ids: set[str] = set()
        self.video_data: list[str] = []
        self.capture_data = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if attributes.get('id'):
            self.ids.add(attributes['id'])
        for attr in ('href', 'src', 'poster'):
            if attributes.get(attr):
                self.refs.append(attributes[attr])
        if tag == 'script' and attributes.get('id') == 'data' and attributes.get('type') == 'application/json':
            self.capture_data = True

    def handle_endtag(self, tag: str) -> None:
        if tag == 'script':
            self.capture_data = False

    def handle_data(self, data: str) -> None:
        if self.capture_data:
            self.video_data.append(data)


def page_text(source: bytes | Path) -> str:
    return source.decode('utf-8-sig') if isinstance(source, bytes) else source.read_text(encoding='utf-8-sig')


def validate_urls(plan: dict[PurePosixPath, bytes | Path]) -> int:
    pages: dict[PurePosixPath, PageParser] = {}
    for relative, source in plan.items():
        if relative.suffix == '.html':
            parser = PageParser()
            parser.feed(page_text(source))
            pages[relative] = parser
    checked = 0
    for relative, parser in pages.items():
        for ref in parser.refs:
            parts = urlsplit(ref)
            if parts.scheme or parts.netloc:
                continue
            if parts.path.startswith('/') or '\\' in parts.path:
                raise ValueError(f'Link must stay relative to the project Pages path: {relative}: {ref}')
            target = PurePosixPath(posixpath.normpath(posixpath.join(relative.parent.as_posix(), unquote(parts.path)))) if parts.path else relative
            if target not in plan:
                raise ValueError(f'Broken or unpublished local link: {relative}: {ref}')
            if parts.fragment and target in pages:
                fragment = unquote(parts.fragment)
                quiz_route = target.name == 'chapter-one.html' and re.fullmatch(r'quiz-[1-7](?:-(?:0[1-9]|10))?', fragment)
                if fragment not in pages[target].ids and not quiz_route:
                    raise ValueError(f'Unknown page fragment: {relative}: {ref}')
            checked += 1
    player = pages[VIDEO_DIR / 'index.html']
    lessons = json.loads(''.join(player.video_data))
    if [lesson['number'] for lesson in lessons] != [f'1.{n}' for n in range(2, 8)]:
        raise ValueError('The video player must contain the six ordered lessons 1.2–1.7')
    for lesson in lessons:
        for asset in (lesson['file'], lesson['poster'],
                      lesson['file'].removesuffix('.mp4') + '.srt',
                      lesson['file'].removesuffix('.mp4') + '-旁白稿.txt'):
            if '/' in asset or '\\' in asset or not video_allowed(asset) or VIDEO_DIR / asset not in plan:
                raise ValueError(f'Missing or invalid video player attachment: {asset}')
            checked += 1
    return checked


def validate_existing_site(root: Path, site: Path, plan: dict[PurePosixPath, bytes | Path]) -> None:
    reject_links(site, root)
    if not site.exists():
        return
    if not site.is_dir():
        raise ValueError('_site must be a regular directory')
    allowed_dirs = {PurePosixPath('.')}
    for relative in plan:
        allowed_dirs.update(relative.parents)
    for current, dirs, files in os.walk(site, followlinks=False):
        directory = Path(current)
        for name in dirs:
            path = directory / name
            reject_links(path, root)
            if PurePosixPath(path.relative_to(site).as_posix()) not in allowed_dirs:
                raise ValueError(f'Unexpected existing output directory: {path.relative_to(site)}')
        for name in files:
            path = directory / name
            reject_links(path, root)
            if not path.is_file() or PurePosixPath(path.relative_to(site).as_posix()) not in plan:
                raise ValueError(f'Unexpected existing output file: {path.relative_to(site)}')


def assert_no_private_urls(path: Path) -> None:
    """Stream every published file, including media, without loading it all into RAM."""
    carry = b''
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            data = (carry + chunk).lower()
            if any(pattern in data for pattern in PRIVATE_PATTERNS):
                raise ValueError(f'An internal image authorization URL remains in: {path.name}')
            carry = data[-64:]


def build(root: Path = ROOT) -> dict[str, int]:
    root = root.absolute()
    reject_links(root, root)
    site = root / '_site'
    plan: dict[PurePosixPath, bytes | Path] = {
        PurePosixPath('index.html'): read_source(root, PurePosixPath('public-index.html')).read_bytes(),
        PurePosixPath('.nojekyll'): b'',
    }
    for name in NOTE_FILES:
        relative = NOTES_DIR / name
        source = read_source(root, relative)
        plan[relative] = public_notes(source.read_text(encoding='utf-8-sig')).encode('utf-8') if name == 'chapter-one.html' else source
    plan[NOTES_DIR / 'index.html'] = (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta http-equiv="refresh" content="0;url=../index.html">'
        '<title>第一章学习中心</title></head><body>'
        '<p><a href="../index.html">前往第一章学习中心 →</a></p></body></html>'
    ).encode('utf-8')
    video_source = root.joinpath(*VIDEO_DIR.parts)
    reject_links(video_source, root)
    if not video_source.is_dir():
        raise ValueError('The video output directory is missing')
    video_count = 0
    for source in sorted(video_source.iterdir()):
        reject_links(source, root)
        if not source.is_file() or not video_allowed(source.name):
            raise ValueError(f'Unapproved video output file or directory: {source.name}')
        plan[VIDEO_DIR / source.name] = source
        video_count += source.suffix.lower() == '.mp4'
    if video_count != 6 or VIDEO_DIR / 'index.html' not in plan:
        raise ValueError('The public site requires six completed videos and their player')
    checked = validate_urls(plan)
    validate_existing_site(root, site, plan)
    for relative, source in plan.items():
        destination = site.joinpath(*relative.parts)
        reject_links(destination, root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(source, bytes):
            destination.write_bytes(source)
        else:
            shutil.copy2(source, destination)
        assert_no_private_urls(destination)
    report = {'publicFiles': len(plan), 'videos': video_count, 'localLinksChecked': checked}
    print(json.dumps(report, ensure_ascii=False))
    return report


if __name__ == '__main__':
    build()
