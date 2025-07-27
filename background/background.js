// Background script for T&C Summarizer Extension

// Service worker event listeners
self.addEventListener('install', event => {
    console.log('Service worker installing');
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    console.log('Service worker activating');
    event.waitUntil(self.clients.claim());
});

// Setup function to initialize extension
async function initializeExtension() {
    try {
        // Wait a bit to ensure chrome APIs are available
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Check if chrome.storage is available
        if (!chrome.storage) {
            console.error('Chrome storage API not available');
            return;
        }

        // Set default settings
        await chrome.storage.sync.set({
            'auto_detect': true,
            'cache_summaries': true
        });
        console.log('Default settings initialized');

        // Check if chrome.alarms is available before using it
        if (chrome.alarms) {
            // Initialize periodic cache cleanup
            const alarms = await chrome.alarms.getAll();
            if (!alarms.some(alarm => alarm.name === 'cleanupCache')) {
                await chrome.alarms.create('cleanupCache', {
                    periodInMinutes: 60 * 24 // Run once per day
                });
                console.log('Cache cleanup alarm created');
            }
        } else {
            console.warn('Alarms API not available');
        }
    } catch (error) {
        console.error('Initialization error:', error);
    }
}

// Listen for installation/update
chrome.runtime.onInstalled.addListener((details) => {
    console.log('T&C Summarizer extension installed/updated:', details.reason);
    // Delay initialization to ensure all APIs are ready
    setTimeout(() => {
        initializeExtension();
    }, 500);
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Received message:', request.action);
    
    try {
        switch (request.action) {
            case 'getTCAnalysis':
                if (!sender.tab || !sender.tab.id) {
                    sendResponse({ error: 'No tab information available' });
                    return;
                }
                handleTCAnalysis(sender.tab.id, sendResponse);
                return true; // Keep message channel open

            case 'cacheSummary':
                cacheSummary(request.url, request.summary)
                    .then(() => sendResponse({ success: true }))
                    .catch(error => sendResponse({ success: false, error: error.message }));
                return true;

            case 'getCachedSummary':
                getCachedSummary(request.url, sendResponse);
                return true;

            default:
                console.warn('Unknown action:', request.action);
                sendResponse({ success: false, error: 'Unknown action' });
        }
    } catch (error) {
        console.error('Error handling message:', error);
        sendResponse({ success: false, error: error.message });
    }
});

// Tab update listener to detect T&C pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        try {
            checkIfTCPage(tab);
        } catch (error) {
            console.error('Error checking T&C page:', error);
        }
    }
});

function checkIfTCPage(tab) {
    if (!tab.url) return;
    
    // Check if URL suggests this might be a T&C page
    const url = tab.url.toLowerCase();
    const tcKeywords = ['terms', 'privacy', 'legal', 'policy', 'agreement', 'eula'];
    
    const isTCUrl = tcKeywords.some(keyword => url.includes(keyword));
    
    if (isTCUrl) {
        // Set badge to indicate T&C page detected
        chrome.action.setBadgeText({
            tabId: tab.id,
            text: 'T&C'
        }).catch(error => console.error('Error setting badge text:', error));
        
        chrome.action.setBadgeBackgroundColor({
            tabId: tab.id,
            color: '#4CAF50'
        }).catch(error => console.error('Error setting badge color:', error));
    } else {
        // Clear badge for non-T&C pages
        chrome.action.setBadgeText({
            tabId: tab.id,
            text: ''
        }).catch(error => console.error('Error clearing badge:', error));
    }
}

async function handleTCAnalysis(tabId, sendResponse) {
    try {
        // Check if scripting API is available
        if (!chrome.scripting) {
            throw new Error('Scripting API not available');
        }

        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: () => {
                const extractTextContent = () => {
                    // Common selectors for main content
                    const selectors = [
                        'main',
                        'article',
                        '.terms-content',
                        '.policy-content',
                        '.privacy-content',
                        '#terms',
                        '#privacy-policy',
                        '.legal-content',
                        '[class*="terms"]',
                        '[class*="privacy"]',
                        '[class*="policy"]'
                    ];

                    let content = '';
                    for (const selector of selectors) {
                        const element = document.querySelector(selector);
                        if (element && element.innerText.trim().length > 500) {
                            content = element.innerText;
                            break;
                        }
                    }

                    // If no content found through selectors, get body text
                    if (!content || content.trim().length < 500) {
                        const bodyText = document.body.innerText;
                        // Only use body text if it seems substantial
                        if (bodyText.trim().length > 500) {
                            content = bodyText;
                        }
                    }

                    // Clean up the content
                    return content.trim().substring(0, 50000); // Limit to 50k characters
                };

                return {
                    text: extractTextContent(),
                    url: window.location.href,
                    title: document.title
                };
            }
        });
        
        const result = results[0]?.result;
        if (result && result.text) {
            sendResponse(result);
        } else {
            sendResponse({ error: 'No content found' });
        }
    } catch (error) {
        console.error('Error analyzing T&C content:', error);
        sendResponse({ error: error.message });
    }
}

async function cacheSummary(url, summary) {
    if (!chrome.storage || !chrome.storage.local) {
        throw new Error('Storage API not available');
    }

    const cacheKey = `summary_${btoa(encodeURIComponent(url)).slice(0, 50)}`;
    const cacheData = {
        summary: summary,
        timestamp: Date.now(),
        url: url
    };
    
    try {
        await chrome.storage.local.set({ [cacheKey]: cacheData });
        console.log('Summary cached successfully');
    } catch (error) {
        console.error('Error caching summary:', error);
        throw error;
    }
}

async function getCachedSummary(url, sendResponse) {
    try {
        if (!chrome.storage || !chrome.storage.local) {
            sendResponse(null);
            return;
        }

        const cacheKey = `summary_${btoa(encodeURIComponent(url)).slice(0, 50)}`;
        
        const result = await chrome.storage.local.get([cacheKey]);
        const cached = result[cacheKey];
        
        if (cached) {
            // Check if cache is still valid (24 hours)
            const isValid = (Date.now() - cached.timestamp) < (24 * 60 * 60 * 1000);
            sendResponse(isValid ? cached.summary : null);
        } else {
            sendResponse(null);
        }
    } catch (error) {
        console.error('Error getting cached summary:', error);
        sendResponse(null);
    }
}

async function cleanupOldCache() {
    try {
        if (!chrome.storage || !chrome.storage.local) {
            console.warn('Storage API not available for cleanup');
            return;
        }

        const items = await chrome.storage.local.get(null);
        const keysToRemove = [];
        const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        
        Object.keys(items).forEach(key => {
            if (key.startsWith('summary_') && 
                items[key].timestamp && 
                items[key].timestamp < oneWeekAgo) {
                keysToRemove.push(key);
            }
        });
        
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
            console.log(`Cleaned up ${keysToRemove.length} old cache entries`);
        }
    } catch (error) {
        console.error('Error during cache cleanup:', error);
    }
}

// Alarm listener with proper error handling
if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
        try {
            if (alarm.name === 'cleanupCache') {
                await cleanupOldCache();
            }
        } catch (error) {
            console.error('Error in alarm listener:', error);
        }
    });
} else {
    console.warn('Alarms API not available - cache cleanup disabled');
}

// Error handling for unhandled promise rejections
self.addEventListener('unhandledrejection', event => {
    console.error('Unhandled promise rejection:', event.reason);
    event.preventDefault();
});

// Keep service worker alive
chrome.runtime.onStartup.addListener(() => {
    console.log('Extension startup');
});