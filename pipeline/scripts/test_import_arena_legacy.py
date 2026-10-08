"""Tests for the unpickler hardening and download integrity checks of import_arena_legacy.py.

Run (from the repo root):  python -m unittest discover -s pipeline/scripts -p "test_*.py" -v
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import import_arena_legacy as m  # noqa: E402


def _short(s: str) -> bytes:
    b = s.encode()
    return b"\x8c" + bytes([len(b)]) + b  # SHORT_BINUNICODE


def global_pickle(module: str, name: str) -> bytes:
    """Protocol-4 pickle whose only content is STACK_GLOBAL(module, name) (dotted names are legal there)."""
    return b"\x80\x04" + _short(module) + _short(name) + b"\x93."


def is_stub(obj) -> bool:
    return isinstance(obj, type) and issubclass(obj, m._Inert)


def load(payload: bytes):
    return m.SafeUnpickler(io.BytesIO(payload)).load()


class UnpicklerHardening(unittest.TestCase):
    def test_dotted_name_in_allowed_module_is_stubbed(self):
        # pandas.core.frame is fine as a module, but "sys.modules" walks to the real sys.modules
        self.assertTrue(is_stub(load(global_pickle("pandas.core.frame", "sys.modules"))))
        self.assertTrue(is_stub(load(global_pickle("pandas.core.series", "sys.modules"))))

    def test_any_dotted_name_is_stubbed_even_for_allowed_pairs(self):
        self.assertTrue(is_stub(load(global_pickle("pandas.core.frame", "DataFrame.__init__"))))
        self.assertTrue(is_stub(load(global_pickle("builtins", "str.join"))))

    def test_module_objects_under_allowed_prefixes_are_not_reachable(self):
        # the old prefix allow-list resolved ("pandas.core.frame", "sys") to the real sys module
        self.assertTrue(is_stub(load(global_pickle("pandas.core.frame", "sys"))))
        self.assertTrue(is_stub(load(global_pickle("pandas.core.series", "lib"))))

    def test_dangerous_callables_are_stubbed(self):
        for mod, name in [("os", "system"), ("builtins", "eval"), ("builtins", "getattr"), ("subprocess", "Popen"),
                          ("sys", "exit"), ("operator", "attrgetter"), ("plotly.graph_objs._figure", "Figure")]:
            with self.subTest(mod=mod, name=name):
                self.assertTrue(is_stub(load(global_pickle(mod, name))))

    def test_stubbed_names_are_recorded(self):
        m.SafeUnpickler.stubbed.clear()
        load(global_pickle("os", "system"))
        self.assertIn("os.system", m.SafeUnpickler.stubbed)

    def test_allowlist_is_exact_module_name_pairs(self):
        # every entry is a (module, name) pair with a plain (non-dotted) name ...
        for entry in m._ALLOWED:
            self.assertIsInstance(entry, tuple)
            self.assertEqual(len(entry), 2)
            self.assertNotIn(".", entry[1])
        # ... and each one really resolves to the genuine object (not a stub)
        u = m.SafeUnpickler(io.BytesIO(b""))
        for module, name in sorted(m._ALLOWED):
            with self.subTest(module=module, name=name):
                self.assertFalse(is_stub(u.find_class(module, name)))

    def test_neighbouring_names_in_allowed_modules_are_stubbed(self):
        u = m.SafeUnpickler(io.BytesIO(b""))
        self.assertTrue(is_stub(u.find_class("pandas.core.frame", "sys")))
        self.assertTrue(is_stub(u.find_class("pandas._libs.internals", "BlockManager")))
        self.assertTrue(is_stub(u.find_class("numpy", "load")))
        self.assertTrue(is_stub(u.find_class("builtins", "open")))


class FakeHttp:
    def __init__(self, routes: dict[str, bytes]):
        self.routes = routes
        self.calls: list[str] = []

    def __call__(self, url: str, retries: int = 4) -> bytes:
        self.calls.append(url)
        return self.routes[url]


def blob_sha1(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


class Integrity(unittest.TestCase):
    def test_list_space_files_reports_lfs_sha256_and_git_blob_sha1(self):
        tree = [
            {"type": "directory", "path": "assets", "oid": "d" * 40},
            {"type": "file", "path": "elo_results_20230508.pkl", "size": 10, "oid": "a" * 40,
             "lfs": {"oid": "b" * 64, "size": 10, "pointerSize": 130}},
            {"type": "file", "path": "leaderboard_table_20230619.csv", "size": 5, "oid": "c" * 40},
        ]
        http = FakeHttp({m.TREE_URL.format(space=m.SPACE, rev="REV"): json.dumps(tree).encode()})
        with mock.patch.object(m, "http_get", http):
            files = m.list_space_files("REV")
        self.assertEqual(set(files), {"elo_results_20230508.pkl", "leaderboard_table_20230619.csv"})
        self.assertEqual(files["elo_results_20230508.pkl"]["size"], 10)
        self.assertEqual(files["elo_results_20230508.pkl"]["algo"], "sha256")
        self.assertEqual(files["elo_results_20230508.pkl"]["digest"], "b" * 64)
        self.assertEqual(files["leaderboard_table_20230619.csv"]["algo"], "git-sha1")
        self.assertEqual(files["leaderboard_table_20230619.csv"]["digest"], "c" * 40)

    def _info(self, data: bytes, algo: str = "sha256") -> dict:
        digest = hashlib.sha256(data).hexdigest() if algo == "sha256" else blob_sha1(data)
        return {"size": len(data), "algo": algo, "digest": digest}

    def test_download_with_matching_sha256_is_cached(self):
        data = b"pickle-bytes"
        url = m.FILE_URL.format(space=m.SPACE, rev="REV", name="x.pkl")
        http = FakeHttp({url: data})
        with tempfile.TemporaryDirectory() as td, mock.patch.object(m, "http_get", http):
            p = m.cached("x.pkl", self._info(data), Path(td), "REV")
            self.assertEqual(p.read_bytes(), data)

    def test_download_with_wrong_sha256_but_right_size_is_rejected(self):
        good, evil = b"pickle-bytes", b"PICKLE-BYTES"  # same length
        self.assertEqual(len(good), len(evil))
        url = m.FILE_URL.format(space=m.SPACE, rev="REV", name="x.pkl")
        http = FakeHttp({url: evil})
        with tempfile.TemporaryDirectory() as td, mock.patch.object(m, "http_get", http):
            with self.assertRaisesRegex(RuntimeError, "sha256"):
                m.cached("x.pkl", self._info(good), Path(td), "REV")
            self.assertFalse((Path(td) / "x.pkl").exists())

    def test_cached_file_with_right_size_but_wrong_sha256_is_redownloaded(self):
        good, evil = b"pickle-bytes", b"PICKLE-BYTES"
        url = m.FILE_URL.format(space=m.SPACE, rev="REV", name="x.pkl")
        http = FakeHttp({url: good})
        with tempfile.TemporaryDirectory() as td, mock.patch.object(m, "http_get", http):
            (Path(td) / "x.pkl").write_bytes(evil)
            p = m.cached("x.pkl", self._info(good), Path(td), "REV")
            self.assertEqual(p.read_bytes(), good)
            self.assertEqual(len(http.calls), 1)

    def test_valid_cached_file_is_not_downloaded_again(self):
        data = b"pickle-bytes"
        http = FakeHttp({})
        with tempfile.TemporaryDirectory() as td, mock.patch.object(m, "http_get", http):
            (Path(td) / "x.pkl").write_bytes(data)
            m.cached("x.pkl", self._info(data), Path(td), "REV")
            self.assertEqual(http.calls, [])

    def test_git_blob_sha1_is_verified_for_non_lfs_files(self):
        good, evil = b"a,b\n1,2\n", b"a,b\n9,9\n"
        url = m.FILE_URL.format(space=m.SPACE, rev="REV", name="t.csv")
        with tempfile.TemporaryDirectory() as td:
            with mock.patch.object(m, "http_get", FakeHttp({url: good})):
                m.cached("t.csv", self._info(good, "git-sha1"), Path(td), "REV")
            with mock.patch.object(m, "http_get", FakeHttp({url: evil})), tempfile.TemporaryDirectory() as td2:
                with self.assertRaisesRegex(RuntimeError, "git-sha1"):
                    m.cached("t.csv", self._info(good, "git-sha1"), Path(td2), "REV")

    def test_size_mismatch_is_still_rejected(self):
        data = b"pickle-bytes"
        url = m.FILE_URL.format(space=m.SPACE, rev="REV", name="x.pkl")
        info = self._info(data)
        info["size"] += 1
        with tempfile.TemporaryDirectory() as td, mock.patch.object(m, "http_get", FakeHttp({url: data})):
            with self.assertRaisesRegex(RuntimeError, "bytes"):
                m.cached("x.pkl", info, Path(td), "REV")

    def test_pickles_without_a_sha256_are_refused(self):
        data = b"pickle-bytes"
        info = self._info(data, "git-sha1")
        with tempfile.TemporaryDirectory() as td, mock.patch.object(m, "http_get", FakeHttp({})):
            with self.assertRaisesRegex(RuntimeError, "sha256"):
                m.cached("x.pkl", info, Path(td), "REV", require="sha256")


if __name__ == "__main__":
    unittest.main()
