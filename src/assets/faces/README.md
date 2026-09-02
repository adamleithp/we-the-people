Portraits revealed behind the shattered page titles (`src/components/ShatterTitle.astro`).

Drop portrait JPG/PNG/WebP files here — one per shard is ideal (48 on the homepage,
42 on section pages); fewer just cycle. The folder is globbed at build time, so
adding a file is the whole job.

Until this folder holds images, ShatterTitle falls back to `src/assets/hero/`.

Size doesn't matter: these live in `src/assets/`, not `public/`, so Astro resizes
them to ~1100px WebP at build. Drop the original in. (They used to sit in
`public/` and ship untouched — 22 MB of 4–40 megapixel JPEGs that the browser
decoded at full size the first time anyone hovered a title.)
