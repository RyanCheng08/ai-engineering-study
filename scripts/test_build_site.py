"""Check the published boundary and routes without reading local study records."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('build_site', Path(__file__).with_name('build-site.py'))
build_site = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_site)


def chapter_page(chapter: int, counts: list[int], redirects: dict[str, str] | None = None) -> str:
    data = {'quizBank': {'lessons': [
        {'number': f'{chapter}.{section}', 'questions': [
            {'id': f'{chapter}.{section}-{question:02d}'} for question in range(1, count + 1)
        ]} for section, count in enumerate(counts, 1)
    ]}, 'exerciseRedirects': redirects or {}}
    return ('<html><body><a href="resume.html">个人履历</a>'
            '<script type="application/json" id="page-data">' + json.dumps(data) + '</script>'
            '</body></html>')


def fixture(root: Path) -> None:
    notes = root / build_site.NOTES_DIR
    notes.mkdir()
    for name in build_site.NOTE_FILES:
        (notes / name).write_text('学习资料', encoding='utf-8')
    pages = {
        'chapter-one.html': chapter_page(1, [10] * 7),
        'chapter-two.html': chapter_page(2, [14, 14, 14, 16, 15]),
        'chapter-three.html': chapter_page(3, [15, 16, 14, 17, 15, 18, 20], {'c7-s39': 'quiz-7-11'}),
    }
    for name, text in pages.items():
        (notes / name).write_text(text, encoding='utf-8')
    (notes / 'index.html').write_text('<a href="../index.html">课程首页</a>', encoding='utf-8')
    (root / 'public-index.html').write_text(
        '<a href="可视化页面/chapter-one.html#quiz-7-10">第一章</a>'
        '<a href="可视化页面/chapter-two.html#quiz-1-14">第二章原题</a>'
        '<a href="可视化页面/chapter-three.html#quiz-7-20">第三章原题</a>'
        '<a href="可视化页面/chapter-three.html#c7-s39">旧答案书签</a>', encoding='utf-8')
    (notes / 'resume.html').write_text('不应发布', encoding='utf-8')
    (notes / '第三章-作答记录.json').write_text('{"favorites":[]}', encoding='utf-8')
    (root / 'lesson-notes').mkdir()
    (root / 'lesson-notes' / 'private.md').write_text('不应发布的工作区内容', encoding='utf-8')
    videos = root / build_site.VIDEO_DIR
    videos.mkdir(parents=True)
    lessons = []
    for number in range(2, 8):
        base = f'1.{number}-课程'
        lessons.append({'number': f'1.{number}', 'file': base + '.mp4', 'poster': base + '.jpg'})
        for suffix in ('.mp4', '.jpg', '.srt', '-旁白稿.txt'):
            (videos / (base + suffix)).write_bytes(b'fixture')
    (videos / 'index.html').write_text('<script id="data" type="application/json">' +
                                      json.dumps(lessons) + '</script>', encoding='utf-8')


class PublicBuildTests(unittest.TestCase):
    def test_three_chapters_publish_only_explicit_files_and_valid_routes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            report = build_site.build(root)
            self.assertEqual(report['chapters'], 3)
            self.assertEqual(report['videos'], 6)
            published_notes = root / '_site' / build_site.NOTES_DIR
            self.assertEqual({path.name for path in published_notes.iterdir()},
                             set(build_site.NOTE_FILES) | {'index.html'})
            self.assertFalse((root / '_site' / 'lesson-notes').exists())
            for name in build_site.CHAPTER_PAGES:
                self.assertNotIn('resume.html', (published_notes / name).read_text(encoding='utf-8'))
            self.assertEqual(build_site.build(root), report)

    def test_nonexistent_question_route_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            (root / 'public-index.html').write_text(
                '<a href="可视化页面/chapter-two.html#quiz-1-15">不存在的题</a>', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Unknown page fragment'):
                build_site.build(root)

    def test_invalid_legacy_redirect_is_rejected(self):
        parser = build_site.PageParser()
        parser.feed(chapter_page(3, [10], {'c1-s39': 'quiz-1-11'}))
        with self.assertRaisesRegex(ValueError, 'redirect target is missing'):
            parser.quiz_routes()

    def test_private_output_file_cannot_survive_a_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            site = root / '_site'
            site.mkdir()
            (site / '作答记录.json').write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Unexpected existing output file'):
                build_site.build(root)

    def test_new_chapter_download_cannot_contain_internal_authorization_url(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            (root / build_site.NOTES_DIR / '第二章测试题-答案解析.txt').write_text(
                'https://example.invalid/authcode/?code=fixture', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'internal image authorization URL'):
                build_site.build(root)


if __name__ == '__main__':
    unittest.main()
