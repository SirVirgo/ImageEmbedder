const { hooks, events, ui, settingsManager } = require('sillytavern-api');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { ipcRenderer } = require('electron');

// Конфигурация
let config = {
    imageFolder: path.join(__dirname, 'image_cache'),
    allowedTypes: new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']),
    maxSize: '800px'
};

// Инициализация
let imageMap = new Map();

function loadConfig() {
    const saved = settingsManager.getExtensionConfig('ImageEmbedder');
    if (saved) {
        config = { ...config, ...saved };
    }

    // Создаем папку, если не существует
    if (!fs.existsSync(config.imageFolder)) {
        fs.mkdirSync(config.imageFolder, { recursive: true });
    }
}

function scanImages() {
    imageMap.clear();
    try {
        fs.readdirSync(config.imageFolder).forEach(file => {
            const filePath = path.join(config.imageFolder, file);
            const stats = fs.statSync(filePath);

            if (stats.isFile()) {
                const mimeType = mime.lookup(file);
                if (config.allowedTypes.has(mimeType)) {
                    imageMap.set(file.toLowerCase(), {
                        path: filePath,
                        name: path.basename(file, path.extname(file)),
                        mime: mimeType
                    });
                }
            }
        });
    } catch (error) {
        ui.notificationError(`Ошибка сканирования: ${error.message}`);
    }
}

// GUI Integration
hooks.register('settings-ui', () => ({
    id: 'image-embedder',
    name: 'Image Embedder',
    content: `
        <div class="image-embedder-settings">
            <h3>Настройки изображений</h3>
            <div class="setting-item">
                <label>Папка с изображениями:</label>
                <input type="text" id="imageFolderPath" 
                       value="${config.imageFolder}" 
                       readonly
                       style="width: 70%">
                <button onclick="selectImageFolder()" 
                        class="btn btn-primary"
                        style="margin-left: 10px">
                    Выбрать папку
                </button>
            </div>
            <div class="setting-item">
                <label>Макс. размер:</label>
                <input type="text" 
                       id="imageMaxSize" 
                       value="${config.maxSize}"
                       onchange="updateMaxSize(this.value)">
            </div>
        </div>
    `
}));

// Обработчики GUI
window.selectImageFolder = async () => {
    const result = await ipcRenderer.invoke('open-directory-dialog');
    if (!result.canceled && result.filePaths[0]) {
        config.imageFolder = result.filePaths[0];
        document.getElementById('imageFolderPath').value = config.imageFolder;
        saveConfig();
        scanImages();
    }
};

window.updateMaxSize = (value) => {
    config.maxSize = value;
    saveConfig();
};

function saveConfig() {
    settingsManager.setExtensionConfig('ImageEmbedder', config);
}

// Обработка сообщений
hooks.register('message-preprocess', (message) => {
    const imageRegex = /\[([^\]]+?\.(?:png|jpe?g|webp|avif))(:\d+%?)?\]/gi;

    message.content = message.content.replace(imageRegex, (match, fileName, size) => {
        const image = imageMap.get(fileName.toLowerCase());
        if (!image) return match;

        const sizeAttr = size ? ` style="width: ${size.slice(1)}"` : 
                             ` style="max-width: ${config.maxSize}"`;

        return `<img src="${getImageData(image)}" 
                    alt="${image.name}"
                    ${sizeAttr}
                    class="user-image-embed">`;
    });

    return message;
});

function getImageData(image) {
    try {
        if (process.env.ELECTRON) {
            return `file://${image.path}?${Date.now()}`;
        } else {
            const data = fs.readFileSync(image.path);
            return `data:${image.mime};base64,${data.toString('base64')}`;
        }
    } catch (error) {
        console.error('Error loading image:', error);
        return '[Image load failed]';
    }
}

// Инициализация
events.on('extension-loaded', () => {
    loadConfig();
    scanImages();

    fs.watch(config.imageFolder, { recursive: true }, (event) => {
        if (event === 'rename') scanImages();
    });
});

// Стили
hooks.register('styles', () => `
    .user-image-embed {
        border-radius: 8px;
        margin: 10px 0;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        display: block;
    }

    .image-embedder-settings {
        padding: 15px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        margin-bottom: 20px;
    }
`);