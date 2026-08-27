from unittest.mock import patch

from fastapi.testclient import TestClient

from briefrender.api import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_openapi():
    response = client.get("/openapi.json")
    assert response.status_code == 200
    assert "/health" in response.json()["paths"]


def test_hits():
    with patch("briefrender.api.cache.incr", return_value=7) as incr:
        response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "Hello World! This page has been visited 7 times."}
    incr.assert_called_once_with("hits")
