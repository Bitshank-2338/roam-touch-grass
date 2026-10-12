"""Loopback ShieldGemma scorer. Explicitly install/download models before starting.

No automatic weight download: only existing Hugging Face cache/local paths load.
See docs/shieldgemma.md. Scores are policy violations, not approval decisions.
"""
import base64
import io
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

POLICY_VERSION = "roam-v1"
TEXT_MODEL = "google/shieldgemma-2b"
IMAGE_MODEL = "google/shieldgemma-2-4b-it"
TEXT_POLICIES = {
    "sexual": '"No Sexually Explicit Information": The prompt shall not contain references to sexual acts or other lewd content aimed at causing arousal. Medical or scientific terms related to anatomy or sex education are permitted.',
    "dangerous": '"No Dangerous Content": The prompt shall not facilitate harming oneself or others, building firearms or explosives, promoting terrorism, or instructions for suicide.',
    "hate": '"No Hate Speech": The prompt shall not express, incite or promote hate, discrimination, dehumanization, or violence based on protected attributes. Positive references to protected groups are permitted.',
    "harassment": '"No Harassment": The prompt shall not contain malicious, intimidating, bullying or abusive content targeting an individual, including physical threats.',
    "violence": '"No Violence/Gore": The prompt shall not contain shocking, sensational or gratuitous descriptions of extreme violence, excessive blood or gore, extreme injury, or moment of death. Ordinary factual historical or educational discussion is permitted.',
}
IMAGE_POLICIES = {
    "sexual": '"No Sexually Explicit content": The image shall not depict explicit or graphic sexual acts, pornography, erotic nudity, rape or sexual assault. Ordinary swimming or beachwear without explicit sexual activity is permitted.',
    "dangerous": '"No Dangerous content": The image shall not facilitate or encourage activities causing real-world harm, building firearms or explosives, promoting terrorism or instructions for suicide.',
    "violence": '"No Violence/Gore content": The image shall not depict shocking, sensational or gratuitous violence, excessive blood or gore, gratuitous violence against animals, extreme injury or moment of death.',
    "hate": '"No Hate Speech": The image shall not contain text or symbols promoting hate, discrimination, dehumanization, or calls to violence against protected groups.',
    "threats": '"No Physical Threats": The image shall not contain text or symbols threatening physical violence against a person.',
}


def load_models():
    import torch
    from PIL import Image
    from transformers import AutoTokenizer, AutoModelForCausalLM, AutoProcessor, ShieldGemma2ForImageClassification
    opts = {"local_files_only": True, "device_map": "auto", "torch_dtype": torch.bfloat16 if torch.cuda.is_available() else torch.float32}
    tokenizer = AutoTokenizer.from_pretrained(os.environ.get("SHIELD_TEXT_PATH", TEXT_MODEL), local_files_only=True)
    text_model = AutoModelForCausalLM.from_pretrained(os.environ.get("SHIELD_TEXT_PATH", TEXT_MODEL), **opts).eval()
    processor = AutoProcessor.from_pretrained(os.environ.get("SHIELD_IMAGE_PATH", IMAGE_MODEL), local_files_only=True)
    image_model = ShieldGemma2ForImageClassification.from_pretrained(os.environ.get("SHIELD_IMAGE_PATH", IMAGE_MODEL), **opts).eval()
    yes = tokenizer.encode("Yes", add_special_tokens=False)
    no = tokenizer.encode("No", add_special_tokens=False)
    if len(yes) != 1 or len(no) != 1:
        raise RuntimeError("Yes/No labels must each tokenize to one token")

    def classify(text, image_data=None):
        scores = {}
        for key, policy in TEXT_POLICIES.items():
            prompt = ("You are a policy expert trying to help determine whether a user prompt is in violation of the defined safety policies.\n\n"
                      "<start_of_turn>\nHuman Question: " + text + "\n<end_of_turn>\n\nOur safety principle is defined in the below:\n\n"
                      + policy + "\n\n===\n\nDoes the human question violate the above principle? Your answer must start with 'Yes' or 'No'. And then walk through step by step to be sure we answer correctly.\n")
            inputs = tokenizer(prompt, return_tensors="pt").to(text_model.device)
            # Never silently truncate part of a user's post.
            if inputs.input_ids.shape[1] > min(text_model.config.max_position_embeddings, 8192):
                raise ValueError("Complete post exceeds the policy model context")
            with torch.inference_mode():
                logits = text_model(**inputs).logits[0, -1, [yes[0], no[0]]].float()
                scores[key] = torch.softmax(logits, dim=0)[0].item()
        result = {"policyVersion": POLICY_VERSION, "text": scores}
        if image_data:
            image = Image.open(io.BytesIO(base64.b64decode(image_data, validate=True))).convert("RGB")
            output_scores = {}
            # One policy at a time reduces peak memory on smaller computers.
            for key, policy in IMAGE_POLICIES.items():
                inputs = processor(images=[image], policies=[key], custom_policies={key: policy}, return_tensors="pt").to(image_model.device)
                with torch.inference_mode():
                    probs = image_model(**inputs).probabilities.float().reshape(-1, 2)
                if probs.shape[0] != 1:
                    raise ValueError("Unexpected image policy score shape")
                # Transformers ShieldGemma2 returns [Yes, No] probabilities.
                output_scores[key] = probs[0, 0].item()
            result["image"] = output_scores
        return result
    return classify


if __name__ == "__main__":
    classify = None
    try:
        classify = load_models()
    except Exception as error:
        print("ShieldGemma unavailable:", type(error).__name__, "Install dependencies and cache both approved models; no weights were downloaded.")
    service_key = os.environ.get("SHIELDGEMMA_SERVICE_KEY", "")

    class Handler(BaseHTTPRequestHandler):
        def reply(self, code, value):
            raw = json.dumps(value).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", len(raw))
            self.end_headers()
            self.wfile.write(raw)

        def authorised(self):
            import hmac
            return not service_key or hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + service_key)

        def do_GET(self):
            if not self.authorised():
                return self.reply(403, {"error": "Private service key required"})
            if self.path != "/health":
                return self.reply(404, {})
            self.reply(200, {"ready": classify is not None, "policyVersion": POLICY_VERSION, "models": {"text": TEXT_MODEL, "image": IMAGE_MODEL}})

        def do_POST(self):
            if not self.authorised():
                return self.reply(403, {"error": "Private service key required"})
            if self.path != "/classify" or classify is None:
                return self.reply(503, {"error": "Dedicated policy models unavailable"})
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 24 * 1024 * 1024:
                return self.reply(413, {"error": "Invalid payload size"})
            try:
                payload = json.loads(self.rfile.read(length))
                text = payload.get("text")
                if not isinstance(text, str) or not 0 < len(text) <= 7000:
                    raise ValueError("Invalid complete text")
                self.reply(200, classify(text, payload.get("image")))
            except Exception:
                self.reply(503, {"error": "Policy scoring failed; do not publish"})

    HTTPServer(("127.0.0.1", int(os.environ.get("SHIELDGEMMA_PORT", "4191"))), Handler).serve_forever()
