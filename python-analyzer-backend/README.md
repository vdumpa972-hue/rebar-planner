# Rebar Planner Python Analyzer Backend

Deploy this folder as a separate Python web service on Render/Railway/Fly.

## Local test

```bash
cd python-analyzer-backend
python -m pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Health check:

```text
http://localhost:8000/health
```

Analyze endpoint:

```text
POST /analyze
form-data field: blueprint = PDF or image
```

## Render deployment

1. Push this project to GitHub.
2. In Render: New Web Service.
3. Root directory: `python-analyzer-backend`.
4. Build command: `pip install -r requirements.txt`.
5. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`.
6. After deployment, copy your service URL.
7. In Vercel Rebar app, add environment variable:

```text
PYTHON_ANALYZER_URL=https://your-render-service.onrender.com
```

The Next.js API route will call `${PYTHON_ANALYZER_URL}/analyze`.
