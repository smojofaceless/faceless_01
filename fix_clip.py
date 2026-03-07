from safetensors.torch import load_file, save_file

bak = 'D:/ComfyUI_windows_portable/ComfyUI/models/clip_vision/open-clip-xlm-roberta-large-vit-huge-14_visual_fp16.safetensors.bak'
dst = 'D:/ComfyUI_windows_portable/ComfyUI/models/clip_vision/open-clip-xlm-roberta-large-vit-huge-14_visual_fp16.safetensors'
sd = load_file(bak)

new_sd = {}
for k, v in sd.items():
    nk = k
    # Squeeze extra batch dimensions on embeddings
    if k == 'visual.cls_embedding':
        v = v.squeeze()  # [1,1,1280] → [1280]
    if k == 'visual.pos_embedding':
        v = v.squeeze(0)  # [1,257,1280] → [257,1280]
    nk = nk.replace('visual.cls_embedding', 'visual.class_embedding')
    nk = nk.replace('visual.patch_embedding.weight', 'visual.conv1.weight')
    nk = nk.replace('visual.pos_embedding', 'visual.positional_embedding')
    nk = nk.replace('visual.pre_norm.', 'visual.ln_pre.')
    nk = nk.replace('visual.post_norm.', 'visual.ln_post.')
    if 'visual.transformer.' in nk and 'resblocks' not in nk:
        parts = nk.split('.')
        idx = parts.index('transformer')
        layer_num = parts[idx + 1]
        rest = '.'.join(parts[idx + 2:])
        # Attention keys
        rest = rest.replace('attn.proj.', 'attn.out_proj.')
        rest = rest.replace('attn.to_qkv.weight', 'attn.in_proj_weight')
        rest = rest.replace('attn.to_qkv.bias', 'attn.in_proj_bias')
        # LayerNorm keys
        rest = rest.replace('norm1.', 'ln_1.')
        rest = rest.replace('norm2.', 'ln_2.')
        # MLP keys (Sequential indices to named layers)
        rest = rest.replace('mlp.0.', 'mlp.c_fc.')
        rest = rest.replace('mlp.2.', 'mlp.c_proj.')
        nk = 'visual.transformer.resblocks.' + layer_num + '.' + rest
    if k == 'visual.head':
        # Do NOT transpose - ComfyUI's convert_to_transformers already transposes
        nk = 'visual.proj'
    new_sd[nk] = v

check = 'visual.transformer.resblocks.0.attn.in_proj_weight'
print('Check key exists:', check in new_sd)
print('Total keys:', len(new_sd))

# Print a few sample keys for verification
for i, k in enumerate(sorted(new_sd.keys())):
    if i < 10 or 'attn.in_proj' in k or 'attn.out_proj' in k:
        print(k)
    if i == 10:
        print('...')

save_file(new_sd, dst)
print('Saved successfully!')
