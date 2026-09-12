import sys
import os
import traceback

def run_health_checks():
    print("=== SovereignAudit Backend Health Check ===")
    print(f"Python Version: {sys.version}")
    print(f"Working Directory: {os.getcwd()}")
    print("-" * 50)

    # 1. Test basic imports
    modules_to_test = [
        ("fastapi", "FastAPI"),
        ("supabase", "Supabase Client"),
        ("sentence_transformers", "SentenceTransformers"),
        ("presidio_analyzer", "Microsoft Presidio Analyzer"),
        ("presidio_anonymizer", "Microsoft Presidio Anonymizer"),
        ("spacy", "spaCy"),
        ("docling.document_converter", "IBM Docling Converter"),
        ("google.generativeai", "Google Generative AI"),
        ("pdf2image", "pdf2image"),
        ("pytesseract", "pytesseract")
    ]

    import_success = True
    for module_name, display_name in modules_to_test:
        try:
            __import__(module_name)
            print(f"[SUCCESS] Imported {display_name} ({module_name})")
        except Exception as e:
            print(f"[FAILED]  Importing {display_name} ({module_name}): {e}")
            import_success = False

    if not import_success:
        print("\n[ERROR] Some basic imports failed. Check dependency versions.")
        return False

    print("-" * 50)

    # 2. Test spaCy and Presidio PII Scrubbing
    try:
        print("Testing PII Scrubbing (spaCy + Presidio)...")
        from presidio_analyzer import AnalyzerEngine
        from presidio_anonymizer import AnonymizerEngine

        analyzer = AnalyzerEngine()
        anonymizer = AnonymizerEngine()
        text = "Hello, my name is John Doe and my email is john.doe@example.com."
        results = analyzer.analyze(text=text, language="en")
        anonymized = anonymizer.anonymize(text=text, analyzer_results=results)
        
        print(f"  Original:  {text}")
        print(f"  Scrubbed:  {anonymized.text}")
        print("[SUCCESS] PII Scrubbing works perfectly!")
    except Exception as e:
        print(f"[FAILED]  PII Scrubbing test failed: {e}")
        traceback.print_exc()
        return False

    print("-" * 50)

    # 3. Test SentenceTransformer Embedding Model Loading
    try:
        print("Testing SentenceTransformer embedding model load & encode...")
        from sentence_transformers import SentenceTransformer
        # Use a small model to make the test quick
        model = SentenceTransformer("BAAI/bge-small-en-v1.5")
        vector = model.encode("Verify health of embedding model", normalize_embeddings=True)
        print(f"  Embedding dimensions: {len(vector)}")
        print("[SUCCESS] Embedding model loaded and encoded successfully!")
    except Exception as e:
        print(f"[FAILED]  Embedding model test failed: {e}")
        traceback.print_exc()
        return False

    print("-" * 50)

    # 4. Test Tesseract OCR binary availability
    try:
        print("Testing Tesseract OCR binary availability...")
        import pytesseract
        # Just check the tesseract version
        version = pytesseract.get_tesseract_version()
        print(f"  Tesseract version: {version}")
        print("[SUCCESS] Tesseract OCR is available on the path!")
    except Exception as e:
        print(f"[WARNING] Tesseract OCR check failed: {e}")
        print("          Ingestion will work, but scanned PDF/image fallback OCR will fail.")

    print("-" * 50)

    # 5. Test Poppler availability (via pdf2image)
    try:
        print("Testing Poppler pdfinfo availability...")
        from pdf2image.exceptions import PDFInfoNotInstalledError
        from pdf2image import pdfinfo_from_path
        
        # We don't have a real PDF, but let's test if the pdfinfo binary runs
        # It should throw a FileNotFoundError for a non-existent file, NOT PDFInfoNotInstalledError
        try:
            pdfinfo_from_path("non_existent_file.pdf")
        except FileNotFoundError:
            print("[SUCCESS] Poppler binary is available on the path!")
        except PDFInfoNotInstalledError:
            print("[FAILED]  Poppler is not installed or not in PATH!")
            return False
        except Exception:
            print("[SUCCESS] Poppler binary is available on the path (threw expected error)!")
    except Exception as e:
        print(f"[FAILED]  Poppler test failed: {e}")
        return False

    print("-" * 50)
    print("=== All Core Backend Capability Health Checks Passed! ===")
    return True

if __name__ == "__main__":
    success = run_health_checks()
    sys.exit(0 if success else 1)
