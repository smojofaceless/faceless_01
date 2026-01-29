// =====================================================
// AUDIO GENERATION MODULE (ElevenLabs)
// =====================================================

import type { WordTimestamp, AudioResult } from "./config.ts";

/**
 * Generate audio with ElevenLabs TTS with word-level timestamps
 */
export async function generateAudio(
  elevenLabsKey: string,
  text: string,
  voiceId: string
): Promise<AudioResult> {
  console.log(`Calling ElevenLabs API with voice ${voiceId} and timestamps...`);
  console.log(`Text length: ${text.length} characters`);
  
  // Use the streaming endpoint with timestamps
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("ElevenLabs error response:", error);
    throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  console.log("ElevenLabs response received with timestamps");
  
  // Decode base64 audio
  const audioBase64 = data.audio_base64;
  const audioBuffer = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0)).buffer;
  
  // Extract word-level timestamps from alignment data
  const wordTimestamps: WordTimestamp[] = [];
  let actualDuration = 0;
  
  if (data.alignment && data.alignment.characters) {
    const chars = data.alignment.characters;
    const charStarts = data.alignment.character_start_times_seconds;
    const charEnds = data.alignment.character_end_times_seconds;
    
    // Group characters into words
    let currentWord = '';
    let wordStart = 0;
    let wordEnd = 0;
    
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      
      if (char === ' ' || i === chars.length - 1) {
        // End of word
        if (i === chars.length - 1 && char !== ' ') {
          currentWord += char;
          wordEnd = charEnds[i];
        }
        
        // Clean up the word - remove hyphens and extra punctuation for display
        let cleanWord = currentWord.trim();
        // Remove hyphens (but keep the word)
        cleanWord = cleanWord.replace(/-/g, '');
        // Keep only essential punctuation at the end (period, comma, question mark, exclamation)
        // Remove quotes, apostrophes from display but keep letters
        cleanWord = cleanWord.replace(/['"]/g, '');
        
        if (cleanWord.length > 0) {
          wordTimestamps.push({
            word: cleanWord,
            start: Number(wordStart.toFixed(3)),
            end: Number(wordEnd.toFixed(3)),
          });
        }
        
        currentWord = '';
        if (i + 1 < chars.length) {
          wordStart = charStarts[i + 1];
        }
      } else {
        if (currentWord === '') {
          wordStart = charStarts[i];
        }
        currentWord += char;
        wordEnd = charEnds[i];
      }
    }
    
    // Get actual audio duration from last timestamp
    if (charEnds.length > 0) {
      actualDuration = Math.ceil(charEnds[charEnds.length - 1]) + 1;
    }
  }
  
  console.log(`Generated ${wordTimestamps.length} word timestamps, duration: ${actualDuration}s`);
  console.log("Sample timestamps:", wordTimestamps.slice(0, 5));
  
  return {
    audioBuffer,
    wordTimestamps,
    actualDuration,
  };
}

// Re-export types for convenience
export type { WordTimestamp, AudioResult };
