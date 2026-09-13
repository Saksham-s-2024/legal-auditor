import sys
from dotenv import load_dotenv
import os

# Load environment variables
load_dotenv()

def test_supabase():
    print("Testing Supabase connection...")
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY")

    if not supabase_url or "dummy" in supabase_url:
        print("[FAILED] SUPABASE_URL is not set or contains dummy values.")
        return False

    try:
        from supabase import create_client
        supabase = create_client(supabase_url, supabase_key)
        # Try a simple query on workspaces table
        res = supabase.table("workspaces").select("id").limit(1).execute()
        print(f"[SUCCESS] Connected to Supabase. Got data response: {res.data}")
        return True
    except Exception as e:
        print(f"[FAILED] Supabase connection failed: {e}")
        return False

def test_gemini():
    print("Testing Gemini API connection...")
    gemini_key = os.getenv("GEMINI_API_KEY")

    if not gemini_key or "dummy" in gemini_key:
        print("[FAILED] GEMINI_API_KEY is not set or contains dummy values.")
        return False

    try:
        import google.generativeai as genai
        genai.configure(api_key=gemini_key)
        
        print("Listing available models for this key:")
        models = list(genai.list_models())
        for m in models:
            print(f"  - {m.name} (methods: {m.supported_generation_methods})")
            
        if not models:
            print("[WARNING] No models returned for this key.")
            
        # Try the first model that supports generate_content
        content_models = [m.name for m in models if "generateContent" in m.supported_generation_methods]
        if content_models:
            target_model = content_models[0]
            print(f"Attempting content generation with model: {target_model}...")
            model = genai.GenerativeModel(target_model.split("/")[-1])
            response = model.generate_content("Hello. Reply with 'OK'.")
            print(f"[SUCCESS] Gemini response: {response.text.strip()}")
            return True
        else:
            print("[FAILED] No model supports content generation.")
            return False
    except Exception as e:
        print(f"[FAILED] Gemini API connection failed: {e}")
        return False

if __name__ == "__main__":
    print("=== Testing Credentials ===")
    supabase_ok = test_supabase()
    print("-" * 50)
    gemini_ok = test_gemini()
    print("-" * 50)

    if supabase_ok and gemini_ok:
        print("=== [SUCCESS] All credentials are valid and ready to launch! ===")
        sys.exit(0)
    else:
        print("=== [FAILED] Some credentials failed validation. Please check your keys. ===")
        sys.exit(1)
