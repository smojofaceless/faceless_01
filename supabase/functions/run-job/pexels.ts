// =====================================================
// PEXELS MODULE - Video and Photo Search for Scenes
// =====================================================

import { VISUAL_KEYWORDS, type StoryScene } from "./config.ts";

/**
 * Search Pexels for a PHOTO (for AI image fallback)
 * Returns a static image URL, not video
 */
export async function searchPexelsPhoto(
  pexelsKey: string,
  query: string
): Promise<string | null> {
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=5`;
    const r = await fetch(url, { headers: { Authorization: pexelsKey } });
    if (!r.ok) return null;
    const data = await r.json();
    const photo = data?.photos?.[0];
    // Prefer large2x (high res) or large
    return photo?.src?.large2x || photo?.src?.large || photo?.src?.original || null;
  } catch (error) {
    console.error(`[Pexels Photo] Search error for "${query}":`, error);
    return null;
  }
}

/**
 * Search Pexels for a single video matching keywords
 */
export async function searchPexelsForKeywords(
  pexelsKey: string,
  keywords: string[],
  usedVideoIds: Set<number> = new Set()
): Promise<{ name: string; source_url: string; videoId: number } | null> {
  for (const keyword of keywords) {
    try {
      console.log(`Searching Pexels for: "${keyword}"`);
      
      const response = await fetch(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&orientation=portrait&per_page=20`,
        {
          headers: {
            "Authorization": pexelsKey,
          },
        }
      );

      if (!response.ok) {
        console.error(`Pexels search failed for "${keyword}":`, response.status);
        continue;
      }

      const data = await response.json();
      
      if (data.videos && data.videos.length > 0) {
        // Filter out already used videos and prefer longer ones
        let suitableVideos = data.videos.filter((v: any) => 
          !usedVideoIds.has(v.id) && v.duration >= 5
        );
        
        if (suitableVideos.length === 0) {
          suitableVideos = data.videos.filter((v: any) => !usedVideoIds.has(v.id));
        }
        
        if (suitableVideos.length > 0) {
          // Pick from top results
          const randomIndex = Math.floor(Math.random() * Math.min(suitableVideos.length, 3));
          const video = suitableVideos[randomIndex];
          
          // Get the best video file
          const videoFile = video.video_files.find((f: any) => 
            f.quality === "hd" && f.height > f.width
          ) || video.video_files.find((f: any) => 
            f.quality === "hd"
          ) || video.video_files.find((f: any) =>
            f.quality === "sd" && f.height > f.width
          ) || video.video_files[0];
          
          if (videoFile?.link) {
            console.log(`Found video for "${keyword}": ${video.id}`);
            return {
              name: `Pexels: ${keyword}`,
              source_url: videoFile.link,
              videoId: video.id,
            };
          }
        }
      }
    } catch (error) {
      console.error(`Pexels search error for "${keyword}":`, error);
    }
  }
  return null;
}

/**
 * Search Pexels videos for all scenes
 */
export async function searchVideosForScenes(
  pexelsKey: string,
  scenes: StoryScene[],
  visualPreset: string
): Promise<StoryScene[]> {
  const usedVideoIds = new Set<number>();
  const fallbackKeywords = VISUAL_KEYWORDS[visualPreset] || ["dark atmospheric", "shadows", "night"];
  
  for (const scene of scenes) {
    // Try scene-specific keywords first, then fallbacks
    const allKeywords = [...scene.keywords, ...fallbackKeywords];
    const result = await searchPexelsForKeywords(pexelsKey, allKeywords, usedVideoIds);
    
    if (result) {
      scene.videoUrl = result.source_url;
      usedVideoIds.add(result.videoId);
    } else {
      // Last resort: any dark video
      const fallback = await searchPexelsForKeywords(pexelsKey, ["dark room", "shadows", "night sky"], usedVideoIds);
      if (fallback) {
        scene.videoUrl = fallback.source_url;
        usedVideoIds.add(fallback.videoId);
      }
    }
  }
  
  // If any scene still has no video, use the first scene's video or a default
  const firstVideoUrl = scenes.find(s => s.videoUrl)?.videoUrl;
  // Fallback to a generic dark video if all searches failed
  const defaultVideoUrl = "https://videos.pexels.com/video-files/3571264/3571264-uhd_2560_1440_30fps.mp4"; // Dark clouds
  
  for (const scene of scenes) {
    if (!scene.videoUrl) {
      scene.videoUrl = firstVideoUrl || defaultVideoUrl;
    }
  }
  
  return scenes;
}
