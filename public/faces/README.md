Portraits revealed behind the shattered page titles (`src/components/ShatterTitle.astro`).

Drop portrait JPG/PNG/WebP files here — one per shard is ideal (24 on the homepage,
20 on section pages); fewer just cycle. The folder is read at build time, so adding
a file is the whole job.

Until this folder holds images, ShatterTitle falls back to `public/hero/`.

Keep them small — ~600px on the long edge, under ~120KB each. They are fetched on
the first hover of a title, all at once.
