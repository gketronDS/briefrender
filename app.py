import os
import redis
from fastapi import FastAPI

app = FastAPI()
cache = redis.Redis(host=os.getenv("REDIS_HOST", "localhost"), port=int(os.getenv("REDIS_PORT", 6379)), db=0)

@app.get("/")
async def hello():
    count = cache.incr("hits")
    return {"message": f"Hello World! This page has been visited {count} times."}