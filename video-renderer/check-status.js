// Check status of a ComfyUI job
const id = process.argv[2] || 'comfy_c4351d7a';
fetch(`http://localhost:3001/comfyui-status/${id}`)
  .then(r => r.json())
  .then(d => {
    console.log('=== JOB STATUS ===');
    console.log('Status:', d.status);
    console.log('Completed:', d.completed + '/' + d.total);
    console.log('Errors:', d.errors?.length || 0);
    console.log('Images:', d.images?.length || 0);
    if (d.images?.[0]) {
      console.log('\n=== IMAGE 0 ===');
      console.log('URL:', d.images[0].url || '(no Supabase upload)');
      console.log('Metadata:', JSON.stringify(d.images[0].metadata, null, 2));
    }
  })
  .catch(e => console.log('Error:', e.message));
