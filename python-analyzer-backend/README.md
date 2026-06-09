# Rebar Planner Python Analyzer

Render settings:

- Root Directory: `python-analyzer-backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

Endpoints:

- `GET /health`
- `POST /analyze`
- `POST /analyze-region`
