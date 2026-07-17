import sys
import mlx.core as mx
import mlx_lm

print("Loading model prism-ml/Bonsai-27B-mlx-1bit...")
try:
    model, tokenizer = mlx_lm.load("prism-ml/Bonsai-27B-mlx-1bit")
    print("Model loaded successfully!")
    
    prompt = "Hello! Tell me a one-sentence joke about computers."
    print(f"Generating for prompt: '{prompt}'...")
    
    response = mlx_lm.generate(model, tokenizer, prompt=prompt, verbose=True)
    print("\n--- Response ---")
    print(response)
except Exception as e:
    print("An error occurred:", e, file=sys.stderr)
