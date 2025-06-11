let allFonts = [];
let filteredFonts = [];
let downloadErrorCount = 0; // Track errors during a download session
let selectedFontsPsn = new Set();

const containerEl = document.getElementById('font-list-container');
const sizerEl = document.getElementById('font-list-sizer');
const viewportEl = document.getElementById('font-list-viewport');

const searchInput = document.getElementById('search-input');
const selectAllBtn = document.getElementById('select-all-btn');
const deselectAllBtn = document.getElementById('deselect-all-btn');
const downloadBtn = document.getElementById('download-btn');
const statusBar = document.getElementById('status-bar');

const ITEM_HEIGHT = 30; // Must match .font-item height in CSS
const VISIBLE_BUFFER = 5; // Render this many extra items above/below viewport

function renderVirtualList() {
    const containerHeight = containerEl.clientHeight;
    const scrollTop = containerEl.scrollTop;

    // Calculate which items should be visible
    let startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
    let endIndex = startIndex + Math.ceil(containerHeight / ITEM_HEIGHT);
    
    // Apply buffer
    startIndex = Math.max(0, startIndex - VISIBLE_BUFFER);
    endIndex = Math.min(filteredFonts.length, endIndex + VISIBLE_BUFFER);
    
    const visibleItems = filteredFonts.slice(startIndex, endIndex);

    // Position the viewport to match the scroll position
    const offsetY = startIndex * ITEM_HEIGHT;
    viewportEl.style.transform = `translateY(${offsetY}px)`;

    let html = '';
    for (const font of visibleItems) {
        const isSelected = selectedFontsPsn.has(font.psn);
        html += `
            <div class="font-item ${font.isDownloaded ? 'downloaded' : ''}" data-psn="${font.psn}">
                <input type="checkbox" ${font.isDownloaded ? 'disabled checked' : ''} ${isSelected ? 'checked' : ''}>
                <label>${font.ff} - ${font.fsf}</label>
            </div>
        `;
    }
    viewportEl.innerHTML = html;
}

function applyFilter() {
    const lowerFilter = searchInput.value.toLowerCase();
    filteredFonts = allFonts.filter(font => 
        font.ff.toLowerCase().includes(lowerFilter) || 
        font.fsf.toLowerCase().includes(lowerFilter)
    );
    
    // Update the sizer height to make the scrollbar correct
    sizerEl.style.height = `${filteredFonts.length * ITEM_HEIGHT}px`;
    
    // Reset scroll and render the new virtual list
    containerEl.scrollTop = 0;
    renderVirtualList();
}

async function initialize() {
    selectedFontsPsn.clear();
    allFonts = await window.fontAPI.getFontList();
    applyFilter();
}

searchInput.addEventListener('input', applyFilter);
containerEl.addEventListener('scroll', renderVirtualList);

// Handle individual checkbox clicks via event delegation on the viewport
viewportEl.addEventListener('change', (event) => {
    if (event.target.type === 'checkbox') {
        const fontItem = event.target.closest('.font-item');
        if (fontItem) {
            const psn = fontItem.dataset.psn;
            if (event.target.checked) {
                selectedFontsPsn.add(psn);
            } else {
                selectedFontsPsn.delete(psn);
            }
        }
    }
});

selectAllBtn.addEventListener('click', () => {
    filteredFonts.forEach(font => {
        if (!font.isDownloaded) {
            selectedFontsPsn.add(font.psn);
        }
    });
    renderVirtualList(); // Re-render to show checks
});

deselectAllBtn.addEventListener('click', () => {
    selectedFontsPsn.clear();
    renderVirtualList(); // Re-render to show checks
});

downloadBtn.addEventListener('click', () => {
    const fontsToDownload = [];
    const allFontsByPsn = new Map(allFonts.map(f => [f.psn, f]));

    // Build the list of fonts to download from the selection Set
    selectedFontsPsn.forEach(psn => {
        if (allFontsByPsn.has(psn)) {
            fontsToDownload.push(allFontsByPsn.get(psn));
        }
    });

    if (fontsToDownload.length > 0) {
        downloadErrorCount = 0; // Reset error count before starting
        window.fontAPI.downloadFonts(fontsToDownload);
        downloadBtn.disabled = true;
        statusBar.textContent = `Starting download of ${fontsToDownload.length} fonts...`;
    }
});

window.fontAPI.onDownloadProgress(({ completed, total, name, error }) => {
    if (error) {
        downloadErrorCount++;
        statusBar.textContent = `[${completed}/${total}] Error downloading ${name}.`;
    } else {
        statusBar.textContent = `[${completed}/${total}] Downloaded: ${name}`;
        
        // Dynamically update the UI for the newly downloaded font
        const fontItemEl = document.querySelector(`.font-item[data-psn="${name}"]`);
        if (fontItemEl) {
            fontItemEl.classList.add('downloaded');
            const checkbox = fontItemEl.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.disabled = true;
                checkbox.checked = true;
            }
        }
        
        // Also update the master data list so the state persists after filtering
        const fontData = allFonts.find(f => f.psn === name);
        if (fontData) {
            fontData.isDownloaded = true;
        }
        
        // Remove from selection set if it was selected
        selectedFontsPsn.delete(name);
    }

    if (completed === total) {
        if (downloadErrorCount > 0) {
            statusBar.textContent = `Download complete with ${downloadErrorCount} error(s). Check console for details.`;
        } else {
            statusBar.textContent = 'All downloads finished! New fonts are now available for use.';
        }
        downloadBtn.disabled = false;
        // No need to call initialize() anymore, as we updated the UI dynamically.
    }
});

initialize();

window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        window.fontAPI.closeWindow();
    }
});
