# Image attachments

Images are user-message content, not filesystem paths or renderer-only decoration. The existing authenticated loopback RPC carries bounded upload/read chunks; the provider credential remains backend-only. No new transport, remote image fetch, public asset URL, or renderer access to local files is introduced.

## Upload and processing

- PNG, JPEG, WebP and GIF are identified from bytes, not a supplied MIME label. Files are limited to 20 MiB and decoded dimensions to 40 megapixels (at most 40,000 pixels on either edge). Unsupported/damaged files return errors rather than being silently omitted.
- Backend Photon processing runs in one-shot worker threads, with at most two active preparations. JPEG, PNG and WebP EXIF orientation is applied before resizing. Images fit within 2000×2000 without upscaling. PNG is preferred for legible screenshot text; JPEG quality steps and further dimension reduction enforce a base64 payload below 4.5 MiB. Animated images are sent as a still frame, disclosed in model context.
- Upload IDs bind a filename, length and SHA-256. Ordered 24 KiB chunks are committed to the session database and can be repeated only with identical bytes. At most ten unsent/preparing uploads occupy a session's attachment slots. A complete source hash is required before decoding. A failed upload/preparation can be retried or explicitly removed; it never submits a user message by itself.
- Original bytes and model-prepared bytes are private session-owned files, saved through exclusive temporary files, create-if-absent publication and fsync. Session metadata references them only after publication. Source originals remain available for full-size viewing. A crash between publication and metadata commit may leave orphan files; same-ID retries verify matching bytes instead of replacing an existing image.

## Messages, recovery and inference

The image migration extends session database version 6 to version 7, preserving existing entries/tools. Later migrations continue normally. Image references bind atomically to a user entry in ordered `entry_images` rows. Image-only messages are accepted; unprepared, repeated or previously sent image IDs are rejected. Retried turn IDs validate both text and image IDs and never repeat inference. Sent attachments cannot be deleted by draft cleanup.

History exposes image metadata and checksums, not base64 provider payloads or credentials. Model context reconstructs the prepared image as a real Responses `input_image` data URL with `detail: auto`, alongside text and an image dimension hint. Originals are not injected into model context. Models explicitly known to be text-only reject attachments; an unknown capability is not silently treated as text-only. Provider errors remain truthful, with no blind resend.

Image payloads have a separate 64 MiB request budget; ordinary text/tool input retains its 8 MiB bound. Images are not counted as base64 text tokens. Existing context projection/compaction carries visual content through its image-aware path. Opening or reloading the renderer does not send images again.

Deleting a session moves its image files with its session-owned storage into the existing retirement/trash lifecycle. Unsent image discard cancels preparation and removes upload rows/private image files. Shutdown aborts preparation workers. Stop during sending prevents submission where possible; if acceptance races Stop, the client requests cancellation of that accepted turn instead of treating Stop as rollback.

## Composer and viewer

Composer drafts retain original Blob bytes and stable image IDs in IndexedDB, scoped to project/session identity. Failed saves remain in memory across workspace navigation, with unload protection and visible retry errors. Project draft identities are persisted before attaching, without prematurely creating a backend session. Accepted-image cleanup cannot cause an automatic resend; a leftover already-sent ID fails explicitly if cleanup was interrupted.

Paste, drag/drop and the paperclip file picker add removable image tiles. Composer previews use cached, centered square PNG crops at up to 256×256; they do not alter originals or provider content. Saved-message previews download prepared bytes lazily when near the viewport. Chunk downloads are bounded, checked for continuity and verified against SHA-256 before displaying a Blob URL. Blob URLs are revoked when their owner unmounts. Renderer CSP permits local `blob:` images, not remote image sources or arbitrary `data:` URLs.

Click opens a native modal dialog with a viewport-fit image, filename/count, previous/next controls, a compact SVG close control without extra focus highlighting. Click/Enter toggles zoom, the wheel and +/- adjust zoom, dragging/arrows pan and 0 fits. Escape or background/close dismisses the viewer and restores opener focus. Failed downloads/decoding show a retryable unavailable state. Full-size viewers use original bytes, not the square composer crop.

Image attachments are not a filesystem sandbox or a credential boundary. Local OS-user access can expose saved images just as it can expose other session files. Stop cannot interrupt synchronous kernel I/O, and filesystem fsync guarantees remain platform-dependent.

Regression sources: `tests/images.test.mjs`, `tests/images-agent.test.mjs`, `tests/images-migration.test.mjs`, and `tests/images-ui.test.mjs` with `tests/fixtures/images-ui.mjs`. These were written but not executed under the user's no-tests instruction. A live Codex vision request has not been verified.
