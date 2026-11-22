#!/usr/bin/env bash
# Build a ZirZirCord .flatpak bundle. Usage: ./build-flatpak.sh [path/to/ZirZirCord.deb]
# Without an argument it uses the .deb from `npm run build -w @zirzircord/desktop-tauri`.
# Needs: flatpak, flatpak-builder, and the GNOME 49 runtime + SDK:
#   flatpak install flathub org.gnome.Platform//49 org.gnome.Sdk//49
set -euo pipefail
cd "$(dirname "$0")"

deb="${1:-$(ls ../src-tauri/target/release/bundle/deb/*.deb | head -n1)}"
cp "$deb" zirzircord.deb

[ -d shared-modules ] || git clone --depth 1 https://github.com/flathub/shared-modules.git shared-modules

flatpak-builder --user --force-clean --install-deps-from=flathub \
  --repo=repo build-dir app.zirzircord.desktop.yml
flatpak build-bundle repo ZirZirCord.flatpak app.zirzircord.desktop
echo "Built $(pwd)/ZirZirCord.flatpak  (install: flatpak install --user ZirZirCord.flatpak)"
