# SovereignAudit v2.0
### Resilient Hierarchical RAG Legal Auditor · Zero-cost Production Stack

---

## Architecture

```
frontend/    → Next.js + Tailwind → Deploy to Vercel Hobby
backend/     → FastAPI + Docling  → Deploy to Hugging Face Spaces (Docker)
database/    → schema.sql         → Run once in Supabase SQL Editor
```

## Deployment

### 1. Supabase Database
1. Create a free project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** and paste + run `database/schema.sql`
3. Copy your **Project URL** and **service_role** key

### 2. Backend → Hugging Face Spaces
1. Create a new **Docker** Space at [huggingface.co/spaces](https://huggingface.co/spaces)
2. Push the `backend/` directory contents to the Space repo
3. Add Secrets in HF Space settings:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `GEMINI_API_KEY`
   - `APP_SECRET_KEY`
4. The Space will build and expose port 7860 (update `Dockerfile` CMD port if needed)

### 3. Frontend → Vercel
1. Push `frontend/` to a GitHub repo
2. Import to [vercel.com](https://vercel.com), select **Next.js** preset
3. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = your HF Space URL

---

## Local Development

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m spacy download en_core_web_lg
cp ../.env.example .env   # fill in your values
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

## Security Notes
- All user input is length-capped at 500 chars before DB operations
- SQL operations use parameterized Supabase SDK calls (no f-string injection)
- All Gemini tokens are DOMPurify-sanitized before DOM render
- Global exception middleware strips tracebacks from client responses
- Row-Level Security enforces workspace isolation at DB level
