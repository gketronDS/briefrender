"""The Evolvable contract: long-lived, forward-compatible document models.

Design doc: docs/chartcast-unified-decomposition.md §1-2 (#301).

Compatibility rules (the additive-only law):

1. Never remove or rename a field. Deprecate in the docstring; keep emitting.
2. New fields are optional with defaults — a vN-1 doc must validate under vN.
3. Never tighten: no new required entries, no narrowed types, no shrunk bounds.
4. Open string sets, not closed enums, for anything that can grow
   (``VisualElement.kind``, ``CameraMove.kind``, evidence ``kind``). Readers
   must treat unknown values as ignore/passthrough, never error.
5. ``schema_version`` bumps only for shape changes that need a migration.
   Purely additive changes do not bump the version.
"""

from collections.abc import Callable
from copy import deepcopy
from typing import Any

from pydantic import BaseModel, ConfigDict

CURRENT_SCHEMA_VERSION = 1


class Evolvable(BaseModel):
    """Base for every model in the long-lived contract.

    - ``extra="allow"``: unknown fields from newer writers are retained and
      re-emitted on dump — forward compatibility is automatic.
    - ``schema_version`` is a monotonic int stamped on the *root* document
      (``Deck``, ``VideoPlan``). Nested models inherit the root's version and
      do not carry their own.
    """

    model_config = ConfigDict(extra="allow")


class VersionedDoc(Evolvable):
    schema_version: int = CURRENT_SCHEMA_VERSION
    revision: int = 0  # optimistic-concurrency counter (design doc §7)


# ── Decomposition side — Deck (§2.1) ─────────────────────────────────────────


class BBox(Evolvable):
    """Normalized to the source unit's width/height (0.0-1.0)."""

    x: float
    y: float
    w: float
    h: float


class AssetRef(Evolvable):
    """Content-addressed blob reference (image, audio). Stored on disk under
    the job dir keyed by sha256; inline base64 only in transit."""

    sha256: str
    media_type: str  # "image/png", "image/webp", ...
    path: str | None = None  # server-local materialization
    url: str | None = None


class EvidenceSpan(Evolvable):
    """A verbatim, citable span of source content. Narration claims must
    resolve to these (design doc §5)."""

    id: str
    kind: str  # "text" | "table_cell" | "axis" | "series" | "code_output" | ...
    text: str  # verbatim content — never paraphrased
    locator: dict = {}  # e.g. {"row": 2, "col": "Q3"} or {"para": 0}


class ElementAnalysis(Evolvable):
    """Open container for annotator output attached to a ``VisualElement``
    (design doc §3) — e.g. ``ChartAnalysis``-shaped data for charts. Kept
    fully open (no declared fields) so annotators can evolve freely."""


class VisualElement(Evolvable):
    id: str  # stable ULID
    kind: str  # "chart" | "image" | "table" | "text" | "code_output" | "equation" | ...
    bbox: BBox
    z_order: int = 0
    source_ref: dict = {}  # {"slide": 3, "shape_id": 7} / {"page": 2} / {"cell": 5, "output": 0}
    content_hash: str  # sha256 of raw content — annotation cache key (§3)
    raster: AssetRef | None = None  # rendered/extracted pixels
    text: str | None = None  # for text elements
    table: list[list[str]] | None = None  # normalized rows for tables
    native_chart: dict | None = None  # python-pptx chart XML digest (type, series, axes)
    # ── attached by the annotator pass (§3) ──
    analysis: ElementAnalysis | None = None
    evidence: list[EvidenceSpan] = []
    featurability: float | None = None  # 0-1, focus-worthiness


class SourceUnit(Evolvable):
    """One slide / page / notebook cell."""

    id: str
    index: int  # 1-based
    kind: str  # "slide" | "page" | "cell"
    background: AssetRef | None = None  # full-unit raster
    element_ids: list[str] = []
    text_context: str = ""  # unit-level prose (slide text, markdown cell)
    speaker_notes: str = ""


class Deck(VersionedDoc):
    id: str
    source: dict  # {"format": "pptx", "filename": ..., "sha256": ...}
    units: list[SourceUnit]
    elements: dict[str, VisualElement]  # keyed by element id


# ── Reconstruction side — VideoPlan (§2.2) ───────────────────────────────────


class CameraMove(Evolvable):
    kind: str  # "hold" | "cut" | "pan" | "zoom_in" | "zoom_out"
    element_id: str | None = None  # target; bbox override allowed
    bbox: BBox | None = None
    start: float  # seconds from scene start
    duration: float


class Narration(Evolvable):
    text: str
    evidence_refs: list[str] = []  # EvidenceSpan ids grounding this text
    duration: float | None = None  # measured after TTS
    audio: AssetRef | None = None  # cached TTS, keyed by sha256(text|voice)


class Scene(Evolvable):
    id: str
    source_unit_id: str
    background: AssetRef | None = None
    element_ids: list[str] = []  # elements featured in this scene
    narration: Narration
    focus_order: list[CameraMove] = []  # ≥1 bbox-driven move for multi-element scenes
    duration: float  # narration-driven, planner-budgeted


class FactCheckReport(Evolvable):
    passed: bool
    unsupported_claims: list[dict] = []  # {"scene_id", "claim", "reason"}
    questions: list[dict] = []  # QuizBank Q/A trace (design doc §5)


class VideoPlan(VersionedDoc):
    id: str
    job_id: str
    deck_id: str
    scenes: list[Scene]  # playback order
    outline: str = ""  # deck-level narrative spine
    voice_id: str | None = None
    resolution: tuple[int, int] = (1920, 1080)
    total_duration: float  # 15-60s budget (design doc §4)
    fact_check: FactCheckReport | None = None
    # Denormalized copy of featured elements, so the plan is self-contained
    # for edit + render.
    elements: dict[str, VisualElement] = {}


# ── Migration registry (§1.3) ────────────────────────────────────────────────

_MIGRATIONS: dict[int, Callable[[dict], dict]] = {}


def migration(from_version: int) -> Callable[[Callable[[dict], dict]], Callable[[dict], dict]]:
    """Register migrate_vN_to_vN+1. Migrations are dict→dict (never model-
    level) so unknown fields pass through untouched."""

    def wrap(fn: Callable[[dict], dict]) -> Callable[[dict], dict]:
        _MIGRATIONS[from_version] = fn
        return fn

    return wrap


def _check_migration_chain(migrations: dict[int, Callable[[dict], dict]], current_version: int) -> None:
    """A missing link in the chain is a startup error, not a load-time surprise."""
    missing = [v for v in range(1, current_version) if v not in migrations]
    if missing:
        raise RuntimeError(
            f"Migration chain has gaps: no migration registered from version(s) {missing}; "
            f"the chain must cover 1..{current_version - 1} to reach CURRENT_SCHEMA_VERSION={current_version}."
        )


def _upgrade(raw: dict[str, Any]) -> dict[str, Any]:
    v = raw.get("schema_version", 1)
    if not isinstance(v, int) or v < 1:
        raise ValueError(f"invalid schema_version {v!r}: must be an integer >= 1")
    if v > CURRENT_SCHEMA_VERSION:
        # A doc from a newer writer: extra="allow" lets it round-trip, so load
        # it as-is rather than failing on an absent forward migration.
        return raw
    # Copy so upgrading never mutates the caller's dict.
    raw = deepcopy(raw)
    while v < CURRENT_SCHEMA_VERSION:
        raw = _MIGRATIONS[v](raw)
        v += 1
        raw["schema_version"] = v
    return raw


def load_video_plan(raw: dict) -> VideoPlan:
    return VideoPlan.model_validate(_upgrade(raw))


def load_deck(raw: dict) -> Deck:
    return Deck.model_validate(_upgrade(raw))


_check_migration_chain(_MIGRATIONS, CURRENT_SCHEMA_VERSION)
