import { getContext, substituteParams } from '../../../../script.js';
import { extension_settings, saveSettingsDebounced } from '../../../extensions.js';
import { getFileText, debounce } from '../../../utils.js';

const { eventSource, event_types, callPopup, renderExtensionTemplateAsync, getContext } = getContext();
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const chokidar = require('chokidar');

const EXTENSION_ID = 'image-embedder';
const defaultSettings = {
    enabled: true,
    folder: '',
    maxWidth: '600px',
    allowedTypes: ['image/png', 'image/jpeg', 'image/webp'],
    cache: {},
    lastScan: 0
};

let imageCache = new Map();

async function scanFolder(folder) {
    try {
        if (!folder || !fs.existsSync(folder)) return;

        const files = await fs.promises.readdir(folder);
        const newCache = new Map();

        for (const file of files) {
            try {
                const filePath = path.join(folder, file);
                const stats = await fs.promises.stat(filePath);

                if (stats.isFile()) {
                    const mimeType = mime.lookup(file);
                    if (extension_settings[EXTENSION_ID].allowedTypes.includes(mimeType)) {
                        newCache.set(file.toLowerCase(), {
                            path: filePath,
                            name: path.basename(file, path.extname(file)),
                            mime: mimeType,
                            size: stats.size,
                            mtime: stats.mtimeMs
                        });
                    }
                }
            } catch (e) {
                console.error('Error processing file:', file, e);
            }
        }

        imageCache = newCache;
        extension_settings[EXTENSION_ID].cache = Object.fromEntries(imageCache);
        extension_settings[EXTENSION_ID].lastScan = Date.now();
        saveSettingsDebounced();
        updateStatus();
    } catch (error) {
        console.error('Image Embedder scan error:', error);
    }
}

function updateStatus() {
    const count = imageCache.size;
    $('#imageEmbedderCount').text(count);
    $('#imageEmbedderStatus').toggleClass('error', count === 0);
}

function updateSettingsUI() {
    $('#imageEmbedderEnabled').prop('checked', extension_settings[EXTENSION_ID].enabled);
    $('#imageEmbedderFolder').val(extension_settings[EXTENSION_ID].folder);
    $('#imageEmbedderMaxWidth').val(extension_settings[EXTENSION_ID].maxWidth);
}

async function handleFolderSelect() {
    const result = await window.electron.showOpenDialog({
        properties: ['openDirectory']
    });

    if (!result.canceled && result.filePaths[0]) {
        extension_settings[EXTENSION_ID].folder = result.filePaths[0];
        await scanFolder(extension_settings[EXTENSION_ID].folder);
        updateSettingsUI();
        startFileWatcher();
    }
}

function replaceImageTags(text) {
    const pattern = /\[([^\]]+?\.(?:png|jpe?g|webp))(:\d+%?)?\]/gi;

    return text.replace(pattern, (match, filename, size) => {
        const image = imageCache.get(filename.toLowerCase());
        if (!image) return match;

        const width = size ? size.slice(1) : extension_settings[EXTENSION_ID].maxWidth;
        return `<img src="file://${image.path}" 
                    alt="${image.name}" 
                    style="max-width: ${width}; border-radius: 8px;"
                    class="embedded-image"
                    data-filename="${filename}">`;
    });
}

function setupEventListeners() {
    $('#imageEmbedderEnabled').on('change', function() {
        extension_settings[EXTENSION_ID].enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#imageEmbedderFolderBtn').on('click', debounce(handleFolderSelect, 300));

    $('#imageEmbedderMaxWidth').on('input', debounce(function() {
        extension_settings[EXTENSION_ID].maxWidth = $(this).val();
        saveSettingsDebounced();
    }, 500));
}

function startFileWatcher() {
    if (this.watcher) {
        this.watcher.close();
    }

    if (extension_settings[EXTENSION_ID].folder) {
        this.watcher = chokidar.watch(extension_settings[EXTENSION_ID].folder, {
            ignoreInitial: true,
            awaitWriteFinish: true
        });

        this.watcher
            .on('add', path => scanFolder(extension_settings[EXTENSION_ID].folder))
            .on('unlink', path => scanFolder(extension_settings[EXTENSION_ID].folder));
    }
}

eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
    if (!extension_settings[EXTENSION_ID].enabled) return;

    const message = getContext().chat[messageId];
    message.mes = replaceImageTags(message.mes);
    getContext().updateMessageBlock(messageId, message);
});

eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
    if (!extension_settings[EXTENSION_ID].enabled) return;

    const message = getContext().chat[messageId];
    message.swipes.forEach((swipe, index) => {
        message.swipes[index] = replaceImageTags(swipe);
    });
    getContext().updateMessageBlock(messageId, message);
});

jQuery(async () => {
    if (!extension_settings[EXTENSION_ID]) {
        extension_settings[EXTENSION_ID] = JSON.parse(JSON.stringify(defaultSettings));
    }

    if (extension_settings[EXTENSION_ID].cache) {
        imageCache = new Map(Object.entries(extension_settings[EXTENSION_ID].cache));
    }

    // Регистрация UI
    const $settings = await renderExtensionTemplateAsync(EXTENSION_ID, 'settings');
    $('#extensions_settings').append($settings);

    setupEventListeners();
    updateSettingsUI();
    updateStatus();

    if (extension_settings[EXTENSION_ID].folder) {
        scanFolder(extension_settings[EXTENSION_ID].folder);
        startFileWatcher();
    }

    console.log('🖼️ Image Embedder initialized');
});
