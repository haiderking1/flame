# Bundled fonts

- **Inter 4.1**: variable normal/italic WOFF2, weights 100–900.
  Source: https://github.com/rsms/inter/releases/tag/v4.1
  Archive: `Inter-4.1.zip`, files from `web/`.
  License: `inter/LICENSE.txt` (SIL Open Font License 1.1).
- **JetBrains Mono Nerd Font Mono**, Nerd Fonts **3.5.1**: regular, italic, bold, and bold italic TTF.
  Source: https://github.com/ryanoasis/nerd-fonts/releases/tag/v3.5.1
  Archive: `JetBrainsMono.zip`.
  License: `jetbrains-mono-nerd/OFL.txt` (SIL Open Font License 1.1).

Files are unmodified upstream assets. The Mono variant keeps Nerd Font symbols within monospace cells. Fonts are bundled locally and fetched by the renderer only when needed; code fonts are not preloaded at startup.

`fonts.css` declares the faces. Global `--font-ui` and `--font-code` variables select their roles.
