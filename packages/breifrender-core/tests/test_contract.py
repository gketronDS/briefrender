"""Compat harness for the Evolvable contract (#301, design doc §1.4).

- Historical goldens load through the migration chain and validate at current.
- The FUTURE golden loads, a known field is edited, and every unknown field
  survives the dump byte-for-byte.
- dump → load → dump is idempotent for every golden.
- The migration chain is checked for gaps at import time.
"""

import json
from pathlib import Path

import pytest

from shared_types import (
    CURRENT_SCHEMA_VERSION,
    BBox,
    CameraMove,
    Deck,
    Evolvable,
    Narration,
    Scene,
    VersionedDoc,
    VideoPlan,
    VisualElement,
    load_deck,
    load_video_plan,
)
from shared_types import contract as contract_module
from shared_types.contract import _MIGRATIONS, _check_migration_chain, migration

GOLDEN_DIR = Path(__file__).parent / "golden"


def _load_golden(name: str) -> dict:
    return json.loads((GOLDEN_DIR / name).read_text())


def _assert_subtree(expected: object, actual: object, path: str = "$") -> None:
    """Every key/value in `expected` must appear identically in `actual`."""
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path}: expected dict, got {type(actual).__name__}"
        for key, value in expected.items():
            assert key in actual, f"{path}.{key}: missing from dump"
            _assert_subtree(value, actual[key], f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list), f"{path}: expected list, got {type(actual).__name__}"
        assert len(expected) == len(actual), f"{path}: length {len(actual)} != {len(expected)}"
        for i, (e, a) in enumerate(zip(expected, actual, strict=True)):
            _assert_subtree(e, a, f"{path}[{i}]")
    else:
        assert json.dumps(expected) == json.dumps(actual), f"{path}: {actual!r} != {expected!r}"


class TestEvolvableBase:
    def test_extra_fields_are_retained_and_redumped(self):
        bbox = BBox.model_validate({"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4, "rotation_deg": 45})
        assert bbox.model_dump(mode="json")["rotation_deg"] == 45

    def test_versioned_doc_defaults(self):
        class Doc(VersionedDoc):
            pass

        doc = Doc()
        assert doc.schema_version == CURRENT_SCHEMA_VERSION
        assert doc.revision == 0

    def test_future_schema_version_preserved_on_load_and_dump(self):
        # A newer writer's schema_version (> current) must survive load/dump
        # untouched — never reset to the local default (design doc §1.2).
        raw = _load_golden("videoplan.vFUTURE.json")
        future = CURRENT_SCHEMA_VERSION + 5
        raw["schema_version"] = future
        plan = load_video_plan(raw)
        assert plan.schema_version == future
        assert plan.model_dump(mode="json")["schema_version"] == future

    def test_load_does_not_mutate_caller_dict(self):
        raw = _load_golden("videoplan.v1.json")
        before = json.dumps(raw, sort_keys=True)
        load_video_plan(raw)
        assert json.dumps(raw, sort_keys=True) == before

    def test_invalid_schema_version_raises_value_error(self):
        raw = _load_golden("videoplan.v1.json")
        raw["schema_version"] = 0
        with pytest.raises(ValueError):
            load_video_plan(raw)

    def test_open_kind_strings_accept_unknown_values(self):
        move = CameraMove(kind="orbit", start=0.0, duration=1.0)
        assert move.kind == "orbit"
        el = VisualElement(
            id="e1",
            kind="hologram_chart",
            bbox=BBox(x=0.0, y=0.0, w=1.0, h=1.0),
            content_hash="0" * 64,
        )
        assert el.kind == "hologram_chart"


class TestHistoricalGoldens:
    def test_deck_v1_loads_and_validates(self):
        deck = load_deck(_load_golden("deck.v1.json"))
        assert isinstance(deck, Deck)
        assert deck.schema_version == CURRENT_SCHEMA_VERSION
        assert deck.units[0].kind == "slide"
        assert deck.elements["el-chart-1"].bbox.w == 0.6

    def test_videoplan_v1_loads_and_validates(self):
        plan = load_video_plan(_load_golden("videoplan.v1.json"))
        assert isinstance(plan, VideoPlan)
        assert plan.schema_version == CURRENT_SCHEMA_VERSION
        assert isinstance(plan.scenes[0], Scene)
        assert isinstance(plan.scenes[0].narration, Narration)
        assert plan.scenes[0].focus_order[1].kind == "zoom_in"

    @pytest.mark.parametrize(
        ("name", "loader"),
        [
            ("deck.v1.json", load_deck),
            ("videoplan.v1.json", load_video_plan),
            ("videoplan.vFUTURE.json", load_video_plan),
        ],
    )
    def test_dump_load_dump_idempotent(self, name, loader):
        first = loader(_load_golden(name)).model_dump(mode="json")
        second = loader(first).model_dump(mode="json")
        assert first == second


class TestFutureGolden:
    def test_future_golden_loads(self):
        plan = load_video_plan(_load_golden("videoplan.vFUTURE.json"))
        assert isinstance(plan, VideoPlan)
        assert plan.scenes[0].focus_order[0].kind == "orbit"

    def test_unknown_fields_survive_edit_and_dump(self):
        raw = _load_golden("videoplan.vFUTURE.json")
        plan = load_video_plan(raw)

        # Edit a known field, as an older editor would.
        plan.outline = "Edited by an older writer."

        dumped = plan.model_dump(mode="json")
        expected = dict(raw)
        expected["outline"] = "Edited by an older writer."
        _assert_subtree(expected, dumped)

    def test_unknown_fields_survive_json_round_trip(self):
        raw = _load_golden("videoplan.vFUTURE.json")
        plan = load_video_plan(raw)
        dumped = json.loads(plan.model_dump_json())
        _assert_subtree(raw, dumped)


class TestMigrationRegistry:
    def test_chain_is_complete_at_import(self):
        # Trivially true at v1, but the check itself must exist and pass.
        _check_migration_chain(_MIGRATIONS, CURRENT_SCHEMA_VERSION)

    def test_gap_in_chain_raises(self):
        with pytest.raises(RuntimeError, match="[Mm]igration"):
            _check_migration_chain({1: lambda d: d}, 3)

    def test_empty_chain_raises_for_version_above_one(self):
        with pytest.raises(RuntimeError):
            _check_migration_chain({}, 2)

    def test_complete_simulated_chain_passes(self):
        _check_migration_chain({1: lambda d: d, 2: lambda d: d}, 3)

    def test_migration_decorator_registers(self, monkeypatch):
        registry: dict = {}
        monkeypatch.setattr(contract_module, "_MIGRATIONS", registry)

        @migration(1)
        def migrate_v1_to_v2(raw: dict) -> dict:
            return raw

        assert registry[1] is migrate_v1_to_v2

    def test_load_walks_migration_chain(self, monkeypatch):
        monkeypatch.setattr(contract_module, "CURRENT_SCHEMA_VERSION", 2)

        def migrate_v1_to_v2(raw: dict) -> dict:
            raw = dict(raw)
            raw["outline"] = raw.pop("legacy_outline", "")
            return raw

        monkeypatch.setattr(contract_module, "_MIGRATIONS", {1: migrate_v1_to_v2})

        raw = _load_golden("videoplan.v1.json")
        del raw["schema_version"]  # missing schema_version defaults to 1
        raw["legacy_outline"] = "migrated spine"
        raw.pop("outline", None)

        plan = load_video_plan(raw)
        assert plan.outline == "migrated spine"
        assert plan.schema_version == 2


class TestExports:
    def test_all_contract_names_exported(self):
        import shared_types

        for name in (
            "CURRENT_SCHEMA_VERSION",
            "Evolvable",
            "VersionedDoc",
            "BBox",
            "AssetRef",
            "EvidenceSpan",
            "ElementAnalysis",
            "VisualElement",
            "SourceUnit",
            "Deck",
            "CameraMove",
            "Narration",
            "Scene",
            "FactCheckReport",
            "VideoPlan",
            "migration",
            "load_deck",
            "load_video_plan",
        ):
            assert hasattr(shared_types, name), name
            assert name in shared_types.__all__, name

    def test_existing_exports_intact(self):
        import shared_types

        for name in ("ChartAnalysis", "JobRecord", "JobStatus", "TriageResult", "ShapeInfo"):
            assert hasattr(shared_types, name), name

    def test_evolvable_is_base_of_contract_models(self):
        for cls in (BBox, CameraMove, Narration, Scene, VisualElement):
            assert issubclass(cls, Evolvable)
        assert issubclass(Deck, VersionedDoc)
        assert issubclass(VideoPlan, VersionedDoc)
