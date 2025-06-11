// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// --- API Bridge ---
contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-control', 'minimize'),
  maximizeWindow: () => ipcRenderer.send('window-control', 'maximize'),
  closeWindow: () => ipcRenderer.send('window-control', 'close'),
});

// Listen for file data from the main process
ipcRenderer.on('open-files-data', (event, filesData) => {
    // Find the single, hidden file input element Photopea uses.
    const fileInput = document.querySelector('input[type="file"]');
    if (!fileInput) {
        console.error('Photopea file input element not found.');
        return;
    }

    // Reconstruct File objects from the raw data.
    const fileObjects = filesData.map(file => {
        return new File([file.buffer], file.name, { type: file.type });
    });

    if (fileObjects.length === 0) return;

    // The DataTransfer object is the standard way to create a FileList.
    const dataTransfer = new DataTransfer();
    fileObjects.forEach(file => dataTransfer.items.add(file));

    // Assign the files to the input element's files property.
    fileInput.files = dataTransfer.files;

    // Dispatch a 'change' event on the input element. This is crucial, as it
    // triggers the event listener that Photopea uses to process the files.
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
});

/**
 * Main function for all DOM manipulations.
 */
function applyDOMTweaks() {
  // --- 1. Inject Custom Window Controls ---
  if (!document.querySelector('.electron-window-controls')) {
    const originalButtonsContainer = document.querySelector('div[style*="float: right"]');
    if (originalButtonsContainer && originalButtonsContainer.parentNode) {
      const parent = originalButtonsContainer.parentNode;
      originalButtonsContainer.remove();

      const controlsContainer = document.createElement('div');
      controlsContainer.className = 'electron-window-controls';
      controlsContainer.innerHTML = `
        <button id="minimize-btn" class="window-control-btn" title="Minimize"></button>
        <button id="maximize-btn" class="window-control-btn" title="Maximize / Restore"></button>
        <button id="close-btn" class="window-control-btn" title="Close"></button>
      `;
      parent.appendChild(controlsContainer);

      document.getElementById('minimize-btn').addEventListener('click', () => ipcRenderer.send('window-control', 'minimize'));
      document.getElementById('maximize-btn').addEventListener('click', () => ipcRenderer.send('window-control', 'maximize'));
      document.getElementById('close-btn').addEventListener('click', () => ipcRenderer.send('window-control', 'close'));

      const style = document.createElement('style');
      style.innerHTML = `
        /* --- THIS IS THE FIX --- */
        .electron-window-controls {
          position: absolute;      /* Use absolute positioning within the parent */
          top: 0;                /* Pin to the top */
          right: 0;              /* Pin to the right */
          height: 31px;          /* Set a fixed height matching the top bar */
          z-index: 10;
          -webkit-app-region: no-drag;
          display: flex;
          align-items: center;
        }
        /* --- End of Fix --- */

        .window-control-btn {
          -webkit-app-region: no-drag; display: inline-flex; justify-content: center; align-items: center;
          width: 46px; height: 100%; border: none; background-color: transparent;
          color: #e0e0e0;
          font-family: 'Segoe UI Symbol', 'system-ui'; font-size: 10px; cursor: pointer;
          transition: background-color 0.15s; padding: 0;
          overflow: hidden;
        }
        .window-control-btn:hover { background-color: rgba(255, 255, 255, 0.1); }
        #close-btn:hover { background-color: #e81123; color: white; }
        #minimize-btn::before { content: ''; width: 10px; height: 1px; background-color: currentColor; }
        #maximize-btn::before { content: ''; width: 10px; height: 10px; border: 1px solid currentColor; }
        #close-btn::before { content: '\\00d7'; font-family: 'Segoe UI', 'system-ui'; font-size: 26px; font-weight: 100; position: relative; top: -3px; }
        .electron-app-icon { height: 20px; margin: 0 8px 0 8px; vertical-align: middle; -webkit-app-region: no-drag; }
        #font-manager-btn {
          width: auto;
          padding: 0 15px;
          font-size: 13px;
        }
      `;
      document.head.appendChild(style);
      console.log('Custom window controls injected.');
    }
  }

  // --- All other tweaks remain the same ---

  // Add the Photopea Icon
  if (!document.querySelector('.electron-app-icon')) {
    const topBar = document.querySelector('.topbar');
    if (topBar) {
      const appIcon = document.createElement('img');
      appIcon.src = '/promo/thumb256.png';
      appIcon.className = 'electron-app-icon';
      topBar.prepend(appIcon);
    }
  }

  // Clear the Welcome Screen's Left Menu
  const welcomeMenu = document.querySelector('div[style*="width: 210px"][style*="padding-top: 32px"]');
  if (welcomeMenu && welcomeMenu.innerHTML !== '') {
    welcomeMenu.innerHTML = '';
  }

  // Remove Top Bar Buttons
  const accountButton = Array.from(document.querySelectorAll('button.fitem.bbtn')).find(el => el.textContent.trim() === 'Account');
  if (accountButton) accountButton.remove();
  const fullscreenButton = document.querySelector('button[title="Fullscreen"]');
  if (fullscreenButton) fullscreenButton.remove();

  // Remove the non-functional "Templates" feature from the Home Screen.
  const templatesButton = Array.from(document.querySelectorAll('span.bhover'))
                               .find(el => el.textContent.trim() === 'Templates');
  if (templatesButton) {
    templatesButton.remove();
  }

  // Remove the bottom promotional banner
  const bottomBanner = document.querySelector('div[style*="filter: drop-shadow"][style*="bottom: 0px"]');
  if (bottomBanner) {
    bottomBanner.remove();
  }

  // --- Add Custom "Desktop" Menu Button ---
  if (!document.getElementById('desktop-menu-btn')) {
    const moreButton = Array.from(document.querySelectorAll('.topbar > span > button')).find(btn => btn.textContent.trim() === 'More');
    if (moreButton) {
      const menuId = 'desktop-context-menu';

      // --- Menu Configuration ---
      const menuItems = [
        {
          label: 'Manage Offline Fonts',
          action: () => ipcRenderer.send('open-font-manager')
        },
        // { label: 'Another Item', action: () => alert('Another action!') }, // Example
      ];

      // --- Helper Functions ---
      const closeMenu = () => {
        const menu = document.getElementById(menuId);
        if (menu) menu.remove();
        window.removeEventListener('mousedown', handleOutsideClick);
      };

      const handleOutsideClick = (event) => {
        const menu = document.getElementById(menuId);
        // This handler now closes the menu if the click is outside of it.
        // The button's own click handler manages toggling.
        if (menu && !menu.contains(event.target)) {
          closeMenu();
        }
      };

      const createMenuItem = (itemConfig) => {
        const menuItem = document.createElement('div');
        menuItem.className = 'enab';
        menuItem.innerHTML = `<span class="check"></span><span class="label">${itemConfig.label}</span>`;
        menuItem.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          closeMenu();
          itemConfig.action();
        });
        return menuItem;
      };

      const openMenu = (button) => {
        const cmanager = document.querySelector('.cmanager');
        if (!cmanager) return;
        
        const anyContextMenu = cmanager.querySelector('.contextpanel');
        if (anyContextMenu) anyContextMenu.remove();
        
        const menu = document.createElement('div');
        menu.id = menuId;
        menu.className = 'contextpanel cp_light';
        const buttonRect = button.getBoundingClientRect();
        menu.style.cssText = `position: absolute; z-index: 10; left: ${buttonRect.left}px; top: ${buttonRect.bottom}px;`;
        
        menuItems.forEach(item => menu.appendChild(createMenuItem(item)));
        
        cmanager.appendChild(menu);
        
        setTimeout(() => window.addEventListener('mousedown', handleOutsideClick), 0);
      };

      // --- Button Creation & Logic ---
      const desktopButton = document.createElement('button');
      desktopButton.id = 'desktop-menu-btn';
      desktopButton.textContent = 'Desktop';
      
      desktopButton.addEventListener('mousedown', (event) => {
        event.stopPropagation();
        if (document.getElementById(menuId)) {
          closeMenu();
        } else {
          openMenu(desktopButton);
        }
      });
      
      moreButton.parentNode.appendChild(desktopButton);
      console.log('Custom "Desktop" menu button injected.');

      // --- Observer to close our menu if Photopea opens one ---
      const cmanager = document.querySelector('.cmanager');
      if (cmanager) {
        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
              const addedNode = mutation.addedNodes[0];
              if (addedNode.nodeType === Node.ELEMENT_NODE && addedNode.classList.contains('contextpanel') && addedNode.id !== menuId) {
                closeMenu();
              }
            }
          }
        });
        observer.observe(cmanager, { childList: true });
      }
    }
  }
}

// --- Use MutationObserver ---
window.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver(() => {
    applyDOMTweaks();
  });
  observer.observe(document.body, { childList: true, subtree: true });
});