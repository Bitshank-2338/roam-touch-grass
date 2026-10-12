# Dedicated policy screening

New posts, changes and comments enter **Checking**. They remain private as **Needs review** if a check is unavailable, incomplete, ambiguous or not validated. The previous approved post stays public during an edit. New video uploads are disabled. Photos are decoded, metadata-stripped and saved in `DATA_DIR/quarantine`; the server serves them publicly only while an approved snapshot references them. Private owner/moderator preview requires a header key and uses `Cache-Control: no-store`.

The installed Ollama and Hugging Face cache models were inspected on 11 October 2026. No ShieldGemma weights are installed. Python runtime imports succeeded with torch 2.12.0, Transformers 5.8.1, Accelerate 1.13.0 and Pillow 11.2.1, but that torch installation reports CUDA unavailable. GPU operation needs a compatible CUDA-enabled PyTorch environment; the current Python runtime would use CPU. Gemma 3 may assist with context, but cannot substitute for a dedicated policy classifier. Roam therefore does not automatically approve contributions on this computer. The application generates a private moderator key in `DATA_DIR/moderator-key.txt`; open `/moderator` and enter it there. Never put that key in a public client configuration or repository.

`ops/shieldgemma_service.py` is a real local Transformers scorer for Google's `google/shieldgemma-2b` (text) and `google/shieldgemma-2-4b-it` (images). It returns Yes/No violation probabilities, checks complete text without truncation and processes one image policy at a time. It binds to loopback and loads **cached/local files only**. Both gated model licences must be accepted and weights cached explicitly by the operator. The stock image policies cover explicit sexual content, dangerous activity and gore. Roam adds image hate/threat and text gore policies; those extensions need evaluation and cannot be assumed as reliable as the trained categories. Ordinary beach/swimming photos are allowed by the policy.

## Obtain model access

Sign in to Hugging Face. Open [ShieldGemma text](https://huggingface.co/google/shieldgemma-2b) and [ShieldGemma images](https://huggingface.co/google/shieldgemma-2-4b-it) and submit the Google licence/access form on each page. Once granted, create a fine-grained [token](https://huggingface.co/settings/tokens) with read permission for both gated model repositories. Keep it private.

Run these commands on the private AI server, using the same account that accepted the licences:

```powershell
python -m pip install --upgrade huggingface_hub
hf auth login
hf download google/shieldgemma-2b
hf download google/shieldgemma-2-4b-it
```

Enter the token into the interactive login prompt, never into chat or source code. A 403 means access or token permissions need checking. Downloads are large; these commands do not enable automatic approval.

Setup after accepting the model licences:

1. Create an isolated Python environment and install `torch`, `transformers`, `accelerate`, `pillow` and `huggingface_hub` compatible with ShieldGemma 2. Cache both models with the Hugging Face CLI, or set `SHIELD_TEXT_PATH` and `SHIELD_IMAGE_PATH` to downloaded model directories. Do this explicitly: startup never downloads them.
2. Run `python ops/shieldgemma_service.py` in that environment. Optional `SHIELDGEMMA_SERVICE_KEY` must match the Node server configuration. `/health` must report both models ready.
3. Evaluate representative permitted travel/swimming/food photos, disallowed categories, ambiguity, non-English input, injection attempts and images containing text/symbols. Calibrate the provisional 0.1 allow / 0.8 block thresholds in `moderation.mjs` against that labelled set and record outcomes before enabling automatic approval. Intermediate probabilities need review. Model scores do not guarantee content safety.
4. Set `SHIELDGEMMA_URL=http://127.0.0.1:4191` and, **only after validation**, `SHIELDGEMMA_VALIDATED=1`, then restart Roam. The Gemma context check can request review but never override the dedicated classifiers. Missing image/text scores fail private. GPU memory on this 4 GB laptop may be insufficient for both full models; the sidecar supports Transformers `device_map=auto` CPU offload but CPU operation may be slow. Evaluate on a larger local/server machine if necessary.

The database queue is durable across restarts. Items already in Needs review require an operator decision a fresh edited submission or the protected recheck action; they do not suddenly publish after a model setup change. Approval/block decisions are recorded in `moderation_audit`. Reactions and comments use random private browser keys stored hashed server-side, independent from display aliases. Recovering that browser key restores its ownership. Creating a new browser identity is not a proof of a different person and cannot prevent sophisticated vote manipulation.

Sources: [Google safeguard guide](https://ai.google.dev/responsible/docs/safeguards/shieldgemma), [ShieldGemma text model card](https://ai.google.dev/gemma/docs/shieldgemma/model_card), [ShieldGemma 2 image model card](https://ai.google.dev/gemma/docs/shieldgemma/model_card_2), [Transformers ShieldGemma 2 API](https://huggingface.co/docs/transformers/model_doc/shieldgemma2).

## Labelled evaluation harness

Copy `ops/moderation-cases.template.json` into an ignored `private-evaluation` directory and replace every placeholder with correctly labelled cases and real local photos. Include representative travel, swimming, food, sexual content, gore, hateful symbols/text, physical threats, ambiguity, non-English content and prompt injection. Use permitted evaluation material; do not commit it. Expand each category beyond the template's single case.

With the scorer running, execute `node ops/evaluate-moderation.mjs <manifest.json> <new-report.json>`. The harness refuses missing image/category coverage, records case IDs and outcomes without uploading a public report, and fails on malformed checks or unexpected decisions. It never opens the validation gate itself. Inspect false positives/negatives, calibrate thresholds, repeat testing and verify Gemma context review and actual publication separately. Contract tests cannot replace this real-model evaluation.
