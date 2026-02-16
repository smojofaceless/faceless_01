// Test Facebook Graph API for Reels metrics
const pageToken = "EAAMZBUZAV4n5IBQrQ2JMgvktG7Af9XEBjBVW0hkjF2vxuSMnRbGaZAyYVtua2Vvp2dRXwvIy9mZB3F8ITizRriGCizIABUVo2ohfL9ZBmekr6KLOnEp3livoZBzezwU9nq6uFPZCF05GRFdT0DZAfZCmjsGRuGRKp5iZBgFF3lDJPZAScHdxsLysWG3ZC90rvMIRNMrwoK59ycXY";
const userToken = "EAAMZBUZAV4n5IBQjDwWV9dVEolXFb4v7RVBZBa0ltwUi55YTDfA87mSEGJ9gaRdt8DqOlP7rYAzi5FDdMjE9lVId1l50O2g3ZCkJs8dUmZCyZCIgB3G7vOecC0lLRcb28vh9sYl3QK0dVyD6ZCnRJBzvmzypZCcofXzKqJxgXR6dZALTHR2QOMtHNp5Gwtlbz";
const videoId = "936433168734131";
const pageId = "897189743488066";

async function test(label, url) {
  console.log(`\n--- ${label} ---`);
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log(`Status: ${res.status}`);
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.log(`Network error: ${e.message}`);
  }
}

async function main() {
  // Test 1: Basic video fields with page token
  await test("1. Basic fields (page token)", 
    `https://graph.facebook.com/v21.0/${videoId}?fields=id,description,length,views&access_token=${pageToken}`);

  // Test 2: video_insights with old metrics (page token)
  await test("2. video_insights old metrics (page token)",
    `https://graph.facebook.com/v21.0/${videoId}/video_insights?metric=total_video_views,total_video_impressions&access_token=${pageToken}`);

  // Test 3: video_insights with blue_reels_play_count (page token)
  await test("3. video_insights blue_reels_play_count (page token)",
    `https://graph.facebook.com/v21.0/${videoId}/video_insights?metric=blue_reels_play_count&access_token=${pageToken}`);

  // Test 4: video_insights with post_video_views (page token)  
  await test("4. video_insights post_video_views (page token)",
    `https://graph.facebook.com/v21.0/${videoId}/video_insights?metric=post_video_views&access_token=${pageToken}`);

  // Test 5: Get video fields with engagement
  await test("5. Video fields with engagement (page token)",
    `https://graph.facebook.com/v21.0/${videoId}?fields=id,views,likes.summary(true),comments.summary(true),shares&access_token=${pageToken}`);

  // Test 6: Try using user token for video_insights
  await test("6. video_insights old metrics (user token)",
    `https://graph.facebook.com/v21.0/${videoId}/video_insights?metric=total_video_views&access_token=${userToken}`);

  // Test 7: Page published posts
  await test("7. Page published posts (page token)",
    `https://graph.facebook.com/v21.0/${pageId}/published_posts?fields=id,message,shares,likes.summary(true),comments.summary(true)&limit=3&access_token=${pageToken}`);

  // Test 8: Page videos 
  await test("8. Page videos (page token)",
    `https://graph.facebook.com/v21.0/${pageId}/videos?fields=id,title,views,likes.summary(true),comments.summary(true)&limit=3&access_token=${pageToken}`);
}

main();
