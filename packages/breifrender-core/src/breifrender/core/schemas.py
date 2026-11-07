import base64
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, PlainSerializer, PlainValidator


def _bytes_from_json(v: object) -> bytes:
    if isinstance(v, bytes):
        return v
    if isinstance(v, str):
        return base64.b64decode(v)
    raise ValueError(f"Cannot convert {type(v)} to bytes")


Base64Bytes = Annotated[
    bytes,
    PlainValidator(_bytes_from_json),
    PlainSerializer(lambda v: base64.b64encode(v).decode(), return_type=str),
]


class ShapeInfo(BaseModel):
    shape_type: str
    position: tuple[float, float, float, float]  # left, top, width, height
    text: str | None = None
    image_bytes: Base64Bytes | None = None
    is_chart_object: bool


class SlideContent(BaseModel):
    slide_number: int
    shapes: list[ShapeInfo]
    text_context: str
    speaker_notes: str = ""


class DetectionResult(BaseModel):
    is_chart: bool
    confidence: float = Field(ge=0.0, le=1.0)
    chart_type: str | None = None
    detection_method: Literal["heuristic", "llm_vision"]


class TriageDecision(StrEnum):
    ACCEPT = "accept"
    DEFER = "defer"
    REJECT = "reject"


class TriageResult(BaseModel):
    decision: TriageDecision
    reason: str
    chart_category: str | None = None
    complexity: Literal["low", "medium", "high"] | None = None


class AxisInfo(BaseModel):
    label: str | None = None
    units: str | None = None
    range: tuple[float, float] | None = None


class ChartAnalysis(BaseModel):
    chart_type: str
    title: str
    x_axis: AxisInfo | None = None
    y_axis: AxisInfo | None = None
    key_insights: list[str]
    data_narrative: str
    statistical_claims: list[str]
    audience_context: str


class DimensionResult(BaseModel):
    score: float = Field(ge=0.0, le=10.0)
    issues: list[str]
    suggestions: list[str]


class QualityAudit(BaseModel):
    overall_score: float = Field(ge=0.0, le=10.0)
    visual_clarity: DimensionResult
    statistical_integrity: DimensionResult
    communication: DimensionResult
    passed: bool
    summary: str


class ScriptSegment(BaseModel):
    text: str
    duration_seconds: float = Field(gt=0.0)
    visual_cue: str


class NarrationScript(BaseModel):
    segments: list[ScriptSegment]
    total_duration: float = Field(gt=0.0)
    tone: Literal["professional", "casual", "academic"]


class VideoArtifact(BaseModel):
    video_path: str
    format: Literal["mp4"] = "mp4"
    duration: float
    resolution: tuple[int, int]


class AttachmentKind(StrEnum):
    IMAGE_PNG = "image_png"
    IMAGE_JPEG = "image_jpeg"
    TABLE_CSV = "table_csv"
    AUDIO = "audio"
    VIDEO = "video"
    OTHER = "other"


class Attachment(BaseModel):
    """A multimedia attachment supplied with a job.

    Exactly one of ``data`` (inline base64 bytes) or ``url`` (remote ref) must
    be set. The server is responsible for materializing ``url`` references
    later; ``data`` is persisted to disk at ingest time.
    """

    kind: AttachmentKind = AttachmentKind.OTHER
    filename: str | None = None
    content_type: str | None = None
    data: Base64Bytes | None = None
    url: str | None = None


class TextBlocks(BaseModel):
    """Structured prose blocks consumed by the capsule/script generator."""

    finding: str | None = None
    why: str | None = None
    recommendation: str | None = None
    caveats: str | None = None


class JobInput(BaseModel):
    """v0.2 multimedia ingestion contract.

    All fields optional individually but the caller must supply at least one
    content source (``text_blocks``, ``attachments``, or ``source_pptx_url``).
    The endpoint enforces this.
    """

    voice_id: str | None = None
    intent: str | None = None
    text_blocks: TextBlocks | None = None
    attachments: list[Attachment] = Field(default_factory=list)
    source_pptx_url: str | None = None
    hosted_player: bool = False
    recipient_webhook: str | None = None


class JobOutput(BaseModel):
    """v0.2 response shape returned once a job completes."""

    video_url: str | None = None
    transcript_url: str | None = None
    capsule_url: str | None = None
    player_url: str | None = None


class JobStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    DEAD_LETTER = "dead_letter"


class PipelineStageResult(BaseModel):
    stage: str
    started_at: datetime
    completed_at: datetime | None = None
    tokens_used: int = 0
    model: str | None = None
    result: dict


class JobRecord(BaseModel):
    id: str
    status: JobStatus
    input_file_url: str
    stages: list[PipelineStageResult] = Field(default_factory=list)
    result_video_url: str | None = None
    error: str | None = None
    created_at: datetime
    completed_at: datetime | None = None
    total_tokens_used: int = 0
