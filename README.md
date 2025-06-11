# Photopea Desktop

An unofficial Electron wrapper for Photopea, designed for a seamless desktop experience with a focus on offline functionality.

## Installation

Ready-to-use installers for Windows and Linux are available on the project's **Releases** page.

The installer is fully self-contained. No internet connection is required to install or run the application with its bundled features.

## Features

### Offline Font Management

By default, fonts are fetched from Photopea's servers on-demand as you use them. For complete offline capability, you can download the entire font library. In the application's top menu bar, click **`Desktop > Manage Offline Fonts`**.

### Manual Updates

You can manually update the core Photopea application files to the latest version available online.

1.  Ensure you have Python 3 and `tqdm` installed (`pip install tqdm`).
2.  Run the `updater.py` script. It will download the latest files into a new `www.photopea.com` directory.
3.  Copy this entire `www.photopea.com` directory into the application's user data folder.
    *   **Windows:** `%APPDATA%\photopea-desktop\`
    *   **Linux:** `~/.config/photopea-desktop/`

**Disclaimer:** This wrapper is tested with the version of Photopea it was released with. While the updater allows you to fetch newer versions, it cannot be guaranteed that they will remain compatible with the existing wrapper code. If you experience issues after updating, you can delete the folder you copied to revert the update.

## Known Issues

*   Integrations for Google Drive, Dropbox, etc. do not work and have been removed from the home screen.
*   The "Templates" feature is non-functional. The button has been removed from the home screen.

## Credits

The core downloader and patcher script (`updater.py`) is heavily based on the work from the **[photopea-v-2 project on GitFlic](https://gitflic.ru/project/photopea-v2/photopea-v-2/)**.