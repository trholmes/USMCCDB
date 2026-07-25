"""Migration-chain sanity checks — no database needed, so they always run
(unlike test_api.py these are not skipped without TEST_DATABASE_URL).

The repo uses sequential integer revision ids, so two branches developed in
parallel can each add the same "next" id; the merge is textually clean but
Alembic then refuses to run (duplicate revision id, or forked heads when the
ids differ but both revise the same parent) — exactly what happened when
PRs #70 and #72 both added 0013. PR CI runs on the merge preview with the
base branch, so these assertions make the second PR fail before it merges:
renumber its migration onto the newest revision on main to fix.
"""

import warnings
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parents[1]


def test_single_linear_migration_chain():
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        scripts = ScriptDirectory.from_config(cfg)
        heads = scripts.get_heads()
        chain = list(scripts.walk_revisions())

    # Alembic collapses duplicate ids into one script with only a warning —
    # surface it as a failure instead.
    dups = [str(w.message) for w in caught if "more than once" in str(w.message)]
    assert not dups, f"Duplicate migration revision ids: {dups}"

    assert len(heads) == 1, (
        f"Forked migration history (heads: {heads}) — one branch must be "
        "renumbered to revise the other"
    )

    # Every version file must be reachable in the single chain (a collapsed
    # duplicate or an orphaned script would drop out silently).
    files = sorted(p.name for p in (BACKEND / "alembic" / "versions").glob("0*.py"))
    assert len(files) == len(chain), (files, [r.revision for r in chain])

    # Ids are the contiguous zero-padded sequence the repo uses, and each
    # file is named after the revision it declares.
    ids = sorted(r.revision for r in chain)
    assert ids == [f"{i:04d}" for i in range(1, len(ids) + 1)], ids
    for script in chain:
        assert Path(script.path).name.startswith(script.revision), script.path
