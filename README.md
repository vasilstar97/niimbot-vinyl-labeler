# Vinyl Labeler

A static label editor for vinyl sleeves. React and Ant Design, with an album sidebar, a central label preview, and a print settings sidebar. The UI uses black, white, and orange (`#f55e36`), following [J-Card Cover Designer](https://vasilstar97.github.io/j-card-designer/).

Search MusicBrainz, select an album, edit the details, add a real Spotify Code, export PNG, or print to a NIIMBOT over USB or BLE. No application server, Python installation, or Spotify API key is needed.

## Run

Node.js 22.12+; Node.js 24 LTS is recommended.

```sh
npm ci
npm run dev
```

Open the URL printed in the terminal, normally http://127.0.0.1:5173. Use Chrome or Edge on a computer for USB printing. VS Code preview and build tasks are also provided.

```sh
npm test
npm run build
npm run preview
```

## Workflow

1. Search for an artist **or** album and select a result. If a combined query returns nothing, try the artist or title separately.
2. Check the populated fields. The app looks for Spotify links on the MusicBrainz release group and its first 50 releases. Links may be missing or point to another edition.
3. If necessary, use **Find** to search Spotify and paste a full album URL or `spotify:album:…` URI. Open short `spotify.link` URLs in a browser first.
4. Select **Not on Spotify** only when appropriate. The label displays `not available on spotify`, centered horizontally and vertically. Network errors never enable this fallback automatically.
5. Set the label size and review the preview. Download PNG, or connect a printer and press **Print 1 label**.

The draft is stored in local browser storage. Queries and album IDs are sent directly to MusicBrainz and Spotify. Narrow screens use drawers for the side panels; desktop layouts keep both sidebars visible. The print settings scrollbar is always shown. Label margins remain part of the layout but are never drawn as guides.

## Label layout

- Defaults: 50 × 30 mm, 3 mm outer margins, 1 mm cell padding.
- No borders: the grid controls placement only.
- Bundled Open Sans Regular/Bold, 2 mm font size. UI styling does not change the print font.
- A 2 mm line step means baseline-to-baseline distance, not an additional 2 mm gap.
- At the default size, each text row is 6 mm high; the Spotify Code occupies the remainder. The caption column occupies 25% of the content width, with a 10 mm minimum.
- Text blocks are vertically centered. Padding affects placement and wrapping, without clipping glyphs. Overflow blocks export and printing rather than silently shrinking the font.
- Preview, PNG, and printing use the same monochrome raster. PNG contains the correct pixel dimensions but no physical-size metadata; set the dimensions manually when importing it elsewhere.

## Printer support

The app uses [NiimBlueLib](https://github.com/MultiMote/niimbluelib), pinned to 0.49.1. Its model map assigns B21S (ID 777) and B21S_C2B (ID 776) to D110. This app overrides that mapping with the **B1** task: it explicitly declares the copy count in the seven-byte PrintStart and six-byte SetPageSize commands. The previous D110 path produced one complete label followed by a partial duplicate on the user's B21S. The six-byte page-size requirement is documented in [niimprint #33](https://github.com/AndBondStyle/niimprint/issues/33) and [NiimPrintX #50](https://github.com/labbots/NiimPrintX/pull/50). The packet sequence is regression-tested, and the user confirmed one complete label with no extra copy after this correction. Other model mappings are unchanged. Unknown protocols disable printing. A 90° rotation is available.

The suggested Python alternatives remain useful for local applications: [AndBondStyle/niimprint](https://github.com/AndBondStyle/niimprint) provides a small USB/serial and Bluetooth RFCOMM CLI; [NiimPrintX](https://github.com/labbots/NiimPrintX) provides a CLI and desktop GUI. Their READMEs list B21 but do not separately confirm B21S. Neither runs directly on GitHub Pages.

B21S uses 203 dpi and a 384-dot printhead, approximately 48 mm wide. A 50 mm canvas is 400 pixels wide. The app removes 8 blank pixels from each side before transmission, without resizing the artwork. It rejects layouts where this crop would reach the content area. Mechanical centering still depends on the roll and firmware.

Web Serial and Web Bluetooth require HTTPS or localhost and a browser device permission. Bluetooth here means BLE, not arbitrary Bluetooth/RFCOMM support. On Windows, USB should appear as a COM port; a device driver may be needed. Close the manufacturer's app if it has locked the device. Other NIIMBOT models recognized by the library may work but have not been physically tested here. Other printer brands can use PNG export.

Connecting, searching, and editing never print. A print action submits one page and one copy. Disconnections and timeouts do not trigger an automatic retry. Check whether a label was printed before submitting another job.

### Roll information

On connection, the print sidebar displays the RFID product code and remaining-label counter when reported. Dimensions are not inferred from a product code or applied automatically.

A read-only query of the connected B21S returned product code `10262260`, 276 total labels, 59 used, and paper type 1 (labels with gaps): 217 remaining according to its counter. The paper-size query did not provide usable dimensions on this device. Returned fields depend on the firmware and roll.

### Physical verification and diagnostics

On 2026-11-17, one authorized test job using the corrected B1 task was printed over USB on the user's B21S: Polygondwanaland, 50 × 30 mm, 203 dpi, 384 × 240 transmitted pixels, density 3, no rotation. The user confirmed that exactly one complete label came out, with no partial duplicate. The captured stream contained one PrintStart, one PageStart, one six-byte SetPageSize with quantity 1, one PageEnd, and one accepted PrintEnd; reported print and feed progress reached 100%. This confirms the tested device and configuration, not all firmware versions or Bluetooth printing. Spotify scanning is still unverified.

**Download print log** exports timestamps, stage changes, control packets, row headers, and progress responses. It does not include the label bitmap. The log exists in memory for the current page session and is cleared on reload. Rejected `PrintEnd` responses are reported as unconfirmed printing. No pages are automatically resent.

## Spotify Codes

The app downloads the real code image from the service used by [Spotify Codes](https://www.spotifycodes.com/):

```text
https://scannables.scdn.co/uri/plain/png/ffffff/black/640/spotify:album:ALBUM_ID
```

This public image service has no guaranteed API contract. Network restrictions, service changes, or CORS can interrupt loading. Failed code loading blocks printing and offers a retry. Minimum code width is checked, but scanning a thermal print must be verified with a phone. Follow the Spotify Codes terms.

## GitHub Pages

The [workflow](.github/workflows/pages.yml) runs on pushes to `main` or manually from Actions. It installs dependencies, runs tests, builds the app, and commits only the contents of `dist/` to the separate **`gh-pages`** branch. That branch is created automatically; it includes `.nojekyll` so Pages serves the built files directly. No personal access token is required.

After the first successful workflow run, open **Settings → Pages → Build and deployment**:

1. Source: **Deploy from a branch**.
2. Branch: **gh-pages**.
3. Folder: **/ (root)**.
4. Click **Save**.

Subsequent pushes to `main` rebuild the site and update `gh-pages`. The workflow explicitly requests a Pages build when branch publishing is configured, because commits made with `GITHUB_TOKEN` do not themselves trigger a Pages build. On a new repository it publishes the branch and leaves a notice to complete the settings above. If necessary, rerun the workflow after enabling Pages. Do not select **GitHub Actions** as the Pages source for this workflow.

The site will be available at https://vasilstar97.github.io/niimbot-vinyl-labeler/ once GitHub Pages finishes deployment. Update the workflow if your default branch has another name.

You can also host `dist/` on any static HTTPS host. Vite's relative base supports repository subdirectories.

## Checks and licenses

Tests cover geometry, wrapping, Spotify URIs, the installed B21S protocol mapping, one-copy submission, blank-margin cropping, failure handling, and rejected print completion. Printer tests use a fake transport and never access hardware. Live catalog and code-image requests have been checked in the browser.

Runtime dependency audit was clean at the previous check. The full audit reported a `picomatch` ReDoS advisory through Vite's build dependencies; no patched picomatch release was published at that check. Recheck when updating dependencies.

NiimBlueLib is MIT-licensed; Open Sans uses the SIL Open Font License. Dependency packages include their respective licenses.
