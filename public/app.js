// App State
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let apiKey = '';
let notionApiKey = ''; // Added for Notion API Key
let notionDatabaseId = ''; // Added for Notion Database ID
let notionDatabaseSchema = null; // Added to store fetched Notion DB schema
let allTasks = []; // Store all tasks
let recordingTimer = null; // Timer voor maximale opnameduur
const MAX_RECORDING_TIME = 5 * 60 * 1000; // 5 minuten in milliseconden
let isDesktopBrowser = false; // Indicator voor desktop browser
const API_KEY_STORAGE_DURATION = 30; // Aantal dagen om API key te bewaren

// === ENHANCED CREDENTIAL STORAGE SYSTEM ===
class SecureCredentialManager {
    constructor() {
        this.dbName = 'VoiceTaskSecureDB';
        this.dbVersion = 1;
        this.storeName = 'credentials';
        this.encryptionKey = this.generateDeviceKey();
        this.db = null;
    }

    // Generate a device-specific encryption key
    generateDeviceKey() {
        const userAgent = navigator.userAgent;
        const screenDimensions = `${screen.width}x${screen.height}`;
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const baseString = `${userAgent}-${screenDimensions}-${timezone}`;
        
        // Simple but effective device fingerprint
        let hash = 0;
        for (let i = 0; i < baseString.length; i++) {
            const char = baseString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    // Simple XOR encryption (sufficient for local storage)
    encrypt(text, key) {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return btoa(result); // Base64 encode
    }

    decrypt(encryptedText, key) {
        try {
            const decoded = atob(encryptedText); // Base64 decode
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return result;
        } catch (error) {
            console.error('Decryption failed:', error);
            return null;
        }
    }

    // Initialize IndexedDB
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('type', 'type', { unique: false });
                    store.createIndex('expiryDate', 'expiryDate', { unique: false });
                }
            };
        });
    }

    // Store credentials securely
    async storeCredentials(credentials) {
        if (!this.db) await this.initDB();
        
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        
        const promises = [];
        
        // Store each credential type
        Object.entries(credentials).forEach(([key, value]) => {
            if (value && value.trim()) {
                const encryptedValue = this.encrypt(value, this.encryptionKey);
                const credentialData = {
                    id: key,
                    type: 'api_credential',
                    value: encryptedValue,
                    timestamp: Date.now(),
                    expiryDate: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
                    deviceKey: this.encryptionKey.substring(0, 8) // Partial key for validation
                };
                
                promises.push(
                    new Promise((resolve, reject) => {
                        const request = store.put(credentialData);
                        request.onsuccess = () => resolve();
                        request.onerror = () => reject(request.error);
                    })
                );
            }
        });
        
        await Promise.all(promises);
        
        // Also store in localStorage as backup
        this.storeInLocalStorageBackup(credentials);
        
        console.log('✅ Credentials stored securely in IndexedDB');
    }

    // Retrieve credentials securely
    async retrieveCredentials() {
        try {
            if (!this.db) await this.initDB();
            
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            
            const credentials = {};
            const credentialKeys = ['openaiApiKey', 'notionApiKey', 'notionDatabaseId'];
            
            const promises = credentialKeys.map(key => 
                new Promise((resolve) => {
                    const request = store.get(key);
                    request.onsuccess = () => {
                        const result = request.result;
                        if (result && result.expiryDate > Date.now()) {
                            // Verify device key matches
                            if (result.deviceKey === this.encryptionKey.substring(0, 8)) {
                                const decryptedValue = this.decrypt(result.value, this.encryptionKey);
                                if (decryptedValue) {
                                    credentials[key] = decryptedValue;
                                }
                            }
                        }
                        resolve();
                    };
                    request.onerror = () => resolve(); // Continue on error
                })
            );
            
            await Promise.all(promises);
            
            // Fallback to localStorage if IndexedDB fails
            if (Object.keys(credentials).length === 0) {
                console.log('🔄 Falling back to localStorage');
                return this.retrieveFromLocalStorageBackup();
            }
            
            console.log('✅ Credentials retrieved from IndexedDB');
            return credentials;
            
        } catch (error) {
            console.error('IndexedDB retrieval failed, using localStorage fallback:', error);
            return this.retrieveFromLocalStorageBackup();
        }
    }

    // Clean expired credentials
    async cleanExpiredCredentials() {
        if (!this.db) await this.initDB();
        
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const index = store.index('expiryDate');
        
        const now = Date.now();
        const range = IDBKeyRange.upperBound(now);
        
        const request = index.openCursor(range);
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
    }

    // localStorage backup methods
    storeInLocalStorageBackup(credentials) {
        try {
            Object.entries(credentials).forEach(([key, value]) => {
                if (value && value.trim()) {
                    const encryptedValue = this.encrypt(value, this.encryptionKey);
                    const data = {
                        value: encryptedValue,
                        timestamp: Date.now(),
                        expiryDate: Date.now() + (30 * 24 * 60 * 60 * 1000)
                    };
                    localStorage.setItem(`secure_${key}`, JSON.stringify(data));
                }
            });
        } catch (error) {
            console.error('localStorage backup failed:', error);
        }
    }

    retrieveFromLocalStorageBackup() {
        const credentials = {};
        const credentialKeys = ['openaiApiKey', 'notionApiKey', 'notionDatabaseId'];
        
        credentialKeys.forEach(key => {
            try {
                const stored = localStorage.getItem(`secure_${key}`);
                if (stored) {
                    const data = JSON.parse(stored);
                    if (data.expiryDate > Date.now()) {
                        const decryptedValue = this.decrypt(data.value, this.encryptionKey);
                        if (decryptedValue) {
                            credentials[key] = decryptedValue;
                        }
                    } else {
                        localStorage.removeItem(`secure_${key}`);
                    }
                }
            } catch (error) {
                console.error(`Failed to retrieve ${key} from localStorage:`, error);
            }
        });
        
        return credentials;
    }

    // Clear all stored credentials
    async clearAllCredentials() {
        // Clear IndexedDB
        if (this.db) {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            await new Promise((resolve) => {
                const request = store.clear();
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
            });
        }
        
        // Clear localStorage backup
        ['openaiApiKey', 'notionApiKey', 'notionDatabaseId'].forEach(key => {
            localStorage.removeItem(`secure_${key}`);
        });
        
        // Clear legacy storage
        localStorage.removeItem('voiceTaskApiKey');
        localStorage.removeItem('voiceTaskApiKeyExpiry');
        sessionStorage.removeItem('voiceTaskApiKey');
        localStorage.removeItem('voiceTaskNotionApiKey');
        localStorage.removeItem('voiceTaskNotionDatabaseId');
        localStorage.removeItem('voiceTaskNotionCredentialsExpiry');
        sessionStorage.removeItem('voiceTaskNotionApiKey');
        sessionStorage.removeItem('voiceTaskNotionDatabaseId');
        
        console.log('🗑️ All credentials cleared');
    }
}

// Initialize credential manager
const credentialManager = new SecureCredentialManager();

// === SERVICE WORKER REGISTRATION ===
// Register service worker for PWA functionality and credential persistence
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('✅ Service Worker registered successfully:', registration.scope);
            
            // Listen for service worker messages
            navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
            
            // Setup background sync for credential backup
            if ('sync' in window.ServiceWorkerRegistration.prototype) {
                console.log('✅ Background Sync supported');
            }
            
        } catch (error) {
            console.error('❌ Service Worker registration failed:', error);
        }
    });
}

// Handle service worker messages
function handleServiceWorkerMessage(event) {
    const { type, data } = event.data;
    
    switch (type) {
        case 'CREDENTIAL_BACKUP_SUCCESS':
            console.log('✅ Credentials backed up successfully via Service Worker');
            break;
        case 'CREDENTIAL_RESTORE_REQUEST':
            handleCredentialRestoreRequest();
            break;
        default:
            console.log('Service Worker message:', type, data);
    }
}

// Enhanced credential manager with service worker backup
credentialManager.storeCredentialsWithBackup = async function(credentials) {
    // Store using primary method
    await this.storeCredentials(credentials);
    
    // Additional backup via service worker
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'BACKUP_CREDENTIALS',
            data: credentials
        });
    }
    
    // Schedule background sync for network backup
    if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
        const registration = await navigator.serviceWorker.ready;
        try {
            await registration.sync.register('credential-backup');
            console.log('🔄 Background sync scheduled for credential backup');
        } catch (error) {
            console.error('Background sync registration failed:', error);
        }
    }
};

// Enhanced credential retrieval with service worker fallback
credentialManager.retrieveCredentialsWithFallback = async function() {
    // Try primary retrieval method first
    let credentials = await this.retrieveCredentials();
    
    // If no credentials found, try service worker backup
    if (Object.keys(credentials).length === 0 && navigator.serviceWorker) {
        try {
            credentials = await requestCredentialsFromServiceWorker();
            if (Object.keys(credentials).length > 0) {
                console.log('✅ Credentials restored from Service Worker backup');
                // Store back in primary storage
                await this.storeCredentials(credentials);
            }
        } catch (error) {
            console.error('Service Worker credential restore failed:', error);
        }
    }
    
    return credentials;
};

// Request credentials from service worker
function requestCredentialsFromServiceWorker() {
    return new Promise((resolve) => {
        if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
            resolve({});
            return;
        }
        
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = (event) => {
            const { success, credentials, error } = event.data;
            if (success) {
                resolve(credentials || {});
            } else {
                console.error('Service Worker credential restore error:', error);
                resolve({});
            }
        };
        
        navigator.serviceWorker.controller.postMessage({
            type: 'RESTORE_CREDENTIALS'
        }, [messageChannel.port2]);
    });
}

// === CREDENTIAL PERSISTENCE STATUS CHECKER ===
class CredentialStatusChecker {
    constructor() {
        this.statusElements = {
            indexeddb: document.getElementById('indexeddb-status'),
            serviceworker: document.getElementById('serviceworker-status'),
            localstorage: document.getElementById('localstorage-status'),
            android: document.getElementById('android-optimization')
        };
    }

    // Check all credential persistence methods
    async checkAllStatus() {
        await Promise.all([
            this.checkIndexedDBStatus(),
            this.checkServiceWorkerStatus(),
            this.checkLocalStorageStatus(),
            this.checkAndroidOptimization()
        ]);
    }

    // Update status item visual state
    updateStatusItem(element, status, icon, text) {
        if (!element) return;
        
        const iconSpan = element.querySelector('.status-icon');
        const textSpan = element.querySelector('.status-text');
        
        if (iconSpan) iconSpan.textContent = icon;
        if (textSpan && text) textSpan.textContent = text;
        
        // Update CSS classes
        element.classList.remove('active', 'limited', 'disabled', 'pending');
        element.classList.add(status);
    }

    // Check IndexedDB functionality
    async checkIndexedDBStatus() {
        try {
            if (!window.indexedDB) {
                this.updateStatusItem(this.statusElements.indexeddb, 'disabled', '❌', 'IndexedDB Versleuteling (Niet ondersteund)');
                return;
            }

            // Test IndexedDB creation
            const testDB = await new Promise((resolve, reject) => {
                const request = indexedDB.open('test-db', 1);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('test')) {
                        db.createObjectStore('test', { keyPath: 'id' });
                    }
                };
            });

            testDB.close();
            
            // Clean up test database
            indexedDB.deleteDatabase('test-db');
            
            this.updateStatusItem(this.statusElements.indexeddb, 'active', '✅', 'IndexedDB Versleuteling');
            
        } catch (error) {
            console.error('IndexedDB check failed:', error);
            this.updateStatusItem(this.statusElements.indexeddb, 'disabled', '❌', 'IndexedDB Versleuteling (Fout)');
        }
    }

    // Check Service Worker functionality
    async checkServiceWorkerStatus() {
        try {
            if (!('serviceWorker' in navigator)) {
                this.updateStatusItem(this.statusElements.serviceworker, 'disabled', '❌', 'Service Worker Backup (Niet ondersteund)');
                return;
            }

            const registration = await navigator.serviceWorker.getRegistration();
            if (registration && registration.active) {
                this.updateStatusItem(this.statusElements.serviceworker, 'active', '✅', 'Service Worker Backup');
            } else {
                this.updateStatusItem(this.statusElements.serviceworker, 'limited', '⚠️', 'Service Worker Backup (Registratie)');
            }
            
        } catch (error) {
            console.error('Service Worker check failed:', error);
            this.updateStatusItem(this.statusElements.serviceworker, 'disabled', '❌', 'Service Worker Backup (Fout)');
        }
    }

    // Check localStorage functionality
    checkLocalStorageStatus() {
        try {
            if (!window.localStorage) {
                this.updateStatusItem(this.statusElements.localstorage, 'disabled', '❌', 'LocalStorage Fallback (Niet ondersteund)');
                return;
            }

            // Test localStorage read/write
            const testKey = 'test-storage-key';
            const testValue = 'test-value';
            
            localStorage.setItem(testKey, testValue);
            const retrieved = localStorage.getItem(testKey);
            localStorage.removeItem(testKey);
            
            if (retrieved === testValue) {
                this.updateStatusItem(this.statusElements.localstorage, 'active', '✅', 'LocalStorage Fallback');
            } else {
                this.updateStatusItem(this.statusElements.localstorage, 'limited', '⚠️', 'LocalStorage Fallback (Beperkt)');
            }
            
        } catch (error) {
            console.error('localStorage check failed:', error);
            this.updateStatusItem(this.statusElements.localstorage, 'disabled', '❌', 'LocalStorage Fallback (Fout)');
        }
    }

    // Check Android PWA optimization
    checkAndroidOptimization() {
        const isAndroid = /Android/i.test(navigator.userAgent);
        const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                     window.navigator.standalone === true;
        const supportsBackgroundSync = 'serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype;
        
        if (isAndroid && isPWA && supportsBackgroundSync) {
            this.updateStatusItem(this.statusElements.android, 'active', '✅', 'Android PWA Optimalisatie');
        } else if (isAndroid) {
            if (isPWA) {
                this.updateStatusItem(this.statusElements.android, 'limited', '⚠️', 'Android PWA (Beperkte sync)');
            } else {
                this.updateStatusItem(this.statusElements.android, 'limited', '⚠️', 'Android Browser (Installeer als app)');
            }
        } else {
            this.updateStatusItem(this.statusElements.android, 'active', '💻', 'Desktop Optimalisatie');
        }
    }
}

// Initialize credential status checker
const credentialStatusChecker = new CredentialStatusChecker();

// Add event listener to update status when settings panel opens
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize the settings panel
    initializeSettingsPanel();
    
    // Setup all event listeners for the app
    setupEventListeners();
    
    // Load saved credentials and auto-login
    await loadSavedCredentials();
    
    const settingsButton = document.getElementById('settings-button');
    if (settingsButton) {
        settingsButton.addEventListener('click', () => {
            // Delay status check to ensure elements are visible
            setTimeout(() => {
                credentialStatusChecker.checkAllStatus();
            }, 100);
        });
    }
    
    // Also update status when gear icon is clicked (the actual settings button)
    const settingsGearIcon = document.getElementById('settings-gear-icon');
    if (settingsGearIcon) {
        settingsGearIcon.addEventListener('click', () => {
            // Delay status check to ensure elements are visible
            setTimeout(() => {
                credentialStatusChecker.checkAllStatus();
            }, 100);
        });
    }
});

// Load saved credentials and auto-login if valid
async function loadSavedCredentials() {
    try {
        console.log('Loading saved credentials...');
        
        // Use enhanced credential retrieval with fallback
        const credentials = await credentialManager.retrieveCredentialsWithFallback();
        
        // Load OpenAI API Key
        if (credentials.openaiApiKey) {
            apiKey = credentials.openaiApiKey;
            console.log('✅ OpenAI API key loaded from secure storage');
            
            // Auto-login if we have a valid API key
            const loginScreen = document.getElementById('login-screen');
            const appScreen = document.getElementById('app-screen');
            
            if (loginScreen && appScreen) {
                loginScreen.classList.add('hidden');
                appScreen.classList.remove('hidden');
                console.log('✅ Auto-logged in with saved credentials');
            }
        }
        
        // Load Notion credentials
        if (credentials.notionApiKey) {
            notionApiKey = credentials.notionApiKey;
            console.log('✅ Notion API key loaded from secure storage');
        }
        
        if (credentials.notionDatabaseId) {
            notionDatabaseId = credentials.notionDatabaseId;
            console.log('✅ Notion Database ID loaded from secure storage');
        }
        
        // If we have both Notion credentials, try to fetch schema
        if (notionApiKey && notionDatabaseId) {
            try {
                await fetchNotionDatabaseSchema();
                console.log('✅ Notion database schema loaded');
            } catch (error) {
                console.error('Failed to load Notion schema:', error);
            }
        }
        
    } catch (error) {
        console.error('Error loading saved credentials:', error);
    }
}

// Setup all event listeners for the app
function setupEventListeners() {
    console.log('Setting up event listeners');
    
    // Get DOM elements
    const loginButton = document.getElementById('login-button');
    const logoutButton = document.getElementById('logout-button');
    const recordButton = document.getElementById('record-button');
    const clearAllTasksButton = document.getElementById('clear-all-tasks-button');
    const copyButton = document.getElementById('copy-button');
    const copyTranscriptionButton = document.getElementById('copy-transcription-button');
    
    // Status and container elements
    const statusElement = document.getElementById('status');
    const tasksContainer = document.getElementById('tasks-container');
    const tasksElement = document.getElementById('tasks');
    const transcriptionContainer = document.getElementById('transcription-container');
    const transcriptionElement = document.getElementById('transcription');
    
    // Screen elements
    const loginScreen = document.getElementById('login-screen');
    const appScreen = document.getElementById('app-screen');
    const apiKeyInput = document.getElementById('api-key-input');
    
    // Make elements globally accessible
    window.statusElement = statusElement;
    window.tasksContainer = tasksContainer;
    window.tasksElement = tasksElement;
    window.transcriptionContainer = transcriptionContainer;
    window.transcriptionElement = transcriptionElement;
    window.copyTranscriptionButton = copyTranscriptionButton;
    
    // Record button event listener
    if (recordButton) {
        recordButton.addEventListener('click', toggleRecording);
        console.log('✅ Record button event listener added');
    } else {
        console.error('❌ Record button not found');
    }
    
    // Logout button event listener
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            // Clear credentials using secure credential manager
            credentialManager.clearAllCredentials();
            
            // Reset global variables
            apiKey = '';
            notionApiKey = '';
            notionDatabaseId = '';
            
            // Switch screens
            appScreen.classList.add('hidden');
            loginScreen.classList.remove('hidden');
            resetUI();
        });
        console.log('✅ Logout button event listener added');
    } else {
        console.error('❌ Logout button not found');
    }
    
    // Clear all tasks button
    if (clearAllTasksButton) {
        clearAllTasksButton.addEventListener('click', () => {
            if (confirm('Weet je zeker dat je alle taken wilt wissen?')) {
                allTasks = [];
                saveTasks();
                tasksContainer.classList.remove('hidden');
                tasksElement.innerHTML = '<p>Alle taken zijn gewist.</p>';
                statusElement.textContent = 'Alle taken gewist';
            }
        });
        console.log('✅ Clear all tasks button event listener added');
    } else {
        console.error('❌ Clear all tasks button not found');
    }
    
    // Copy all tasks button
    if (copyButton) {
        copyButton.addEventListener('click', () => {
            const taskElements = document.querySelectorAll('.task-item');
            let clipboardText = '';
            
            taskElements.forEach(taskElement => {
                const title = taskElement.querySelector('h3').textContent;
                const metadata = taskElement.querySelectorAll('.task-metadata span');
                
                clipboardText += `- ${title}\n`;
                metadata.forEach(item => {
                    clipboardText += `  ${item.textContent}\n`;
                });
                clipboardText += '\n';
            });
            
            navigator.clipboard.writeText(clipboardText)
                .then(() => {
                    const originalText = copyButton.textContent;
                    copyButton.textContent = 'Gekopieerd!';
                    setTimeout(() => {
                        copyButton.textContent = originalText;
                    }, 2000);
                })
                .catch(err => {
                    console.error('Failed to copy: ', err);
                    alert('Kon taken niet naar klembord kopiëren');
                });
        });
        console.log('✅ Copy button event listener added');
    } else {
        console.error('❌ Copy button not found');
    }
    
    // Copy transcription button
    if (copyTranscriptionButton) {
        copyTranscriptionButton.addEventListener('click', () => {
            const transcriptionText = transcriptionElement.textContent;
            if (transcriptionText) {
                navigator.clipboard.writeText(transcriptionText)
                    .then(() => {
                        const originalText = copyTranscriptionButton.textContent;
                        copyTranscriptionButton.textContent = 'Gekopieerd!';
                        setTimeout(() => {
                            copyTranscriptionButton.textContent = originalText;
                        }, 2000);
                    })
                    .catch(err => {
                        console.error('Failed to copy transcription: ', err);
                        alert('Kon transcriptie niet naar klembord kopiëren');
                    });
            }
        });
        console.log('✅ Copy transcription button event listener added');
    } else {
        console.error('❌ Copy transcription button not found');
    }
    
    console.log('✅ All event listeners setup complete');
}

// Add missing functions that are referenced but not defined
function toggleRecording() {
    const recordButton = document.getElementById('record-button');
    const statusElement = document.getElementById('status');
    
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

async function startRecording() {
    const recordButton = document.getElementById('record-button');
    const statusElement = document.getElementById('status');
    
    try {
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Setup MediaRecorder
        let options = {};
        if (MediaRecorder.isTypeSupported('audio/webm')) {
            options.mimeType = 'audio/webm';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            options.mimeType = 'audio/mp4';
        }
        
        mediaRecorder = new MediaRecorder(stream, options);
        audioChunks = [];
        
        mediaRecorder.addEventListener('dataavailable', event => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        });
        
        mediaRecorder.addEventListener('stop', () => {
            stream.getTracks().forEach(track => track.stop());
            processAudio();
        });
        
        mediaRecorder.start();
        isRecording = true;
        
        recordButton.textContent = 'Stop Opname';
        recordButton.classList.add('recording');
        statusElement.textContent = 'Opname gestart... Spreek nu je taken in';
        
        // Auto-stop after 5 minutes
        recordingTimer = setTimeout(() => {
            if (isRecording) {
                stopRecording();
            }
        }, MAX_RECORDING_TIME);
        
    } catch (error) {
        console.error('Error starting recording:', error);
        statusElement.textContent = 'Fout bij starten opname. Controleer microfoon toegang.';
    }
}

function stopRecording() {
    const recordButton = document.getElementById('record-button');
    const statusElement = document.getElementById('status');
    
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        
        recordButton.textContent = 'Start Opname';
        recordButton.classList.remove('recording');
        statusElement.textContent = 'Opname gestopt. Audio wordt verwerkt...';
        
        if (recordingTimer) {
            clearTimeout(recordingTimer);
            recordingTimer = null;
        }
    }
}

// Load saved tasks from localStorage
function loadSavedTasks() {
    try {
        const saved = localStorage.getItem('voiceTaskAllTasks');
        if (saved) {
            allTasks = JSON.parse(saved);
            console.log(`Loaded ${allTasks.length} saved tasks`);
        }
    } catch (error) {
        console.error('Error loading saved tasks:', error);
        allTasks = [];
    }
}

// Save tasks to localStorage
function saveTasks() {
    try {
        localStorage.setItem('voiceTaskAllTasks', JSON.stringify(allTasks));
        console.log(`Saved ${allTasks.length} tasks`);
    } catch (error) {
        console.error('Error saving tasks:', error);
    }
}

// Load saved tasks on startup
loadSavedTasks();

async function processAudio() {
    try {
        // Default to Dutch for Striks branding
        const preferDutch = true;
        
        if (audioChunks.length === 0) {
            console.error('No audio chunks to process');
            statusElement.textContent = preferDutch ? 
                'Geen audio opgenomen om te verwerken' : 
                'No audio recorded to process';
            return;
        }
        
        // Log information about audio chunks for debugging
        console.log(`Processing ${audioChunks.length} audio chunks`);
        audioChunks.forEach((chunk, index) => {
            console.log(`Chunk ${index}: ${chunk.size} bytes, type: ${chunk.type}`);
        });
        
        // Bepaal het juiste MIME type voor de Blob
        let blobType = 'audio/webm';
        
        // Als we een mediaRecorder hebben, gebruik dan de mimeType daarvan
        if (mediaRecorder && mediaRecorder.mimeType) {
            blobType = mediaRecorder.mimeType;
            console.log(`Using MediaRecorder mimeType: ${blobType}`);
        } else if (audioChunks.length > 0 && audioChunks[0].type) {
            // Als de chunks een type hebben, gebruik dat
            blobType = audioChunks[0].type;
            console.log(`Using audio chunk type: ${blobType}`);
        } else {
            console.log(`Falling back to default type: ${blobType}`);
        }
        
        // Create audio blob and form data
        const audioBlob = new Blob(audioChunks, { type: blobType });
        console.log(`Created audio blob: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
        
        // Check of de blob geldig is
        if (audioBlob.size === 0) {
            throw new Error('Opgenomen audiobestand is leeg. Probeer het opnieuw.');
        }
        
        // First, transcribe the audio using Whisper API
        const formData = new FormData();
        formData.append('file', audioBlob, `recording${Date.now()}.webm`);
        // Using a more advanced Whisper model for better accuracy
        formData.append('model', 'whisper-1');
        // Remove the language parameter to enable auto-detection
        // formData.append('language', 'en');
        // Update prompt to be language-neutral
        formData.append('prompt', 'This recording may contain tasks, to-do items, and reminders in various languages.');
        
        console.log('=== STARTING WHISPER API CALL ===');
        console.log(`Sending audio blob to Whisper API: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
        console.log(`API Key being used: ${apiKey.substring(0, 20)}...`);
        
        statusElement.textContent = preferDutch ? 'Audio transcriberen...' : 'Transcribing audio...';
        
        // Kortere timeout om sneller te detecteren of er problemen zijn
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            console.error('Whisper API timeout after 60 seconds');
            controller.abort();
            statusElement.textContent = preferDutch ? 
                'Timeout: API reactie duurt te lang. Probeer een kortere opname.' : 
                'Timeout: API response taking too long. Try a shorter recording.';
        }, 60000); // 60 seconden timeout
        
        console.log('Making fetch request to Whisper API...');
        
        try {
            const transcriptionResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                },
                body: formData,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            console.log('=== WHISPER API RESPONSE RECEIVED ===');
            console.log('Response status:', transcriptionResponse.status);
            console.log('Response headers:', Object.fromEntries([...transcriptionResponse.headers.entries()]));
            
            if (!transcriptionResponse.ok) {
                const errorText = await transcriptionResponse.text();
                console.error('Whisper API error response:', errorText);
                
                // Specifieke foutmeldingen
                if (transcriptionResponse.status === 401) {
                    throw new Error('API key is ongeldig. Controleer je OpenAI API key.');
                } else if (transcriptionResponse.status === 429) {
                    throw new Error('API quota overschreden. Probeer later opnieuw.');
                } else if (transcriptionResponse.status === 413) {
                    throw new Error('Audio bestand te groot. Maak een kortere opname.');
                }
                
                try {
                    const errorData = JSON.parse(errorText);
                    console.error('Parsed error data:', errorData);
                    throw new Error(`API Error: ${errorData.error?.message || 'Unknown error'}`);
                } catch (jsonError) {
                    throw new Error(`API Error (${transcriptionResponse.status}): ${errorText || 'Unknown error'}`);
                }
            }
            
            const transcriptionText = await transcriptionResponse.text();
            console.log('Raw transcription response:', transcriptionText.substring(0, 500) + (transcriptionText.length > 500 ? '...' : ''));
            
            let transcriptionData;
            try {
                transcriptionData = JSON.parse(transcriptionText);
                console.log('Parsed transcription data:', transcriptionData);
            } catch (jsonError) {
                console.error('Error parsing JSON from Whisper API response:', jsonError);
                throw new Error('Kon de API-respons niet verwerken (JSON parsing error)');
            }
            
            if (!transcriptionData.text || transcriptionData.text.trim() === '') {
                console.warn('Whisper API returned empty transcription');
                throw new Error('Geen spraak gedetecteerd in de opname. Probeer opnieuw en spreek duidelijk in de microfoon.');
            }
            
            const transcribedText = transcriptionData.text;
            console.log('=== TRANSCRIPTION SUCCESSFUL ===');
            console.log('Transcribed text:', transcribedText);
            
            // Display transcription
            transcriptionContainer.classList.remove('hidden');
            transcriptionElement.textContent = transcribedText;
            
            // Show copy transcription button
            if (copyTranscriptionButton) {
                copyTranscriptionButton.classList.remove('hidden');
            }
            
            // Continue with rest of processing...
            // Detect if the transcribed text is in Dutch
            const isDutchText = detectDutchLanguage(transcribedText);
            
            // Now, process the transcription using GPT to extract tasks
            statusElement.textContent = preferDutch ? 'Taken extraheren...' : 'Extracting tasks...';
            
            console.log('=== STARTING GPT CHAT COMPLETION ===');

            const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o', // Using a more advanced model for better understanding
                    messages: [
                        {
                            role: 'system',
                            content: `You are a specialized task extraction and processing system that works with both Dutch and English. Analyze the text and extract actionable tasks, even if they are described in a conversational or indirect manner.

First, detect the language of the input (Dutch or English).

Return the result as a JSON array where each task object has: 
1. task: The task description (clear, concise, actionable) in the SAME LANGUAGE as the input
2. criticality: Priority level (low/laag, normal/normaal, high/hoog, very high/zeer hoog)
3. due_date: Due date if mentioned (in YYYY-MM-DD format) or null if not specified
4. category: Best guess at category (Work/Werk, Family/Familie, Household/Huishouden, Personal/Persoonlijk, etc.)

For Dutch input, return Dutch task descriptions and Dutch category names. For English input, return English task descriptions and English category names. The criticality should match the language of the input.

Specific instructions:
- Infer priority based on language used
- Extract dates even if mentioned relatively (tomorrow/morgen, next week/volgende week, in two days/over twee dagen)
- If multiple tasks are mentioned, create separate entries for each
- If the speaker mentions a project, associate relevant tasks with that project
- Be flexible with informal language but deliver structured tasks
- Make task descriptions clear and actionable even if input is vague

Examples for English:
For "I need to call John about the project by tomorrow and also remember to send the report": 
[
  {"task":"Call John about the project", "criticality":"normal", "due_date":"2024-05-21", "category":"Work"},
  {"task":"Send the report", "criticality":"normal", "due_date":null, "category":"Work"}
]

Examples for Dutch:
For "Ik moet morgen Jan bellen over het project en ook niet vergeten het rapport te versturen": 
[
  {"task":"Jan bellen over het project", "criticality":"normaal", "due_date":"2024-05-21", "category":"Werk"},
  {"task":"Het rapport versturen", "criticality":"normaal", "due_date":null, "category":"Werk"}
]

Return tasks as a valid JSON array with no extra text.`
                        },
                        { role: 'user', content: transcribedText }
                    ],
                    temperature: 0.3 // Lower temperature for more consistent, focused responses
                })
            });

            console.log('GPT Chat response status:', chatResponse.status);

            if (!chatResponse.ok) {
                const errorData = await chatResponse.json();
                console.error('GPT Chat error:', errorData);
                throw new Error(`API Error: ${errorData.error?.message || 'Unknown error'}`);
            }

            const chatData = await chatResponse.json();
            console.log('GPT Chat response received:', chatData);

            let tasksArray = [];

            try {
                // Parse the response to extract the tasks
                const content = chatData.choices[0].message.content.trim();
                console.log('GPT response content:', content);
                
                // Attempt to extract JSON if it's wrapped in markdown code blocks
                const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || content.match(/\[([\s\S]*)\]/);
                const jsonString = jsonMatch ? jsonMatch[1] : content;
                console.log('Extracted JSON string:', jsonString);
                
                tasksArray = JSON.parse(jsonString.includes('[') ? jsonString : `[${jsonString}]`);
                console.log('Parsed tasks array:', tasksArray);
            } catch (parseError) {
                console.error('Error parsing tasks:', parseError);
                throw new Error('Failed to parse tasks from AI response');
            }

            // Add timestamp to each task
            tasksArray = tasksArray.map(task => ({
                ...task,
                timestamp: new Date().toISOString()
            }));

            console.log('=== TASKS EXTRACTED SUCCESSFULLY ===');
            console.log('Final tasks array:', tasksArray);

            // Add the new tasks to our storage
            allTasks = [...allTasks, ...tasksArray];
            saveTasks();

            // After successfully extracting tasks and before displaying them
            if (notionApiKey && notionDatabaseId) {
                try {
                    statusElement.textContent = preferDutch ? 
                        'Taken toevoegen aan Notion...' : 
                        'Adding tasks to Notion...';
                    
                    console.log('=== STARTING NOTION SYNC ===');
                    await addTasksToNotion(tasksArray);
                    console.log('=== NOTION SYNC SUCCESSFUL ===');
                    
                    // Show success message
                    const successMessage = document.createElement('div');
                    successMessage.className = 'status-message success';
                    successMessage.textContent = preferDutch ? 
                        `${tasksArray.length} taken succesvol toegevoegd aan Notion!` : 
                        `Successfully added ${tasksArray.length} tasks to Notion!`;
                    statusElement.parentNode.insertBefore(successMessage, statusElement.nextSibling);
                    
                    // Remove success message after 5 seconds
                    setTimeout(() => {
                        successMessage.remove();
                    }, 5000);
                } catch (notionError) {
                    console.error('=== NOTION SYNC ERROR ===');
                    console.error('Notion error details:', notionError);
                    
                    // Show error message
                    const errorMessage = document.createElement('div');
                    errorMessage.className = 'status-message error';
                    errorMessage.textContent = preferDutch ? 
                        `Fout bij toevoegen aan Notion: ${notionError.message}` : 
                        `Error adding to Notion: ${notionError.message}`;
                    statusElement.parentNode.insertBefore(errorMessage, statusElement.nextSibling);
                    
                    // Remove error message after 5 seconds
                    setTimeout(() => {
                        errorMessage.remove();
                    }, 5000);
                }
            }

            // Display all tasks
            displayTasks(allTasks);
            statusElement.textContent = preferDutch ? 
                'Klaar om nieuwe taken op te nemen' : 
                'Ready to record new tasks';
            
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                console.error('Whisper API request was aborted due to timeout');
                statusElement.textContent = preferDutch ? 
                    'Timeout: Probeer een kortere opname of controleer je internetverbinding' : 
                    'Timeout: Try a shorter recording or check your internet connection';
            } else {
                console.error('Network error during Whisper API call:', fetchError);
                throw fetchError;
            }
        }
        
    } catch (error) {
        console.error('=== ERROR IN PROCESSAUDIO ===');
        console.error('Error details:', error);
        
        // Default to Dutch for Striks branding
        const preferDutch = true;
        
        statusElement.textContent = preferDutch ? 
            `Fout: ${error.message}` : 
            `Error: ${error.message}`;
    }
}

// Function to detect if text is likely Dutch
function detectDutchLanguage(text) {
    const dutchWords = ['ik', 'je', 'het', 'de', 'en', 'een', 'dat', 'is', 'in', 'te', 'van', 'niet', 
                        'zijn', 'op', 'voor', 'met', 'als', 'maar', 'om', 'aan', 'er', 'nog', 'ook',
                        'moet', 'kan', 'zal', 'wil', 'gaan', 'maken', 'doen', 'hebben', 'worden',
                        'morgen', 'vandaag', 'gisteren', 'volgende', 'week', 'maand'];
    
    // Convert to lowercase and split into words
    const words = text.toLowerCase().split(/\s+/);
    
    // Count Dutch words
    const dutchWordCount = words.filter(word => dutchWords.includes(word)).length;
    
    // If more than 15% of words are recognized Dutch words, consider it Dutch
    return dutchWordCount / words.length > 0.15;
}

function displayTasks(tasks) {
    tasksContainer.classList.remove('hidden');
    tasksElement.innerHTML = '';
    
    if (tasks.length === 0) {
        tasksElement.innerHTML = '<p>Geen taken gevonden. Probeer opnieuw op te nemen met duidelijkere instructies.</p>';
        return;
    }
    
    tasks.forEach((task, index) => {
        const taskElement = document.createElement('div');
        taskElement.className = 'task-item';
        
        // Voeg category class toe voor styling
        if (task.category) {
            const categoryLower = task.category.toLowerCase();
            if (categoryLower.includes('werk') || categoryLower.includes('work')) {
                taskElement.classList.add('task-category-werk');
            } else if (categoryLower.includes('familie') || categoryLower.includes('family')) {
                taskElement.classList.add('task-category-familie');
            } else if (categoryLower.includes('huishouden') || categoryLower.includes('household')) {
                taskElement.classList.add('task-category-huishouden');
            } else if (categoryLower.includes('persoonlijk') || categoryLower.includes('personal')) {
                taskElement.classList.add('task-category-persoonlijk');
            }
        }
        
        // Voeg priority class toe voor styling
        if (task.criticality) {
            const criticalityLower = task.criticality.toLowerCase();
            if (criticalityLower.includes('high') || criticalityLower.includes('hoog') || 
                criticalityLower.includes('very') || criticalityLower.includes('zeer')) {
                taskElement.classList.add('priority-high');
            }
        }
        
        // Format due date
        let dueDateDisplay = task.due_date ? new Date(task.due_date).toLocaleDateString() : 
                                            (isTaskInDutch(task) ? 'Geen einddatum' : 'No due date');
        
        // Format priority label
        let priorityLabel = isTaskInDutch(task) ? 'Prioriteit: ' : 'Priority: ';
        
        // Format category label
        let categoryLabel = isTaskInDutch(task) ? 'Categorie: ' : 'Category: ';
        
        taskElement.innerHTML = `
            <div class="task-header">
                <h3>${task.task}</h3>
                <button class="delete-task-button" data-index="${index}">×</button>
            </div>
            <div class="task-metadata">
                <span>${priorityLabel}${task.criticality || 'normaal'}</span>
                <span>${isTaskInDutch(task) ? 'Deadline: ' : 'Due: '}${dueDateDisplay}</span>
                <span>${categoryLabel}${task.category || (isTaskInDutch(task) ? 'Overig' : 'Uncategorized')}</span>
            </div>
        `;
        
        tasksElement.appendChild(taskElement);
        
        // Add delete button event listener
        const deleteButton = taskElement.querySelector('.delete-task-button');
        deleteButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const taskIndex = parseInt(e.target.getAttribute('data-index'));
            deleteTask(taskIndex);
        });
    });
}

// Helper function to detect if a task is in Dutch
function isTaskInDutch(task) {
    // Check for Dutch criticality values
    const dutchCriticalities = ['laag', 'normaal', 'hoog', 'zeer hoog'];
    if (dutchCriticalities.includes(task.criticality?.toLowerCase())) {
        return true;
    }
    
    // Check for Dutch category values
    const dutchCategories = ['werk', 'familie', 'huishouden', 'persoonlijk', 'overig'];
    if (task.category && dutchCategories.some(cat => task.category.toLowerCase().includes(cat))) {
        return true;
    }
    
    return false;
}

function resetUI() {
    if (transcriptionContainer) transcriptionContainer.classList.add('hidden');
    if (tasksContainer) tasksContainer.classList.add('hidden');
    if (transcriptionElement) transcriptionElement.textContent = '';
    if (tasksElement) tasksElement.innerHTML = '';
    
    // Hide copy transcription button when transcription is cleared
    if (copyTranscriptionButton) {
        copyTranscriptionButton.classList.add('hidden');
    }
    
    // Get current UI language preference
    const isDutchUI = allTasks.length > 0 && 
                     allTasks.filter(task => isTaskInDutch(task)).length > allTasks.length / 2;
                     
    if (statusElement) {
        statusElement.textContent = isDutchUI ? 'Klaar om op te nemen' : 'Ready to record';
    }
    
    if (isRecording && mediaRecorder) {
        mediaRecorder.stop();
        if (mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        isRecording = false;
        if (recordButton) {
            recordButton.textContent = isDutchUI ? 'Start Opname' : 'Start Recording';
            recordButton.classList.remove('recording');
        }
    }
}

// Function to load saved Notion credentials
function loadNotionCredentials() {
    let savedNotionKey = sessionStorage.getItem('voiceTaskNotionApiKey');
    let savedNotionDbId = sessionStorage.getItem('voiceTaskNotionDatabaseId');

    if (savedNotionKey && savedNotionDbId) {
        console.log('Found Notion credentials in session storage');
        notionApiKey = savedNotionKey;
        notionDatabaseId = savedNotionDbId;
    } else {
        savedNotionKey = localStorage.getItem('voiceTaskNotionApiKey');
        savedNotionDbId = localStorage.getItem('voiceTaskNotionDatabaseId');
        const expiryDate = localStorage.getItem('voiceTaskNotionCredentialsExpiry');

        if (savedNotionKey && savedNotionDbId && expiryDate) {
            const now = new Date();
            const expiry = new Date(expiryDate);

            if (now < expiry) {
                console.log(`Found valid Notion credentials in local storage (expires: ${expiry.toLocaleDateString()})`);
                notionApiKey = savedNotionKey;
                notionDatabaseId = savedNotionDbId;
            } else {
                console.log('Notion credentials in local storage have expired, removing');
                localStorage.removeItem('voiceTaskNotionApiKey');
                localStorage.removeItem('voiceTaskNotionDatabaseId');
                localStorage.removeItem('voiceTaskNotionCredentialsExpiry');
            }
        }
    }
}

// Function to save Notion credentials
async function saveNotionCredentials() {
    // This function is now handled by the settings panel
    // Just load existing credentials if any
    console.log('saveNotionCredentials called - credentials are now managed via settings panel');
}

// Function to populate the Notion field mapping UI
function populateNotionMappingUI(schema) {
    const mappingSection = document.getElementById('notion-mapping-section');
    if (!mappingSection) {
        console.error('Notion mapping section not found');
        return;
    }

    // Show the mapping section
    mappingSection.classList.remove('hidden');

    // Get all select elements
    const taskNameSelect = document.getElementById('map-notion-task-name');
    const prioritySelect = document.getElementById('map-notion-priority');
    const dueDateSelect = document.getElementById('map-notion-due-date');
    const categorySelect = document.getElementById('map-notion-category');
    const statusSelect = document.getElementById('map-notion-status');

    // Clear existing options except the first one
    [taskNameSelect, prioritySelect, dueDateSelect, categorySelect, statusSelect].forEach(select => {
        if (select) {
            while (select.options.length > 1) {
                select.remove(1);
            }
        }
    });

    // Add options based on schema
    Object.entries(schema).forEach(([propertyName, property]) => {
        const option = document.createElement('option');
        option.value = propertyName;
        option.textContent = propertyName;
        
        // Add to appropriate select based on property type
        switch (property.type) {
            case 'title':
                taskNameSelect?.appendChild(option.cloneNode(true));
                break;
            case 'select':
                if (propertyName.toLowerCase().includes('priority') || 
                    propertyName.toLowerCase().includes('prioriteit')) {
                    prioritySelect?.appendChild(option.cloneNode(true));
                } else if (propertyName.toLowerCase().includes('category') || 
                         propertyName.toLowerCase().includes('categorie')) {
                    categorySelect?.appendChild(option.cloneNode(true));
                } else if (propertyName.toLowerCase().includes('status')) {
                    statusSelect?.appendChild(option.cloneNode(true));
                }
                break;
            case 'date':
                dueDateSelect?.appendChild(option.cloneNode(true));
                break;
        }
    });

    // Load saved mapping if it exists
    loadNotionFieldMapping();
}

// Function to save the Notion field mapping
function saveNotionFieldMapping() {
    const mapping = {
        taskName: document.getElementById('map-notion-task-name')?.value || '',
        priority: document.getElementById('map-notion-priority')?.value || '',
        dueDate: document.getElementById('map-notion-due-date')?.value || '',
        category: document.getElementById('map-notion-category')?.value || '',
        status: document.getElementById('map-notion-status')?.value || '',
        statusOption: document.getElementById('map-notion-status-option')?.value || ''
    };

    // Save to localStorage
    localStorage.setItem('notionFieldMapping', JSON.stringify(mapping));
    
    // Show success message
    const statusElement = document.getElementById('notion-mapping-status');
    if (statusElement) {
        statusElement.textContent = 'Mapping succesvol opgeslagen!';
        statusElement.className = 'status-message success';
        setTimeout(() => {
            statusElement.textContent = '';
            statusElement.className = 'status-message';
        }, 3000);
    }
}

// Function to load saved Notion field mapping
function loadNotionFieldMapping() {
    const savedMapping = localStorage.getItem('notionFieldMapping');
    if (!savedMapping) return;

    try {
        const mapping = JSON.parse(savedMapping);
        
        // Set values in select elements
        if (mapping.taskName) document.getElementById('map-notion-task-name').value = mapping.taskName;
        if (mapping.priority) document.getElementById('map-notion-priority').value = mapping.priority;
        if (mapping.dueDate) document.getElementById('map-notion-due-date').value = mapping.dueDate;
        if (mapping.category) document.getElementById('map-notion-category').value = mapping.category;
        if (mapping.status) {
            const statusSelect = document.getElementById('map-notion-status');
            statusSelect.value = mapping.status;
            // Trigger change event to show status options if needed
            statusSelect.dispatchEvent(new Event('change'));
            if (mapping.statusOption) {
                document.getElementById('map-notion-status-option').value = mapping.statusOption;
            }
        }
    } catch (error) {
        console.error('Error loading Notion field mapping:', error);
    }
}

// Function to update status options when status field is selected
function updateStatusOptions(propertyName) {
    const statusOptionSelect = document.getElementById('map-notion-status-option');
    if (!statusOptionSelect || !notionDatabaseSchema) return;
    
    // Clear existing options
    statusOptionSelect.innerHTML = '<option value="">-- Selecteer Standaard Optie --</option>';
    
    const property = notionDatabaseSchema[propertyName];
    if (property && property.type === 'select' && property.select && property.select.options) {
        property.select.options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.name;
            optionElement.textContent = option.name;
            statusOptionSelect.appendChild(optionElement);
        });
    }
}

// Add event listeners for mapping UI
function setupNotionMappingListeners() {
    // Save mapping button
    const saveButton = document.getElementById('save-notion-mapping-button');
    if (saveButton) {
        saveButton.addEventListener('click', saveNotionFieldMapping);
    }

    // Status field change handler
    const statusSelect = document.getElementById('map-notion-status');
    if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
            updateStatusOptions(e.target.value);
        });
    }
}

// Modify the existing fetchNotionDatabaseSchema function to call populateNotionMappingUI
async function fetchNotionDatabaseSchema() {
    if (!notionApiKey || !notionDatabaseId) {
        console.warn('Notion API Key or Database ID is missing. Cannot fetch schema.');
        return false;
    }

    console.log(`Fetching schema for database ID: ${notionDatabaseId}`);

    try {
        const response = await fetch(`https://api.notion.com/v1/databases/${notionDatabaseId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${notionApiKey}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => response.text());
            console.error('Error fetching Notion database schema:', errorData);
            notionDatabaseSchema = null;
            return false;
        }

        const schemaData = await response.json();
        notionDatabaseSchema = schemaData.properties;
        console.log('Successfully fetched Notion database schema:', notionDatabaseSchema);
        
        // Populate the mapping UI with the schema
        populateNotionMappingUI(notionDatabaseSchema);
        
        // Setup event listeners for the mapping UI
        setupNotionMappingListeners();
        
        return true;

    } catch (error) {
        console.error('Exception while fetching Notion database schema:', error);
        notionDatabaseSchema = null;
        return false;
    }
}

// Function to format a task for Notion API
function formatTaskForNotion(task) {
    const mapping = JSON.parse(localStorage.getItem('notionFieldMapping') || '{}');
    
    // Start with the required parent database
    const notionTask = {
        parent: { database_id: notionDatabaseId },
        properties: {}
    };
    
    // Map task name to title property
    if (mapping.taskName) {
        notionTask.properties[mapping.taskName] = {
            title: [
                {
                    text: {
                        content: task.task
                    }
                }
            ]
        };
    }
    
    // Map priority
    if (mapping.priority && task.criticality) {
        notionTask.properties[mapping.priority] = {
            select: {
                name: task.criticality
            }
        };
    }
    
    // Map due date
    if (mapping.dueDate && task.due_date) {
        notionTask.properties[mapping.dueDate] = {
            date: {
                start: task.due_date
            }
        };
    }
    
    // Map category
    if (mapping.category && task.category) {
        notionTask.properties[mapping.category] = {
            select: {
                name: task.category
            }
        };
    }
    
    // Map status if configured
    if (mapping.status && mapping.statusOption) {
        notionTask.properties[mapping.status] = {
            select: {
                name: mapping.statusOption
            }
        };
    }
    
    return notionTask;
}

// Function to add tasks to Notion
async function addTasksToNotion(tasks) {
    if (!notionApiKey || !notionDatabaseId) {
        console.warn('Notion API Key or Database ID is missing');
        return false;
    }
    
    const mapping = JSON.parse(localStorage.getItem('notionFieldMapping') || '{}');
    if (!mapping.taskName) {
        console.warn('Notion field mapping is not configured');
        return false;
    }
    
    try {
        const results = [];
        for (const task of tasks) {
            const notionTask = formatTaskForNotion(task);
            
            const response = await fetch('https://api.notion.com/v1/pages', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${notionApiKey}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(notionTask)
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => response.text());
                console.error('Error adding task to Notion:', errorData);
                throw new Error(`Failed to add task to Notion: ${errorData.error?.message || errorData}`);
            }
            
            const result = await response.json();
            results.push(result);
        }
        
        return results;
    } catch (error) {
        console.error('Error in addTasksToNotion:', error);
        throw error;
    }
}

// Settings Panel Functions
function initializeSettingsPanel() {
    console.log('Initializing settings panel...');
    
    const settingsGearIcon = document.getElementById('settings-gear-icon');
    const settingsOverlay = document.getElementById('settings-overlay');
    const settingsCloseButton = document.getElementById('settings-close-button');
    const settingsCancelButton = document.getElementById('settings-cancel-button');
    const settingsSaveButton = document.getElementById('settings-save-button');
    const settingsTabs = document.querySelectorAll('.settings-tab');
    

    
    if (!settingsGearIcon || !settingsOverlay) {
        console.error('Settings panel elements not found');
        return;
    }
    
    // Open settings panel
    settingsGearIcon.addEventListener('click', () => {
        loadSettingsFromStorage();
        settingsOverlay.classList.remove('hidden');
    });
    
    // Close settings panel
    const closeSettings = () => {
        settingsOverlay.classList.add('hidden');
    };
    
    settingsCloseButton?.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSettings();
    });
    
    settingsCancelButton?.addEventListener('click', closeSettings);
    
    // Close on overlay click
    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) {
            closeSettings();
        }
    });
    
    // Save settings
    settingsSaveButton?.addEventListener('click', saveSettingsFromPanel);
    
    // Tab switching
    settingsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            switchSettingsTab(targetTab);
        });
    });
    
    // Initialize Notion mapping listeners for settings panel
    setupSettingsNotionMappingListeners();
    
    console.log('Settings panel initialized successfully');
}

function switchSettingsTab(targetTab) {
    // Remove active class from all tabs and content
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Add active class to clicked tab and corresponding content
    document.querySelector(`[data-tab="${targetTab}"]`).classList.add('active');
    document.getElementById(targetTab).classList.add('active');
}

function autoSaveDevelopmentKeys() {
    console.log('Auto-saving development API keys...');
    
    // Development API keys removed for security - users will enter their own keys
    const devOpenAIKey = '';
    const devNotionKey = '';
    const devNotionDbId = '';
    
    // Only save if no keys exist in storage yet
    credentialManager.retrieveCredentials().then(existingCredentials => {
        if (!existingCredentials.openaiApiKey && !existingCredentials.notionApiKey) {
            console.log('No existing credentials found - users will need to enter their own API keys');
            
            // Don't auto-save empty credentials
            if (devOpenAIKey && devNotionKey && devNotionDbId) {
                const devCredentials = {
                    openaiApiKey: devOpenAIKey,
                    notionApiKey: devNotionKey,
                    notionDatabaseId: devNotionDbId
                };
                
                credentialManager.storeCredentials(devCredentials).then(() => {
                    // Update global variables
                    apiKey = devOpenAIKey;
                    notionApiKey = devNotionKey;
                    notionDatabaseId = devNotionDbId;
                });
            }
        }
    });
}

async function loadSettingsFromStorage() {
    console.log('Loading settings from secure storage...');
    
    // Auto-save development API keys for easier testing
    autoSaveDevelopmentKeys();
    
    try {
        // Clean expired credentials first
        await credentialManager.cleanExpiredCredentials();
        
        // Retrieve credentials using enhanced method with service worker fallback
        const credentials = await credentialManager.retrieveCredentialsWithFallback();
        
        // Load OpenAI API Key
        const openaiKey = credentials.openaiApiKey || '';
        const openaiKeyInput = document.getElementById('settings-openai-key');
        if (openaiKeyInput) {
            openaiKeyInput.value = openaiKey;
        }
        
        // Update global variable
        if (openaiKey) {
            apiKey = openaiKey;
        }
        
        // Load Notion credentials
        const notionKey = credentials.notionApiKey || '';
        const notionDbId = credentials.notionDatabaseId || '';
        
        const notionKeyInput = document.getElementById('settings-notion-key');
        const notionDbIdInput = document.getElementById('settings-notion-database-id');
        
        if (notionKeyInput) notionKeyInput.value = notionKey;
        if (notionDbIdInput) notionDbIdInput.value = notionDbId;
        
        // Update global variables
        if (notionKey) notionApiKey = notionKey;
        if (notionDbId) notionDatabaseId = notionDbId;
        
        // Load Notion field mapping into settings panel
        loadSettingsNotionFieldMapping();
        
        // If we have Notion credentials, fetch schema for settings panel
        if (notionKey && notionDbId) {
            fetchNotionSchemaForSettings();
        }
        
        console.log('✅ Settings loaded successfully from secure storage');
        
    } catch (error) {
        console.error('Error loading settings from secure storage:', error);
        
        // Fallback to legacy storage for migration
        loadLegacyCredentials();
    }
}

// Migration function for legacy credentials
function loadLegacyCredentials() {
    console.log('🔄 Migrating from legacy storage...');
    
    // Check legacy localStorage/sessionStorage
    let legacyApiKey = sessionStorage.getItem('voiceTaskApiKey') || localStorage.getItem('voiceTaskApiKey') || '';
    let legacyNotionKey = localStorage.getItem('voiceTaskNotionApiKey') || '';
    let legacyNotionDbId = localStorage.getItem('voiceTaskNotionDatabaseId') || '';
    
    if (legacyApiKey || legacyNotionKey || legacyNotionDbId) {
        const credentials = {
            openaiApiKey: legacyApiKey,
            notionApiKey: legacyNotionKey,
            notionDatabaseId: legacyNotionDbId
        };
        
        // Migrate to new secure storage
        credentialManager.storeCredentials(credentials).then(() => {
            console.log('✅ Legacy credentials migrated to secure storage');
            
            // Update UI
            loadSettingsFromStorage();
        });
    }
}

async function saveSettingsFromPanel() {
    console.log('Saving settings from panel...');
    
    const openaiKeyInput = document.getElementById('settings-openai-key');
    const notionKeyInput = document.getElementById('settings-notion-key');
    const notionDbIdInput = document.getElementById('settings-notion-database-id');
    
    const openaiKey = openaiKeyInput?.value.trim() || '';
    const notionKey = notionKeyInput?.value.trim() || '';
    const notionDbId = notionDbIdInput?.value.trim() || '';
    
    // Validate OpenAI key
    if (openaiKey && !openaiKey.startsWith('sk-')) {
        alert('Ongeldige OpenAI API key. Deze moet beginnen met "sk-"');
        return;
    }
    
    try {
        // Store credentials using enhanced method with service worker backup
        const credentials = {
            openaiApiKey: openaiKey,
            notionApiKey: notionKey,
            notionDatabaseId: notionDbId
        };
        
        await credentialManager.storeCredentialsWithBackup(credentials);
        
        // Update global variables
        if (openaiKey) apiKey = openaiKey;
        if (notionKey) notionApiKey = notionKey;
        if (notionDbId) notionDatabaseId = notionDbId;
        
        // Save field mapping
        saveSettingsNotionFieldMapping();
        
        // Fetch schema if both are provided
        if (notionKey && notionDbId) {
            try {
                await fetchNotionSchemaForSettings();
            } catch (error) {
                console.error('Error fetching Notion schema:', error);
            }
        }
        
        // Close settings panel
        document.getElementById('settings-overlay').classList.add('hidden');
        
        // Show success message with enhanced persistence indicator
        const statusElement = document.getElementById('status');
        if (statusElement) {
            const originalText = statusElement.textContent;
            statusElement.textContent = '✅ Instellingen veilig opgeslagen met backup!';
            statusElement.style.backgroundColor = '#e8f5e9';
            statusElement.style.color = '#2e7d32';
            
            setTimeout(() => {
                statusElement.textContent = originalText;
                statusElement.style.backgroundColor = '';
                statusElement.style.color = '';
            }, 3000);
        }
        
        console.log('✅ Settings saved successfully with enhanced backup');
        
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Fout bij opslaan van instellingen. Probeer het opnieuw.');
    }
}

function setupSettingsNotionMappingListeners() {
    const statusSelect = document.getElementById('settings-map-status');
    const statusOptionSelect = document.getElementById('settings-map-status-option');
    
    if (statusSelect && statusOptionSelect) {
        statusSelect.addEventListener('change', function() {
            if (this.value) {
                updateSettingsStatusOptions(this.value);
                statusOptionSelect.classList.remove('hidden');
            } else {
                statusOptionSelect.classList.add('hidden');
            }
        });
    }
}

function loadSettingsNotionFieldMapping() {
    const savedMapping = localStorage.getItem('notionFieldMapping');
    if (!savedMapping) return;
    
    try {
        const mapping = JSON.parse(savedMapping);
        
        // Load task name mapping
        const taskNameSelect = document.getElementById('settings-map-task-name');
        if (taskNameSelect && mapping.taskName) {
            taskNameSelect.value = mapping.taskName;
        }
        
        // Load priority mapping
        const prioritySelect = document.getElementById('settings-map-priority');
        if (prioritySelect && mapping.priority) {
            prioritySelect.value = mapping.priority;
        }
        
        // Load due date mapping
        const dueDateSelect = document.getElementById('settings-map-due-date');
        if (dueDateSelect && mapping.dueDate) {
            dueDateSelect.value = mapping.dueDate;
        }
        
        // Load category mapping
        const categorySelect = document.getElementById('settings-map-category');
        if (categorySelect && mapping.category) {
            categorySelect.value = mapping.category;
        }
        
        // Load status mapping
        const statusSelect = document.getElementById('settings-map-status');
        const statusOptionSelect = document.getElementById('settings-map-status-option');
        if (statusSelect && mapping.status) {
            statusSelect.value = mapping.status;
            if (mapping.statusOption && statusOptionSelect) {
                updateSettingsStatusOptions(mapping.status);
                statusOptionSelect.classList.remove('hidden');
                statusOptionSelect.value = mapping.statusOption;
            }
        }
        
        console.log('Loaded field mapping into settings panel');
    } catch (error) {
        console.error('Error loading field mapping for settings panel:', error);
    }
}

function saveSettingsNotionFieldMapping() {
    const taskNameSelect = document.getElementById('settings-map-task-name');
    const prioritySelect = document.getElementById('settings-map-priority');
    const dueDateSelect = document.getElementById('settings-map-due-date');
    const categorySelect = document.getElementById('settings-map-category');
    const statusSelect = document.getElementById('settings-map-status');
    const statusOptionSelect = document.getElementById('settings-map-status-option');
    
    const mapping = {
        taskName: taskNameSelect?.value || '',
        priority: prioritySelect?.value || '',
        dueDate: dueDateSelect?.value || '',
        category: categorySelect?.value || '',
        status: statusSelect?.value || '',
        statusOption: statusOptionSelect?.value || ''
    };
    
    localStorage.setItem('notionFieldMapping', JSON.stringify(mapping));
    console.log('Saved field mapping from settings panel');
}

async function fetchNotionSchemaForSettings() {
    if (!notionApiKey || !notionDatabaseId) {
        console.log('Missing Notion credentials for schema fetch');
        return;
    }
    
    console.log('Fetching Notion schema for settings panel...');
    
    try {
        const response = await fetch(`https://api.notion.com/v1/databases/${notionDatabaseId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${notionApiKey}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        notionDatabaseSchema = data.properties;
        
        populateSettingsNotionMappingUI(data.properties);
        
        // Setup event listeners for the mapping UI
        setupSettingsNotionMappingListeners();
        
        console.log('Notion schema fetched successfully for settings panel');
    } catch (error) {
        console.error('Error fetching Notion schema for settings:', error);
        
        const statusElement = document.getElementById('settings-notion-mapping-status');
        if (statusElement) {
            statusElement.textContent = 'Fout bij ophalen database schema. Controleer je Notion configuratie.';
            statusElement.className = 'status-message error';
        }
    }
}

function populateSettingsNotionMappingUI(schema) {
    console.log('Populating settings Notion mapping UI with schema:', schema);
    
    // Get all select elements
    const taskNameSelect = document.getElementById('settings-map-task-name');
    const prioritySelect = document.getElementById('settings-map-priority');
    const dueDateSelect = document.getElementById('settings-map-due-date');
    const categorySelect = document.getElementById('settings-map-category');
    const statusSelect = document.getElementById('settings-map-status');
    
    const selects = [taskNameSelect, prioritySelect, dueDateSelect, categorySelect, statusSelect];
    
    // Clear all selects first (keep first option)
    selects.forEach(select => {
        if (select) {
            // Keep first option and clear rest
            const firstOption = select.firstElementChild;
            select.innerHTML = '';
            if (firstOption) {
                select.appendChild(firstOption);
            }
        }
    });
    
    // Add options based on schema with intelligent auto-mapping
    Object.entries(schema).forEach(([propertyName, propertyConfig]) => {
        const option = document.createElement('option');
        option.value = propertyName;
        option.textContent = `${propertyName} (${propertyConfig.type})`;
        
        // Add to appropriate select based on property type and intelligent mapping
        switch (propertyConfig.type) {
            case 'title':
                if (taskNameSelect) {
                    taskNameSelect.appendChild(option.cloneNode(true));
                    // Auto-select title field for task name
                    taskNameSelect.value = propertyName;
                }
                break;
            case 'select':
                const lowerName = propertyName.toLowerCase();
                if ((lowerName.includes('priority') || lowerName.includes('prioriteit')) && prioritySelect) {
                    prioritySelect.appendChild(option.cloneNode(true));
                    // Auto-select priority field
                    prioritySelect.value = propertyName;
                } else if ((lowerName.includes('category') || lowerName.includes('categorie')) && categorySelect) {
                    categorySelect.appendChild(option.cloneNode(true));
                    // Auto-select category field
                    categorySelect.value = propertyName;
                } else if (lowerName.includes('status') && statusSelect) {
                    statusSelect.appendChild(option.cloneNode(true));
                    // Auto-select status field
                    statusSelect.value = propertyName;
                    // Trigger status options update
                    updateSettingsStatusOptions(propertyName);
                    statusSelect.classList.remove('hidden');
                }
                // Also add to all other select fields as options
                selects.forEach(select => {
                    if (select && select !== taskNameSelect) {
                        const optionCopy = document.createElement('option');
                        optionCopy.value = propertyName;
                        optionCopy.textContent = `${propertyName} (${propertyConfig.type})`;
                        select.appendChild(optionCopy);
                    }
                });
                break;
            case 'date':
                if (dueDateSelect) {
                    dueDateSelect.appendChild(option.cloneNode(true));
                    // Auto-select date field for due date
                    dueDateSelect.value = propertyName;
                }
                // Also add to other selects
                selects.forEach(select => {
                    if (select && select !== dueDateSelect) {
                        const optionCopy = document.createElement('option');
                        optionCopy.value = propertyName;
                        optionCopy.textContent = `${propertyName} (${propertyConfig.type})`;
                        select.appendChild(optionCopy);
                    }
                });
                break;
            default:
                // Add to all selects for other property types
                selects.forEach(select => {
                    if (select) {
                        const optionCopy = document.createElement('option');
                        optionCopy.value = propertyName;
                        optionCopy.textContent = `${propertyName} (${propertyConfig.type})`;
                        select.appendChild(optionCopy);
                    }
                });
                break;
        }
    });
    
    // Save the automatically detected mapping
    saveSettingsNotionFieldMapping();
    
    // Then load any existing saved mapping (which may override the auto-detected values)
    loadSettingsNotionFieldMapping();
    
    console.log('Settings Notion mapping UI populated successfully with auto-mapping');
}

function updateSettingsStatusOptions(propertyName) {
    const statusOptionSelect = document.getElementById('settings-map-status-option');
    if (!statusOptionSelect || !notionDatabaseSchema) return;
    
    // Clear existing options
    statusOptionSelect.innerHTML = '<option value="">-- Selecteer Standaard Optie --</option>';
    
    const property = notionDatabaseSchema[propertyName];
    if (property && property.type === 'select' && property.select && property.select.options) {
        property.select.options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.name;
            optionElement.textContent = option.name;
            statusOptionSelect.appendChild(optionElement);
        });
    }
}

console.log('✅ All event listeners setup complete'); 

// Function to delete a specific task by index
function deleteTask(taskIndex) {
    if (taskIndex >= 0 && taskIndex < allTasks.length) {
        const deletedTask = allTasks[taskIndex];
        
        // Remove task from array
        allTasks.splice(taskIndex, 1);
        
        // Save updated tasks
        saveTasks();
        
        // Re-display remaining tasks
        if (allTasks.length > 0) {
            displayTasks(allTasks);
        } else {
            // No tasks left, show empty state
            tasksContainer.classList.remove('hidden');
            tasksElement.innerHTML = '<p>Geen taken meer. Start een nieuwe opname om taken toe te voegen.</p>';
        }
        
        // Update status
        const statusElement = document.getElementById('status');
        if (statusElement) {
            const isTaskInDutch = deletedTask.criticality && 
                                 ['laag', 'normaal', 'hoog', 'zeer hoog'].includes(deletedTask.criticality.toLowerCase());
            statusElement.textContent = isTaskInDutch ? 
                'Taak verwijderd' : 
                'Task deleted';
        }
        
        console.log(`Task deleted: ${deletedTask.task}`);
    } else {
        console.error('Invalid task index for deletion:', taskIndex);
    }
}

// Helper function to detect if a task is in Dutch