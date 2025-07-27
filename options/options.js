// Options page functionality for T&C Summarizer Extension

// Initialize the options page
document.addEventListener('DOMContentLoaded', function() {
    checkChromeAPIs();
    initializeEventListeners();
});

// Check if Chrome APIs are available
function checkChromeAPIs() {
    if (typeof chrome === 'undefined' || !chrome.storage) {
        document.getElementById('api-error').style.display = 'block';
        console.error('Chrome extension APIs not available');
        return false;
    }
    return true;
}

// Initialize all event listeners
function initializeEventListeners() {
    document.getElementById('clear-cache-btn').addEventListener('click', clearCache);
    document.getElementById('export-data-btn').addEventListener('click', exportData);
}

// Clear cache
async function clearCache() {
    if (!checkChromeAPIs()) return;

    if (!confirm('Are you sure you want to clear all cached summaries?')) {
        return;
    }

    const btn = document.getElementById('clear-cache-btn');
    
    try {
        btn.disabled = true;
        btn.textContent = 'Clearing...';
        
        const items = await chrome.storage.local.get();
        const keysToRemove = Object.keys(items).filter(key => key.startsWith('summary_'));
        
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
            showMessage('success', `Cleared ${keysToRemove.length} cached summaries.`);
        } else {
            showMessage('success', 'No cached summaries to clear.');
        }
        
    } catch (error) {
        console.error('Error clearing cache:', error);
        showMessage('error', 'Error clearing cache. Please try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Clear Cache';
    }
}

// Export data
async function exportData() {
    if (!checkChromeAPIs()) return;

    const btn = document.getElementById('export-data-btn');
    
    try {
        btn.disabled = true;
        btn.textContent = 'Exporting...';
        
        const [syncData, localData] = await Promise.all([
            chrome.storage.sync.get(),
            chrome.storage.local.get()
        ]);
        
        const exportData = {
            settings: syncData,
            cache: localData,
            exportDate: new Date().toISOString(),
            version: '1.0',
            extensionName: 'T&C Summarizer'
        };
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `tc-summarizer-data-${new Date().toISOString().split('T')[0]}.json`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        showMessage('success', 'Data exported successfully!');
        
    } catch (error) {
        console.error('Error exporting data:', error);
        showMessage('error', 'Error exporting data. Please try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Export Data';
    }
}

// Show success/error messages
function showMessage(type, message) {
    const successDiv = document.getElementById('success-message');
    const errorDiv = document.getElementById('error-message');
    
    successDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    
    const targetDiv = type === 'success' ? successDiv : errorDiv;
    targetDiv.textContent = message;
    targetDiv.style.display = 'block';
    
    setTimeout(() => {
        targetDiv.style.display = 'none';
    }, 5000);
}

// Export functions for use by other scripts if needed
window.optionsPage = {
    clearCache,
    exportData,
    showMessage
};