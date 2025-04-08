import { getContext, substituteParams } from '../../../../script.js';
import { extension_settings, saveSettingsDebounced } from '../../../extensions.js';
import { getFileText, debounce } from '../../../utils.js';

const { eventSource, event_types, callPopup, renderExtensionTemplateAsync } = getContext();

const defaultSettings = {
    enabled: true,
    folder: '',
    maxWidth: '600px',
    allowedTypes: ['image/png', 'image/jpeg', 'image/webp'],
    cache: {},
    lastScan: 0
};

const path = 'extensions/ImageEmbedder';
let imageCache = new Map();

async function scanFolder(folder) {
    try {
        const files = await fs.promises.readdir(folder);
        imageCache.clear();

        for (const file of files) {
            const filePath = path.join(folder, file);
            const stats = await fs.promises.stat(filePath);

            if (stats.isFile()) {
                const mimeType = mime.lookup(file);
                if (extension_settings.ImageEmbedder.allowedTypes.includes(mimeType)) {
                    imageCache.set(file.toLowerCase(), {
                        path: filePath,
                        name: path.basename(file, path.extname(file)),
                        mime: mimeType,
                        size: stats.size,
                        lastModified: stats.mtimeMs
                    });
                }
            }
        }

        extension_settings.ImageEmbedder.cache = Object.fromEntries(imageCache);
        extension_settings.ImageEmbedder.lastScan = Date.now();
        saveSettingsDebounced();
    } catch (error) {
        console.error('Image Embedder scan error:', error);
    }
}

function updateSettingsUI() {
    $('#imageEmbedderFolder').val(extension_settings.ImageEmbedder.folder);
    $('#imageEmbedderMaxWidth').val(extension_settings.ImageEmbedder.maxWidth);
    $('#imageEmbedderEnabled').prop('checked', extension_settings.ImageEmbedder.enabled);
}

async function handleFolderSelect() {
    const result = await window.electron.showOpenDialog({
        properties: ['openDirectory']
    });

    if (!result.canceled && result.filePaths[0]) {
        extension_settings.ImageEmbedder.folder = result.filePaths[0];
        await scanFolder(extension_settings.ImageEmbedder.folder);
        updateSettingsUI();
    }
}

function replaceImageTags(text) {
    const pattern = /\[([^\]]+?\.(?:png|jpe?g|webp))(:\d+%?)?\]/gi;

    return text.replace(pattern, (match, filename, size) => {
        const image = imageCache.get(filename.toLowerCase());
        if (!image) return match;

        const width = size ? size.slice(1) : extension_settings.ImageEmbedder.maxWidth;
        return `<img src="file://${image.path}" 
                    alt="${image.name}" 
                    style="max-width: ${width}; border-radius: 8px;"
                    class="embedded-image">`;
    });
}

eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
    if (!extension_settings.ImageEmbedder.enabled) return;

    const message = chat[messageId];
    message.mes = replaceImageTags(message.mes);
    updateMessageBlock(messageId, message);
});

eventSource.on(event_types.MESSAGE_SWIPED, (messageId) => {
    if (!extension_settings.ImageEmbedder.enabled) return;

    const message = chat[messageId];
    message.swipes.forEach((swipe, index) => {
        message.swipes[index] = replaceImageTags(swipe);
    });
    updateMessageBlock(messageId, message);
});

jQuery(async () => {
    // Инициализация настроек
    if (!extension_settings.ImageEmbedder) {
        extension_settings.ImageEmbedder = { ...defaultSettings };
    }

    // Загрузка кэша
    if (Object.keys(extension_settings.ImageEmbedder.cache).length > 0) {
        imageCache = new Map(Object.entries(extension_settings.ImageEmbedder.cache));
    }

    // Регистрация UI
    $('#extensions_settings').append(await renderExtensionTemplateAsync(path, 'settings'));

    // Элементы управления
    $('#imageEmbedderEnabled').on('change', () => {
        extension_settings.ImageEmbedder.enabled = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#imageEmbedderFolderBtn').on('click', debounce(handleFolderSelect, 300));

    $('#imageEmbedderMaxWidth').on('input', debounce(() => {
        extension_settings.ImageEmbedder.maxWidth = $(this).val();
        saveSettingsDebounced();
    }, 500));

    // Автосканирование при изменениях
    const watcher = chokidar.watch(extension_settings.ImageEmbedder.folder, {
        ignoreInitial: true,
        awaitWriteFinish: true
    });

    watcher.on('add', (path) => scanFolder(extension_settings.ImageEmbedder.folder));
    watcher.on('unlink', (path) => scanFolder(extension_settings.ImageEmbedder.folder));

    updateSettingsUI();
    console.log('🖼️ Image Embedder loaded');
});
