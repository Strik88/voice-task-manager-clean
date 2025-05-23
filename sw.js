// === VOICE TASK MANAGER SERVICE WORKER ===
// Enhanced for credential persistence and Android PWA support

const CACHE_NAME = 'voice-task-manager-v2';
const STATIC_CACHE_NAME = 'voice-task-static-v2';

// Files to cache for offline functionality
const STATIC_FILES = [
    '/',
    '/index.html',
    '/app.js',
    '/style.css',
    '/manifest.json'
];

// Install event - cache static files
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installing...');
    
    event.waitUntil(
        caches.open(STATIC_CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Caching static files');
                return cache.addAll(STATIC_FILES);
            })
            .then(() => {
                console.log('Service Worker: Static files cached successfully');
                // Force activation of new service worker
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('Service Worker: Error caching static files:', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activating...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== STATIC_CACHE_NAME && cacheName !== CACHE_NAME) {
                            console.log('Service Worker: Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('Service Worker: Activated successfully');
                // Take control of all pages
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }
    
    // Skip external API calls (OpenAI, Notion)
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) {
        return;
    }
    
    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                // Return cached version if available
                if (cachedResponse) {
                    console.log('Service Worker: Serving from cache:', event.request.url);
                    return cachedResponse;
                }
                
                // Fetch from network and cache for future use
                return fetch(event.request)
                    .then((networkResponse) => {
                        // Only cache successful responses
                        if (networkResponse.status === 200) {
                            const responseClone = networkResponse.clone();
                            caches.open(CACHE_NAME)
                                .then((cache) => {
                                    cache.put(event.request, responseClone);
                                });
                        }
                        return networkResponse;
                    })
                    .catch((error) => {
                        console.error('Service Worker: Network fetch failed:', error);
                        
                        // Return offline page for navigation requests
                        if (event.request.mode === 'navigate') {
                            return caches.match('/index.html');
                        }
                        
                        throw error;
                    });
            })
    );
});

// Background sync for credential backup (when network is available)
self.addEventListener('sync', (event) => {
    console.log('Service Worker: Background sync triggered:', event.tag);
    
    if (event.tag === 'credential-backup') {
        event.waitUntil(
            backupCredentialsToCloud()
        );
    }
});

// Message handling for credential management
self.addEventListener('message', (event) => {
    const { type, data } = event.data;
    
    switch (type) {
        case 'BACKUP_CREDENTIALS':
            handleCredentialBackup(data);
            break;
        case 'RESTORE_CREDENTIALS':
            handleCredentialRestore(event);
            break;
        case 'CLEAR_CACHE':
            clearAllCaches();
            break;
        default:
            console.log('Service Worker: Unknown message type:', type);
    }
});

// Credential backup to IndexedDB (more persistent than localStorage on Android)
async function handleCredentialBackup(credentials) {
    try {
        // Store in a dedicated IndexedDB that's less likely to be cleared
        const db = await openCredentialDB();
        const transaction = db.transaction(['backup'], 'readwrite');
        const store = transaction.objectStore('backup');
        
        await store.put({
            id: 'main-backup',
            credentials: credentials,
            timestamp: Date.now(),
            expiryDate: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
        });
        
        console.log('Service Worker: Credentials backed up to persistent storage');
    } catch (error) {
        console.error('Service Worker: Credential backup failed:', error);
    }
}

// Credential restoration
async function handleCredentialRestore(event) {
    try {
        const db = await openCredentialDB();
        const transaction = db.transaction(['backup'], 'readonly');
        const store = transaction.objectStore('backup');
        const result = await store.get('main-backup');
        
        if (result && result.expiryDate > Date.now()) {
            event.ports[0].postMessage({
                success: true,
                credentials: result.credentials
            });
        } else {
            event.ports[0].postMessage({
                success: false,
                error: 'No valid backup found'
            });
        }
    } catch (error) {
        console.error('Service Worker: Credential restore failed:', error);
        event.ports[0].postMessage({
            success: false,
            error: error.message
        });
    }
}

// Open dedicated credential backup database
function openCredentialDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('VoiceTaskCredentialBackup', 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('backup')) {
                const store = db.createObjectStore('backup', { keyPath: 'id' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

// Clear all caches
async function clearAllCaches() {
    try {
        const cacheNames = await caches.keys();
        await Promise.all(
            cacheNames.map(cacheName => caches.delete(cacheName))
        );
        console.log('Service Worker: All caches cleared');
    } catch (error) {
        console.error('Service Worker: Error clearing caches:', error);
    }
}

// Cloud backup (placeholder for future server-side backup)
async function backupCredentialsToCloud() {
    // TODO: Implement server-side credential backup for ultimate persistence
    console.log('Service Worker: Cloud backup not yet implemented');
}

// Notification for credential persistence issues
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    if (event.action === 'restore-credentials') {
        // Open app and trigger credential restore
        event.waitUntil(
            clients.openWindow('/?restore=true')
        );
    }
});

console.log('Service Worker: Loaded successfully'); 