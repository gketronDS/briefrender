from datetime import UTC, datetime

from shared_types import (
    Attachment,
    AttachmentKind,
    AxisInfo,
    ChartAnalysis,
    DetectionResult,
    DimensionResult,
    JobInput,
    JobOutput,
    JobRecord,
    JobStatus,
    NarrationScript,
    PipelineStageResult,
    QualityAudit,
    ScriptSegment,
    ShapeInfo,
    SlideContent,
    TextBlocks,
    VideoArtifact,
)


def _round_trip(cls, instance):
    restored = cls.model_validate_json(instance.model_dump_json())
    assert restored == instance


class TestShapeInfo:
    def test_round_trip(self):
        _round_trip(
            ShapeInfo,
            ShapeInfo(
                shape_type="Picture",
                position=(0.0, 0.0, 100.0, 100.0),
                image_bytes=b"\x89PNG\r\n",
                is_chart_object=False,
            ),
        )

    def test_chart_object(self):
        _round_trip(
            ShapeInfo,
            ShapeInfo(
                shape_type="Chart",
                position=(10.0, 20.0, 300.0, 200.0),
                text="Revenue by Quarter",
                is_chart_object=True,
            ),
        )

    def test_json_schema(self):
        schema = ShapeInfo.model_json_schema()
        assert "shape_type" in schema["properties"]


class TestSlideContent:
    def test_round_trip(self):
        _round_trip(
            SlideContent,
            SlideContent(
                slide_number=1,
                shapes=[
                    ShapeInfo(
                        shape_type="TextBox", position=(0.0, 0.0, 50.0, 20.0), text="Title", is_chart_object=False
                    ),
                ],
                text_context="Title slide with overview",
            ),
        )

    def test_empty_shapes(self):
        _round_trip(SlideContent, SlideContent(slide_number=2, shapes=[], text_context=""))


class TestDetectionResult:
    def test_round_trip(self):
        _round_trip(
            DetectionResult,
            DetectionResult(
                is_chart=True,
                confidence=0.95,
                chart_type="bar",
                detection_method="heuristic",
            ),
        )

    def test_no_chart(self):
        _round_trip(
            DetectionResult,
            DetectionResult(
                is_chart=False,
                confidence=0.1,
                detection_method="llm_vision",
            ),
        )


class TestAxisInfo:
    def test_round_trip(self):
        _round_trip(AxisInfo, AxisInfo(label="Revenue ($M)", units="millions", range=(0.0, 100.0)))

    def test_minimal(self):
        _round_trip(AxisInfo, AxisInfo())


class TestChartAnalysis:
    def test_round_trip(self):
        _round_trip(
            ChartAnalysis,
            ChartAnalysis(
                chart_type="bar",
                title="Q4 Revenue by Region",
                x_axis=AxisInfo(label="Region"),
                y_axis=AxisInfo(label="Revenue", units="$M", range=(0.0, 50.0)),
                key_insights=["APAC grew 23% YoY", "EMEA flat"],
                data_narrative="This bar chart shows regional revenue for Q4.",
                statistical_claims=["23% growth in APAC"],
                audience_context="Executive leadership team",
            ),
        )

    def test_json_schema(self):
        assert "properties" in ChartAnalysis.model_json_schema()


class TestDimensionResult:
    def test_round_trip(self):
        _round_trip(
            DimensionResult,
            DimensionResult(score=7.5, issues=["Missing axis label"], suggestions=["Add y-axis label"]),
        )


class TestQualityAudit:
    def test_round_trip(self):
        dim_ok = DimensionResult(score=9.0, issues=[], suggestions=[])
        _round_trip(
            QualityAudit,
            QualityAudit(
                overall_score=8.0,
                visual_clarity=dim_ok,
                statistical_integrity=DimensionResult(
                    score=7.0, issues=["No error bars"], suggestions=["Add error bars"]
                ),
                communication=dim_ok,
                passed=True,
                summary="Chart meets quality standards.",
            ),
        )


class TestScriptSegment:
    def test_round_trip(self):
        _round_trip(
            ScriptSegment,
            ScriptSegment(text="Let's look at Q4 revenue.", duration_seconds=5.0, visual_cue="full chart"),
        )


class TestNarrationScript:
    def test_round_trip(self):
        _round_trip(
            NarrationScript,
            NarrationScript(
                segments=[
                    ScriptSegment(text="Welcome.", duration_seconds=4.0, visual_cue="title slide"),
                    ScriptSegment(text="Revenue grew 15%.", duration_seconds=6.0, visual_cue="bar chart"),
                ],
                total_duration=10.0,
                tone="professional",
            ),
        )


class TestVideoArtifact:
    def test_round_trip(self):
        _round_trip(
            VideoArtifact,
            VideoArtifact(video_path="/data/jobs/abc/output/video.mp4", duration=30.0, resolution=(1920, 1080)),
        )

    def test_format_defaults_to_mp4(self):
        v = VideoArtifact(video_path="/tmp/x.mp4", duration=10.0, resolution=(1920, 1080))
        assert v.format == "mp4"


class TestPipelineStageResult:
    def test_round_trip(self):
        now = datetime.now(UTC)
        _round_trip(
            PipelineStageResult,
            PipelineStageResult(stage="ingest", started_at=now, completed_at=now, result={"slides_count": 5}),
        )


class TestAttachment:
    def test_inline_data_round_trip(self):
        _round_trip(
            Attachment,
            Attachment(
                kind=AttachmentKind.IMAGE_PNG,
                filename="chart.png",
                content_type="image/png",
                data=b"\x89PNG\r\n",
            ),
        )

    def test_url_only_round_trip(self):
        _round_trip(
            Attachment,
            Attachment(kind=AttachmentKind.TABLE_CSV, url="https://example.com/data.csv"),
        )

    def test_kind_defaults_to_other(self):
        a = Attachment(url="https://example.com/foo")
        assert a.kind is AttachmentKind.OTHER


class TestTextBlocks:
    def test_round_trip(self):
        _round_trip(
            TextBlocks,
            TextBlocks(finding="X dropped", why="seasonal", recommendation="hedge", caveats="small N"),
        )

    def test_all_optional(self):
        _round_trip(TextBlocks, TextBlocks())


class TestJobInput:
    def test_full_round_trip(self):
        _round_trip(
            JobInput,
            JobInput(
                voice_id="alex",
                intent="explain Q4 revenue dip",
                text_blocks=TextBlocks(finding="Revenue dropped 18% QoQ"),
                attachments=[
                    Attachment(kind=AttachmentKind.IMAGE_PNG, filename="chart.png", data=b"\x89PNG\r\n"),
                    Attachment(kind=AttachmentKind.TABLE_CSV, url="https://example.com/q4.csv"),
                ],
                source_pptx_url="https://example.com/deck.pptx",
                hosted_player=True,
                recipient_webhook="https://example.com/hook",
            ),
        )

    def test_empty_round_trip(self):
        _round_trip(JobInput, JobInput())

    def test_attachments_default_empty(self):
        assert JobInput().attachments == []


class TestJobOutput:
    def test_round_trip(self):
        _round_trip(
            JobOutput,
            JobOutput(
                video_url="/files/x/output.mp4",
                transcript_url="/files/x/transcript.txt",
                capsule_url="/files/x/capsule.json",
                player_url="https://player.example.com/x",
            ),
        )

    def test_all_optional(self):
        _round_trip(JobOutput, JobOutput())


class TestJobRecord:
    def test_round_trip(self):
        now = datetime.now(UTC)
        _round_trip(
            JobRecord,
            JobRecord(
                id="550e8400-e29b-41d4-a716-446655440000",
                status=JobStatus.PROCESSING,
                input_file_url="/data/uploads/abc/source.pptx",
                stages=[
                    PipelineStageResult(stage="ingest", started_at=now, completed_at=now, result={"slides_count": 3})
                ],
                created_at=now,
            ),
        )

    def test_all_statuses(self):
        now = datetime.now(UTC)
        for status in JobStatus:
            _round_trip(JobRecord, JobRecord(id="test", status=status, input_file_url="/test.pptx", created_at=now))

    def test_json_schema(self):
        schema = JobRecord.model_json_schema()
        assert "status" in schema["properties"]
