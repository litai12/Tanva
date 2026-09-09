# GPT-Image-2.5 Jichuan synchronization (2026-09-09)

User contract: sync TapCanvas's jichuan image channel to Tanva; keep Tanva prices independent of quality; expose quality selection in the existing GPT-Image-2.5 node.

## Integration

- Source: 101 TapCanvas new-api channel `jichuan-image` (id 295), type 1, https://jichuan.pro, model `gpt-image-2.5`. Only this image channel was copied; video channels and source tiered pricing were not copied.
- The shared gptImage25 palette now has Flare, Sunburst, Jichuan options. Jichuan quality options: low/high/xhigh/max, default low on selection. Both the model and quality persist in node data. Reference limit is one for Jichuan, and its 4K pixel contract is independent of GPT-Image-2's narrower 4K aspect-ratio set.
- Imported the TapCanvas pixel-normalization contract, adapted to this repository's DTO. Generation uses JSON; remote reference image requests use /v1/images/edits with an image string. Multiple references or non-HTTP(S) references are rejected before upstream. No source price-by-quality configuration was copied.
- Tanva credits: 1K=20, 2K=30, 4K=40 for every quality, even with a stable route hint. Gateway public pricing: CNY 0.2/0.3/0.4, with resolution-only specs. Stored ModelPrice copies the existing Flare entry to preserve current gateway charging conventions.
- Reusable server-local registration: new-api/patches/2026-09-09/sync-jichuan-image25.py. Credentials remain in subprocess memory, never printed or stored in source. Backups are private on 101 under /opt/tanva-backups/jichuan-image25-20260909.

## Verification and deployment

- Frontend/backend builds passed. Go DTO, OpenAI adaptor and model tests passed. A 12-case quality/resolution test verifies wire quality, URL reference handling, edits endpoint and identical token metadata across quality settings.
- Backend price checks cover all four qualities at all three resolutions with normal/stable hints. Existing-catalog upgrade and explicit-disable checks passed with all three GPT-Image-2.5 model options.
- 101 source and web assets updated; new-api rebuilt/recreated and tanvas-api reloaded. Live public node configuration includes all three models. Live gateway pricing confirms only the three resolution tiers. Live frontend bundle contains Jichuan and quality selector options.
- No paid upstream image generation was submitted; verification covers configuration, build, local request conversion/billing tests and live published assets/catalogs.

## Local revision: default max, no low (not deployed)

Per user request, Jichuan now exposes high/xhigh/max only and defaults to max. Switching to Jichuan selects max; old low/auto/missing values resolve to max in both the canvas execution path and gateway normalization. Other models keep their existing quality behavior. The registration utility now updates the Jichuan catalog quality enum/default without changing prices. This revision is local only; no server changes or Git commit were performed.
