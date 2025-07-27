// Content script for T&C Summarizer
// This script runs on all pages to detect T&C content

(function() {
    'use strict';
    
    // Check if this page might be a T&C page
    let isLikelyTC = false;
    
    // T&C detection patterns
    const tcPatterns = [
        /terms\s+of\s+service/i,
        /terms\s+of\s+use/i,
        /terms\s+and\s+conditions/i,
        /user\s+agreement/i,
        /privacy\s+policy/i,
        /end\s+user\s+license/i,
        /service\s+agreement/i,
        /legal\s+notice/i
    ];
    
    function detectTCPage() {
        // Check URL
        const url = window.location.href.toLowerCase();
        const pathname = window.location.pathname.toLowerCase();
        
        // Check for T&C indicators in URL
        const urlIndicators = [
            'terms', 'privacy', 'legal', 'policy', 'agreement', 'eula'
        ];
        
        for (const indicator of urlIndicators) {
            if (url.includes(indicator)) {
                isLikelyTC = true;
                break;
            }
        }
        
        // Check page title
        const title = document.title.toLowerCase();
        for (const pattern of tcPatterns) {
            if (pattern.test(title)) {
                isLikelyTC = true;
                break;
            }
        }
        
        // Check main headings
        const headings = document.querySelectorAll('h1, h2, h3');
        for (const heading of headings) {
            const text = heading.textContent.toLowerCase();
            for (const pattern of tcPatterns) {
                if (pattern.test(text)) {
                    isLikelyTC = true;
                    break;
                }
            }
            if (isLikelyTC) break;
        }
        
        // Store detection result
        if (isLikelyTC) {
            // Add a subtle indicator to the page
            addTCIndicator();
        }
    }
    
    function addTCIndicator() {
        // Only add indicator if it doesn't exist
        if (document.getElementById('tc-summarizer-indicator')) {
            return;
        }
        
        // Create floating indicator
        const indicator = document.createElement('div');
        indicator.id = 'tc-summarizer-indicator';
        indicator.innerHTML = `
            <div style="
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 10px 15px;
                border-radius: 25px;
                font-family: 'Segoe UI', sans-serif;
                font-size: 12px;
                z-index: 10000;
                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                cursor: pointer;
                transition: all 0.3s ease;
                backdrop-filter: blur(10px);
            " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                📄 T&C Detected
            </div>
        `;
        
        // Add click handler
        indicator.addEventListener('click', () => {
            // Open the extension popup
            chrome.runtime.sendMessage({
                action: 'openPopup'
            });
        });
        
        document.body.appendChild(indicator);
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
            if (indicator && indicator.parentNode) {
                indicator.style.opacity = '0.7';
                indicator.style.transform = 'scale(0.9)';
            }
        }, 10000);
    }
    
    // Advanced T&C content extraction
    function extractTCContent() {
        let content = '';
        
        // Priority selectors for T&C content
        const contentSelectors = [
            'main',
            '[role="main"]',
            '.terms-content',
            '.legal-content',
            '.privacy-content',
            '.policy-content',
            '.agreement-content',
            'article',
            '.content',
            '.main-content',
            '#content',
            '#main-content'
        ];
        
        // Try to find the main content container
        let contentContainer = null;
        for (const selector of contentSelectors) {
            contentContainer = document.querySelector(selector);
            if (contentContainer && contentContainer.innerText.length > 500) {
                break;
            }
        }
        
        // Fallback to body if no suitable container found
        if (!contentContainer) {
            contentContainer = document.body;
        }
        
        // Extract and clean text
        content = contentContainer.innerText || contentContainer.textContent || '';
        
        // Remove excessive whitespace
        content = content.replace(/\s+/g, ' ').trim();
        
        // Remove navigation and footer content
        content = content.replace(/^.*?(terms|privacy|legal|agreement|policy)/i, '$1');
        
        return content;
    }
    
    // Analyze page content for T&C characteristics
    function analyzeTCContent() {
        const content = extractTCContent();
        const lowerContent = content.toLowerCase();
        
        let score = 0;
        const indicators = [
            { pattern: /terms of service|terms of use/gi, weight: 15 },
            { pattern: /user agreement|service agreement/gi, weight: 15 },
            { pattern: /privacy policy|data collection/gi, weight: 10 },
            { pattern: /hereby agree|you agree/gi, weight: 10 },
            { pattern: /intellectual property/gi, weight: 8 },
            { pattern: /limitation of liability/gi, weight: 8 },
            { pattern: /termination|suspend|suspension/gi, weight: 7 },
            { pattern: /governing law|jurisdiction/gi, weight: 7 },
            { pattern: /dispute resolution|arbitration/gi, weight: 7 },
            { pattern: /prohibited uses|restrictions/gi, weight: 6 },
            { pattern: /account|registration/gi, weight: 5 },
            { pattern: /payment|billing|fees/gi, weight: 5 },
            { pattern: /cookies|tracking/gi, weight: 4 },
            { pattern: /third party|third-party/gi, weight: 3 }
        ];
        
        indicators.forEach(indicator => {
            const matches = content.match(indicator.pattern);
            if (matches) {
                score += matches.length * indicator.weight;
            }
        });
        
        // Normalize score to percentage
        const maxPossibleScore = 200; // Reasonable maximum
        const confidence = Math.min(100, Math.round((score / maxPossibleScore) * 100));
        
        return {
            isTC: confidence >= 30,
            confidence: confidence,
            content: content.substring(0, 10000), // Limit content length
            wordCount: content.split(/\s+/).length,
            keyIndicators: indicators.filter(ind => content.match(ind.pattern)).length
        };
    }
    
    // Message listener for communication with popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'getTCContent') {
            const analysis = analyzeTCContent();
            sendResponse(analysis);
        }
        return true; // Keep message channel open for async response
    });
    
    // Initialize detection when page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', detectTCPage);
    } else {
        detectTCPage();
    }
    
    // Re-detect on dynamic content changes
    let detectionTimeout;
    const observer = new MutationObserver(() => {
        clearTimeout(detectionTimeout);
        detectionTimeout = setTimeout(detectTCPage, 1000);
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
})();