// =====================================================
// IMAGE GENERATION MODULE
// DALL-E 3, GPT-4o (gpt-image-1), FLUX Pro/Redux
// =====================================================

import { 
  StoryAnchor, 
  VisualBeat, 
  ART_STYLE_CONFIG,
  ArtStyleConfig,
  updateJob 
} from "./config.ts";

// =====================================================
// HELPER: Upload remote image to Supabase Storage
// Prevents issues with expiring Replicate/OpenAI URLs
// Handles both HTTP URLs and base64 data URLs
// =====================================================
export async function uploadRemoteImageToStorage(
  supabase: any,
  bucket: string,
  path: string,
  imageSource: string
): Promise<string> {
  let bytes: Uint8Array;
  let contentType: string;
  
  // Handle base64 data URLs (from OpenAI when it returns b64_json)
  if (imageSource.startsWith('data:')) {
    const matches = imageSource.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) throw new Error('Invalid base64 data URL format');
    
    contentType = matches[1];
    const base64Data = matches[2];
    
    // Decode base64 to bytes
    const binaryString = atob(base64Data);
    bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    console.log(`[STORAGE] Processing base64 image (${bytes.length} bytes)`);
  } else {
    // Handle HTTP(S) URLs
    const res = await fetch(imageSource);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
    contentType = res.headers.get("content-type") || "image/webp";
  }

  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: true,
  });

  if (error) {
    console.error(`[STORAGE] Upload failed for ${path}:`, error);
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  console.log(`[STORAGE] ✓ Uploaded ${path} to Supabase Storage`);
  return data.publicUrl;
}

// =====================================================
// DEBUG LOGGING - Capture exact API inputs
// =====================================================
interface ReplicateInput {
  model: string;
  endpoint: string;
  input: Record<string, any>;
  timestamp: string;
}

// Store last Replicate inputs for debugging
let lastReplicateInputs: ReplicateInput[] = [];

export function getLastReplicateInputs(): ReplicateInput[] {
  return lastReplicateInputs;
}

export function clearReplicateInputs(): void {
  lastReplicateInputs = [];
}

function logReplicateInput(model: string, endpoint: string, input: Record<string, any>): void {
  const entry: ReplicateInput = {
    model,
    endpoint,
    input,
    timestamp: new Date().toISOString(),
  };
  lastReplicateInputs.push(entry);
  
  // Log to console for Supabase logs
  console.log(`\n========== REPLICATE INPUT (${model}) ==========`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Input JSON:\n${JSON.stringify(input, null, 2)}`);
  console.log(`================================================\n`);
}

// =====================================================
// FLUX PRO - Scene 1 (Text to Image)
// =====================================================

export async function generateFluxProImage(
  replicateKey: string,
  prompt: string,
  sceneIndex: number
): Promise<string | null> {
  try {
    console.log(`[FLUX-PRO] Generating scene ${sceneIndex + 1} (master frame)...`);
    
    const endpoint = "https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions";
    const input = {
      prompt: prompt,
      width: 768,
      height: 1344,
      aspect_ratio: "9:16",
      output_format: "webp",
      output_quality: 90,
      safety_tolerance: 5,
      prompt_upsampling: false
    };
    
    // Log the exact input for debugging
    logReplicateInput("flux-1.1-pro", endpoint, input);
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${replicateKey}`,
        "Content-Type": "application/json",
        "Prefer": "wait",
      },
      body: JSON.stringify({ input }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[FLUX-PRO] API error:", response.status, error);
      return null;
    }

    const result = await response.json();
    
    if (result.output) {
      const imageUrl = typeof result.output === 'string' ? result.output : result.output[0];
      if (imageUrl) {
        console.log(`[FLUX-PRO] ✓ Scene ${sceneIndex + 1} master frame generated`);
        return imageUrl;
      }
    }
    
    if (result.id) {
      return await pollReplicatePrediction(replicateKey, result.id, sceneIndex, "FLUX-PRO");
    }
    
    console.error("[FLUX-PRO] Unexpected response format:", result);
    return null;
  } catch (error) {
    console.error("[FLUX-PRO] Generation error:", error);
    return null;
  }
}

// =====================================================
// FLUX REDUX - Scenes 2+ (Image to Image with Reference)
// =====================================================

export async function generateFluxReduxImage(
  replicateKey: string,
  prompt: string,
  sceneIndex: number,
  referenceImageUrl: string
): Promise<string | null> {
  try {
    console.log(`[FLUX-REDUX] Generating scene ${sceneIndex + 1} with reference...`);
    console.log(`[FLUX-REDUX] Reference: ${referenceImageUrl.substring(0, 80)}...`);
    
    const endpoint = "https://api.replicate.com/v1/models/black-forest-labs/flux-redux-dev/predictions";
    const input = {
      prompt: prompt,
      redux_image: referenceImageUrl,
      width: 768,
      height: 1344,
      aspect_ratio: "9:16",
      num_outputs: 1,
      output_format: "webp",
      output_quality: 90,
      megapixels: "1",
      guidance: 3.5,
      num_inference_steps: 28,
    };
    
    // Log the exact input for debugging
    logReplicateInput("flux-redux-dev", endpoint, input);
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${replicateKey}`,
        "Content-Type": "application/json",
        "Prefer": "wait",
      },
      body: JSON.stringify({ input }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[FLUX-REDUX] API error:", response.status, error);
      // DO NOT FALLBACK TO FLUX PRO - that breaks character consistency!
      // Return null and let the caller handle the error
      return null;
    }

    const result = await response.json();
    
    if (result.output) {
      const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
      if (imageUrl) {
        console.log(`[FLUX-REDUX] ✓ Scene ${sceneIndex + 1} generated with reference`);
        return imageUrl;
      }
    }
    
    if (result.id) {
      return await pollReplicatePrediction(replicateKey, result.id, sceneIndex, "FLUX-REDUX");
    }
    
    console.error("[FLUX-REDUX] Unexpected response:", result);
    return null;
  } catch (error) {
    console.error("[FLUX-REDUX] Generation error:", error);
    return null;
  }
}

// =====================================================
// REPLICATE PREDICTION POLLING
// =====================================================

async function pollReplicatePrediction(
  replicateKey: string,
  predictionId: string,
  sceneIndex: number,
  modelName: string
): Promise<string | null> {
  const maxWait = 120000;
  const pollInterval = 2000;
  let elapsed = 0;
  
  console.log(`[${modelName}] Polling prediction ${predictionId}...`);
  
  while (elapsed < maxWait) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    elapsed += pollInterval;
    
    const statusResponse = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      {
        headers: { "Authorization": `Bearer ${replicateKey}` },
      }
    );
    
    if (!statusResponse.ok) {
      console.error(`[${modelName}] Status check failed:`, statusResponse.status);
      continue;
    }
    
    const status = await statusResponse.json();
    
    if (status.status === "succeeded") {
      const imageUrl = Array.isArray(status.output) ? status.output[0] : status.output;
      if (imageUrl) {
        console.log(`[${modelName}] ✓ Scene ${sceneIndex + 1} generated`);
        return imageUrl;
      }
      console.error(`[${modelName}] No output URL`);
      return null;
    }
    
    if (status.status === "failed" || status.status === "canceled") {
      console.error(`[${modelName}] Prediction ${status.status}:`, status.error);
      return null;
    }
    
    console.log(`[${modelName}] Status: ${status.status} (${elapsed/1000}s)`);
  }
  
  console.error(`[${modelName}] Timed out after 120s`);
  return null;
}

// =====================================================
// FLUX MAIN ROUTER
// =====================================================

export async function generateFluxImage(
  replicateKey: string,
  prompt: string,
  sceneIndex: number,
  referenceImageUrl?: string
): Promise<string | null> {
  console.log(`[FLUX-ROUTER] Scene ${sceneIndex + 1}: referenceImageUrl=${referenceImageUrl ? 'SET' : 'UNDEFINED'}`);
  
  // Scene 1 (index 0): Use FLUX Pro for master frame
  if (sceneIndex === 0) {
    console.log(`[FLUX-ROUTER] → Using FLUX Pro (scene 1 = master frame)`);
    return await generateFluxProImage(replicateKey, prompt, sceneIndex);
  }
  
  // Scenes 2+: Use FLUX Redux with reference for consistency
  if (referenceImageUrl) {
    console.log(`[FLUX-ROUTER] → Using FLUX Redux (scene ${sceneIndex + 1} with reference)`);
    return await generateFluxReduxImage(replicateKey, prompt, sceneIndex, referenceImageUrl);
  }
  
  // Fallback: No reference available (shouldn't happen, but log it)
  console.warn(`[FLUX-ROUTER] ⚠️ No reference image for scene ${sceneIndex + 1}! Falling back to FLUX Pro (will lose character consistency)`);
  return await generateFluxProImage(replicateKey, prompt, sceneIndex);
}

// =====================================================
// GPT-4o IMAGE GENERATION
// =====================================================

export async function generateGPT4oImage(
  openaiKey: string,
  prompt: string,
  sceneIndex: number,
  maxRetries: number = 3
): Promise<string | null> {
  console.log(`[GPT-4o] Generating scene ${sceneIndex + 1} image...`);
  
  // GPT image models use different size options: 1024x1024, 1536x1024, 1024x1536
  // Note: GPT image models ALWAYS return base64 (no URL option)
  // COST per image (portrait 1024x1536): low=$0.016, medium=$0.063, high=$0.25
  // For horror/atmospheric images, the quality difference is barely noticeable
  const requestBody = {
    model: "gpt-image-1",
    prompt: prompt,
    n: 1,
    size: "1024x1536",  // Portrait mode for GPT image models (NOT 1024x1792!)
    quality: "low",     // $0.016/image (portrait) - best value!
    output_format: "webp",  // Use webp for smaller file size
  };
  
  console.log(`[GPT-4o] Request: model=${requestBody.model}, size=${requestBody.size}, quality=${requestBody.quality}`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[GPT-4o] Image API error (attempt ${attempt}/${maxRetries}):`, response.status, error.substring(0, 150));
        
        // Handle rate limiting with exponential backoff
        if (response.status === 429) {
          if (attempt < maxRetries) {
            // Wait longer for each retry: 20s, 40s, 60s
            const waitTime = 20 * attempt * 1000;
            console.log(`[GPT-4o] Rate limited! Waiting ${waitTime/1000}s before retry...`);
            await new Promise(r => setTimeout(r, waitTime));
            continue;
          }
        }
        
        throw new Error(`GPT-4o API error ${response.status}: ${error.substring(0, 200)}`);
      }

      const data = await response.json();
      const imageData = data.data?.[0];
      
      // GPT image models always return base64
      if (imageData?.b64_json) {
        console.log(`[GPT-4o] ✓ Scene ${sceneIndex + 1} image generated (base64 format, ${imageData.b64_json.length} chars)`);
        return `data:image/webp;base64,${imageData.b64_json}`;
      }
      
      // Fallback for URL (shouldn't happen with gpt-image-1 but handle it)
      if (imageData?.url) {
        console.log(`[GPT-4o] ✓ Scene ${sceneIndex + 1} image generated (URL format)`);
        return imageData.url;
      }
      
      console.error("[GPT-4o] No image URL or base64 in response:", JSON.stringify(data).substring(0, 200));
      throw new Error("GPT-4o returned empty response");
    } catch (error: any) {
      // If it's already a rate limit retry, the error was already logged
      if (attempt === maxRetries) {
        console.error(`[GPT-4o] Failed after ${maxRetries} attempts:`, error?.message || error);
        throw error;
      }
      // For non-429 errors, still retry but with shorter delay
      console.log(`[GPT-4o] Attempt ${attempt} failed, retrying in 5s...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  
  throw new Error("GPT-4o generation failed after all retries");
}

// =====================================================
// DALL-E 3 IMAGE GENERATION
// =====================================================

export async function generateDallE3Image(
  openaiKey: string,
  prompt: string,
  sceneIndex: number
): Promise<string | null> {
  try {
    console.log(`[DALL-E 3] Generating scene ${sceneIndex + 1} image...`);
    
    // DALL-E 3 supports 1024x1792 portrait mode
    // COST OPTIMIZATION: Use "standard" quality - 33% cheaper ($0.080 vs $0.120)
    const requestBody = {
      model: "dall-e-3",
      prompt: prompt,
      n: 1,
      size: "1024x1792",
      quality: "standard",  // $0.080/image vs $0.120/image for "hd"
      // Don't specify response_format - let API decide (more robust)
    };
    
    console.log(`[DALL-E 3] Request: model=${requestBody.model}, size=${requestBody.size}, quality=${requestBody.quality}`);
    
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("[DALL-E 3] API error:", response.status, error);
      throw new Error(`DALL-E 3 API error ${response.status}: ${error.substring(0, 200)}`);
    }

    const data = await response.json();
    const imageData = data.data?.[0];
    
    // Handle both URL and base64 responses
    if (imageData?.url) {
      console.log(`[DALL-E 3] ✓ Scene ${sceneIndex + 1} image generated (URL format)`);
      return imageData.url;
    } else if (imageData?.b64_json) {
      console.log(`[DALL-E 3] ✓ Scene ${sceneIndex + 1} image generated (base64 format)`);
      return `data:image/png;base64,${imageData.b64_json}`;
    }
    
    console.error("[DALL-E 3] No image URL or base64 in response:", JSON.stringify(data).substring(0, 200));
    throw new Error("DALL-E 3 returned empty response");
  } catch (error) {
    console.error("[DALL-E 3] Error:", error);
    throw error;  // Re-throw so strict mode can catch it
  }
}

// =====================================================
// UNIFIED IMAGE GENERATION (Routes to correct model)
// =====================================================

export async function generateImage(
  openaiKey: string,
  prompt: string,
  sceneIndex: number,
  imageModel: "dall-e-3" | "gpt-4o" | "flux",
  referenceImageUrl?: string,
  strict: boolean = true  // If true, fail instead of falling back to another model
): Promise<string | null> {
  console.log(`\n[IMAGE] Generating scene ${sceneIndex + 1} with model: ${imageModel} (strict=${strict})`);
  
  // Try FLUX
  if (imageModel === "flux") {
    const replicateKey = Deno.env.get("REPLICATE_API_TOKEN");
    if (!replicateKey) {
      if (strict) throw new Error("FLUX selected but REPLICATE_API_TOKEN is not set");
      console.log(`[IMAGE] REPLICATE_API_TOKEN not set, falling back to DALL-E 3...`);
    } else {
      try {
        const result = await generateFluxImage(replicateKey, prompt, sceneIndex, referenceImageUrl);
        if (result) return result;
      } catch (fluxError) {
        if (strict) throw fluxError;
        console.log(`[IMAGE] FLUX error, falling back to DALL-E 3:`, fluxError);
      }
    }
  }
  
  // Try GPT-4o
  if (imageModel === "gpt-4o") {
    try {
      const result = await generateGPT4oImage(openaiKey, prompt, sceneIndex);
      if (result) return result;
    } catch (gptError) {
      if (strict) throw gptError;
      console.log(`[IMAGE] GPT-4o error, falling back to DALL-E 3:`, gptError);
    }
  }
  
  // DALL-E 3 (or fallback if not strict)
  try {
    const result = await generateDallE3Image(openaiKey, prompt, sceneIndex);
    if (result) return result;
  } catch (dalleError) {
    if (strict) throw dalleError;
    console.log(`[IMAGE] DALL-E 3 error:`, dalleError);
  }
  
  return null;
}
